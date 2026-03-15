import { LocalPEP } from '../local-pep.js';
import type { ModeTransition, PeerPosture } from '../types.js';

function makeTransition(
  newPosture: PeerPosture,
  prevPosture: PeerPosture = 'maintain',
): ModeTransition {
  return {
    peer_node_id: 'peer-001',
    previous_posture: prevPosture,
    new_posture: newPosture,
    reason: 'test',
    decided_at: new Date().toISOString(),
  };
}

describe('LocalPEP', () => {
  test('enforce: maintain → no callback invoked (no posture change)', async () => {
    const pep = new LocalPEP();
    const cb = jest.fn();
    pep.registerCallback(cb);

    await pep.enforce(makeTransition('maintain', 'maintain'));
    expect(cb).not.toHaveBeenCalled();
  });

  test('enforce: caution → callback invoked', async () => {
    const pep = new LocalPEP();
    const cb = jest.fn();
    pep.registerCallback(cb);

    await pep.enforce(makeTransition('caution', 'maintain'));
    expect(cb).toHaveBeenCalledWith('peer-001', 'caution', 'test');
  });

  test('enforce: reject → callback invoked', async () => {
    const pep = new LocalPEP();
    const cb = jest.fn();
    pep.registerCallback(cb);

    await pep.enforce(makeTransition('reject', 'maintain'));
    expect(cb).toHaveBeenCalledWith('peer-001', 'reject', 'test');
  });

  test('enforce returns PepResult with correct posture', async () => {
    const pep = new LocalPEP();
    const result = await pep.enforce(makeTransition('restrict', 'maintain'));
    expect(result.posture).toBe('restrict');
    expect(result.peer_node_id).toBe('peer-001');
    expect(result.action_taken).toBe('interaction_limited');
  });

  test('shouldBlock: true only for reject', () => {
    const pep = new LocalPEP();
    expect(pep.shouldBlock('p', 'reject')).toBe(true);
    expect(pep.shouldBlock('p', 'restrict')).toBe(false);
    expect(pep.shouldBlock('p', 'caution')).toBe(false);
    expect(pep.shouldBlock('p', 'maintain')).toBe(false);
  });

  test('shouldRestrict: true for restrict and reject', () => {
    const pep = new LocalPEP();
    expect(pep.shouldRestrict('p', 'reject')).toBe(true);
    expect(pep.shouldRestrict('p', 'restrict')).toBe(true);
    expect(pep.shouldRestrict('p', 'caution')).toBe(false);
    expect(pep.shouldRestrict('p', 'maintain')).toBe(false);
  });

  test('multiple callbacks all invoked', async () => {
    const pep = new LocalPEP();
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    pep.registerCallback(cb1);
    pep.registerCallback(cb2);

    await pep.enforce(makeTransition('caution', 'maintain'));
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});
