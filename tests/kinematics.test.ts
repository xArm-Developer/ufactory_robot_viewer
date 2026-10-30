// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Euler, Group, MathUtils, Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import {
  assemblyToolOffset,
  RAIL_CAD_TO_WORLD,
  RAIL_ORIGIN_WORLD,
  ROBOT_BASE_CAD,
  ROBOT_BASE_WORLD_ROTATION,
  ROBOT_MOUNT_CAD_ROTATION,
} from '../src/accessories';
import {
  forward,
  fromRPY,
  HOME,
  homeJoints,
  IKSolver,
  jogVelocity,
  jointNames,
  jointValues,
  limits,
  setJoints,
  stepBasePose,
  toRPY,
  type CartesianAxis,
} from '../src/kinematics';
import { DEFAULT_ROBOT_ID, getRobotSpec, ROBOTS, type RobotId, type RobotSpec } from '../src/robots';
import fixtures from './mujoco-fk.json';

function loadRobotModel(spec: RobotSpec) {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  expect(setJoints(model, homeJoints(spec.dof))).toBe(true);
  return model;
}

const REACHABLE_TARGETS: Record<RobotId, number[][]> = {
  xarm5: [
    [0.12, -0.45, -0.15, 0.6, -0.1],
    [0.24, -0.6, -0.25, 0.85, -0.2],
    [-0.15, -0.35, -0.3, 0.65, 0.15],
    [0, -0.4, -0.2, 0.6, 0],
    [0, 0, 0, 0, 0],
  ],
  xarm6: [
    [0.12, -0.55, -0.12, 0.12, 0.55, -0.1],
    [0.22, -0.7, -0.24, 0.22, 0.7, -0.2],
    [0.08, -0.45, -0.4, -0.1, 0.35, 0.15],
    [-0.1, -0.35, -0.3, 0.2, 0.08, -0.05],
    [-0.12, -0.4, -0.25, 0.1, 0.001, 0.05],
    [0, 0, 0, 0, 0, 0],
  ],
  xarm7: [
    [0.12, -0.45, 0.1, 0.35, 0.12, 0.5, -0.1],
    [0.22, -0.6, 0.2, 0.55, 0.2, 0.65, -0.2],
    [-0.1, -0.35, -0.15, 0.3, -0.1, 0.35, 0.15],
    [-0.12, -0.4, -0.1, 0.25, 0.08, 0.001, 0.05],
    [0, 0, 0, 0, 0, 0, 0],
  ],
  uf850: [
    [0.12, -0.45, -0.25, 0.12, 0.45, -0.1],
    [0.22, -0.6, -0.4, 0.22, 0.6, -0.2],
    [-0.1, -0.35, -0.3, 0.15, 0.25, 0.1],
    [-0.12, -0.4, -0.25, 0.1, 0.001, 0.05],
    [0, 0, 0, 0, 0, 0],
  ],
  lite6: [
    [0.12, 0.35, 0.45, 0.12, 0.35, -0.1],
    [0.22, 0.5, 0.7, 0.22, 0.5, -0.2],
    [-0.1, 0.25, 0.4, -0.1, 0.25, 0.15],
    [-0.12, 0.3, 0.35, 0.1, 0.001, 0.05],
    [0, 0, 0, 0, 0, 0],
  ],
};

