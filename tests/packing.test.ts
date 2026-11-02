// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import URDFLoader from 'urdf-loader';
import { forward, setJoints } from '../src/kinematics';
import { packingJoints } from '../src/packing-kinematics';
import config from '../src/packing-config.json' with { type: 'json' };
import { PackingSegment, packingSegmentRatios, planPackingSegment, stationary, type MotionState } from '../src/packing-trajectory';
import { createGripperModel, gripperPartNames } from '../src/gripper-model';
import { getGripper } from '../src/grippers';

const xml = readFileSync('public/examples/packing-01/scene.xml', 'utf8');

describe('packing example geometry and kinematics', () => {
  it('uses dynamic workpieces, moving surface friction and actuated jaws without a grasp weld', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const belt = doc.querySelector('geom[name="belt"]')!;
    expect(belt.getAttribute('surfacevel')).toBe(`0 -${config.belt.speed} 0 0 0 0`);
    expect(belt.getAttribute('priority')).toBe('1');
    const floor = doc.querySelector('geom[name="box_floor"]')!;
    expect(floor.getAttribute('solref')).toBe('.006 .3');
    expect(floor.getAttribute('solimp')).toBe('.99 .99 .001');
    expect(floor.getAttribute('pos')!.split(' ').map(Number)).toEqual([.2, -.32, .006]);
    expect(Number(doc.querySelector('geom[name="box_right"]')!.getAttribute('pos')!.split(' ')[0]) - Number(doc.querySelector('geom[name="box_left"]')!.getAttribute('pos')!.split(' ')[0]) - config.box.wall).toBeCloseTo(config.box.innerSize);
    for (let i = 0; i < 9; i++) {
      const body = doc.querySelector(`body[name="block_${i}"]`)!;
      expect(body.querySelector('freejoint')).not.toBeNull();
      const geom = body.querySelector('geom')!;
      expect(geom.getAttribute('size')!.split(' ').map(Number)).toEqual([.015, .015, .015]);
      expect(Number(geom.getAttribute('mass'))).toBe(config.part.mass);
      expect(geom.getAttribute('solref')).toBe('.006 .3');
      expect(Number(body.getAttribute('pos')!.split(' ')[1])).toBeCloseTo(config.part.initialY + i * config.part.spacing);
      expect(Number(geom.getAttribute('friction')!.split(' ')[0])).toBeGreaterThan(0);
    }
    expect(doc.querySelector('equality weld')).toBeNull();
    for (const side of ['left', 'right']) {
      expect(doc.querySelector(`position[joint="jaw_${side}"]`)).not.toBeNull();
      const pad = doc.querySelector(`geom[name="pad_${side}"]`)!;
      expect(Number(pad.getAttribute('friction')!.split(' ')[0])).toBeGreaterThan(0);
      expect(pad.getAttribute('solref')).toBe('.008 1');
      expect(pad.getAttribute('priority')).toBe('2');
    }
  });

  it('copies each actuator torque limit from the robot URDF', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const urdf = new DOMParser().parseFromString(readFileSync('public/models/xarm6/xarm6.urdf', 'utf8'), 'application/xml');
    for (let i = 1; i <= 6; i++) {
      const effort = Number(urdf.querySelector(`joint[name="joint${i}"] limit`)!.getAttribute('effort'));
      const limits = doc.querySelector(`position[name="joint${i}"]`)!.getAttribute('forcerange')!.split(' ').map(Number);
      expect(limits).toEqual([-effort, effort]);
    }
  });

  it('centres the 30 mm workpiece between the actual G2 fingers with its bottom at their tips', async () => {
    const spec = getGripper('gripper-g2')!;
    const loader = new GLTFLoader();
    const parts = Object.fromEntries(await Promise.all(gripperPartNames(spec).map(async name => {
      const bytes = readFileSync(`public/models/gripper-g2/${name}.glb`);
      return [name, (await loader.parseAsync(new Uint8Array(bytes).buffer, '')).scene];
    })));
    const gripper = createGripperModel(spec, parts);
    gripper.setOpening(30);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const site = doc.querySelector('site[name="grasp"]')!.getAttribute('pos')!.split(' ').map(Number);
    for (const side of ['left', 'right']) {
      const finger = new Box3().setFromObject(parts[`${side}_finger`]);
      const jaw = doc.querySelector(`body[name="jaw_${side}"]`)!;
      const pad = jaw.querySelector('geom')!;
      const centreZ = Number(jaw.getAttribute('pos')!.split(' ')[2]);
      const halfHeight = Number(pad.getAttribute('size')!.split(' ')[2]);
      expect(centreZ).toBeCloseTo(site[2], 6);
      expect(finger.max.z - centreZ).toBeCloseTo(.015, 4);
      expect(centreZ + halfHeight).toBeLessThanOrEqual(finger.max.z);
    }
  });

  it('reaches the actual URDF grasp site throughout the packing workspace', () => {
    const loader = new URDFLoader(); loader.parseVisual = false;
    const robot = loader.parse(readFileSync('public/models/xarm6/xarm6.urdf', 'utf8'));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const site = doc.querySelector('site[name="grasp"]')!.getAttribute('pos')!.split(' ').map(Number);
    const offset = { position: new Vector3(...site), quaternion: new Quaternion() };
    for (const x of [.18, .22, .26, .32, .4]) for (const y of [-.36, -.28, -.1, 0, .1]) for (const z of [.06, .17, .24]) {
      const joints = packingJoints(x, y, z);
      expect(joints, `${x},${y},${z}`).toBeDefined();
      expect(setJoints(robot, joints!)).toBe(true);
      const pose = forward(robot, 'link_eef', offset);
      expect(pose.position.distanceTo(new Vector3(x, y, z))).toBeLessThan(.00001);
      expect(pose.quaternion.angleTo(new Quaternion(1, 0, 0, 0))).toBeLessThan(.00005);
    }
    expect(packingJoints(3, 0, 0)).toBeUndefined();
    expect(packingJoints(NaN, 0, 0)).toBeUndefined();
  });
});


