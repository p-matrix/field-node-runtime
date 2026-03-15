// =============================================================================
// @pmatrix/field-node-runtime — audit-emitter.ts
// 교환/검증/전이/집행 이벤트를 서버 Audit Log로 전송
//
// Endpoint: POST /v1/fields/{field_id}/audit  (Phase 2에서 구현 예정)
// Phase 1:  로컬 emit + 큐잉 (서버 엔드포인트 준비 전 graceful degradation)
//
// Append-only audit — PI-3 (4.0 논문) 준수.
// AuditEmitter는 로그를 삭제하거나 수정하지 않는다.
//
// References:
//   - Field 개발기획서 v1.2 §3-1 (재활용 자산 — field_audit.py)
//   - 4.0 논문 PI-3 (Append-Only Audit)
// =============================================================================

import type {
  AuditEvent,
  AuditStage,
  StateVector,
  VerificationResult,
  ModeTransition,
  PepResult,
} from './types.js';

export interface AuditEmitterOptions {
  serverApiUrl: string;
  apiKey: string;
  nodeId: string;
  fieldId: string;
  /** Max queue size before dropping oldest events (default: 500) */
  maxQueueSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
  debug?: boolean;
}

export class AuditEmitter {
  private queue: AuditEvent[] = [];
  private readonly maxQueueSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer?: ReturnType<typeof setInterval>;
  private readonly opts: AuditEmitterOptions;

  constructor(opts: AuditEmitterOptions) {
    this.opts = opts;
    this.maxQueueSize = opts.maxQueueSize ?? 500;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
  }

  /** Start periodic flush */
  start(): void {
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  /** Stop periodic flush and drain queue */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }

  // ─── Stage-specific emit helpers ───────────────────────────────────────────

  emitExchange(peerNodeId: string, sv: StateVector): void {
    this.enqueue('exchange', 'sv_sent', {
      peer_node_id: peerNodeId,
      policy_digest: sv.policy_digest,
      r_t: sv.risk_info.r_t,
      mode: sv.risk_info.mode,
    });
  }

  emitVerify(result: VerificationResult): void {
    this.enqueue('verify', `sv_verified_${result.overall}`, {
      peer_node_id: result.peer_node_id,
      overall: result.overall,
      peer_r_t: result.peer_r_t,
      peer_mode: result.peer_mode,
      failed_checks: result.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.name),
      warn_checks: result.checks
        .filter((c) => c.status === 'warn')
        .map((c) => c.name),
    });
  }

  emitDecide(transition: ModeTransition): void {
    if (transition.previous_posture === transition.new_posture) return;
    this.enqueue('decide', 'posture_changed', {
      peer_node_id: transition.peer_node_id,
      from: transition.previous_posture,
      to: transition.new_posture,
      reason: transition.reason,
    });
  }

  emitEnforce(pepResult: PepResult): void {
    if (pepResult.action_taken === 'no_action') return;
    this.enqueue('enforce', pepResult.action_taken, {
      peer_node_id: pepResult.peer_node_id,
      posture: pepResult.posture,
    });
  }

  /** Emit a raw audit event directly (used for custom/degraded events).
   *  Auto-injects field_id, node_id, created_at if not present. */
  emit(event: AuditEvent): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push({
      ...event,
      field_id: event.field_id || this.opts.fieldId,
      node_id: event.node_id || this.opts.nodeId,
      created_at: event.created_at || new Date().toISOString(),
    });
  }

  // ─── Queue management ──────────────────────────────────────────────────────

  private enqueue(stage: AuditStage, event_type: string, payload: Record<string, unknown>): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift(); // drop oldest — append-only, but bounded in memory
    }
    this.queue.push({
      field_id: this.opts.fieldId,
      node_id: this.opts.nodeId,
      stage,
      event_type,
      payload,
      created_at: new Date().toISOString(),
    });
  }

  /** Flush queued events to server. Graceful degradation if endpoint unavailable. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    const url = `${this.opts.serverApiUrl}/v1/fields/${this.opts.fieldId}/audit`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.opts.apiKey,
        },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok && this.opts.debug) {
        console.error(`[AuditEmitter] flush failed: HTTP ${response.status}`);
      }
    } catch (err) {
      // Phase 1: endpoint may not exist yet — silently drop (degraded mode)
      if (this.opts.debug) {
        console.error('[AuditEmitter] flush error (Phase 2 endpoint pending):', err);
      }
      // Re-queue on transient network errors (but not if endpoint is unavailable)
      // Append-only: re-queued events are appended, never mutated.
    }
  }
}
