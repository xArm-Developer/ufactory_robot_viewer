// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Box3,
  BoxGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
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
} from '../src/accessories';
import {
  BoxShape,
  CollisionDetector,
  DEFAULT_PENETRATION_TOLERANCE_M,
  DragChainCollider,
  formatCollisionBodyName,
  intersectsGJK,
  PolytopeShape,
  shouldExcludeCollisionPair,
  type CollisionAssetManifest,
  type CollisionBodyId,
  type CollisionPair,
} from '../src/collision';
import { CollisionHighlighter } from '../src/collision-highlight';
import { createGripperModel, gripperPartNames, type GripperModel } from '../src/gripper-model';
import { getGripper, GRIPPERS, supportsGripper, type GripperId } from '../src/grippers';
import { forward, homeJoints, IKSolver, setJoints } from '../src/kinematics';
import { RailDragChain } from '../src/rail-drag-chain';
import { getRobotSpec, ROBOTS, type RobotId } from '../src/robots';

const ALL_MANIFEST_DIRS = [
  ...ROBOTS.map(r => r.id),
  ...GRIPPERS.map(g => g.id),
  SENSOR_SPEC.id,
  RAIL_SPEC.id,
];

function readManifest(modelId: string): CollisionAssetManifest {
  return JSON.parse(readFileSync(`public/models/${modelId}/collision.json`, 'utf8')) as CollisionAssetManifest;
}

function loadRobot(id: RobotId): URDFRobot {
  const spec = getRobotSpec(id);
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const robot = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  setJoints(robot, homeJoints(spec.dof));
  return robot;
}

async function loadGlbScene(filePath: string): Promise<Group> {
  const loader = new GLTFLoader();
  const bytes = readFileSync(filePath);
  const data = new Uint8Array(bytes).buffer;
  return (await loader.parseAsync(data, '')).scene;
}

const g2PartsPromise = (async () => {
  const entries = await Promise.all(
    gripperPartNames(getGripper('gripper-g2')!).map(
      async name => [name, await loadGlbScene(`public/models/gripper-g2/${name}.glb`)] as const,
    ),
  );
  return Object.fromEntries(entries);
})();

const railTemplatePromise = loadGlbScene('public/models/al0700/model.glb');
const sensorTemplatePromise = loadGlbScene('public/models/ai1500/model.glb');

function cmpAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizePairs(pairs: readonly CollisionPair[]): [CollisionBodyId, CollisionBodyId][] {
  return pairs
    .map(({ first, second }): [CollisionBodyId, CollisionBodyId] =>
      first < second ? [first, second] : [second, first],
    )
    .sort((a, b) => (a[0] === b[0] ? cmpAscii(a[1], b[1]) : cmpAscii(a[0], b[0])));
}

interface TestAssembly {
  root: Group;
  robot: URDFRobot;
  detector: CollisionDetector;
  gripper: GripperModel | null;
  gripperParts: Record<string, Object3D>;
  setRailMm(mm: number): void;
}

