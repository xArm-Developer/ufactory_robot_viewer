// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MathUtils, Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import { bioFingerTravel, GRIPPERS, supportsGripper, toolOffset, validOpening } from '../src/grippers';
import { forward, homeJoints, IKSolver, jointValues, setJoints, stepBasePose } from '../src/kinematics';
import { getRobotSpec, type RobotId } from '../src/robots';
import fixtures from './mujoco-gripper-fk.json';

const robots = ['xarm5', 'xarm6', 'xarm7', 'uf850'] as const;

function loadRobot(id: RobotId) {
  const spec = getRobotSpec(id);
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  setJoints(model, homeJoints(spec.dof));
  return model;
}

describe('opening geometry', () => {
  it('accepts only finite 0.1 mm values within each specified range', () => {
    for (const spec of GRIPPERS) {
      expect(validOpening(spec, spec.minMm)).toBe(true);
      expect(validOpening(spec, spec.maxMm)).toBe(true);
      expect(validOpening(spec, spec.minMm + 0.1)).toBe(true);
      for (const value of [NaN, Infinity, spec.minMm - 0.1, spec.maxMm + 0.1, spec.minMm + 0.05]) {
        expect(validOpening(spec, value)).toBe(false);
      }
    }
    expect(supportsGripper('lite6')).toBe(false);
    expect(bioFingerTravel(71)).toBe(0);
    expect(bioFingerTravel(110)).toBeCloseTo(0.0195, 12);
    expect(bioFingerTravel(150)).toBeCloseTo(0.0395, 12);
  });


});

describe.each(robots)('%s arm + gripper TCP', id => {
  const spec = getRobotSpec(id);
  it.each(GRIPPERS)('matches MuJoCo reference combo URDF across all poses: $name', gripper => {
    const robot = loadRobot(id);
    const offset = toolOffset(id, gripper.id);
    const samples = fixtures.robots[id][gripper.id];
    for (const sample of samples) {
      expect(setJoints(robot, sample.joints)).toBe(true);
      const actual = forward(robot, spec.eeLink, offset);
      const expectedPosition = new Vector3(...sample.position as [number, number, number]);
      const expectedQuaternion = new Quaternion(...sample.quaternion as [number, number, number, number]);
      expect(actual.position.distanceTo(expectedPosition), `${id} ${gripper.id} ${sample.joints}`).toBeLessThan(0.0001);
      expect(actual.quaternion.angleTo(expectedQuaternion)).toBeLessThan(MathUtils.degToRad(0.01));
    }
  });

  it.each(GRIPPERS)('jogs the fixed TCP and restores joints after a failed target: $name', gripper => {
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
