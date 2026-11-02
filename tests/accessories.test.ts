// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import URDFLoader from 'urdf-loader';
import {
  assemblyGripperMount,
  assemblyToolOffset,
  RAIL_CAD_TO_WORLD,
  RAIL_ORIGIN_WORLD,
  RAIL_SPEC,
  ROBOT_BASE_CAD,
  ROBOT_BASE_WORLD_ROTATION,
  ROBOT_MOUNT_CAD_ROTATION,
  SENSOR_FLANGE_CAD,
  SENSOR_SPEC,
  SENSOR_TCP,
  supportsLinearRail,
  supportsSensor,
  validRailPosition,
} from '../src/accessories';
import { GRIPPERS, gripperMount, supportsGripper, toolOffset } from '../src/grippers';
import { composePose, forward, homeJoints, IKSolver, jointValues, setJoints, stepBasePose } from '../src/kinematics';
import { getRobotSpec, ROBOTS, type RobotId } from '../src/robots';

const sensorRobots: RobotId[] = ['xarm5', 'xarm6', 'xarm7', 'uf850'];

function loadRobot(id: RobotId) {
  const spec = getRobotSpec(id);
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  setJoints(model, homeJoints(spec.dof));
  return model;
}

async function loadGlbScene(filePath: string) {
  const loader = new GLTFLoader();
  const bytes = readFileSync(filePath);
  const data = new Uint8Array(bytes).buffer;
  return (await loader.parseAsync(data, '')).scene;
}

describe('v0.0.3 accessory compatibility & validation', () => {
  it('enforces linear rail compatibility exclusively on xArm 5/6/7 and sensor compatibility on xArm 5/6/7 + 850', () => {
    expect(ROBOTS.filter(r => supportsLinearRail(r.id)).map(r => r.id)).toEqual(['xarm5', 'xarm6', 'xarm7']);
    expect(supportsLinearRail('uf850')).toBe(false);
    expect(supportsLinearRail('lite6')).toBe(false);

    expect(ROBOTS.filter(r => supportsSensor(r.id)).map(r => r.id)).toEqual(['xarm5', 'xarm6', 'xarm7', 'uf850']);
    expect(supportsSensor('lite6')).toBe(false);
  });

  it('validates linear rail travel within 0..700 mm on a 0.1 mm grid', () => {
    for (const valid of [0, 0.1, 280.5, 350, 699.9, 700]) {
      expect(validRailPosition(valid), `expected ${valid} to be valid`).toBe(true);
    }
    for (const invalid of [-0.1, 700.1, 0.05, 123.45, NaN, Infinity, -Infinity]) {
      expect(validRailPosition(invalid), `expected ${invalid} to be invalid`).toBe(false);
    }
  });

  it('keeps the robot base +Y parallel to rail +X across 0..700 mm travel', () => {
    const railFrame = new Group();
    railFrame.position.copy(RAIL_ORIGIN_WORLD);
    railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);

    const carriage = new Group();
    railFrame.add(carriage);

    const robotMount = new Group();
    robotMount.position.copy(ROBOT_BASE_CAD);
    robotMount.quaternion.copy(ROBOT_MOUNT_CAD_ROTATION);
    carriage.add(robotMount);

    for (const railMm of [0, 280.5, 350, 700]) {
      carriage.position.z = -railMm / 1000;
      railFrame.updateMatrixWorld(true);
      const worldPos = robotMount.getWorldPosition(new Vector3());
      const worldQuat = robotMount.getWorldQuaternion(new Quaternion());
      expect(worldPos.x).toBeCloseTo(railMm / 1000, 6);
      expect(worldPos.y).toBeCloseTo(0, 6);
      expect(worldPos.z).toBeCloseTo(0.107, 6);
      expect(worldQuat.angleTo(ROBOT_BASE_WORLD_ROTATION)).toBeLessThan(1e-7);
      expect(new Vector3(0, 1, 0).applyQuaternion(worldQuat).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-7);
    }
  });

  it('rejects sensor tool offsets on Lite 6', () => {
    expect(() => assemblyToolOffset('lite6', { sensor: true })).toThrow(/Unsupported sensor/);
    expect(() => assemblyToolOffset('lite6', { gripperId: 'gripper-g2' })).toThrow(/Unsupported gripper/);
  });
});