describe('robot registry & shared kinematics utilities', () => {
  it('registers all 5 UFACTORY arms with confirmed naming and xArm 5 Roll restriction', () => {
    expect(ROBOTS.map(r => r.id)).toEqual(['xarm5', 'xarm6', 'xarm7', 'uf850', 'lite6']);
    expect(ROBOTS.map(r => r.name)).toEqual(['xArm 5', 'xArm 6', 'xArm 7', '850', 'Lite 6']);
    expect(getRobotSpec('uf850').name).toBe('850');
    expect(getRobotSpec('xarm5').disabledJogAxes).toEqual(['roll']);
    expect(getRobotSpec('unknown').id).toBe(DEFAULT_ROBOT_ID);
    expect(HOME).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('uses fixed-axis ZYX RPY and maps jog speed percentages', () => {
    const q = fromRPY(0.3, -0.7, 1.2);
    expect(q.angleTo(new Quaternion().setFromEuler(new Euler(0.3, -0.7, 1.2, 'ZYX')))).toBeLessThan(1e-7);
    expect(toRPY(q)).toEqual(expect.arrayContaining([expect.closeTo(0.3), expect.closeTo(-0.7), expect.closeTo(1.2)]));
    expect(jogVelocity(1)).toEqual({ linearMmPerSec: 2.5, angularDegPerSec: 1 });
    expect(jogVelocity(20)).toEqual({ linearMmPerSec: 50, angularDegPerSec: 20 });
    expect(jogVelocity(100)).toEqual({ linearMmPerSec: 250, angularDegPerSec: 100 });
  });
});

describe.each(ROBOTS)('$name ($id, $dof DoF) kinematics', spec => {
  const robotFixtures = fixtures.robots[spec.id];

  it('defaults to all-zero joints matching MuJoCo zero pose', () => {
    const model = loadRobotModel(spec);
    expect(jointNames(model)).toHaveLength(spec.dof);
    expect(jointValues(model)).toEqual(homeJoints(spec.dof));
    const zeroSample = robotFixtures.samples[0];
    const pose = forward(model, spec.eeLink);
    expect(pose.position.distanceTo(new Vector3(...(zeroSample.position as [number, number, number])))).toBeLessThan(0.0001);
    expect(pose.quaternion.angleTo(new Quaternion(...(zeroSample.quaternion as [number, number, number, number])))).toBeLessThan((0.01 * Math.PI) / 180);
  });

  it.each(robotFixtures.samples)('matches MuJoCo FK for $joints', sample => {
    const model = loadRobotModel(spec);
    expect(setJoints(model, sample.joints)).toBe(true);
    const pose = forward(model, spec.eeLink);
    expect(pose.position.distanceTo(new Vector3(...(sample.position as [number, number, number])))).toBeLessThan(0.0001);
    expect(pose.quaternion.angleTo(new Quaternion(...(sample.quaternion as [number, number, number, number])))).toBeLessThan((0.01 * Math.PI) / 180);
  });

  it('solves sequential reachable goals from all-zero HOME and keeps all joints within URDF limits', () => {
    const source = loadRobotModel(spec);
    const controlled = loadRobotModel(spec);
    const solver = new IKSolver(controlled, spec.eeLink);
    const jointLimits = limits(controlled);

    for (const angles of REACHABLE_TARGETS[spec.id]) {
      expect(setJoints(source, angles)).toBe(true);
      const target = forward(source, spec.eeLink);
      const result = solver.solve(target);
      expect(result, JSON.stringify({ id: spec.id, angles, result })).toMatchObject({ ok: true });
      const actual = forward(controlled, spec.eeLink);
      expect(actual.position.distanceTo(target.position)).toBeLessThan(0.001);
      expect(actual.quaternion.angleTo(target.quaternion)).toBeLessThan(Math.PI / 180);
      jointValues(controlled).forEach((value, i) => {
        expect(value).toBeGreaterThanOrEqual(jointLimits[i].min - 1e-6);
        expect(value).toBeLessThanOrEqual(jointLimits[i].max + 1e-6);
      });
    }
  });

  it('rejects invalid and unreachable goals without changing the last valid pose', () => {
    const model = loadRobotModel(spec);
    const solver = new IKSolver(model, spec.eeLink);
    const before = jointValues(model);
    expect(solver.solve({ position: new Vector3(NaN, 0, 0), quaternion: new Quaternion() }).reason).toBe('invalid');
    expect(solver.solve({ position: new Vector3(10, 10, 10), quaternion: new Quaternion() }).ok).toBe(false);
    jointValues(model).forEach((value, i) => expect(value).toBeCloseTo(before[i], 6));

    const nanJoints = homeJoints(spec.dof);
    nanJoints[0] = NaN;
    expect(setJoints(model, nanJoints)).toBe(false);
    const outOfRange = homeJoints(spec.dof);
    outOfRange[1] = 100;
    expect(setJoints(model, outOfRange)).toBe(false);
    expect(setJoints(model, [0, 0])).toBe(false);
  });

  it('solves 1 mm / 1 deg steps on all supported jog axes and 2.5 mm/s continuous micro-frames from all-zero HOME', () => {
    const disabled = new Set(spec.disabledJogAxes ?? []);
    const allAxes: CartesianAxis[] = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'];

    for (const axis of allAxes) {
      for (const dir of [1, -1] as const) {
        const model = loadRobotModel(spec);
        const solver = new IKSolver(model, spec.eeLink);
        const start = forward(model, spec.eeLink);
        const target = stepBasePose(start, axis, dir * 1);
        const result = solver.solve(target);

        if (disabled.has(axis)) {
          // 5-DoF xArm 5 cannot roll around base X from zero pose; pose must stay untouched.
          expect(result.ok).toBe(false);
          expect(jointValues(model)).toEqual(homeJoints(spec.dof));
        } else {
          expect(result, `${spec.id} ${axis}${dir > 0 ? '+' : '-'}`).toMatchObject({ ok: true });
          const actual = forward(model, spec.eeLink);
          expect(actual.position.distanceTo(target.position)).toBeLessThan(0.001);
          expect(actual.quaternion.angleTo(target.quaternion)).toBeLessThan(Math.PI / 180);
        }
      }
    }

    // 25 frames of 2.5 mm/s continuous motion at 60 FPS (~1.04 mm total) on Z+
    const model = loadRobotModel(spec);
    const solver = new IKSolver(model, spec.eeLink);
    const startZ = forward(model, spec.eeLink);
    let continuousPose = startZ;
    const frameDeltaMm = 2.5 / 60;
    for (let frame = 0; frame < 25; frame++) {
      const nextPose = stepBasePose(continuousPose, 'z', frameDeltaMm);
      expect(solver.solve(nextPose).ok).toBe(true);
      continuousPose = nextPose;
    }
    const afterContinuous = forward(model, spec.eeLink);
    expect((afterContinuous.position.z - startZ.position.z) * 1000).toBeCloseTo(25 * frameDeltaMm, 1);
  });
});

describe.each(['xarm5', 'xarm6', 'xarm7'] as const)('%s linear-rail carriage mount invariance', id => {
  const spec = getRobotSpec(id);

  it('keeps base-frame FK, IK jog convergence, and mount transforms invariant across 0 / 350 / 700 mm carriage travel', () => {
    const unmounted = loadRobotModel(spec);
    const mounted = loadRobotModel(spec);
    const offset = assemblyToolOffset(id, { sensor: true, gripperId: 'gripper-g2' });

    const unmountedSolver = new IKSolver(unmounted, spec.eeLink);
    unmountedSolver.setToolOffset(offset);

    const mountedSolver = new IKSolver(mounted, spec.eeLink);
    mountedSolver.setToolOffset(offset);

    const railFrame = new Group();
    railFrame.position.copy(RAIL_ORIGIN_WORLD);
    railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);

    const carriage = new Group();
    railFrame.add(carriage);

    const robotMount = new Group();
    robotMount.position.copy(ROBOT_BASE_CAD);
    robotMount.quaternion.copy(ROBOT_MOUNT_CAD_ROTATION);
    carriage.add(robotMount);
    robotMount.add(mounted);

    const expectedMountQuat = robotMount.quaternion.clone();

    for (const railMm of [0, 350, 700]) {
      expect(setJoints(unmounted, homeJoints(spec.dof))).toBe(true);
      expect(setJoints(mounted, homeJoints(spec.dof))).toBe(true);
      carriage.position.z = -railMm / 1000;
      railFrame.updateMatrixWorld(true);
      expect(mounted.links.link_base.getWorldQuaternion(new Quaternion()).angleTo(ROBOT_BASE_WORLD_ROTATION)).toBeLessThan(1e-7);

      const fkUnmounted = forward(unmounted, spec.eeLink, offset);
      const fkMounted = forward(mounted, spec.eeLink, offset);
      expect(fkMounted.position.distanceTo(fkUnmounted.position)).toBeLessThan(1e-7);
      expect(fkMounted.quaternion.angleTo(fkUnmounted.quaternion)).toBeLessThan(1e-7);

      for (const axis of ['x', 'z', 'pitch', 'yaw'] as const) {
        const target = stepBasePose(forward(mounted, spec.eeLink, offset), axis, 1);
        expect(unmountedSolver.solve(target)).toMatchObject({ ok: true });
        expect(mountedSolver.solve(target)).toMatchObject({ ok: true });

        const actualMounted = forward(mounted, spec.eeLink, offset);
        expect(actualMounted.position.distanceTo(target.position)).toBeLessThan(0.001);
        expect(actualMounted.quaternion.angleTo(target.quaternion)).toBeLessThan(MathUtils.degToRad(1));

        // Verify local transforms of robotMount and URDFRobot remain untouched by closed-chain-ik
        expect(robotMount.position.distanceTo(ROBOT_BASE_CAD)).toBeLessThan(1e-9);
        expect(robotMount.quaternion.equals(expectedMountQuat)).toBe(true);
        expect(mounted.position.length()).toBeLessThan(1e-9);
        expect(mounted.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
      }
    }
  });
});
