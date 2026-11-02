import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import type { RobotSpec } from './robots';
import type { GripperId, GripperSpec } from './grippers';
import { reachRadius } from './reach';
import {
  assemblyGripperMount,
  RAIL_CAD_TO_WORLD,
  RAIL_ORIGIN_WORLD,
  RAIL_SPEC,
  ROBOT_BASE_CAD,
  ROBOT_MOUNT_CAD_ROTATION,
  SENSOR_FLANGE_CAD,
  SENSOR_SPEC,
  validRailPosition,
} from './accessories';
import { createGripperModel, gripperPartNames, type GripperModel } from './gripper-model';
import type { Pose } from './kinematics';
import { RailDragChain } from './rail-drag-chain';
import {
  CollisionDetector,
  type CollisionAssetManifest,
  type CollisionBodyId,
  type CollisionPair,
} from './collision';
import { CollisionHighlighter } from './collision-highlight';
import { checkAbort, ModelCache, type ModelLease } from './model-cache';
import modelAssets from 'virtual:model-assets';

export interface AssemblyAccessoriesConfig {
  rail: boolean;
  railMm: number;
  sensor: boolean;
  gripper?: GripperSpec;
  opening: number;
}

interface PreparedAccessoryData {
  leases: ModelLease[];
  railIndex: number;
  sensorIndex: number;
  gripperStartIndex: number;
  gripperNames: string[];
  manifests: (CollisionAssetManifest | undefined)[];
}

export interface PreparedAccessories {
  take(): Promise<PreparedAccessoryData>;
  discard(): void;
}

function releaseAssets(leases: readonly ModelLease[]): void {
  for (const lease of leases) lease.release();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function adjustLite6Materials(robot: URDFRobot, ownedMaterials: Set<THREE.Material>): void {
  // Part names are local to each link's visual GLB. Link 6 contains the metal flange.
  const parts: Record<string, { white: readonly string[]; cover?: string }> = {
    link_base: { white: ['part_0'], cover: 'part_1' },
    link1: { white: ['part_0', 'part_1'], cover: 'part_2' },
    link2: { white: ['part_0'], cover: 'part_1' },
    link3: { white: ['part_0', 'part_1'] },
    link4: { white: ['part_0', 'part_1'], cover: 'part_2' },
    link5: { white: ['part_0', 'part_1'] },
  };

  for (const [linkName, { white, cover }] of Object.entries(parts)) {
    const link = robot.links[linkName];
    if (!link) continue;
    for (const visual of link.children) {
      if (!(visual as THREE.Object3D & { isURDFVisual?: boolean }).isURDFVisual) continue;
      visual.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const isWhite = white.includes(object.name);
        const isCover = object.name === cover;
        if (!isWhite && !isCover) return;
        const copies = (Array.isArray(object.material) ? object.material : [object.material]).map(material => {
          const copy = material.clone();
          ownedMaterials.add(copy);
          return copy;
        });
        object.material = Array.isArray(object.material) ? copies : copies[0];
        for (const material of copies) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          if (isWhite) {
            material.roughness = 0.3;
            material.metalness = 0;
          } else {
            material.color.setRGB(0.55, 0.55, 0.55);
          }
        }
      });
    }
  }
}

function createCoordinateFrame(axisLength: number, shaftRadius: number): THREE.Group {
  const frame = new THREE.Group();
  const headLength = axisLength * 0.22;
  const headRadius = shaftRadius * 2.4;
  const shaftLength = axisLength - headLength;
  const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16);
  const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 20);

  const axes: { color: number; rotation: [number, number, number] }[] = [
    { color: 0xe53935, rotation: [0, 0, -Math.PI / 2] }, // +X Red
    { color: 0x2ea043, rotation: [0, 0, 0] },            // +Y Green
    { color: 0x2574e8, rotation: [Math.PI / 2, 0, 0] },  // +Z Blue
  ];

  for (const { color, rotation } of axes) {
    const material = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    });
    const axis = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.position.y = shaftLength / 2;
    shaft.renderOrder = 999;
    const head = new THREE.Mesh(headGeometry, material);
    head.position.y = shaftLength + headLength / 2;
    head.renderOrder = 999;
    axis.add(shaft, head);
    axis.rotation.set(...rotation);
    frame.add(axis);
  }

  const origin = new THREE.Mesh(
    new THREE.SphereGeometry(shaftRadius * 1.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x25332e, depthTest: false, toneMapped: false }),
  );
  origin.renderOrder = 1000;
  frame.add(origin);
  return frame;
}