describe('public AL0700 & AI1500 GLB asset integrity & 3D geometry', () => {
  it('matches SHA-256 checksums, sanitized provenance docs, and actual Three.js GLB geometry bounds', async () => {
    for (const dir of [RAIL_SPEC.id, SENSOR_SPEC.id]) {
      const glbPath = `public/models/${dir}/model.glb`;
      const sumLine = readFileSync(`public/models/${dir}/SHA256SUMS`, 'utf8').trim();
      const [expectedHash, fileName] = sumLine.split(/\s+/);
      expect(fileName).toBe('model.glb');
      const actualHash = createHash('sha256').update(readFileSync(glbPath)).digest('hex');
      expect(actualHash).toBe(expectedHash);

      const sourceDoc = readFileSync(`public/models/${dir}/SOURCE.md`, 'utf8');
      expect(sourceDoc).not.toContain('/home/');
      expect(sourceDoc).not.toContain('dev/asserts');
    }

    // Verify AL0700 rail_fixed & rail_carriage hierarchy and world-space travel along +X
    const railModel = await loadGlbScene('public/models/al0700/model.glb');
    const railFixed = railModel.getObjectByName('rail_fixed');
    const railCarriage = railModel.getObjectByName('rail_carriage');
    expect(railFixed).toBeDefined();
    expect(railCarriage).toBeDefined();

    const railFrame = new Group();
    railFrame.position.copy(RAIL_ORIGIN_WORLD);
    railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);
    railFrame.add(railModel);
    railFrame.updateMatrixWorld(true);

    const fixedBox = new Box3().setFromObject(railFixed!);
    expect(fixedBox.min.z).toBeCloseTo(0, 2);

    const carriageBox0 = new Box3().setFromObject(railCarriage!);
    railCarriage!.position.z = -0.7;
    railFrame.updateMatrixWorld(true);
    const carriageBox700 = new Box3().setFromObject(railCarriage!);
    expect(carriageBox700.min.x - carriageBox0.min.x).toBeCloseTo(0.7, 5);
    expect(carriageBox700.max.x - carriageBox0.max.x).toBeCloseTo(0.7, 5);
    expect(carriageBox700.min.y).toBeCloseTo(carriageBox0.min.y, 6);
    expect(carriageBox700.min.z).toBeCloseTo(carriageBox0.min.z, 6);

    // Verify AI1500 sensor mesh mounts cleanly around flange origin (0,0,0) -> +58.6 mm
    const sensorModel = await loadGlbScene('public/models/ai1500/model.glb');
    let meshCount = 0;
    sensorModel.traverse(obj => { if (obj instanceof Mesh) meshCount++; });
    expect(meshCount).toBeGreaterThan(0);

    const sensorMount = new Group();
    sensorModel.position.copy(SENSOR_FLANGE_CAD).negate();
    sensorMount.add(sensorModel);
    sensorMount.updateMatrixWorld(true);
    const sensorBox = new Box3().setFromObject(sensorMount);
    expect((sensorBox.min.x + sensorBox.max.x) / 2).toBeCloseTo(0, 2);
    expect((sensorBox.min.y + sensorBox.max.y) / 2).toBeCloseTo(0, 2);
    expect(sensorBox.max.z - sensorBox.min.z).toBeGreaterThan(0.05);
    expect(sensorBox.max.z - sensorBox.min.z).toBeLessThan(0.075);
  });

  it('keeps the AL0700 CAD structure and geometry while coloring all 51 parts', () => {
    const bytes = readFileSync('public/models/al0700/model.glb');
    const jsonLength = bytes.readUInt32LE(12);
    const binHeader = 20 + jsonLength;
    expect(bytes.toString('ascii', binHeader + 4, binHeader + 8)).toBe('BIN\0');
    expect(createHash('sha256').update(bytes.subarray(binHeader + 8)).digest('hex'))
      .toBe('edcf46c73495995b816a99417f981d5c56199389db13625dea6e7a898ff9c455');

    type RailGltf = {
      nodes: { name?: string; mesh?: number }[];
      meshes: { primitives: { material: number }[] }[];
      materials: { pbrMetallicRoughness: {
        baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number;
      } }[];
    };
    const gltf = JSON.parse(bytes.toString('utf8', 20, binHeader)) as RailGltf;
    const { materials, ...structure } = gltf;
    expect(createHash('sha256').update(JSON.stringify(structure)).digest('hex'))
      .toBe('4e114aa2da11a96468a56363e164ac1b2d08a907256a2d06975035917756175b');
    expect(materials).toHaveLength(51);

    const black = new Set([0, 3, 5, 7, 8, 11, 17, 18, 19, 22, 35, 43, 44, 45]);
    const darkGray = new Set([23, 24, 34, 39, 42]);
    const finishes = {
      black: { baseColorFactor: [0.015, 0.017, 0.019, 1], metallicFactor: 0.28, roughnessFactor: 0.72 },
      darkGray: { baseColorFactor: [0.075, 0.08, 0.085, 1], metallicFactor: 0.38, roughnessFactor: 0.62 },
      silver: { baseColorFactor: [0.41, 0.44, 0.46, 1], metallicFactor: 0.50, roughnessFactor: 0.42 },
    };
    const parts = gltf.nodes.filter(node => node.name?.startsWith('part_'));
    expect(parts).toHaveLength(51);
    const observed = new Set<string>();
    for (const node of parts) {
      const index = Number(node.name!.slice(5));
      const materialIndex = gltf.meshes[node.mesh!].primitives[0].material;
      const actual = materials[materialIndex].pbrMetallicRoughness;
      const expected = finishes[black.has(index) ? 'black' : darkGray.has(index) ? 'darkGray' : 'silver'];
      expect(actual, node.name).toEqual(expected);
      observed.add(JSON.stringify(actual));
    }
    expect(observed.size).toBe(3);
  });

  it('keeps the AI1500 CAD structure and geometry while matching anodized aluminum flange materials across all 15 parts', () => {
    const bytes = readFileSync('public/models/ai1500/model.glb');
    const jsonLength = bytes.readUInt32LE(12);
    const binHeader = 20 + jsonLength;
    expect(bytes.toString('ascii', binHeader + 4, binHeader + 8)).toBe('BIN\0');
    expect(createHash('sha256').update(bytes.subarray(binHeader + 8)).digest('hex'))
      .toBe('d04549986d3cf50458c543d0d243163e1730321f143d5639d3f953455c5fa572');

    type SensorGltf = {
      nodes: { name?: string; mesh?: number }[];
      meshes: { primitives: { material: number }[] }[];
      materials: {
        doubleSided?: boolean;
        pbrMetallicRoughness: {
          baseColorFactor: number[];
          metallicFactor: number;
          roughnessFactor: number;
        };
      }[];
    };
    const gltf = JSON.parse(bytes.toString('utf8', 20, binHeader)) as SensorGltf;
    const { materials, ...structure } = gltf;
    expect(createHash('sha256').update(JSON.stringify(structure)).digest('hex'))
      .toBe('6fcd701978b279146061e7fd413d7fd420b65986be1bb9531f8dbaee52a74395');
    expect(materials).toHaveLength(15);

    const flangeBytes = readFileSync('public/models/xarm6/meshes/xarm6_1305/visual_glb/link6.glb');
    const flangeGltf = JSON.parse(
      flangeBytes.toString('utf8', 20, 20 + flangeBytes.readUInt32LE(12)),
    ) as SensorGltf;
    const armFlangePbr = flangeGltf.materials[4].pbrMetallicRoughness;

    const silverAnodized = new Set([1, 2]);
    const blackAnodized = new Set([10, 12, 14]);
    const stainless = new Set([0, 3, 5, 7, 11, 13]);
    const connector = new Set([4, 9]);
    const finishes = {
      silverAnodized: {
        baseColorFactor: [0.952941, 0.952941, 0.94902, 1],
        metallicFactor: 0.8,
        roughnessFactor: 0.634245,
      },
      blackAnodized: {
        baseColorFactor: [0.09, 0.094, 0.1, 1],
        metallicFactor: 0.8,
        roughnessFactor: 0.634245,
      },
      stainless: {
        baseColorFactor: [0.96, 0.965, 0.97, 1],
        metallicFactor: 0.78,
        roughnessFactor: 0.48,
      },
      connector: {
        baseColorFactor: [0.045, 0.048, 0.052, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.72,
      },
      contactGold: {
        baseColorFactor: [0.83, 0.64, 0.24, 1],
        metallicFactor: 0.8,
        roughnessFactor: 0.38,
      },
    };

    // Silver anodized sensor flanges must match the xArm 6 anodized aluminum flange PBR parameters.
    finishes.silverAnodized.baseColorFactor.forEach((channel, idx) => {
      expect(channel).toBeCloseTo(armFlangePbr.baseColorFactor[idx], 5);
    });
    expect(finishes.silverAnodized.metallicFactor).toBeCloseTo(armFlangePbr.metallicFactor, 5);
    expect(finishes.silverAnodized.roughnessFactor).toBeCloseTo(armFlangePbr.roughnessFactor, 5);

    const parts = gltf.nodes.filter(node => node.name?.startsWith('part_'));
    expect(parts).toHaveLength(15);
    const observed = new Set<string>();
    for (const node of parts) {
      const index = Number(node.name!.slice(5));
      const materialIndex = gltf.meshes[node.mesh!].primitives[0].material;
      expect(materials[materialIndex].doubleSided, node.name).toBe(true);
      const actual = materials[materialIndex].pbrMetallicRoughness;
      const expected = silverAnodized.has(index)
        ? finishes.silverAnodized
        : blackAnodized.has(index)
          ? finishes.blackAnodized
          : stainless.has(index)
            ? finishes.stainless
            : connector.has(index)
              ? finishes.connector
              : finishes.contactGold;
      expect(actual, node.name).toEqual(expected);
      observed.add(JSON.stringify(actual));
    }
    expect(observed.size).toBe(5);
  });
});

