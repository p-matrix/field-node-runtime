// =============================================================================
// @pmatrix/field-node-runtime — local-pep.ts
// 4.0 Protocol Stage 4: Policy Enforcement Point — 결정 집행
//
// Input:  ModeTransition (from LocalDecider)
// Output: PepResult + callback invocation (Safety Gate extension)
//
// Enforcement postures:
//   maintain  → no action (continue as normal)
//   caution   → notify callback (soft alert, no blocking)
//   restrict  → notify callback, flag peer as restricted
//   reject    → notify callback, block all interaction with peer
//
// Integration with existing Safety Gate:
//   Monitors integrate by registering an EnforcementCallback.
//   The callback receives posture changes and applies monitor-specific gates.
//
// References:
//   - Field 개발기획서 v1.2 §4-2 (Stage 4 PEP)
//   - Field 구현 설계 v0.4 §4 (4대 모니터 Safety Gate 확장 기반)
//   - 4.0 논문 §5.1 (Field is non-executive: PEP lives in the node)
// =============================================================================

import type {
  ModeTransition,
  PepResult,
  PeerPosture,
} from './types.js';

// ─── Enforcement Callback ─────────────────────────────────────────────────────

/**
 * Called when a peer's posture changes.
 * Monitors implement this to apply Safety Gate actions.
 */
export type EnforcementCallback = (
  peerNodeId: string,
  posture: PeerPosture,
  reason: string,
) => void | Promise<void>;

// ─── LocalPEP ─────────────────────────────────────────────────────────────────

export class LocalPEP {
  private callbacks: EnforcementCallback[] = [];

  /**
   * Register an enforcement callback.
   * Monitors (claude-code-monitor, cursor-monitor, etc.) register here
   * to receive posture change notifications and apply Safety Gate actions.
   */
  registerCallback(cb: EnforcementCallback): void {
    this.callbacks.push(cb);
  }

  /**
   * Execute a ModeTransition decision.
   *
   * Called after LocalDecider produces a ModeTransition.
   * Does NOT contact the server — enforcement is local.
   *
   * Design: server emits field_advisory (signal only) in field mode.
   * PEP is the node's own enforcement — not the server's.
   */
  async enforce(transition: ModeTransition): Promise<PepResult> {
    const { peer_node_id, new_posture, reason } = transition;

    if (new_posture !== transition.previous_posture) {
      // Notify all registered callbacks
      await Promise.allSettled(
        this.callbacks.map((cb) => cb(peer_node_id, new_posture, reason)),
      );
    }

    return {
      peer_node_id,
      posture: new_posture,
      action_taken: this.describeAction(new_posture),
      enforced_at: new Date().toISOString(),
    };
  }

  /**
   * Query whether interaction with a peer should be blocked.
   * Safe to call from Safety Gate on every hook event.
   */
  shouldBlock(peerNodeId: string, peerPosture: PeerPosture): boolean {
    return peerPosture === 'reject';
  }

  /**
   * Query whether interaction with a peer should be flagged/limited.
   */
  shouldRestrict(peerNodeId: string, peerPosture: PeerPosture): boolean {
    return peerPosture === 'restrict' || peerPosture === 'reject';
  }

  private describeAction(posture: PeerPosture): string {
    switch (posture) {
      case 'maintain': return 'no_action';
      case 'caution':  return 'flagged_and_monitoring';
      case 'restrict': return 'interaction_limited';
      case 'reject':   return 'interaction_blocked';
    }
  }
}
