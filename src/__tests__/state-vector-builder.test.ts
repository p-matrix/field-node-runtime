import { buildStateVector, computeRt } from '../state-vector-builder.js';

describe('computeRt', () => {
  test('R(t) = 1 - (baseline + norm + (1-stability) + meta_control) / 4', () => {
    const rt = computeRt(0.85, 0.90, 0.20, 0.78);
    // 1 - (0.85 + 0.90 + (1-0.20) + 0.78) / 4 = 1 - 3.33/4 = 1 - 0.8325 = 0.1675
    expect(rt).toBeCloseTo(0.1675, 3);
  });

  test('stability=1 (max instability) → R(t)=1.0', () => {
    // stability=1 means max instability → (1-stability)=0 → minimal subtraction → R(t)=1
    // R(t) = 1 - (0 + 0 + (1-1) + 0) / 4 = 1 - 0 = 1.0
    expect(computeRt(0, 0, 1, 0)).toBeCloseTo(1.0, 3);
  });

  test('all safest axes → R(t)=0', () => {
    // baseline=1, norm=1, stability=0 (fully stable → (1-0)=1), meta_control=1
    // R(t) = 1 - (1 + 1 + 1 + 1) / 4 = 1 - 1 = 0
    expect(computeRt(1, 1, 0, 1)).toBeCloseTo(0, 3);
  });
});

describe('buildStateVector', () => {
  const baseInput = {
    nodeId: 'test-node-001',
    baseline: 0.85,
    norm: 0.90,
    stability: 0.20,
    meta_control: 0.78,
    policyDigest: 'sha256:abc123def456',
    ttlSeconds: 30,
    loopCount: 100,
  };

  test('returns valid StateVector structure', () => {
    const sv = buildStateVector(baseInput);
    expect(sv.risk_info).toBeDefined();
    expect(sv.lifecycle_info).toBeDefined();
    expect(sv.policy_digest).toBe('sha256:abc123def456');
    expect(sv.freshness_evidence).toBeDefined();
    expect(sv.integrity_evidence).toBeDefined();
  });

  test('risk_info.r_t matches computeRt', () => {
    const sv = buildStateVector(baseInput);
    const expected = computeRt(0.85, 0.90, 0.20, 0.78);
    expect(sv.risk_info.r_t).toBeCloseTo(expected, 3);
  });

  test('freshness_evidence.ttl_seconds = input ttlSeconds', () => {
    const sv = buildStateVector({ ...baseInput, ttlSeconds: 60 });
    expect(sv.freshness_evidence.ttl_seconds).toBe(60);
  });

  test('integrity_evidence.node_id = nodeId', () => {
    const sv = buildStateVector(baseInput);
    expect(sv.integrity_evidence.node_id).toBe('test-node-001');
  });

  test('integrity_evidence.signature starts with sha256:', () => {
    const sv = buildStateVector(baseInput);
    expect(sv.integrity_evidence.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('mode derived from r_t when not provided', () => {
    // High stability (instability) → high r_t → Isolated mode
    const sv = buildStateVector({ ...baseInput, stability: 1.0, baseline: 0, norm: 0, meta_control: 0 });
    expect(sv.risk_info.mode).toBe('Isolated');
  });

  test('respects explicit currentMode', () => {
    const sv = buildStateVector({ ...baseInput, currentMode: 'Caution' });
    expect(sv.lifecycle_info.current_mode).toBe('Caution');
  });
});