export class RobotScene {
  robot?: URDFRobot;
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private draco: DRACOLoader;
  private modelCache: ModelCache;
  private armAssets: ModelLease[] = [];
  private armTemplates = new Map<string, URDFRobot>();
  private accessoryAssets: ModelLease[] = [];
  private ownedArmMaterials = new Set<THREE.Material>();
  private railDragGeometry?: THREE.BufferGeometry;
  private resizeObserver: ResizeObserver;
  private reachRing?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private robotMount = new THREE.Group();
  private baseFrame?: THREE.Group;
  private tcpFrame?: THREE.Group;
  private baseFrameVisible = false;
  private tcpFrameVisible = false;
  private initialCamera = new THREE.Vector3(0.93, -1.2, 0.95);
  private initialTarget = new THREE.Vector3(0, 0, 0.38);
  private loadToken = 0;
  private accessoryToken = 0;
  private gripper?: GripperModel;
  private sensorMount?: THREE.Group;
  private railRoot?: THREE.Group;
  private railCarriage?: THREE.Object3D;
  private railDragChain?: RailDragChain;
  private railMounted = false;
  private renderPending = false;
  private disposed = false;
  private collisionDetector = new CollisionDetector();
  private collisionHighlighter = new CollisionHighlighter();
  private collisionManifestCache = new Map<string, CollisionAssetManifest>();