describe('continuous packing trajectories', () => {
  it('passes a moving waypoint continuously and respects sampled Cartesian and joint limits', () => {
    const start: MotionState = { position: [.4, -.04, .055], velocity: [0, -.04, 0], acceleration: [0, 0, 0] };
    const waypoint: MotionState = { position: [.4, -.05, .065], velocity: [0, -.04, .08], acceleration: [0, 0, 0] };
    const end: MotionState = { position: [.245, -.275, .14], velocity: [0, 0, -.16], acceleration: [0, 0, 0] };
    const first = planPackingSegment(start, waypoint, .2);
    const second = planPackingSegment(waypoint, end, .2);
    for (const key of ['position', 'velocity', 'acceleration'] as const) {
      first.sample(first.duration)[key].forEach((value, i) => expect(value).toBeCloseTo(second.sample(0)[key][i], 9));
    }
    expect(Math.hypot(...first.sample(first.duration).velocity)).toBeGreaterThan(.05);
    for (const segment of [first, second]) {
      expect(segment.duration / config.step).toBeCloseTo(Math.round(segment.duration / config.step), 8);
      expect(Math.max(...packingSegmentRatios(segment))).toBeLessThanOrEqual(1);
    }
    expect(first.sample(first.duration).position[2]).toBeCloseTo(waypoint.position[2], 9);
    expect(second.sample(second.duration).position[2]).toBeCloseTo(end.position[2], 9);
  });

  it('samples a fifth-order boundary state exactly', () => {
    const start = stationary([.4, 0, .12]);
    const end = stationary([.3, -.2, .14]);
    const segment = new PackingSegment(start, end, 2);
    for (const key of ['position', 'velocity', 'acceleration'] as const) {
      segment.sample(0)[key].forEach((value, i) => expect(value).toBeCloseTo(start[key][i], 10));
      segment.sample(2)[key].forEach((value, i) => expect(value).toBeCloseTo(end[key][i], 10));
    }
  });
});
