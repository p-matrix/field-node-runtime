// =============================================================================
// @pmatrix/field-node-runtime — local-decider.ts
// 4.0 Protocol Stage 3: 검증 결과 기반 mode transition 결정
//
// Input:  VerificationResult (from LocalVerifier)
// Output: ModeTransition (→ LocalPEP)
//
// Decision rules:
//   verification.overall=fail → reject
//   verification.overall=warn AND peer_r_t ≥ restrictThreshold → restrict
//   verification.overall=warn OR peer_r_t ≥ cautionThreshold   → caution
//   otherwise                                                   → maintain
//
// References:
//   - Field 개발기획서 v1.2 §4-2 (Stage 3 Decide)
//   - 4.0 논문 FP-3 (Verification-Decision Separation)
//   - 정의문 원칙 1: "정렬이지, 통제가 아니다"
// =============================================================================

import type {
  VerificationResult,
  ModeTransition,
  PeerPosture,
} from './types.js';

// ─── Posture state store (in-memory, per node session) ───────────────────────

const peerPostures = new Map<string, PeerPosture>();

function getCurrentPosture(peerNodeId: string): PeerPosture {
  return peerPostures.get(peerNodeId) ?? 'maintain';
}

function setPosture(peerNodeId: string, posture: PeerPosture): void {
  peerPostures.set(peerNodeId, posture);
}

// ─── Decision logic ───────────────────────────────────────────────────────────

export interface LocalDeciderOptions {
  /** peer r_t ≥ this → caution (default: 0.50) */
  cautionThreshold?: number;
  /** peer r_t ≥ this → restrict (default: 0.75) */
  restrictThreshold?: number;
}

const DEFAULT_CAUTION_THRESHOLD = 0.50;
const DEFAULT_RESTRICT_THRESHOLD = 0.75;

/**
 * Decide how to interact with a peer based on its VerificationResult.
 *
 * This is the LOCAL decision — no server call, no central authority.
 * The server's field_advisory signal MAY inform this, but the final
 * decision belongs to this node.
 *
 * Design principle: "정렬이지, 통제가 아니다"
 * The decider aligns with peers, it does not control them.
 */
export function decide(
  result: VerificationResult,
  options: LocalDeciderOptions = {},
): ModeTransition {
  const cautionThreshold = options.cautionThreshold ?? DEFAULT_CAUTION_THRESHOLD;
  const restrictThreshold = options.restrictThreshold ?? DEFAULT_RESTRICT_THRESHOLD;

  const prevPosture = getCurrentPosture(result.peer_node_id);
  let newPosture: PeerPosture;
  let reason: string;

  if (result.overall === 'fail') {
    // Hard failure: policy mismatch, integrity failure, or stale SV
    const failedChecks = result.checks
      .filter((c) => c.status === 'fail')
      .map((c) => c.name)
      .join(', ');
    newPosture = 'reject';
    reason = `verification_failed: ${failedChecks}`;
  } else if (result.peer_r_t >= restrictThreshold) {
    newPosture = 'restrict';
    reason = `peer_r_t=${result.peer_r_t.toFixed(3)} >= restrict_threshold=${restrictThreshold}`;
  } else if (result.overall === 'warn' || result.peer_r_t >= cautionThreshold) {
    newPosture = 'caution';
    const warnChecks = result.checks
      .filter((c) => c.status === 'warn')
      .map((c) => c.name)
      .join(', ');
    reason = warnChecks
      ? `verification_warn: ${warnChecks}`
      : `peer_r_t=${result.peer_r_t.toFixed(3)} >= caution_threshold=${cautionThreshold}`;
  } else {
    newPosture = 'maintain';
    reason = 'verification_pass';
  }

  setPosture(result.peer_node_id, newPosture);

  return {
    peer_node_id: result.peer_node_id,
    previous_posture: prevPosture,
    new_posture: newPosture,
    reason,
    decided_at: new Date().toISOString(),
  };
}

/**
 * Apply a server-emitted field_advisory signal to update posture.
 * The signal is advisory — LocalDecider may accept or override.
 *
 * Phase 1: advisory is accepted directly as a caution or restrict signal.
 * Phase 2+: weight advisory against LocalVerifier's own result.
 */
export function applyFieldAdvisory(
  peerNodeId: string,
  advisoryAction: string,
): ModeTransition {
  const prevPosture = getCurrentPosture(peerNodeId);
  let newPosture: PeerPosture;

  switch (advisoryAction) {
    case 'isolate':
    case 'eject':
      newPosture = 'reject';
      break;
    case 'restrict':
      newPosture = 'restrict';
      break;
    case 'warning':
    case 'restrict_warn':
      newPosture = 'caution';
      break;
    default:
      newPosture = prevPosture;
  }

  setPosture(peerNodeId, newPosture);

  return {
    peer_node_id: peerNodeId,
    previous_posture: prevPosture,
    new_posture: newPosture,
    reason: `field_advisory: ${advisoryAction}`,
    decided_at: new Date().toISOString(),
  };
}

/** Get current posture toward a peer (for PEP query) */
export function getPeerPosture(peerNodeId: string): PeerPosture {
  return getCurrentPosture(peerNodeId);
}

/** Reset all postures (on session end or field reconnect) */
export function resetPostures(): void {
  peerPostures.clear();
}
