// =============================================================================
// @pmatrix/field-node-runtime — local-verifier.ts
// 4.0 Protocol Stage 2: 피어 State Vector 검증
//
// Input:  peer StateVector
// Output: VerificationResult (→ LocalDecider)
//
// Checks:
//   1. policy_digest match    — 동일 Policy를 따르는가
//   2. freshness              — TTL 내인가 (stale SV 거부)
//   3. integrity              — SHA-256 서명 일치 (Phase 1 lightweight)
//   4. risk_info sanity       — 값 범위 [0,1] 유효성
//
// References:
//   - Field 개발기획서 v1.2 §4-2 (Stage 2 Verify)
//   - 4.0 논문 FP-3 (Verification-Decision Separation)
// =============================================================================

import { createHash } from 'node:crypto';
import type {
  StateVector,
  VerificationResult,
  VerificationCheck,
  VerificationStatus,
} from './types.js';

// ─── Individual Checks ────────────────────────────────────────────────────────

function checkPolicyDigest(
  peerSv: StateVector,
  localPolicyDigest: string,
): VerificationCheck {
  const match = peerSv.policy_digest === localPolicyDigest;
  return {
    name: 'policy_digest',
    status: match ? 'pass' : 'fail',
    detail: match
      ? undefined
      : `expected=${localPolicyDigest.slice(0, 16)}… got=${peerSv.policy_digest.slice(0, 16)}…`,
  };
}

function checkFreshness(peerSv: StateVector): VerificationCheck {
  const { timestamp, ttl_seconds } = peerSv.freshness_evidence;
  const svTime = new Date(timestamp).getTime();
  const nowMs = Date.now();
  const ageSeconds = (nowMs - svTime) / 1000;

  if (ageSeconds > ttl_seconds) {
    return {
      name: 'freshness',
      status: 'fail',
      detail: `SV age=${ageSeconds.toFixed(1)}s exceeds TTL=${ttl_seconds}s`,
    };
  }
  if (ageSeconds > ttl_seconds * 0.8) {
    return {
      name: 'freshness',
      status: 'warn',
      detail: `SV age=${ageSeconds.toFixed(1)}s approaching TTL=${ttl_seconds}s`,
    };
  }
  return { name: 'freshness', status: 'pass' };
}

function checkIntegrity(peerSv: StateVector): VerificationCheck {
  const { signature, node_id } = peerSv.integrity_evidence;

  if (signature.startsWith('sha256:')) {
    // Phase 1: re-compute SHA-256 over canonical core payload
    const corePayload = JSON.stringify({
      riskInfo: peerSv.risk_info,
      lifecycleInfo: peerSv.lifecycle_info,
      policyDigest: peerSv.policy_digest,
      freshnessEvidence: peerSv.freshness_evidence,
      nodeId: node_id,
    });
    const expected = 'sha256:' + createHash('sha256').update(corePayload).digest('hex');
    const match = expected === signature;
    return {
      name: 'integrity',
      status: match ? 'pass' : 'fail',
      detail: match ? undefined : 'SHA-256 digest mismatch',
    };
  }

  // Phase 2+: ed25519 path — not yet implemented, warn and pass
  return {
    name: 'integrity',
    status: 'warn',
    detail: `signature type not yet verified: ${signature.split(':')[0] ?? 'unknown'}`,
  };
}

function checkRiskInfoSanity(peerSv: StateVector): VerificationCheck {
  const { baseline, norm, stability, meta_control, r_t } = peerSv.risk_info;
  const axes = [baseline, norm, stability, meta_control, r_t];
  const allInRange = axes.every((v) => v >= 0 && v <= 1);

  if (!allInRange) {
    return {
      name: 'risk_info_sanity',
      status: 'fail',
      detail: `axis values out of [0,1] range: ${JSON.stringify({ baseline, norm, stability, meta_control, r_t })}`,
    };
  }
  return { name: 'risk_info_sanity', status: 'pass' };
}

// ─── Overall status ───────────────────────────────────────────────────────────

function aggregateStatus(checks: VerificationCheck[]): VerificationStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

// ─── LocalVerifier ────────────────────────────────────────────────────────────

export interface LocalVerifierOptions {
  /** Local node's active policy digest */
  localPolicyDigest: string;
}

/**
 * Verify a peer's State Vector.
 *
 * Called in Stage 2 after receiving a peer SV via PeerExchangeClient.
 * Result is passed to LocalDecider for Stage 3 decision.
 *
 * Design principle (FP-3): Verification and Decision are separated.
 * This module ONLY verifies — it does not decide what to do.
 */
export function verifyStateVector(
  peerSv: StateVector,
  options: LocalVerifierOptions,
): VerificationResult {
  const checks: VerificationCheck[] = [
    checkPolicyDigest(peerSv, options.localPolicyDigest),
    checkFreshness(peerSv),
    checkIntegrity(peerSv),
    checkRiskInfoSanity(peerSv),
  ];

  return {
    peer_node_id: peerSv.integrity_evidence.node_id,
    overall: aggregateStatus(checks),
    checks,
    peer_r_t: peerSv.risk_info.r_t,
    peer_mode: peerSv.risk_info.mode,
    verified_at: new Date().toISOString(),
  };
}
