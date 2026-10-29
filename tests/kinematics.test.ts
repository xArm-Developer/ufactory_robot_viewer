// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import { forward, fromRPY, HOME, IKSolver, jogVelocity, jointValues, limits, setJoints, stepBasePose, toRPY } from '../src/kinematics';
import fixtures from './mujoco-fk.json';

function robot() {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync('public/models/xarm6/xarm6.urdf', 'utf8'));
  setJoints(model, HOME);
  return model;
}

describe('xArm6 kinematics', () => {
  it('defaults HOME to all-zero joints matching MuJoCo zero pose', () => {
    expect(HOME).toEqual([0, 0, 0, 0, 0, 0]);
    const model = robot();
    expect(jointValues(model)).toEqual([0, 0, 0, 0, 0, 0]);
    const zeroSample = fixtures.samples[1];
    const pose = forward(model);
    expect(pose.position.distanceTo(new Vector3(...zeroSample.position as [number, number, number]))).toBeLessThan(0.0001);
    expect(pose.quaternion.angleTo(new Quaternion(...zeroSample.quaternion as [number, number, number, number]))).toBeLessThan(0.01 * Math.PI / 180);
  });
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
  it('solves reachable goals from all-zero HOME and keeps all joints within URDF limits', () => {
    const source = robot();
    const controlled = robot();
    const solver = new IKSolver(controlled);
    // Sequential targets emulate interactive steps starting from all-zero and include a near-singular wrist.
    const targets = [
      [0.12, -0.55, -0.12, 0.12, 0.55, -0.1],
      [0.22, -0.7, -0.24, 0.22, 0.7, -0.2],
      [0.08, -0.45, -0.4, -0.1, 0.35, 0.15],
      [-0.1, -0.35, -0.3, 0.2, 0.08, -0.05],
      [-0.12, -0.4, -0.25, 0.1, 0.001, 0.05],
      [0, 0, 0, 0, 0, 0],
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
  it('maps jog speed percentages and solves 1 mm / 1 deg steps and 2.5 mm/s micro-frames from all-zero HOME', () => {
    expect(jogVelocity(1)).toEqual({ linearMmPerSec: 2.5, angularDegPerSec: 1 });
    expect(jogVelocity(20)).toEqual({ linearMmPerSec: 50, angularDegPerSec: 20 });
    expect(jogVelocity(100)).toEqual({ linearMmPerSec: 250, angularDegPerSec: 100 });

    const model = robot();
    const solver = new IKSolver(model);
    const start = forward(model);

    // 1 mm linear step on X+
    const steppedX = stepBasePose(start, 'x', 1);
    expect(solver.solve(steppedX).ok).toBe(true);
    const afterX = forward(model);
    expect((afterX.position.x - start.position.x) * 1000).toBeCloseTo(1, 1);
    expect(afterX.quaternion.angleTo(start.quaternion)).toBeLessThan(0.05 * Math.PI / 180);

    // 1 deg angular step on Yaw+
    const beforeYaw = MathUtils.radToDeg(toRPY(afterX.quaternion)[2]);
    const steppedYaw = stepBasePose(afterX, 'yaw', 1);
    expect(solver.solve(steppedYaw).ok).toBe(true);
    const afterYaw = forward(model);
    expect(MathUtils.radToDeg(toRPY(afterYaw.quaternion)[2]) - beforeYaw).toBeCloseTo(1, 1);

    // 25 frames of 2.5 mm/s continuous motion at 60 FPS (~1.04 mm total)
    let continuousPose = afterYaw;
    const frameDeltaMm = 2.5 / 60;
    for (let frame = 0; frame < 25; frame++) {
      const nextPose = stepBasePose(continuousPose, 'z', frameDeltaMm);
      expect(solver.solve(nextPose).ok).toBe(true);
      continuousPose = nextPose;
    }
    const afterContinuous = forward(model);
    expect((afterContinuous.position.z - afterYaw.position.z) * 1000).toBeCloseTo(25 * frameDeltaMm, 1);
  });
});
