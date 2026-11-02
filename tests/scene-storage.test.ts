import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROBOTS } from '../src/robots';
import { SCENE_STORAGE_KEY, SCENE_VERSION, SceneStorage, parseSceneSnapshot, type SceneSnapshot } from '../src/scene-storage';

const scene = (changes: Partial<SceneSnapshot> = {}): SceneSnapshot => ({
  version: SCENE_VERSION, robot: 'xarm6', joints: [0, 0, 0, 0, 0, 0],
  rail: null, railMm: 0, sensor: null, gripper: null, opening: null, ...changes,
});
const parse = (value: unknown) => parseSceneSnapshot(JSON.stringify(value));

describe('scene record validation', () => {
  it('accepts each robot with its own joint count and valid assemblies', () => {
    for (const robot of ROBOTS) {
      const snapshot = scene({ robot: robot.id, joints: Array(robot.dof).fill(0.1) });
      expect(parse(snapshot)).toEqual(snapshot);
      expect(parse({ ...snapshot, joints: [...snapshot.joints, 0] })).toBeNull();
    }
    expect(parse(scene({ rail: 'al0700', railMm: 280.5, sensor: 'ai1500', gripper: 'bio-gripper-g2', opening: 110 }))).not.toBeNull();
    expect(parse(scene({ robot: 'lite6', gripper: 'lite6-gripper', opening: 0 }))).not.toBeNull();
    expect(parse(scene({ robot: 'lite6', gripper: 'lite6-vacuum-gripper' }))).not.toBeNull();
  });

  it('rejects malformed, incompatible, non-finite and out-of-range values', () => {
    for (const invalid of [
      null, [], {}, { ...scene(), version: 2 }, { ...scene(), robot: 'unknown' },
      { ...scene(), joints: [0, 0, 0, 0, 0, null] }, { ...scene(), joints: [0, 0, 0, 0, 0, '0'] },
      { ...scene(), rail: 'al0700', railMm: 700.1 }, { ...scene(), railMm: 1 },
      { ...scene(), rail: 'al0700', railMm: 0.01 }, { ...scene(), sensor: 'other' },
      { ...scene(), robot: 'lite6', rail: 'al0700' }, { ...scene(), robot: 'lite6', sensor: 'ai1500' },
      { ...scene(), robot: 'lite6', gripper: 'gripper-g2', opening: 42 },
      { ...scene(), gripper: 'gripper-g2', opening: 84.1 },
      { ...scene(), robot: 'lite6', gripper: 'lite6-gripper', opening: 50 },
      { ...scene(), gripper: 'lite6-vacuum-gripper', opening: 0 },
      { ...scene(), opening: 0 },
    ]) expect(parse(invalid)).toBeNull();
    expect(parseSceneSnapshot('{broken')).toBeNull();
  });
});

describe('scene persistence', () => {
  afterEach(() => vi.useRealTimers());

  it('throttles complete immutable snapshots and flushes pending changes on stop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() } as unknown as Storage;
    const saver = new SceneStorage(() => storage, vi.fn());
    const first = scene();
    saver.queue(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    first.joints[0] = 1;
    saver.queue(first);
    first.joints[0] = 2;
    vi.advanceTimersByTime(199);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(storage.setItem).toHaveBeenLastCalledWith(SCENE_STORAGE_KEY, JSON.stringify(scene({ joints: [1, 0, 0, 0, 0, 0] })));
    saver.queue(first);
    saver.flush();
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    saver.flush();
    vi.advanceTimersByTime(500);
    expect(storage.setItem).toHaveBeenCalledTimes(3);
  });

  it('distinguishes missing and invalid records and reports storage failures once', () => {
    const notify = vi.fn();
    const storage = { getItem: vi.fn(() => '{bad'), setItem: vi.fn(() => { throw Error('full'); }) } as unknown as Storage;
    const saver = new SceneStorage(() => storage, notify);
    expect(saver.read()).toEqual({ kind: 'invalid' });
    saver.queue(scene());
    saver.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    const inaccessible = new SceneStorage(() => { throw Error('disabled'); }, notify);
    expect(inaccessible.read()).toEqual({ kind: 'unavailable' });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