async function buildTestAssembly(
  robotId: RobotId,
  options: { rail?: boolean; sensor?: boolean; gripperId?: GripperId | null } = {},
): Promise<TestAssembly> {
  const spec = getRobotSpec(robotId);
  const root = new Group();
  const robot = loadRobot(robotId);
  const detector = new CollisionDetector();

  detector.registerArmManifest(readManifest(robotId), robot.links, spec.dof);

  let railCarriage: Object3D | null = null;
  let dragChain: RailDragChain | null = null;
  if (options.rail) {
    const railFrame = new Group();
    railFrame.position.copy(RAIL_ORIGIN_WORLD);
    railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);
    const railModel = (await railTemplatePromise).clone(true);
    railFrame.add(railModel);
    root.add(railFrame);

    const railFixed = railModel.getObjectByName('rail_fixed')!;
    railCarriage = railModel.getObjectByName('rail_carriage')!;
    const part35 = railFixed.getObjectByName('part_35') as Mesh;
    part35.geometry = part35.geometry.clone();
    dragChain = new RailDragChain(railFixed);
    dragChain.setPosition(0);

    const robotMount = new Group();
    robotMount.name = 'robot_mount';
    robotMount.position.copy(ROBOT_BASE_CAD);
    robotMount.quaternion.copy(ROBOT_MOUNT_CAD_ROTATION);
    railCarriage.add(robotMount);
    robotMount.add(robot);

    detector.registerRailManifest(readManifest(RAIL_SPEC.id), railFixed, railCarriage, 0);
  } else {
    robot.quaternion.copy(ROBOT_BASE_WORLD_ROTATION);
    root.add(robot);
  }

  const eeLink = robot.links[spec.eeLink];
  if (options.sensor) {
    const sensorMount = new Group();
    sensorMount.name = 'sensor_flange_mount';
    const sensorModel = (await sensorTemplatePromise).clone(true);
    sensorModel.position.copy(SENSOR_FLANGE_CAD).negate();
    sensorMount.add(sensorModel);
    eeLink.add(sensorMount);

    detector.registerSensorManifest(readManifest(SENSOR_SPEC.id), sensorMount);
  }

  let gripper: GripperModel | null = null;
  const gripperParts: Record<string, Object3D> = {};
  if (options.gripperId) {
    const gripperSpec = getGripper(options.gripperId)!;
    if (options.gripperId === 'gripper-g2') {
      const templates = await g2PartsPromise;
      for (const [k, v] of Object.entries(templates)) {
        gripperParts[k] = v.clone(true);
      }
    } else {
      for (const name of gripperPartNames(gripperSpec)) {
        const placeholder = new Group();
        placeholder.name = name;
        gripperParts[name] = placeholder;
      }
    }
    gripper = createGripperModel(gripperSpec, gripperParts);
    const mount = assemblyGripperMount(robotId, options.gripperId, Boolean(options.sensor));
    gripper.root.position.copy(mount.position);
    gripper.root.quaternion.copy(mount.quaternion);
    eeLink.add(gripper.root);

    detector.registerGripperManifest(readManifest(options.gripperId), gripperParts);
  }

  detector.setExclusionOptions({ armDof: spec.dof, hasSensor: Boolean(options.sensor) });
  root.updateMatrixWorld(true);

  return {
    root,
    robot,
    detector,
    gripper,
    gripperParts,
    setRailMm(mm: number) {
      if (railCarriage) railCarriage.position.z = -mm / 1000;
      dragChain?.setPosition(mm);
      detector.setRailPosition(mm);
      root.updateMatrixWorld(true);
    },
  };
}

function makeMatrix(pos: [number, number, number], eulerRad: [number, number, number] = [0, 0, 0]): Matrix4 {
  const m = new Matrix4();
  m.compose(
    new Vector3(...pos),
    new Quaternion().setFromEuler(new Euler(...eulerRad)),
    new Vector3(1, 1, 1),
  );
  return m;
}