  constructor(private container: HTMLElement) {
    this.robotMount.name = 'robot_mount';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive xArm 6 3D model');
    container.appendChild(this.renderer.domElement);

    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(new URL(`${import.meta.env.BASE_URL}draco/`, document.baseURI).href);
    this.modelCache = new ModelCache(this.draco);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.initialCamera);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.copy(this.initialTarget);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.4;
    this.orbit.minDistance = 0.25;
    this.orbit.maxDistance = 6;
    this.orbit.maxPolarAngle = Math.PI - 0.01;
    this.orbit.addEventListener('change', () => this.requestRender());
    this.orbit.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777f82, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(2, -3, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
    key.shadow.camera.right = key.shadow.camera.top = 2.2;
    key.shadow.bias = -0.0001;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8e8ff, 1.5);
    fill.position.set(-3, 1, 3);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: 0x263332, opacity: 0.16, depthWrite: false }),
    );
    floor.position.z = -0.012;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.requestRender();
  }

  /** Render changes and orbit damping, but leave an idle scene idle. */
  requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      if (this.disposed) return;
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private async fetchCollisionManifest(modelId: string, signal?: AbortSignal): Promise<CollisionAssetManifest> {
    checkAbort(signal);
    const cached = this.collisionManifestCache.get(modelId);
    if (cached) return cached;
    const url = new URL(`${import.meta.env.BASE_URL}models/${modelId}/collision.json`, document.baseURI).href;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Collision manifest HTTP ${response.status} for ${modelId}`);
    const manifest = (await response.json()) as CollisionAssetManifest;
    checkAbort(signal);
    this.collisionManifestCache.set(modelId, manifest);
    return manifest;
  }

  private clearCurrentRobot(): void {
    this.collisionHighlighter.dispose();
    this.collisionDetector.clearAll();
    if (!this.robot) return;
    this.robot.removeFromParent();
    this.robotMount.removeFromParent();
    if (this.baseFrame) disposeObject(this.baseFrame);
    if (this.tcpFrame) disposeObject(this.tcpFrame);
    if (this.reachRing) disposeObject(this.reachRing);
    for (const material of this.ownedArmMaterials) material.dispose();
    this.ownedArmMaterials.clear();
    releaseAssets(this.armAssets);
    this.armAssets = [];
    this.robot = undefined;
    this.reachRing = undefined;
    this.baseFrame = undefined;
    this.tcpFrame = undefined;
  }

  private clearCurrentAccessories(): void {
    this.collisionHighlighter.clearAccessories();
    this.collisionDetector.clearAccessories();

    // Detach robotMount from railCarriage before disposing railRoot so the arm is never disposed.
    this.robotMount.position.set(0, 0, 0);
    this.robotMount.quaternion.identity();
    if (this.robot) {
      this.scene.add(this.robotMount);
    } else {
      this.robotMount.removeFromParent();
    }

    if (this.gripper) {
      this.gripper.root.removeFromParent();
      this.gripper = undefined;
    }
    if (this.sensorMount) {
      this.sensorMount.removeFromParent();
      this.sensorMount = undefined;
    }
    if (this.railRoot) {
      this.railRoot.removeFromParent();
      this.railRoot = undefined;
      this.railCarriage = undefined;
    }
    this.railDragChain = undefined;
    this.railDragGeometry?.dispose();
    this.railDragGeometry = undefined;
    releaseAssets(this.accessoryAssets);
    this.accessoryAssets = [];
  }

  clear(): void {
    this.hideReachRing();
    ++this.loadToken;
    ++this.accessoryToken;
    this.railMounted = false;
    this.clearCurrentAccessories();
    this.clearCurrentRobot();
  }

  destroy(): void {
    this.disposed = true;
    this.clear();
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.modelCache.dispose();
    this.armTemplates.clear();
    this.draco.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  async load(spec: RobotSpec, signal?: AbortSignal): Promise<URDFRobot | null> {
    this.hideReachRing();
    const token = ++this.loadToken;
    ++this.accessoryToken;
    this.railMounted = false;
    this.clearCurrentAccessories();
    this.clearCurrentRobot();

    const baseUrl = new URL(`${import.meta.env.BASE_URL}${spec.modelDir}`, document.baseURI);
    const expected = modelAssets.visuals[spec.id];
    if (!expected || expected.length !== spec.visualMeshCount) throw new Error(`Missing visual mesh manifest for ${spec.id}`);
    const urls = expected.map(path => new URL(path, baseUrl).href);
    const template = this.armTemplates.get(spec.id);
    // Start all visual requests alongside the URDF and collision manifest.
    const visualResults = Promise.allSettled(urls.map(url => this.modelCache.acquire(url, signal)));
    const metadata = Promise.allSettled([
      template ? Promise.resolve(null) : fetch(new URL(spec.urdfFile, baseUrl), { signal }).then(async response => {
        if (!response.ok) throw new Error(`URDF HTTP ${response.status}`);
        return response.text();
      }),
      this.fetchCollisionManifest(spec.id, signal),
    ] as const);
    const [results, meta] = await Promise.all([visualResults, metadata]);
    const leases = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const failure = results.find(result => result.status === 'rejected') ?? meta.find(result => result.status === 'rejected');
    if (token !== this.loadToken || signal?.aborted || failure) {
      releaseAssets(leases);
      if (token !== this.loadToken || signal?.aborted) return null;
      throw (failure as PromiseRejectedResult).reason;
    }

    try {
      const xml = (meta[0] as PromiseFulfilledResult<string | null>).value;
      const armManifest = (meta[1] as PromiseFulfilledResult<CollisionAssetManifest>).value;
      const instances = new Map(urls.map((url, index) => [url, leases[index].object]));
      let meshCount = 0;
      let nextRobot: URDFRobot;
      if (template) {
        nextRobot = template.clone(true);
        nextRobot.traverse(object => {
          const visual = object as THREE.Object3D & { isURDFVisual?: boolean; urdfNode?: Element };
          if (!visual.isURDFVisual) return;
          const path = visual.urdfNode?.querySelector('geometry > mesh')?.getAttribute('filename');
          const instance = path ? instances.get(new URL(path, baseUrl).href) : undefined;
          if (!instance) throw new Error(`Unexpected visual mesh: ${path}`);
          instance.position.set(0, 0, 0);
          instance.quaternion.identity();
          enableShadows(instance);
          visual.add(instance);
          meshCount++;
        });
      } else {
        if (xml === null) throw new Error(`Missing URDF for ${spec.id}`);
        const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
        const actual = [...documentXml.querySelectorAll('visual geometry mesh')].map(mesh => mesh.getAttribute('filename'));
        if (documentXml.querySelector('parsererror') || actual.length !== expected.length ||
            actual.some((path, index) => path !== expected[index])) {
          throw new Error(`Visual mesh manifest does not match URDF for ${spec.id}`);
        }
        const loader = new URDFLoader();
        loader.workingPath = baseUrl.href;
        loader.loadMeshCb = (url, _manager, _material, done) => {
          const object = instances.get(url);
          if (!object) throw new Error(`Unexpected visual mesh: ${url}`);
          meshCount++;
          enableShadows(object);
          done(object);
        };
        nextRobot = loader.parse(documentXml);
      }
      if (meshCount !== expected.length) throw new Error(`Expected ${expected.length} visual meshes, found ${meshCount}`);
      const endLink = nextRobot.links[spec.eeLink];
      if (!endLink) throw new Error(`URDF is missing ${spec.eeLink}`);
      if (!template) {
        // Keep the arm hierarchy without mesh references; decoded meshes remain under the LRU budget.
        const structure = nextRobot.clone(true);
        structure.traverse(object => {
          if ((object as THREE.Object3D & { isURDFVisual?: boolean }).isURDFVisual) object.clear();
        });
        this.armTemplates.set(spec.id, structure);
      }
      if (spec.id === 'lite6') adjustLite6Materials(nextRobot, this.ownedArmMaterials);

      this.robot = nextRobot;
      this.armAssets = leases;
      this.renderer.domElement.setAttribute('aria-label', `Interactive ${spec.name} 3D model`);
      this.baseFrame = createCoordinateFrame(0.14, 0.0026);
      this.baseFrame.name = 'base_coordinate_frame';
      this.baseFrame.visible = this.baseFrameVisible;
      this.robot.links.link_base.add(this.baseFrame);
      this.tcpFrame = createCoordinateFrame(0.1, 0.0022);
      this.tcpFrame.name = 'tcp_coordinate_frame';
      this.tcpFrame.visible = this.tcpFrameVisible;
      endLink.add(this.tcpFrame);
      this.initialCamera.set(...spec.cameraPosition);
      this.initialTarget.set(...spec.cameraTarget);
      this.resetView();
      this.robotMount.position.set(0, 0, 0);
      this.robotMount.quaternion.identity();
      this.robotMount.add(this.robot);
      this.scene.add(this.robotMount);
      this.robot.updateWorldMatrix(true, true);
      this.collisionDetector.registerArmManifest(armManifest, this.robot.links, spec.dof);
      this.collisionHighlighter.registerArm(this.robot, spec.dof);
      this.requestRender();
      return this.robot;
    } catch (error) {
      if (this.robot) this.clearCurrentRobot();
      else {
        for (const material of this.ownedArmMaterials) material.dispose();
        this.ownedArmMaterials.clear();
        releaseAssets(leases);
      }
      throw error;
    }
  }

  /** Begin independent accessory work while the selected arm is loading. */
  prepareAccessories(config: AssemblyAccessoriesConfig, signal?: AbortSignal): PreparedAccessories {
    const modelUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}models/${path}`, document.baseURI).href;
    const tasks: Promise<ModelLease>[] = [];
    const railIndex = config.rail ? tasks.push(this.modelCache.acquire(modelUrl(`${RAIL_SPEC.id}/model.glb`), signal)) - 1 : -1;
    const sensorIndex = config.sensor ? tasks.push(this.modelCache.acquire(modelUrl(`${SENSOR_SPEC.id}/model.glb`), signal)) - 1 : -1;
    const gripperStartIndex = tasks.length;
    const gripperNames = config.gripper ? gripperPartNames(config.gripper) : [];
    for (const name of gripperNames) {
      const extension = config.gripper!.id === 'lite6-gripper' && (name === 'finger1' || name === 'finger2') ? 'stl' : 'glb';
      tasks.push(this.modelCache.acquire(modelUrl(`${config.gripper!.id}/${name}.${extension}`), signal));
    }
    const manifests = [
      config.rail ? this.fetchCollisionManifest(RAIL_SPEC.id, signal) : Promise.resolve(undefined),
      config.sensor ? this.fetchCollisionManifest(SENSOR_SPEC.id, signal) : Promise.resolve(undefined),
      config.gripper ? this.fetchCollisionManifest(config.gripper.id, signal) : Promise.resolve(undefined),
    ];
    const result = Promise.all([Promise.allSettled(tasks), Promise.allSettled(manifests)]).then(([models, metadata]) => {
      const leases = models.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
      const failure = models.find(item => item.status === 'rejected') ?? metadata.find(item => item.status === 'rejected');
      if (failure) {
        releaseAssets(leases);
        throw (failure as PromiseRejectedResult).reason;
      }
      return { leases, railIndex, sensorIndex, gripperStartIndex, gripperNames,
        manifests: metadata.map(item => (item as PromiseFulfilledResult<CollisionAssetManifest | undefined>).value) };
    });
    // A failed preparation may finish before the arm; keep its rejection handled until take().
    void result.catch(() => {});
    let consumed = false;
    let discarded = false;
    return {
      take: async () => {
        const data = await result;
        if (discarded || consumed) throw new Error('Accessory preparation is no longer available');
        consumed = true;
        return data;
      },
      discard: () => {
        if (discarded || consumed) return;
        discarded = true;
        void result.then(data => releaseAssets(data.leases), () => {});
      },
    };
  }

  async setAssemblyAccessories(
    config: AssemblyAccessoriesConfig,
    robotSpec: RobotSpec,
    prepared = this.prepareAccessories(config),
  ): Promise<boolean> {
    this.hideReachRing();
    const token = ++this.accessoryToken;
    this.clearCurrentAccessories();
    if (!this.robot) {
      prepared.discard();
      throw new Error('Robot is not loaded');
    }

    let data: PreparedAccessoryData;
    try {
      data = await prepared.take();
    } catch (error) {
      if (token !== this.accessoryToken) return false;
      throw error;
    }
    if (token !== this.accessoryToken) {
      releaseAssets(data.leases);
      return false;
    }
    this.accessoryAssets = data.leases;
    const { leases, railIndex, sensorIndex, gripperStartIndex, gripperNames, manifests } = data;
    const [railManifest, sensorManifest, gripperManifest] = manifests;

    try {
      if (config.rail) {
        const railScene = leases[railIndex].object;
        const carriage = railScene.getObjectByName('rail_carriage');
        const fixedRail = railScene.getObjectByName('rail_fixed');
        if (!carriage || !fixedRail) {
          throw new Error('Rail model is missing fixed or carriage group');
        }
        const dragMesh = fixedRail.getObjectByName('part_35');
        if (!(dragMesh instanceof THREE.Mesh)) throw new Error('Rail model is missing the drag chain mesh');
        this.railDragGeometry = dragMesh.geometry.clone();
        dragMesh.geometry = this.railDragGeometry;
        const dragChain = new RailDragChain(fixedRail);
        dragChain.setPosition(config.railMm);
        enableShadows(railScene);
        const railFrame = new THREE.Group();
        railFrame.name = 'rail_cad_to_world';
        railFrame.position.copy(RAIL_ORIGIN_WORLD);
        railFrame.quaternion.copy(RAIL_CAD_TO_WORLD);
        railFrame.add(railScene);
        carriage.position.z = -config.railMm / 1000;

        this.robotMount.position.copy(ROBOT_BASE_CAD);
        this.robotMount.quaternion.copy(ROBOT_MOUNT_CAD_ROTATION);
        carriage.add(this.robotMount);

        this.scene.add(railFrame);
        this.railRoot = railFrame;
        this.railCarriage = carriage;
        this.railDragChain = dragChain;
        this.collisionDetector.registerRailManifest(railManifest!, fixedRail, carriage, config.railMm);
        this.collisionHighlighter.registerRail(fixedRail, carriage, this.robotMount);
      }

      if (config.sensor) {
        const sensorScene = leases[sensorIndex].object;
        enableShadows(sensorScene);
        const sensorMount = new THREE.Group();
        sensorMount.name = 'sensor_flange_mount';
        sensorScene.position.copy(SENSOR_FLANGE_CAD).negate();
        sensorMount.add(sensorScene);
        this.robot.links[robotSpec.eeLink].add(sensorMount);
        this.sensorMount = sensorMount;
        this.collisionDetector.registerSensorManifest(sensorManifest!, sensorMount);
        this.collisionHighlighter.registerSensor(sensorMount);
      }

      if (config.gripper) {
        const parts = Object.fromEntries(
          gripperNames.map((name, index) => [
            name,
            leases[gripperStartIndex + index].object,
          ]),
        );
        const gripper = createGripperModel(config.gripper, parts);
        gripper.setOpening(config.opening);
        const mount = assemblyGripperMount(robotSpec.id, config.gripper.id, config.sensor);
        gripper.root.position.copy(mount.position);
        gripper.root.quaternion.copy(mount.quaternion);
        this.robot.links[robotSpec.eeLink].add(gripper.root);
        this.gripper = gripper;
        this.collisionDetector.registerGripperManifest(gripperManifest!, parts);
        this.collisionHighlighter.registerGripper(config.gripper, parts);
      }

      this.collisionDetector.setExclusionOptions({
        armDof: robotSpec.dof,
        hasSensor: config.sensor,
      });
    } catch (error) {
      this.railMounted = false;
      this.clearCurrentAccessories();
      throw error;
    }

    if (config.rail !== this.railMounted) {
      this.railMounted = config.rail;
      const cameraPreset = config.rail ? RAIL_SPEC : robotSpec;
      this.initialCamera.set(...cameraPreset.cameraPosition);
      this.initialTarget.set(...cameraPreset.cameraTarget);
      this.resetView();
    }

    const activeNames = [
      robotSpec.name,
      ...(config.rail ? [RAIL_SPEC.name.en] : []),
      ...(config.sensor ? [SENSOR_SPEC.name.en] : []),
      ...(config.gripper ? [config.gripper.name] : []),
    ];
    this.renderer.domElement.setAttribute('aria-label', `Interactive ${activeNames.join(' and ')} 3D model`);
    this.scene.updateMatrixWorld(true);
    this.resize();
    this.requestRender();
    return true;
  }

  /** Keep the previous radius hidden while loading or checking a new assembly. */
  hideReachRing(): void {
    if (this.reachRing) this.reachRing.visible = false;
    this.requestRender();
  }

  /** Commit only after the assembly and any collision rollback have completed. */
  setReachRing(spec: RobotSpec, sensor: boolean, gripperId?: GripperId): void {
    this.hideReachRing();
    const radius = reachRadius(spec, sensor, gripperId);
    const base = this.robot?.links.link_base;
    if (radius === undefined || !base) {
      if (import.meta.env.DEV) console.warn('No valid reach estimate for assembly', { robot: spec.id, sensor, gripperId });
      return;
    }
    const geometry = new THREE.RingGeometry(radius - 0.0015, radius + 0.0015, 128);
    if (this.reachRing) {
      this.reachRing.geometry.dispose();
      this.reachRing.geometry = geometry;
    } else {
      this.reachRing = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0x919f99, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      }));
      this.reachRing.name = 'tcp_reach_ring';
      base.add(this.reachRing);
    }
    this.reachRing.visible = true;
    this.requestRender();
  }

  /** Inspection for the development browser regression tests. */
  reachRingState(): { visible: boolean; radius: number | null; center: number[] | null; normal: number[] | null; base: number[] | null } {
    const ring = this.reachRing;
    if (!ring) return { visible: false, radius: null, center: null, normal: null, base: null };
    ring.updateWorldMatrix(true, false);
    const base = this.robot?.links.link_base;
    return {
      visible: ring.visible,
      radius: (ring.geometry.parameters.innerRadius + ring.geometry.parameters.outerRadius) / 2,
      center: ring.getWorldPosition(new THREE.Vector3()).toArray(),
      normal: new THREE.Vector3(0, 0, 1).applyQuaternion(ring.getWorldQuaternion(new THREE.Quaternion())).toArray(),
      base: base?.getWorldPosition(new THREE.Vector3()).toArray() ?? null,
    };
  }

  setGripperOpening(opening: number): boolean {
    const changed = this.gripper?.setOpening(opening) ?? false;
    if (changed) this.requestRender();
    return changed;
  }

  /** Add the example's visual geometry without changing the product viewer. */
  addExampleGeometry(root: THREE.Object3D): void {
    this.scene.add(root);
    this.initialCamera.set(1.15, -1.25, 1.05);
    this.initialTarget.set(0.22, -0.02, 0.20);
    this.resetView();
  }

  setRailPosition(railMm: number): boolean {
    if (!this.railCarriage || !this.railDragChain || !validRailPosition(railMm)) return false;
    this.railCarriage.position.z = -railMm / 1000;
    this.railDragChain.setPosition(railMm);
    this.collisionDetector.setRailPosition(railMm);
    this.railCarriage.updateWorldMatrix(true, true);
    this.requestRender();
    return true;
  }

  detectCollisions(): CollisionPair[] {
    if (!this.robot) return [];
    this.scene.updateMatrixWorld(true);
    return this.collisionDetector.detect();
  }

  hasCollisionBody(id: CollisionBodyId): boolean {
    return this.collisionDetector.hasBody(id);
  }

  setCollisionHighlight(bodyIds: Iterable<CollisionBodyId>): void {
    if (this.collisionHighlighter.setHighlighted(bodyIds)) {
      this.requestRender();
    }
  }

  clearCollisionHighlight(): void {
    if (this.collisionHighlighter.clearHighlight()) {
      this.requestRender();
    }
  }

  getHighlightedBodies(): CollisionBodyId[] {
    return this.collisionHighlighter.getHighlightedBodies();
  }

  setToolOffset(offset: Pose): void {
    if (!this.tcpFrame) return;
    this.tcpFrame.position.copy(offset.position);
    this.tcpFrame.quaternion.copy(offset.quaternion);
    this.requestRender();
  }

  setBaseFrameVisible(visible: boolean): void {
    this.baseFrameVisible = visible;
    if (this.baseFrame) this.baseFrame.visible = visible;
    this.requestRender();
  }

  setTcpFrameVisible(visible: boolean): void {
    this.tcpFrameVisible = visible;
    if (this.tcpFrame) this.tcpFrame.visible = visible;
    this.requestRender();
  }

  resetView(): void {
    // Drain any remaining damping before restoring the saved view, otherwise it drifts.
    this.orbit.enableDamping = false;
    this.orbit.update();
    this.camera.position.copy(this.initialCamera);
    this.orbit.target.copy(this.initialTarget);
    this.orbit.update();
    this.orbit.enableDamping = true;
    this.requestRender();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    const hasAccessories = Boolean(this.gripper || this.sensorMount || this.railRoot);
    this.camera.fov = this.robot && hasAccessories && width < 600 ? 45 : 36;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }
}
