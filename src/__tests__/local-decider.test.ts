import { decide, applyFieldAdvisory, getPeerPosture, resetPostures } from '../local-decider.js';
import type { VerificationResult } from '../types.js';

function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    peer_node_id: 'peer-001',
    overall: 'pass',
    checks: [],
    peer_r_t: 0.10,
    peer_mode: 'Normal',
    verified_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetPostures();
});

describe('decide', () => {
  test('pass + low r_t → maintain', () => {
    const transition = decide(makeResult({ overall: 'pass', peer_r_t: 0.10 }));
    expect(transition.new_posture).toBe('maintain');
  });

  test('fail → reject', () => {
    const transition = decide(makeResult({
      overall: 'fail',
      checks: [{ name: 'policy_digest', status: 'fail' }],
    }));
    expect(transition.new_posture).toBe('reject');
    expect(transition.reason).toContain('policy_digest');
  });

  test('peer_r_t ≥ restrictThreshold → restrict', () => {
    const transition = decide(makeResult({ overall: 'pass', peer_r_t: 0.80 }), {
      restrictThreshold: 0.75,
    });
    expect(transition.new_posture).toBe('restrict');
  });

  test('peer_r_t ≥ cautionThreshold → caution', () => {
    const transition = decide(makeResult({ overall: 'pass', peer_r_t: 0.60 }), {
      cautionThreshold: 0.50,
      restrictThreshold: 0.75,
    });
    expect(transition.new_posture).toBe('caution');
  });

  test('warn checks → caution', () => {
    const transition = decide(makeResult({
      overall: 'warn',
      peer_r_t: 0.10,
      checks: [{ name: 'freshness', status: 'warn', detail: 'approaching TTL' }],
    }));
    expect(transition.new_posture).toBe('caution');
  });

  test('decided_at is ISO8601', () => {
    const transition = decide(makeResult());
    expect(() => new Date(transition.decided_at)).not.toThrow();
  });

  test('previous_posture starts as maintain', () => {
    const transition = decide(makeResult());
    expect(transition.previous_posture).toBe('maintain');
  });

  test('posture is persisted across calls', () => {
    decide(makeResult({ overall: 'pass', peer_r_t: 0.80 }), { restrictThreshold: 0.75 });
    const posture = getPeerPosture('peer-001');
    expect(posture).toBe('restrict');
  });
});

describe('applyFieldAdvisory', () => {
  test('isolate → reject', () => {
    const t = applyFieldAdvisory('peer-001', 'isolate');
    expect(t.new_posture).toBe('reject');
  });

  test('eject → reject', () => {
    const t = applyFieldAdvisory('peer-001', 'eject');
    expect(t.new_posture).toBe('reject');
  });

  test('restrict → restrict', () => {
    const t = applyFieldAdvisory('peer-001', 'restrict');
    expect(t.new_posture).toBe('restrict');
  });

  test('warning → caution', () => {
    const t = applyFieldAdvisory('peer-001', 'warning');
    expect(t.new_posture).toBe('caution');
  });

  test('unknown action → maintain (no change)', () => {
    const t = applyFieldAdvisory('peer-001', 'unknown_action');
    expect(t.new_posture).toBe('maintain');
  });
});