describe('GJK + EPA narrow-phase & structural exclusion rules', () => {
  const unitCubeFlat = [
    -0.05, -0.05, -0.05,
    -0.05, -0.05, 0.05,
    -0.05, 0.05, -0.05,
    -0.05, 0.05, 0.05,
    0.05, -0.05, -0.05,
    0.05, -0.05, 0.05,
    0.05, 0.05, -0.05,
    0.05, 0.05, 0.05,
  ];

  function checkGjk(
    a: BoxShape | PolytopeShape,
    matA: Matrix4,
    b: BoxShape | PolytopeShape,
    matB: Matrix4,
  ): boolean {
    a.updateWorldTransform(matA);
    b.updateWorldTransform(matB);
    return intersectsGJK(a, b, DEFAULT_PENETRATION_TOLERANCE_M);
  }

  it('distinguishes separated, <0.2 mm grazing, shallow penetration, deep containment, and rotated shapes', () => {
    const boxA = new BoxShape([0, 0, 0], [0.05, 0.05, 0.05]);
    const boxB = new BoxShape([0, 0, 0], [0.05, 0.05, 0.05]);
    const polyA = new PolytopeShape(unitCubeFlat);
    const polyB = new PolytopeShape(unitCubeFlat);
    const id = makeMatrix([0, 0, 0]);

    // Clearly separated (gap = 5 mm)
    expect(checkGjk(boxA, id, boxB, makeMatrix([0.105, 0, 0]))).toBe(false);
    expect(checkGjk(polyA, id, polyB, makeMatrix([0.105, 0, 0]))).toBe(false);
    expect(checkGjk(boxA, id, polyB, makeMatrix([0.105, 0, 0]))).toBe(false);

    // Grazing overlap of 0.05 mm (< 0.2 mm tolerance) -> must be ignored (false)
    expect(checkGjk(boxA, id, boxB, makeMatrix([0.09995, 0, 0]))).toBe(false);
    expect(checkGjk(polyA, id, polyB, makeMatrix([0.09995, 0, 0]))).toBe(false);
    expect(checkGjk(boxA, id, polyB, makeMatrix([0.09995, 0, 0]))).toBe(false);

    // Shallow penetration of 0.5 mm (> 0.2 mm tolerance) -> true
    expect(checkGjk(boxA, id, boxB, makeMatrix([0.0995, 0, 0]))).toBe(true);
    expect(checkGjk(polyA, id, polyB, makeMatrix([0.0995, 0, 0]))).toBe(true);
    expect(checkGjk(boxA, id, polyB, makeMatrix([0.0995, 0, 0]))).toBe(true);

    // Deep full containment (small box completely inside larger polytope at arbitrary 3D rotation)
    const innerSmall = new BoxShape([0, 0, 0], [0.01, 0.01, 0.01]);
    expect(
      checkGjk(
        polyA,
        makeMatrix([0.01, -0.02, 0.03], [0.4, -0.7, 1.1]),
        innerSmall,
        makeMatrix([0.015, -0.018, 0.028], [-0.9, 0.3, 0.5]),
      ),
    ).toBe(true);

    // 45-degree rotated corner clearance vs penetration (touching X = 0.05 + 0.05 * sqrt(2) = 0.12071068 m)
    expect(checkGjk(boxA, id, polyB, makeMatrix([0.122, 0, 0], [0, 0, Math.PI / 4]))).toBe(false);
    expect(checkGjk(boxA, id, polyB, makeMatrix([0.1195, 0, 0], [0, 0, Math.PI / 4]))).toBe(true);
  });

  it('applies structural exclusion rules accurately across 5/6/7-DoF arms, F/T sensor, grippers, and rail', () => {
    expect(shouldExcludeCollisionPair('arm:link_base', 'arm:link1', { armDof: 6, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('arm:link2', 'arm:link3', { armDof: 6, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('arm:link2', 'arm:link4', { armDof: 6, hasSensor: false })).toBe(false);

    expect(shouldExcludeCollisionPair('arm:link5', 'gripper:base', { armDof: 5, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('arm:link5', 'gripper:base', { armDof: 5, hasSensor: true })).toBe(false);
    expect(shouldExcludeCollisionPair('arm:link5', 'sensor:ai1500', { armDof: 5, hasSensor: true })).toBe(true);
    expect(shouldExcludeCollisionPair('sensor:ai1500', 'gripper:base', { armDof: 5, hasSensor: true })).toBe(true);

    expect(shouldExcludeCollisionPair('arm:link6', 'gripper:base', { armDof: 6, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('arm:link7', 'gripper:base', { armDof: 7, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('arm:link6', 'gripper:left', { armDof: 6, hasSensor: false })).toBe(false);

    expect(shouldExcludeCollisionPair('rail:fixed', 'rail:carriage', { armDof: 6, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('rail:carriage', 'arm:link_base', { armDof: 6, hasSensor: false })).toBe(true);
    expect(shouldExcludeCollisionPair('rail:carriage', 'arm:link3', { armDof: 6, hasSensor: false })).toBe(false);
    expect(shouldExcludeCollisionPair('rail:drag_chain', 'arm:link4', { armDof: 6, hasSensor: false })).toBe(false);
    expect(shouldExcludeCollisionPair('rail:fixed', 'gripper:left', { armDof: 6, hasSensor: false })).toBe(false);
  });
});

describe('collision.json manifest integrity, budgets & SHA256SUMS', () => {
  it('validates schema, finite bounds, <=30 KB single / <=150 KB total budgets, and SHA-256 checksums across all 11 models', () => {
    let totalBytes = 0;

    for (const dir of ALL_MANIFEST_DIRS) {
      const manifestPath = `public/models/${dir}/collision.json`;
      const size = statSync(manifestPath).size;
      expect(size, `${dir}/collision.json size`).toBeLessThanOrEqual(30 * 1024);
      totalBytes += size;

      const raw = readFileSync(manifestPath);
      const actualHash = createHash('sha256').update(raw).digest('hex');
      const sumsLines = readFileSync(`public/models/${dir}/SHA256SUMS`, 'utf8')
        .trim()
        .split('\n')
        .map(line => line.trim().split(/\s+/));
      const match = sumsLines.find(
        ([, file]) => file === 'collision.json' || file === `public/models/${dir}/collision.json`,
      );
      expect(match, `${dir}/SHA256SUMS should list collision.json`).toBeDefined();
      expect(actualHash, `${dir}/collision.json sha256`).toBe(match![0]);

      const sourceDoc = readFileSync(`public/models/${dir}/SOURCE.md`, 'utf8');
      expect(sourceDoc).not.toContain('/home/');
      expect(sourceDoc).not.toContain('dev/asserts');

      const manifest = JSON.parse(raw.toString('utf8')) as CollisionAssetManifest;
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.assetId).toBe(dir);
      expect(manifest.hulls.length).toBeGreaterThan(0);

      for (const hull of manifest.hulls) {
        expect(hull.bodyKey.length).toBeGreaterThan(0);
        if (hull.kind === 'polytope') {
          expect(hull.vertices).toBeDefined();
          expect(hull.vertices!.length).toBeGreaterThanOrEqual(12);
          expect(hull.vertices!.length % 3).toBe(0);
          for (const c of hull.vertices!) {
            expect(Number.isFinite(c)).toBe(true);
            expect(Math.abs(c)).toBeLessThan(2.0);
          }
        } else {
          expect(hull.kind).toBe('box');
          expect(hull.center).toHaveLength(3);
          expect(hull.halfExtents).toHaveLength(3);
          for (const h of hull.halfExtents!) {
            expect(Number.isFinite(h) && h > 0 && h < 1.0).toBe(true);
          }
        }
      }
    }

    expect(totalBytes).toBeLessThanOrEqual(150 * 1024);
  });
});

describe('zero-pose (HOME) zero-false-positive invariant across all assemblies', () => {
  it('reports zero collisions at HOME across all 5 arms × compatible rail × sensor × gripper × openings × rail travel + wrist spin', async () => {
    for (const robotSpec of ROBOTS) {
      const railOptions = supportsLinearRail(robotSpec.id) ? [false, true] : [false];
      const sensorOptions = supportsSensor(robotSpec.id) ? [false, true] : [false];
      const gripperOptions: (GripperId | null)[] = [
        null,
        ...GRIPPERS.filter(g => supportsGripper(robotSpec.id, g.id)).map(g => g.id),
      ];

      for (const rail of railOptions) {
        for (const sensor of sensorOptions) {
          for (const gripperId of gripperOptions) {
            const assembly = await buildTestAssembly(robotSpec.id, { rail, sensor, gripperId });
            const railPositions = rail ? [0, 350, 700] : [0];
            const gSpec = gripperId ? getGripper(gripperId)! : null;
            const openings = gSpec?.opening ? [gSpec.opening.min, gSpec.opening.max] : [null];

            for (const railMm of railPositions) {
              assembly.setRailMm(railMm);
              for (const opening of openings) {
                if (opening !== null && assembly.gripper) {
                  expect(assembly.gripper.setOpening(opening)).toBe(true);
                }
                setJoints(assembly.robot, homeJoints(robotSpec.dof));
                assembly.root.updateMatrixWorld(true);
                expect(
                  assembly.detector.detect(),
                  `${robotSpec.id} rail=${rail}@${railMm} sensor=${sensor} gripper=${gripperId}@${opening}`,
                ).toEqual([]);
              }
            }

            // Full 360-degree wrist rotation sweep on final joint in unfolded L-pose
            const elbowIdx = robotSpec.id === 'xarm7' ? 3 : 2;
            const unfoldedElbow =
              robotSpec.id === 'xarm7' || robotSpec.id === 'lite6' ? Math.PI / 2 : -Math.PI / 2;
            for (const jLast of [-Math.PI, -Math.PI / 2, Math.PI / 2, Math.PI]) {
              const q = homeJoints(robotSpec.dof);
              q[elbowIdx] = unfoldedElbow;
              q[robotSpec.dof - 1] = jLast;
              setJoints(assembly.robot, q);
              assembly.root.updateMatrixWorld(true);
              expect(
                assembly.detector.detect(),
                `${robotSpec.id} wrist=${jLast} rail=${rail} sensor=${sensor} gripper=${gripperId}`,
              ).toEqual([]);
            }
          }
        }
      }
    }

    // Conversely, at folded zero-elbow pose on xArm 5 + AL0700 + AI1500 + BIO Gripper G2,
    // flipping joint5 by 180 deg with a slight wrist pitch swings the asymmetric BIO fingers into rail:carriage.
    const overhangAssembly = await buildTestAssembly('xarm5', {
      rail: true,
      sensor: true,
      gripperId: 'bio-gripper-g2',
    });
    setJoints(overhangAssembly.robot, [0, 0, 0, -0.05, -Math.PI]);
    overhangAssembly.root.updateMatrixWorld(true);
    expect(normalizePairs(overhangAssembly.detector.detect())).toContainEqual(['gripper:right', 'rail:carriage']);
  });
});

describe('MuJoCo ground-truth cross-validation & Gripper G2 visual alignment', () => {
  interface MujocoSample {
    label: string;
    joints: number[];
    collides: boolean;
    minDistMm: number;
    pairs: [CollisionBodyId, CollisionBodyId][];
  }
  interface MujocoComboSample extends MujocoSample {
    robotId: RobotId;
    gripperId: GripperId;
    opening: number;
  }
  const fixtures = JSON.parse(readFileSync('tests/mujoco-collision-fixtures.json', 'utf8')) as {
    mujocoVersion: string;
    arms: Record<RobotId, MujocoSample[]>;
    combinations: MujocoComboSample[];
  };

  it('matches 100% of MuJoCo 3.15.0 bare-arm collision classifications and colliding body pairs across all 5 arms', async () => {
    let checked = 0;
    for (const robotSpec of ROBOTS) {
      const samples = fixtures.arms[robotSpec.id];
      expect(samples.length).toBeGreaterThanOrEqual(8);
      const assembly = await buildTestAssembly(robotSpec.id);

      for (const sample of samples) {
        setJoints(assembly.robot, sample.joints);
        assembly.root.updateMatrixWorld(true);
        const pairs = normalizePairs(assembly.detector.detect());
        expect(pairs.length > 0, `${robotSpec.id}:${sample.label} collided (minDist=${sample.minDistMm}mm)`).toBe(
          sample.collides,
        );
        expect(pairs, `${robotSpec.id}:${sample.label} pairs`).toEqual(sample.pairs);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(45);
  });

  it('matches 100% of MuJoCo 3.15.0 arm + gripper combination collision classifications and colliding pairs', async () => {
    expect(fixtures.combinations.length).toBeGreaterThanOrEqual(18);
    for (const sample of fixtures.combinations) {
      const assembly = await buildTestAssembly(sample.robotId, { gripperId: sample.gripperId });
      if (assembly.gripper && getGripper(sample.gripperId)?.opening) {
        expect(assembly.gripper.setOpening(sample.opening)).toBe(true);
      }
      setJoints(assembly.robot, sample.joints);
      assembly.root.updateMatrixWorld(true);
      const pairs = normalizePairs(assembly.detector.detect());
      expect(
        pairs.length > 0,
        `${sample.robotId}+${sample.gripperId}:${sample.label} collided (minDist=${sample.minDistMm}mm)`,
      ).toBe(sample.collides);
      expect(pairs, `${sample.robotId}+${sample.gripperId}:${sample.label} pairs`).toEqual(sample.pairs);
    }
  });

  it('aligns Gripper G2 convex hull world bounds with visual GLB meshes within <0.5 mm across 0 / 42 / 84 mm openings', async () => {
    const assembly = await buildTestAssembly('xarm6', { gripperId: 'gripper-g2' });
    const manifest = readManifest('gripper-g2');

    for (const opening of [0, 42, 84]) {
      expect(assembly.gripper!.setOpening(opening)).toBe(true);
      assembly.root.updateMatrixWorld(true);

      const visualBox = new Box3();
      const hullBox = new Box3();
      const tmp = new Vector3();

      assembly.gripper!.root.traverse(node => {
        if (node instanceof Mesh) {
          const pos = node.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld);
            visualBox.expandByPoint(tmp);
          }
        }
      });

      for (const hull of manifest.hulls) {
        const partName = hull.partKey ?? hull.bodyKey;
        const partObj = assembly.gripperParts[partName];
        expect(partObj).toBeDefined();
        if (hull.kind === 'polytope' && hull.vertices) {
          for (let i = 0; i < hull.vertices.length; i += 3) {
            tmp.set(hull.vertices[i], hull.vertices[i + 1], hull.vertices[i + 2]).applyMatrix4(partObj.matrixWorld);
            hullBox.expandByPoint(tmp);
          }
        }
      }

      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(hullBox.min[axis] - visualBox.min[axis]), `opening=${opening} min.${axis}`).toBeLessThan(
          0.0005,
        );
        expect(Math.abs(hullBox.max[axis] - visualBox.max[axis]), `opening=${opening} max.${axis}`).toBeLessThan(
          0.0005,
        );
      }
    }
  });
});

describe('AL0700 DragChainCollider deformation & rail assembly collisions', () => {
  it('tracks the deformed part_35 drag chain mesh envelope across 0 / 350 / 700 mm and detects intrusions into all 3 segments', async () => {
    const railFrame = new Group();
    railFrame.position.copy(RAIL_ORIGIN_WORLD);
    railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);
    const railModel = (await railTemplatePromise).clone(true);
    railFrame.add(railModel);
    const railFixed = railModel.getObjectByName('rail_fixed')!;
    const railCarriage = railModel.getObjectByName('rail_carriage')!;
    const part35 = railFixed.getObjectByName('part_35') as Mesh;
    part35.geometry = part35.geometry.clone();
    const dragChain = new RailDragChain(railFixed);

    const detector = new CollisionDetector();
    const collider = detector.registerRailManifest(readManifest(RAIL_SPEC.id), railFixed, railCarriage, 0);
    const probeObj = new Group();
    detector.registerBodyShape('arm:link4', probeObj, new BoxShape([0, 0, 0], [0.008, 0.008, 0.008]));
    detector.rebuildPairs();

    for (const railMm of [0, 350, 700]) {
      dragChain.setPosition(railMm);
      detector.setRailPosition(railMm);
      railFrame.updateMatrixWorld(true);

      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const shape of collider.shapes) {
        shape.updateWorldTransform(railFixed.matrixWorld);
        minX = Math.min(minX, shape.minX);
        minY = Math.min(minY, shape.minY);
        minZ = Math.min(minZ, shape.minZ);
        maxX = Math.max(maxX, shape.maxX);
        maxY = Math.max(maxY, shape.maxY);
        maxZ = Math.max(maxZ, shape.maxZ);
      }

      const meshBox = new Box3().setFromObject(part35);
      expect(Math.abs(minX - meshBox.min.x)).toBeLessThan(0.0015);
      expect(Math.abs(maxX - meshBox.max.x)).toBeLessThan(0.0015);
      expect(Math.abs(minY - meshBox.min.y)).toBeLessThan(0.0015);
      expect(Math.abs(maxY - meshBox.max.y)).toBeLessThan(0.0015);
      expect(Math.abs(minZ - meshBox.min.z)).toBeLessThan(0.0015);
      expect(Math.abs(maxZ - meshBox.max.z)).toBeLessThan(0.0015);

      const midY = 0.5 * (meshBox.min.y + meshBox.max.y);
      const midUpperX = collider.upperStraight.worldCenter.x;
      const midLowerX = collider.lowerStraight.worldCenter.x;

      // 1. Intrude into upper straight run
      probeObj.position.set(midUpperX, midY, meshBox.max.z - 0.008);
      probeObj.updateMatrixWorld(true);
      expect(normalizePairs(detector.detect()), `upper run @ ${railMm}`).toContainEqual([
        'arm:link4',
        'rail:drag_chain',
      ]);

      // 2. Intrude into lower straight run
      probeObj.position.set(midLowerX, midY, meshBox.min.z + 0.008);
      probeObj.updateMatrixWorld(true);
      expect(normalizePairs(detector.detect()), `lower run @ ${railMm}`).toContainEqual([
        'arm:link4',
        'rail:drag_chain',
      ]);

      // 3. Intrude into U-bend apex
      probeObj.position.set(meshBox.min.x + 0.012, midY, 0.5 * (meshBox.min.z + meshBox.max.z));
      probeObj.updateMatrixWorld(true);
      expect(normalizePairs(detector.detect()), `U-bend @ ${railMm}`).toContainEqual([
        'arm:link4',
        'rail:drag_chain',
      ]);

      // 4. Outside drag chain envelope (+25 mm above upper run) -> safe
      probeObj.position.set(midUpperX, midY, meshBox.max.z + 0.025);
      probeObj.updateMatrixWorld(true);
      expect(detector.detect(), `safe clearance @ ${railMm}`).toEqual([]);
    }
  });

  it('detects arm/gripper vs rail:fixed and rail:drag_chain collisions on xArm 6 + AL0700 + Gripper G2', async () => {
    const assembly = await buildTestAssembly('xarm6', { rail: true, gripperId: 'gripper-g2' });
    const spec = getRobotSpec('xarm6');
    const offset = assemblyToolOffset('xarm6', { gripperId: 'gripper-g2' });
    const solver = new IKSolver(assembly.robot, spec.eeLink);
    solver.setToolOffset(offset);

    // 1. Place Gripper G2 TCP directly inside the linear rail beam at world (X = 0.65 m, Y = 0, Z = 0.055 m)
    assembly.setRailMm(350);
    setJoints(assembly.robot, [Math.PI / 2, 0.2, -1.1, 0, 0.9, 0]);
    assembly.root.updateMatrixWorld(true);
    const homeTcp = forward(assembly.robot, spec.eeLink, offset);
    const railBaseTarget = assembly.robot.worldToLocal(new Vector3(0.65, 0, 0.055));
    expect(solver.solve({ position: railBaseTarget, quaternion: homeTcp.quaternion }).ok).toBe(true);
    assembly.root.updateMatrixWorld(true);
    const railHits = assembly.detector.detect();
    expect(
      railHits.some(p => p.first === 'rail:fixed' || p.second === 'rail:fixed'),
      `expected rail:fixed hit, got ${JSON.stringify(railHits)}`,
    ).toBe(true);

    // 2. Close Gripper G2 (so its fingers do not straddle the 40 mm-wide chain) and place TCP inside upper rail:drag_chain (world X in [0.372, 0.614] at railMm = 350)
    expect(assembly.gripper!.setOpening(0)).toBe(true);
    const part35 = assembly.root.getObjectByName('part_35')!;
    const chainBox = new Box3().setFromObject(part35);
    const chainWorldPoint = new Vector3(
      0.52,
      0.5 * (chainBox.min.y + chainBox.max.y),
      chainBox.max.z - 0.015,
    );
    setJoints(assembly.robot, [Math.PI / 2, 0.2, -1.1, 0, 0.9, 0]);
    assembly.root.updateMatrixWorld(true);
    const backTcp = forward(assembly.robot, spec.eeLink, offset);
    const chainBaseTarget = assembly.robot.worldToLocal(chainWorldPoint);
    expect(solver.solve({ position: chainBaseTarget, quaternion: backTcp.quaternion }).ok).toBe(true);
    assembly.root.updateMatrixWorld(true);
    const chainHits = assembly.detector.detect();
    expect(
      chainHits.some(p => p.first === 'rail:drag_chain' || p.second === 'rail:drag_chain'),
      `expected rail:drag_chain hit, got ${JSON.stringify(chainHits)}`,
    ).toBe(true);
  });
});

describe('CollisionHighlighter subtree isolation & material lifecycle', () => {
  it('isolates child URDFJoints, robot_mount, part_35, and sensor_flange_mount without mutating shared materials, and restores original references', () => {
    const sharedMat = new MeshStandardMaterial({ color: 0xdddddd });
    const railMat = new MeshStandardMaterial({ color: 0x444444 });
    const chainMat = new MeshStandardMaterial({ color: 0x111111 });

    // Mock URDFRobot with link_base -> link1 -> link2 -> URDFJoint -> link3 sharing sharedMat
    const link2 = new Group();
    const link2Mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), sharedMat);
    link2.add(link2Mesh);

    const joint3 = new Group() as Group & { isURDFJoint?: boolean };
    joint3.isURDFJoint = true;
    const link3 = new Group();
    const link3Mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), sharedMat);
    link3.add(link3Mesh);
    joint3.add(link3);
    link2.add(joint3);

    const mockRobot = {
      links: { link2, link3 },
    } as unknown as URDFRobot;

    // Mock rail_fixed containing railFixedMesh + part_35 (drag chain), and rail_carriage containing carriageMesh + robot_mount
    const railFixed = new Group();
    const railFixedMesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), railMat);
    const part35 = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), chainMat);
    part35.name = 'part_35';
    railFixed.add(railFixedMesh, part35);

    const railCarriage = new Group();
    const carriageMesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), railMat);
    const robotMount = new Group();
    robotMount.name = 'robot_mount';
    robotMount.add(link2);
    railCarriage.add(carriageMesh, robotMount);

    // Mock sensorMount containing sensorMesh + nested gripper-g2 stop boundary
    const sensorMount = new Group();
    sensorMount.name = 'sensor_flange_mount';
    const sensorMesh = new Mesh(new BoxGeometry(0.05, 0.05, 0.05), sharedMat);
    const gripperBase = new Group();
    gripperBase.name = 'gripper-g2';
    const gripperMesh = new Mesh(new BoxGeometry(0.05, 0.05, 0.05), sharedMat);
    gripperBase.add(gripperMesh);
    sensorMount.add(sensorMesh, gripperBase);

    const highlighter = new CollisionHighlighter();
    highlighter.registerArm(mockRobot, 3);
    highlighter.registerRail(railFixed, railCarriage, robotMount);
    highlighter.registerSensor(sensorMount);
    highlighter.registerGripper(getGripper('gripper-g2')!, { base: gripperBase });

    // 1. Highlight arm:link2 + rail:carriage + rail:fixed + sensor:ai1500
    highlighter.setHighlighted(['arm:link2', 'rail:carriage', 'rail:fixed', 'sensor:ai1500']);

    expect(sharedMat.color.getHex()).toBe(0xdddddd);
    expect(railMat.color.getHex()).toBe(0x444444);
    expect((link2Mesh.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);
    expect((carriageMesh.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);
    expect((railFixedMesh.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);
    expect((sensorMesh.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);

    // Non-colliding boundaries remained completely untouched!
    expect(link3Mesh.material).toBe(sharedMat);
    expect(part35.material).toBe(chainMat);
    expect(gripperMesh.material).toBe(sharedMat);

    // 2. Switch highlight exclusively to rail:drag_chain
    highlighter.setHighlighted(['rail:drag_chain']);
    expect(link2Mesh.material).toBe(sharedMat);
    expect(carriageMesh.material).toBe(railMat);
    expect(railFixedMesh.material).toBe(railMat);
    expect(sensorMesh.material).toBe(sharedMat);
    expect((part35.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);

    // 3. clearAccessories restores accessory materials while preserving arm registration
    highlighter.setHighlighted(['arm:link3', 'rail:drag_chain']);
    expect((link3Mesh.material as MeshStandardMaterial).color.getHex()).toBe(0xdc2626);
    highlighter.clearAccessories();
    expect(part35.material).toBe(chainMat);
    expect(highlighter.getHighlightedBodies()).toEqual(['arm:link3']);

    // 4. dispose() restores exact original material references on remaining meshes
    highlighter.dispose();
    expect(link2Mesh.material).toBe(sharedMat);
    expect(link3Mesh.material).toBe(sharedMat);
    expect(highlighter.getHighlightedBodies()).toEqual([]);
  });

  it('formats the terminal arm link as End flange / 末端法兰 across 5/6/7-DoF arms', () => {
    expect(formatCollisionBodyName('arm:link5', 'zh', null, 5)).toBe('末端法兰');
    expect(formatCollisionBodyName('arm:link5', 'en', null, 5)).toBe('End flange');
    expect(formatCollisionBodyName('arm:link5', 'zh', null, 6)).toBe('连杆5');
    expect(formatCollisionBodyName('arm:link6', 'zh', null, 6)).toBe('末端法兰');
    expect(formatCollisionBodyName('arm:link6', 'en', null, 6)).toBe('End flange');
    expect(formatCollisionBodyName('arm:link6', 'en', null, 7)).toBe('Link 6');
    expect(formatCollisionBodyName('arm:link7', 'zh', null, 7)).toBe('末端法兰');
    expect(formatCollisionBodyName('arm:link7', 'en', null, 7)).toBe('End flange');
  });
});
