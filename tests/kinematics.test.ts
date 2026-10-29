// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import { forward, fromRPY, HOME, IKSolver, jointValues, limits, setJoints, toRPY } from '../src/kinematics';
import fixtures from './mujoco-fk.json';

function robot() {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync('public/models/xarm6/xarm6.urdf', 'utf8'));
  setJoints(model, HOME);
  return model;
}

describe('xArm6 kinematics', () => {
  it.each(fixtures.samples)('matches MuJoCo FK for $joints', sample => {
    const model = robot();
    expect(setJoints(model, sample.joints)).toBe(true);
    const pose = forward(model);
    expect(pose.position.distanceTo(new Vector3(...sample.position as [number, number, number]))).toBeLessThan(0.0001);
    expect(pose.quaternion.angleTo(new Quaternion(...sample.quaternion as [number, number, number, number]))).toBeLessThan(0.01 * Math.PI / 180);
  });
  it('uses fixed-axis ZYX RPY', () => {
    const q = fromRPY(0.3, -0.7, 1.2);
    expect(q.angleTo(new Quaternion().setFromEuler(new Euler(0.3, -0.7, 1.2, 'ZYX')))).toBeLessThan(1e-7);
    expect(toRPY(q)).toEqual(expect.arrayContaining([expect.closeTo(0.3), expect.closeTo(-0.7), expect.closeTo(1.2)]));
  });
  it('solves reachable goals and keeps all joints within URDF limits', () => {
    const source = robot();
    const controlled = robot();
    const solver = new IKSolver(controlled);
    // Sequential targets emulate small interactive steps and include a near-singular wrist.
    const targets = [
      [0.12, -0.55, -0.12, 0.12, 0.55, -0.1],
      [0.22, -0.7, -0.24, 0.22, 0.7, -0.2],
      [0.08, -0.45, -0.4, -0.1, 0.35, 0.15],
      [-0.1, -0.35, -0.3, 0.2, 0.08, -0.05],
      [-0.12, -0.4, -0.25, 0.1, 0.001, 0.05],
      [0, -0.5, 0, 0, 0.5, 0],
    ];
    for (const angles of targets) {
      expect(setJoints(source, angles)).toBe(true);
      const target = forward(source);
      const result = solver.solve(target);
      expect(result, JSON.stringify({ angles, result })).toMatchObject({ ok: true });
      const actual = forward(controlled);
      expect(actual.position.distanceTo(target.position)).toBeLessThan(0.001);
      expect(actual.quaternion.angleTo(target.quaternion)).toBeLessThan(Math.PI / 180);
      jointValues(controlled).forEach((value, i) => {
        expect(value).toBeGreaterThanOrEqual(limits(controlled)[i].min - 1e-6);
        expect(value).toBeLessThanOrEqual(limits(controlled)[i].max + 1e-6);
      });
    }
  });
  it('rejects invalid and unreachable goals without changing the last valid pose', () => {
    const model = robot();
    const solver = new IKSolver(model);
    const before = jointValues(model);
    expect(solver.solve({ position: new Vector3(NaN, 0, 0), quaternion: new Quaternion() }).reason).toBe('invalid');
    expect(solver.solve({ position: new Vector3(10, 10, 10), quaternion: new Quaternion() }).ok).toBe(false);
    jointValues(model).forEach((value, i) => expect(value).toBeCloseTo(before[i], 6));
    expect(setJoints(model, [NaN, 0, 0, 0, 0, 0])).toBe(false);
    expect(setJoints(model, [0, 100, 0, 0, 0, 0])).toBe(false);
  });
});
