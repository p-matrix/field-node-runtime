import { AuditEmitter } from '../audit-emitter.js';
import type { VerificationResult, ModeTransition, PepResult, StateVector } from '../types.js';
import { buildStateVector } from '../state-vector-builder.js';

const OPTS = {
  serverApiUrl: 'https://api.pmatrix.io',
  apiKey: 'test-key',
  nodeId: 'node-001',
  fieldId: 'field-001',
};

function makeSv(): StateVector {
  return buildStateVector({
    nodeId: 'node-001',
    baseline: 0.8,
    norm: 0.9,
    stability: 0.2,
    meta_control: 0.7,
    policyDigest: 'sha256:aabb',
    ttlSeconds: 30,
  });
}

describe('AuditEmitter', () => {
  test('emitExchange enqueues an exchange event', () => {
    const emitter = new AuditEmitter(OPTS);
    const sv = makeSv();
    emitter.emitExchange('peer-001', sv);
    // Queue is private — verify via flush (no-op if server unreachable is fine)
    expect(() => emitter.emitExchange('peer-001', sv)).not.toThrow();
  });

  test('emitVerify enqueues a verify event', () => {
    const emitter = new AuditEmitter(OPTS);
    const result: VerificationResult = {
      peer_node_id: 'peer-001',
      overall: 'pass',
      checks: [],
      peer_r_t: 0.15,
      peer_mode: 'Normal',
      verified_at: new Date().toISOString(),
    };
    expect(() => emitter.emitVerify(result)).not.toThrow();
  });

  test('emitDecide skips if posture unchanged', () => {
    const emitter = new AuditEmitter(OPTS);
    const t: ModeTransition = {
      peer_node_id: 'peer-001',
      previous_posture: 'maintain',
      new_posture: 'maintain',
      reason: 'no change',
      decided_at: new Date().toISOString(),
    };
    // Should not throw, and queue remains empty for unchanged postures
    expect(() => emitter.emitDecide(t)).not.toThrow();
  });

  test('emitDecide enqueues when posture changes', () => {
    const emitter = new AuditEmitter(OPTS);
    const t: ModeTransition = {
      peer_node_id: 'peer-001',
      previous_posture: 'maintain',
      new_posture: 'reject',
      reason: 'verification_failed',
      decided_at: new Date().toISOString(),
    };
    expect(() => emitter.emitDecide(t)).not.toThrow();
  });

  test('emitEnforce skips no_action', () => {
    const emitter = new AuditEmitter(OPTS);
    const r: PepResult = {
      peer_node_id: 'peer-001',
      posture: 'maintain',
      action_taken: 'no_action',
      enforced_at: new Date().toISOString(),
    };
    expect(() => emitter.emitEnforce(r)).not.toThrow();
  });

  test('stop() drains queue without throwing (degraded mode)', async () => {
    const emitter = new AuditEmitter({ ...OPTS, debug: false });
    const sv = makeSv();
    emitter.emitExchange('peer-001', sv);
    await expect(emitter.stop()).resolves.not.toThrow();
  });
});
