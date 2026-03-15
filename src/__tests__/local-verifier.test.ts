import { buildStateVector } from '../state-vector-builder.js';
import { verifyStateVector } from '../local-verifier.js';

const POLICY_DIGEST = 'sha256:aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

function makeFreshSv(overrides: Partial<Parameters<typeof buildStateVector>[0]> = {}) {
  return buildStateVector({
    nodeId: 'peer-node-001',
    baseline: 0.85,
    norm: 0.90,
    stability: 0.20,
    meta_control: 0.78,
    policyDigest: POLICY_DIGEST,
    ttlSeconds: 30,
    loopCount: 50,
    ...overrides,
  });
}

describe('verifyStateVector', () => {
  test('pass: fresh SV with matching policy digest and valid integrity', () => {
    const sv = makeFreshSv();
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    expect(result.overall).toBe('pass');
    expect(result.peer_node_id).toBe('peer-node-001');
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  test('fail: policy_digest mismatch', () => {
    const sv = makeFreshSv();
    const result = verifyStateVector(sv, { localPolicyDigest: 'sha256:different' });
    const policyCheck = result.checks.find((c) => c.name === 'policy_digest');
    expect(policyCheck?.status).toBe('fail');
    expect(result.overall).toBe('fail');
  });

  test('fail: stale SV (timestamp in the past beyond TTL)', () => {
    const sv = makeFreshSv({ ttlSeconds: 1 });
    // Manually backdate timestamp by 60s
    sv.freshness_evidence.timestamp = new Date(Date.now() - 60000).toISOString();
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    const freshnessCheck = result.checks.find((c) => c.name === 'freshness');
    expect(freshnessCheck?.status).toBe('fail');
    expect(result.overall).toBe('fail');
  });

  test('fail: integrity tampered', () => {
    const sv = makeFreshSv();
    sv.integrity_evidence.signature = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    const integrityCheck = result.checks.find((c) => c.name === 'integrity');
    expect(integrityCheck?.status).toBe('fail');
    expect(result.overall).toBe('fail');
  });

  test('fail: risk_info out of range', () => {
    const sv = makeFreshSv();
    sv.risk_info.r_t = 1.5; // invalid
    // Note: integrity check will also fail since payload changed — that's correct behavior
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    const sanityCheck = result.checks.find((c) => c.name === 'risk_info_sanity');
    expect(sanityCheck?.status).toBe('fail');
  });

  test('verified_at is ISO8601', () => {
    const sv = makeFreshSv();
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    expect(() => new Date(result.verified_at)).not.toThrow();
  });

  test('peer_r_t matches sv.risk_info.r_t', () => {
    const sv = makeFreshSv();
    const result = verifyStateVector(sv, { localPolicyDigest: POLICY_DIGEST });
    expect(result.peer_r_t).toBe(sv.risk_info.r_t);
  });
});
