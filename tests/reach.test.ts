// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import URDFLoader from 'urdf-loader';
import { assemblyToolOffset, supportsSensor } from '../src/accessories';
import { GRIPPERS, supportsGripper, type GripperId } from '../src/grippers';
import { forward, limits, setJoints } from '../src/kinematics';
import { reachRadius } from '../src/reach';
import { ROBOTS } from '../src/robots';
import data from '../src/reach-data.json';

const models = data.robots as Record<string, typeof data.robots.xarm6>;
const toleranceM = 0.0001;

function robotModel(path: string) {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  return loader.parse(readFileSync(path, 'utf8'));
}

describe('z=0 TCP numerical reach estimates', () => {
  it('covers exactly the current 27 compatible assemblies', () => {
    const expected = ROBOTS.flatMap(spec => [false, ...(supportsSensor(spec.id) ? [true] : [])].flatMap(sensor =>
      [null, ...GRIPPERS.filter(gripper => supportsGripper(spec.id, gripper.id)).map(gripper => gripper.id)]
        .map(gripperId => `${spec.id}:${sensor}:${gripperId}`)));
    const actual = Object.entries(models).flatMap(([id, robot]) =>
      robot.combinations.map(combo => `${id}:${combo.sensor}:${combo.gripperId}`));
    expect(expected).toHaveLength(27);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it.each(ROBOTS)('$id keeps model, joint limits, TCP and both MuJoCo witnesses current in Three.js', spec => {
    const path = `public/${spec.modelDir}${spec.urdfFile}`;
    const entry = models[spec.id];
    expect(entry, `Missing ${spec.id}; run scripts/generate-reach.py`).toBeDefined();
    expect(entry.urdfSha256, `Changed ${path}; regenerate reach data`).toBe(createHash('sha256').update(readFileSync(path)).digest('hex'));
    expect(entry.eeLink).toBe(spec.eeLink);
    expect(entry.dof).toBe(spec.dof);
    const robot = robotModel(path);
    const jointBounds = limits(robot);
    const joint1 = robot.joints.joint1;
    expect(joint1.jointType).toBe('revolute');
    expect(joint1.axis.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-10);
    expect(joint1.position.x).toBeCloseTo(0, 10);
    expect(joint1.position.y).toBeCloseTo(0, 10);
    expect(joint1.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-10);
    expect(jointBounds[0].max - jointBounds[0].min).toBeGreaterThanOrEqual(2 * Math.PI);

    for (const combo of entry.combinations) {
      const name = `${spec.id} sensor=${combo.sensor} gripper=${combo.gripperId}`;
      const gripperId = combo.gripperId as GripperId | null;
      const offset = assemblyToolOffset(spec.id, { sensor: combo.sensor, gripperId: gripperId ?? undefined });
      expect(offset.position.toArray(), `${name}: TCP changed; regenerate reach data`).toEqual(combo.tcp.position);
      offset.quaternion.toArray().forEach((value, i) =>
        expect(Math.abs(value - combo.tcp.quaternion[i]), `${name}: TCP changed; regenerate reach data`).toBeLessThan(1e-12));
      expect(reachRadius(spec, combo.sensor, gripperId ?? undefined), name).toBe(combo.radiusM);
      expect(new Set([combo.method, combo.crossCheck.method])).toEqual(new Set(['slsqp', 'differential-evolution']));
      expect(Math.abs(combo.radiusM - combo.crossCheck.radiusM), name).toBeLessThanOrEqual(0.001);
      expect(combo.radiusM).toBeGreaterThanOrEqual(combo.crossCheck.radiusM);
      for (const [method, witness] of [['best', combo], ['independent', combo.crossCheck]] as const) {
        expect(witness.jointsRad, `${name} ${method}`).toHaveLength(spec.dof);
        witness.jointsRad.forEach((joint, i) => {
          expect(joint, `${name} ${method} joint${i + 1}`).toBeGreaterThanOrEqual(jointBounds[i].min);
          expect(joint, `${name} ${method} joint${i + 1}`).toBeLessThanOrEqual(jointBounds[i].max);
        });
        expect(setJoints(robot, witness.jointsRad), name).toBe(true);
        const tcp = forward(robot, spec.eeLink, offset).position;
        expect(Math.abs(tcp.z), `${name} ${method}: z`).toBeLessThanOrEqual(toleranceM);
        expect(Math.abs(Math.hypot(tcp.x, tcp.y) - witness.radiusM), `${name} ${method}: radius`).toBeLessThanOrEqual(toleranceM);
        expect(tcp.distanceTo(new Vector3(...witness.tcpBaseM as [number, number, number])), `${name} ${method}: MuJoCo / Three.js`).toBeLessThan(toleranceM);
      }

      // With the first joint sweeping a complete turn, the feasible TCP rotates about base Z.
      expect(setJoints(robot, combo.jointsRad)).toBe(true);
      const original = forward(robot, spec.eeLink, offset).position;
      for (let quarterTurn = 0; quarterTurn <= 4; quarterTurn++) {
        const angle = jointBounds[0].min + quarterTurn * Math.PI / 2;
        const joints = [...combo.jointsRad];
        joints[0] = angle;
        expect(setJoints(robot, joints)).toBe(true);
        const actual = forward(robot, spec.eeLink, offset).position;
        const rotated = original.clone().applyAxisAngle(new Vector3(0, 0, 1), angle - combo.jointsRad[0]);
        expect(actual.distanceTo(rotated), `${name} joint1 ${angle}`).toBeLessThan(toleranceM);
      }
      if (gripperId === 'bio-gripper-g2') {
        expect(offset.position.x).toBeCloseTo(0.135, 8);
        expect(offset.position.y).toBeCloseTo(0, 8);
        expect(offset.position.z).toBeCloseTo(0.055 + (combo.sensor ? 0.0586 : 0), 8);
      }
    }
  });

  it('constrains the G2 TCP to z=0 instead of constraining its flange there', () => {
    const spec = ROBOTS.find(robot => robot.id === 'xarm6')!;
    const robot = robotModel(`public/${spec.modelDir}${spec.urdfFile}`);
    // This independently found feasible optimum has a raised flange and a horizontal TCP.
    const verifiedPose = [0, 1.6788247255868711, -2.733167354763675, -0.00010111816502059004, 0.05137897824821802, 4.327112208772868];
    expect(setJoints(robot, verifiedPose)).toBe(true);
    const tcp = forward(robot, spec.eeLink, assemblyToolOffset(spec.id, { gripperId: 'gripper-g2' })).position;
    const flange = forward(robot, spec.eeLink).position;
    expect(Math.abs(tcp.z)).toBeLessThan(toleranceM);
    expect(Math.hypot(tcp.x, tcp.y) * 1000).toBeCloseTo(882.1, 0);
    expect(flange.z * 1000).toBeCloseTo(93, 0);
  });

  it('rejects missing, incompatible or mismatched configurations instead of reusing a radius', () => {
    const spec = ROBOTS.find(robot => robot.id === 'lite6')!;
    expect(reachRadius(spec, true)).toBeUndefined();
    expect(reachRadius(spec, false, 'gripper-g2')).toBeUndefined();
    expect(reachRadius({ ...spec, eeLink: 'changed' }, false)).toBeUndefined();
    expect(reachRadius({ ...spec, dof: 7 }, false)).toBeUndefined();
  });
});
