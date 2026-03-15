// =============================================================================
// @pmatrix/field-node-runtime — index.ts
// P-MATRIX 4.0 Field Node Runtime
//
// Public API for CLI Monitor integration (3.5 → 4.0 opt-in).
//
// Usage:
//   import { FieldNode } from '@pmatrix/field-node-runtime';
//
//   const node = new FieldNode({ ...config });
//   node.pep.registerCallback((peerId, posture, reason) => {
//     // integrate with existing Safety Gate
//   });
//   node.start();
//   node.sendStateVector({ baseline, norm, stability, meta_control, loopCount });
//
// Field mode activation:
//   PMATRIX_FIELD_MODE=true  (env var) → 4.0 protocol active
//   PMATRIX_FIELD_MODE=false (default) → 3.5 only, no WS connection
//
// References:
//   - Field 개발기획서 v1.2 §2-2 (결정 2: CLI Monitor 공통 Node Runtime)
//   - Field 개발기획서 v1.2 §2-2 (결정 5: 3.5 기반 유지 + 4.0 탑재)
// =============================================================================

export { buildStateVector, computeRt } from './state-vector-builder.js';
export type { BuildStateVectorInput } from './state-vector-builder.js';

export { verifyStateVector } from './local-verifier.js';
export type { LocalVerifierOptions } from './local-verifier.js';

export { decide, applyFieldAdvisory, getPeerPosture, resetPostures } from './local-decider.js';
export type { LocalDeciderOptions } from './local-decider.js';

export { LocalPEP } from './local-pep.js';
export type { EnforcementCallback } from './local-pep.js';

export { AuditEmitter } from './audit-emitter.js';
export type { AuditEmitterOptions } from './audit-emitter.js';

export { PeerExchangeClient } from './peer-exchange-client.js';
export type { PeerExchangeClientOptions, PeerExchangeCallbacks } from './peer-exchange-client.js';

export { isField4Enabled, buildFieldConfigFromEnv } from './field-guard.js';

export { writeFieldState, readFieldState, deleteFieldState, getFieldSessionsDir } from './file-adapter.js';
export type { FieldState } from './file-adapter.js';

export type {
  StateVector,
  RiskInfo,
  LifecycleInfo,
  FreshnessEvidence,
  IntegrityEvidence,
  VerificationResult,
  VerificationCheck,
  VerificationStatus,
  ModeTransition,
  PeerPosture,
  PepResult,
  AuditEvent,
  AuditStage,
  FieldNodeConfig,
  PartialFieldNodeConfig,
  WsEnvelope,
} from './types.js';

// ─── FieldNode: Convenience facade ───────────────────────────────────────────

import { buildStateVector } from './state-vector-builder.js';
import { LocalPEP } from './local-pep.js';
import { AuditEmitter } from './audit-emitter.js';
import { PeerExchangeClient } from './peer-exchange-client.js';
import { resetPostures } from './local-decider.js';
import type { PartialFieldNodeConfig, FieldNodeConfig } from './types.js';
import type { PeerExchangeCallbacks } from './peer-exchange-client.js';

const FIELD_MODE_ENABLED = process.env['PMATRIX_FIELD_MODE'] === 'true';

export interface FieldNodeInput {
  baseline: number;
  norm: number;
  stability: number;
  meta_control: number;
  loopCount?: number;
  currentMode?: string;
  modeSince?: string;
  degraded?: boolean;  // true = axes are neutral placeholders, not measured values
}

/**
 * FieldNode: top-level facade for CLI Monitor integration.
 *
 * 3.5 → 4.0 upgrade path:
 *   - 3.5 (telemetry + Safety Gate) runs as before — unchanged
 *   - 4.0 Node Runtime is layered on top
 *   - PMATRIX_FIELD_MODE=false → only 3.5 active (backward compat)
 *   - PMATRIX_FIELD_MODE=true  → both 3.5 and 4.0 active
 */
export class FieldNode {
  readonly pep: LocalPEP;
  readonly auditEmitter: AuditEmitter;
  private exchangeClient: PeerExchangeClient | null = null;
  private readonly config: Required<FieldNodeConfig>;
  private started = false;

  constructor(config: PartialFieldNodeConfig, callbacks?: PeerExchangeCallbacks) {
    this.config = {
      serverWsUrl: config.serverWsUrl,
      serverApiUrl: config.serverApiUrl,
      apiKey: config.apiKey,
      nodeId: config.nodeId,
      fieldId: config.fieldId,
      policyDigest: config.policyDigest,
      svTtlSeconds: config.svTtlSeconds ?? 30,
      fieldModeEnabled: config.fieldModeEnabled ?? FIELD_MODE_ENABLED,
      cautionThreshold: config.cautionThreshold ?? 0.50,
      restrictThreshold: config.restrictThreshold ?? 0.75,
      debug: config.debug ?? false,
    };

    this.pep = new LocalPEP();
    this.auditEmitter = new AuditEmitter({
      serverApiUrl: this.config.serverApiUrl,
      apiKey: this.config.apiKey,
      nodeId: this.config.nodeId,
      fieldId: this.config.fieldId,
      debug: this.config.debug,
    });

    if (this.config.fieldModeEnabled) {
      this.exchangeClient = new PeerExchangeClient({
        wsUrl: `${this.config.serverWsUrl}/v1/fields/${this.config.fieldId}/exchange`,
        apiKey: this.config.apiKey,
        nodeId: this.config.nodeId,
        fieldId: this.config.fieldId,
        localPolicyDigest: this.config.policyDigest,
        pep: this.pep,
        auditEmitter: this.auditEmitter,
        deciderOptions: {
          cautionThreshold: this.config.cautionThreshold,
          restrictThreshold: this.config.restrictThreshold,
        },
        callbacks,
        debug: this.config.debug,
      });
    }
  }

  /** Start Field Node (connect WS + start audit flush) */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.config.fieldModeEnabled) {
      this.exchangeClient?.connect();
      this.auditEmitter.start();
    }
  }

  /** Send a new State Vector based on current 3.5 monitor axes */
  sendStateVector(input: FieldNodeInput): void {
    if (!this.config.fieldModeEnabled || !this.started) return;

    const sv = buildStateVector({
      nodeId: this.config.nodeId,
      baseline: input.baseline,
      norm: input.norm,
      stability: input.stability,
      meta_control: input.meta_control,
      loopCount: input.loopCount,
      currentMode: input.currentMode,
      modeSince: input.modeSince,
      policyDigest: this.config.policyDigest,
      ttlSeconds: this.config.svTtlSeconds,
    });

    this.exchangeClient?.sendStateVector(sv);

    // Degraded SV: axes are neutral placeholders, not measured values
    if (input.degraded) {
      this.auditEmitter.emit({
        field_id: this.config.fieldId,
        node_id: this.config.nodeId,
        stage: 'exchange',
        event_type: 'sv_send_degraded',
        payload: { risk_info_degraded: true, reason: 'individual_axes_unavailable' },
        created_at: new Date().toISOString(),
      });
    }
  }

  /** Stop Field Node (disconnect + flush audit) */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    this.exchangeClient?.destroy();
    await this.auditEmitter.stop();
    resetPostures();
  }

  get isFieldModeEnabled(): boolean {
    return this.config.fieldModeEnabled;
  }

  get isConnected(): boolean {
    return this.exchangeClient?.isConnected ?? false;
  }

  get peerCount(): number {
    return this.exchangeClient?.peerCount ?? 0;
  }

  get fieldId(): string {
    return this.config.fieldId;
  }
}

