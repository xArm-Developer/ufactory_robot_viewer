// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MathUtils, Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import { bioFingerTravel, GRIPPERS, gripperMount, supportsGripper, toolOffset, validOpening } from '../src/grippers';
import { forward, homeJoints, IKSolver, jointValues, setJoints, stepBasePose } from '../src/kinematics';
import { getRobotSpec, type RobotId } from '../src/robots';
import fixtures from './mujoco-gripper-fk.json';
import liteFixtures from './mujoco-lite6-tool-fk.json';

const robots = ['xarm5', 'xarm6', 'xarm7', 'uf850'] as const;
const legacyGrippers = GRIPPERS.filter(gripper => supportsGripper('xarm6', gripper.id));

function loadRobot(id: RobotId) {
  const spec = getRobotSpec(id);
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  setJoints(model, homeJoints(spec.dof));
  return model;
}

describe('opening geometry', () => {
  it('accepts finite 0.1 mm values for continuous grippers and endpoints for the Lite gripper', () => {
    for (const spec of GRIPPERS) {
      if (!spec.opening) {
        expect(validOpening(spec, 0)).toBe(false);
        continue;
      }
      const { min, max } = spec.opening;
      expect(validOpening(spec, min)).toBe(true);
      expect(validOpening(spec, max)).toBe(true);
      expect(validOpening(spec, min + 0.1)).toBe(spec.opening.mode === 'continuous');
      for (const value of [NaN, Infinity, min - 0.1, max + 0.1, min + 0.05]) {
        expect(validOpening(spec, value)).toBe(false);
      }
    }
    const lite = GRIPPERS.find(spec => spec.id === 'lite6-gripper')!;
    for (const value of [0.1, 30, 50, 99.9]) expect(validOpening(lite, value)).toBe(false);
    expect(GRIPPERS.filter(spec => supportsGripper('lite6', spec.id)).map(spec => spec.id)).toEqual(['lite6-gripper', 'lite6-vacuum-gripper']);
    for (const id of robots) expect(GRIPPERS.filter(spec => supportsGripper(id, spec.id))).toEqual(legacyGrippers);
    expect(bioFingerTravel(71)).toBe(0);
    expect(bioFingerTravel(110)).toBeCloseTo(0.0195, 12);
    expect(bioFingerTravel(150)).toBeCloseTo(0.0395, 12);
    for (const id of robots) {
      const mount = gripperMount(id, 'bio-gripper-g2');
      expect(mount.position.toArray()).toEqual([0, 0, 0]);
      expect(mount.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      const tcp = toolOffset(id, 'bio-gripper-g2');
      expect(tcp.position.toArray()).toEqual([0.135, 0, 0.055]);
      expect(tcp.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
  });


});

describe.each(robots)('%s arm + gripper TCP', id => {
  const spec = getRobotSpec(id);
  it.each(legacyGrippers)('matches MuJoCo reference combo URDF across all poses: $name', gripper => {
    const robot = loadRobot(id);
    const offset = toolOffset(id, gripper.id);
    const samples = fixtures.robots[id][gripper.id as 'gripper-g2' | 'bio-gripper-g2'];
    for (const sample of samples) {
      expect(setJoints(robot, sample.joints)).toBe(true);
      const actual = forward(robot, spec.eeLink, offset);
      const expectedPosition = new Vector3(...sample.position as [number, number, number]);
      const expectedQuaternion = new Quaternion(...sample.quaternion as [number, number, number, number]);
      expect(actual.position.distanceTo(expectedPosition), `${id} ${gripper.id} ${sample.joints}`).toBeLessThan(0.0001);
      expect(actual.quaternion.angleTo(expectedQuaternion)).toBeLessThan(MathUtils.degToRad(0.01));
    }
  });

  it.each(legacyGrippers)('jogs the fixed TCP and restores joints after a failed target: $name', gripper => {
    const robot = loadRobot(id);
    const offset = toolOffset(id, gripper.id);
    const solver = new IKSolver(robot, spec.eeLink);
    solver.setToolOffset(offset);
    for (const axis of ['z', 'yaw'] as const) {
      const target = stepBasePose(forward(robot, spec.eeLink, offset), axis, 1);
      const result = solver.solve(target);
      expect(result, `${id} ${gripper.id} ${axis}`).toMatchObject({ ok: true });
      const actual = forward(robot, spec.eeLink, offset);
      expect(actual.position.distanceTo(target.position)).toBeLessThan(0.001);
      expect(actual.quaternion.angleTo(target.quaternion)).toBeLessThan(MathUtils.degToRad(1));
    }
    const before = jointValues(robot);
    expect(solver.solve({ position: new Vector3(10, 10, 10), quaternion: new Quaternion() }).ok).toBe(false);
    jointValues(robot).forEach((value, index) => expect(value).toBeCloseTo(before[index], 6));
  });
});

describe('Lite 6 tool TCP', () => {
  it.each([
    { id: 'lite6-gripper' as const, samples: liteFixtures.tools.gripper },
    { id: 'lite6-vacuum-gripper' as const, samples: liteFixtures.tools.vacuum },
  ])('matches the independent MuJoCo combination URDF: $id', ({ id, samples }) => {
    const robot = loadRobot('lite6');
    const offset = toolOffset('lite6', id);
    const solver = new IKSolver(robot, 'link6');
    solver.setToolOffset(offset);
    for (const sample of samples) {
      expect(setJoints(robot, sample.joints)).toBe(true);
      const actual = forward(robot, 'link6', offset);
      expect(actual.position.distanceTo(new Vector3(...sample.position as [number, number, number]))).toBeLessThan(0.0001);
      expect(actual.quaternion.angleTo(new Quaternion(...sample.quaternion as [number, number, number, number]))).toBeLessThan(MathUtils.degToRad(0.01));
    }
    setJoints(robot, samples[1].joints);
    const target = stepBasePose(forward(robot, 'link6', offset), 'z', 1);
    expect(solver.solve(target)).toMatchObject({ ok: true });
    expect(forward(robot, 'link6', offset).position.distanceTo(target.position)).toBeLessThan(0.001);
    expect(() => toolOffset('xarm6', id)).toThrow(/Unsupported gripper/);
  });
});
