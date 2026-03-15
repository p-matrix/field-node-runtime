// =============================================================================
// @pmatrix/field-node-runtime — state-vector-builder.ts
// 4.0 Protocol Stage 1: State Vector 5요소 구성
//
// Input:  4-axis values (from 3.5 monitor) + lifecycle + policy_digest
// Output: StateVector (to be sent via PeerExchangeClient)
//
// References:
//   - Field 구현 설계 v0.4 §5.1 (State Vector 5요소)
//   - Field 개발기획서 v1.2 §4-3
// =============================================================================

import { createHash } from 'node:crypto';
import type {
  StateVector,
  RiskInfo,
  LifecycleInfo,
  FreshnessEvidence,
  IntegrityEvidence,
} from './types.js';

// ─── R(t) computation (mirrors server core/rt_compute.py) ─────────────────────
//
// Formula: R(t) = 1 - (baseline + norm + (1 - stability) + meta_control) / 4
// Stability polarity: higher stability score = more instability.
// Server inverts it — local computation does the same.
//

export function computeRt(
  baseline: number,
  norm: number,
  stability: number,
  meta_control: number,
): number {
  const rt = 1 - (baseline + norm + (1 - stability) + meta_control) / 4;
  return Math.max(0, Math.min(1, parseFloat(rt.toFixed(4))));
}

function modeFromRt(rt: number): string {
  if (rt >= 0.75) return 'Isolated';
  if (rt >= 0.50) return 'Restricted';
  if (rt >= 0.25) return 'Caution';
  return 'Normal';
}

// ─── Phase 1 Integrity: SHA-256 of payload ───────────────────────────────────
//
// Phase 2+: replace with ed25519 signing using a real key pair.
//

function buildIntegrity(
  nodeId: string,
  payload: string,
): IntegrityEvidence {
  const sig = 'sha256:' + createHash('sha256').update(payload).digest('hex');
  return { signature: sig, node_id: nodeId };
}

// ─── StateVectorBuilder ───────────────────────────────────────────────────────

export interface BuildStateVectorInput {
  nodeId: string;
  baseline: number;
  norm: number;
  stability: number;
  meta_control: number;
  currentMode?: string;
  modeSince?: string;
  loopCount?: number;
  policyDigest: string;
  ttlSeconds?: number;
}

/**
 * Build a 4.0 State Vector from 3.5 monitor axis values.
 *
 * Called each time the monitor has new axis data and wants to
 * broadcast its current state to peers (Stage 1 Exchange).
 */
export function buildStateVector(input: BuildStateVectorInput): StateVector {
  const {
    nodeId,
    baseline,
    norm,
    stability,
    meta_control,
    loopCount = 0,
    policyDigest,
    ttlSeconds = 30,
  } = input;

  const r_t = computeRt(baseline, norm, stability, meta_control);
  const mode = input.currentMode ?? modeFromRt(r_t);
  const now = new Date().toISOString();

  const riskInfo: RiskInfo = {
    baseline: parseFloat(baseline.toFixed(4)),
    norm: parseFloat(norm.toFixed(4)),
    stability: parseFloat(stability.toFixed(4)),
    meta_control: parseFloat(meta_control.toFixed(4)),
    r_t,
    mode,
  };

  const lifecycleInfo: LifecycleInfo = {
    current_mode: mode,
    mode_since: input.modeSince ?? now,
    loop_count: loopCount,
  };

  const freshnessEvidence: FreshnessEvidence = {
    timestamp: now,
    ttl_seconds: ttlSeconds,
  };

  // Integrity over deterministic payload (without integrity field itself)
  const corePayload = JSON.stringify({ riskInfo, lifecycleInfo, policyDigest, freshnessEvidence, nodeId });
  const integrityEvidence = buildIntegrity(nodeId, corePayload);

  return {
    risk_info: riskInfo,
    lifecycle_info: lifecycleInfo,
    policy_digest: policyDigest,
    freshness_evidence: freshnessEvidence,
    integrity_evidence: integrityEvidence,
  };
}