describe.each(sensorRobots)('%s stacked F/T sensor + gripper TCP & IK', id => {
  const spec = getRobotSpec(id);

  it('composes sensor-only (+58.6 mm) and sensor + gripper TCP offsets accurately', () => {
    const robot = loadRobot(id);
    const bareFk = forward(robot, spec.eeLink);

    const sensorOffset = assemblyToolOffset(id, { sensor: true });
    expect(sensorOffset.position.z).toBeCloseTo(0.0586, 8);
    const sensorFk = forward(robot, spec.eeLink, sensorOffset);
    const expectedSensorFk = composePose(bareFk, sensorOffset);
    expect(sensorFk.position.distanceTo(expectedSensorFk.position)).toBeLessThan(1e-9);
    expect(sensorFk.quaternion.angleTo(expectedSensorFk.quaternion)).toBeLessThan(1e-9);
    // At zero pose, link_eef points straight down (-Z in link_base), so +58.6 mm flange +Z shifts base Z by -58.6 mm.
    expect(sensorFk.position.z).toBeCloseTo(bareFk.position.z - 0.0586, 5);

    for (const gripper of GRIPPERS.filter(g => supportsGripper(id, g.id))) {
      const stackedMount = assemblyGripperMount(id, gripper.id, true);
      const expectedMount = composePose(SENSOR_TCP, gripperMount(id, gripper.id));
      expect(stackedMount.position.distanceTo(expectedMount.position)).toBeLessThan(1e-9);
      expect(stackedMount.quaternion.angleTo(expectedMount.quaternion)).toBeLessThan(1e-9);

      const stackedOffset = assemblyToolOffset(id, { sensor: true, gripperId: gripper.id });
      const expectedOffset = composePose(SENSOR_TCP, toolOffset(id, gripper.id));
      expect(stackedOffset.position.distanceTo(expectedOffset.position)).toBeLessThan(1e-9);
      expect(stackedOffset.quaternion.angleTo(expectedOffset.quaternion)).toBeLessThan(1e-9);

      if (gripper.id === 'gripper-g2') {
        expect(stackedOffset.position.z).toBeCloseTo(0.0586 + 0.1735, 8);
      }
    }
  });

  it('solves Cartesian jog steps for sensor-only and sensor + gripper stacks and rolls back unreachable goals', () => {
    const combos = [
      { label: 'sensor-only', offset: assemblyToolOffset(id, { sensor: true }) },
      ...GRIPPERS.filter(g => supportsGripper(id, g.id)).map(g => ({
        label: `sensor+${g.id}`,
        offset: assemblyToolOffset(id, { sensor: true, gripperId: g.id }),
      })),
    ];

    for (const combo of combos) {
      const robot = loadRobot(id);
      const solver = new IKSolver(robot, spec.eeLink);
      solver.setToolOffset(combo.offset);

      for (const axis of ['x', 'z', 'yaw'] as const) {
        const target = stepBasePose(forward(robot, spec.eeLink, combo.offset), axis, 1);
        const result = solver.solve(target);
        expect(result, `${id} ${combo.label} ${axis}`).toMatchObject({ ok: true });
        const actual = forward(robot, spec.eeLink, combo.offset);
        expect(actual.position.distanceTo(target.position)).toBeLessThan(0.001);
        expect(actual.quaternion.angleTo(target.quaternion)).toBeLessThan(MathUtils.degToRad(1));
      }

      const before = jointValues(robot);
      expect(solver.solve({ position: new Vector3(10, 10, 10), quaternion: new Quaternion() }).ok).toBe(false);
      jointValues(robot).forEach((value, index) => expect(value).toBeCloseTo(before[index], 6));
    }
  });
});
