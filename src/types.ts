// =============================================================================
// @pmatrix/field-node-runtime — types.ts
// P-MATRIX 4.0 Field Protocol shared types
//
// References:
//   - Field 개발기획서 v1.2 §4 (Architecture)
//   - Field 구현 설계 v0.4 §5.1 (State Vector 5요소)
//   - 4.0 논문 §5.1, §5.7
// =============================================================================

// ─── 4-axis Risk Info ─────────────────────────────────────────────────────────

/**
 * 4-axis coordinate system (3.5 basis).
 * Stability polarity: higher = more instability (monitor sends instability score).
 */
export interface RiskInfo {
  baseline: number;       // 0–1, tool risk accumulation
  norm: number;           // 0–1, behavioral compliance
  stability: number;      // 0–1, instability score (higher = more drift)
  meta_control: number;   // 0–1, meta-cognitive control
  r_t: number;            // computed: 1 - (baseline + norm + (1-stability) + meta_control) / 4
  mode: string;           // "Normal" | "Caution" | "Restricted" | "Isolated"
}

// ─── Lifecycle Info ───────────────────────────────────────────────────────────

export interface LifecycleInfo {
  current_mode: string;   // current operational mode
  mode_since: string;     // ISO8601 timestamp when mode was entered
  loop_count: number;     // total event loop count since session start
}

// ─── Freshness Evidence ───────────────────────────────────────────────────────

export interface FreshnessEvidence {
  timestamp: string;      // ISO8601 — when this SV was built
  ttl_seconds: number;    // how long this SV is considered fresh
}

// ─── Integrity Evidence ───────────────────────────────────────────────────────
//
// Phase 1: placeholder signature (hex digest of payload).
// Phase 2+: ed25519 proper signing with key pair.
//

export interface IntegrityEvidence {
  signature: string;      // Phase 1: "sha256:<hex>", Phase 2+: "ed25519:<base64>"
  node_id: string;        // unique node identifier
}

// ─── State Vector (4.0 §5.1) ─────────────────────────────────────────────────

/**
 * 4.0 Protocol State Vector — 5요소 구조.
 * Exchanged between nodes in Stage 1 (Exchange).
 */
export interface StateVector {
  risk_info: RiskInfo;
  lifecycle_info: LifecycleInfo;
  policy_digest: string;          // sha256 of active field policy
  freshness_evidence: FreshnessEvidence;
  integrity_evidence: IntegrityEvidence;
}

// ─── Verification Result (Stage 2) ───────────────────────────────────────────

export type VerificationStatus = 'pass' | 'warn' | 'fail';

export interface VerificationCheck {
  name: string;
  status: VerificationStatus;
  detail?: string;
}

/**
 * Result of LocalVerifier evaluation of a peer's StateVector.
 * Input to LocalDecider (Stage 3).
 */
export interface VerificationResult {
  peer_node_id: string;
  overall: VerificationStatus;
  checks: VerificationCheck[];
  peer_r_t: number;
  peer_mode: string;
  verified_at: string;          // ISO8601
}

// ─── Mode Transition Decision (Stage 3) ──────────────────────────────────────

/**
 * Possible interaction postures toward a peer node.
 * Decided by LocalDecider, executed by LocalPEP.
 */
export type PeerPosture =
  | 'maintain'    // no change — continue as normal
  | 'caution'     // flag and monitor — soft alert
  | 'restrict'    // limit interaction scope
  | 'reject';     // refuse to interact with this peer

export interface ModeTransition {
  peer_node_id: string;
  previous_posture: PeerPosture;
  new_posture: PeerPosture;
  reason: string;
  decided_at: string;           // ISO8601
}

// ─── PEP Enforcement Result (Stage 4) ────────────────────────────────────────

export interface PepResult {
  peer_node_id: string;
  posture: PeerPosture;
  action_taken: string;
  enforced_at: string;          // ISO8601
}

// ─── Audit Event ─────────────────────────────────────────────────────────────

export type AuditStage = 'exchange' | 'verify' | 'decide' | 'enforce';

export interface AuditEvent {
  field_id?: string;
  node_id: string;
  stage: AuditStage;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;           // ISO8601
}

// ─── Field Node Config ────────────────────────────────────────────────────────

export interface FieldNodeConfig {
  /** P-MATRIX server WebSocket URL for State Vector exchange */
  serverWsUrl: string;
  /** P-MATRIX server REST URL for audit log */
  serverApiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** This node's identifier */
  nodeId: string;
  /** Active Field ID */
  fieldId: string;
  /** Active policy digest (sha256) */
  policyDigest: string;
  /** State Vector TTL in seconds (default: 30) */
  svTtlSeconds: number;
  /** Whether field mode is active — false = 3.5 only, no 4.0 protocol */
  fieldModeEnabled: boolean;
  /** Minimum peer r_t to trigger caution (default: 0.50) */
  cautionThreshold: number;
  /** Minimum peer r_t to trigger restrict (default: 0.75) */
  restrictThreshold: number;
  /** Debug logging */
  debug: boolean;
}

export type PartialFieldNodeConfig = Partial<FieldNodeConfig> &
  Pick<FieldNodeConfig, 'serverWsUrl' | 'serverApiUrl' | 'apiKey' | 'nodeId' | 'fieldId' | 'policyDigest'>;

// ─── WS Message envelope ──────────────────────────────────────────────────────

export interface WsEnvelope {
  type: 'state_vector' | 'field_advisory' | 'ping' | 'pong';
  node_id: string;
  field_id: string;
  payload: unknown;
  sent_at: string;
}
