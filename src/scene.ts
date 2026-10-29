import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { forward, type Pose } from './kinematics';

export type TransformMode = 'off' | 'translate' | 'rotate';

export class RobotScene {
  robot!: URDFRobot;
  onTargetChange?: (pose: Pose) => void;
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private target = new THREE.Object3D();
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private currentMode: TransformMode = 'off';
  private initialCamera = new THREE.Vector3(0.93, -1.2, 0.95);
  private initialTarget = new THREE.Vector3(0, 0, 0.38);

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive xArm 6 3D model');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.initialCamera);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.copy(this.initialTarget);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 0.65;
    this.orbit.maxDistance = 5;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777f82, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(2, -3, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.bias = -0.0001;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8e8ff, 1.5);
    fill.position.set(-3, 1, 3);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x263332, opacity: 0.16 }));
    floor.position.z = -0.012;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.49, 0.025, 96), new THREE.MeshStandardMaterial({ color: 0xbfc7c4, roughness: 0.83, metalness: 0.16 }));
    disk.rotation.x = Math.PI / 2;
    disk.position.z = -0.025;
    disk.receiveShadow = true;
    this.scene.add(disk);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.623, 128), new THREE.MeshBasicMaterial({ color: 0x919f99, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.position.z = -0.008;
    this.scene.add(ring);

    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 12), new THREE.MeshBasicMaterial({ color: 0xee6d38, depthTest: false }));
    marker.renderOrder = 1000;
    this.target.add(marker);
    this.scene.add(this.target);
    this.target.visible = false;
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSpace('world');
    this.transform.setSize(0.8);
    this.transform.attach(this.target);
    const helper = this.transform.getHelper();
    helper.visible = false;
    this.scene.add(helper);
    this.transform.addEventListener('dragging-changed', event => { this.orbit.enabled = !event.value; });
    this.transform.addEventListener('objectChange', () => {
      if (!this.robot || this.currentMode === 'off') return;
      const base = this.robot.links.link_base;
      base.updateWorldMatrix(true, false);
      const baseQ = base.getWorldQuaternion(new THREE.Quaternion());
      const position = this.target.position.clone().applyMatrix4(new THREE.Matrix4().copy(base.matrixWorld).invert());
      const quaternion = baseQ.invert().multiply(this.target.quaternion.clone()).normalize();
      this.onTargetChange?.({ position, quaternion });
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  async load(): Promise<URDFRobot> {
    const baseUrl = new URL(`${import.meta.env.BASE_URL}models/xarm6/`, document.baseURI);
    const response = await fetch(new URL('xarm6.urdf', baseUrl));
    if (!response.ok) throw new Error(`URDF HTTP ${response.status}`);
    const xml = await response.text();
    const manager = new THREE.LoadingManager();
    const draco = new DRACOLoader(manager);
    draco.setDecoderPath(new URL(`${import.meta.env.BASE_URL}draco/`, document.baseURI).href);
    const gltf = new GLTFLoader(manager).setDRACOLoader(draco);
    const loader = new URDFLoader(manager);
    loader.workingPath = baseUrl.href;
    const pending: Promise<void>[] = [];
    loader.loadMeshCb = (url, _manager, _material, done) => {
      const task = gltf.loadAsync(url).then(result => {
        result.scene.traverse(object => {
          if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
        });
        done(result.scene);
      }).catch((error: unknown) => {
        done(null as unknown as THREE.Object3D, error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
      pending.push(task);
    };
    this.robot = loader.parse(xml);
    if (pending.length !== 7) throw new Error(`Expected 7 visual meshes, found ${pending.length}`);
    await Promise.all(pending);
    this.scene.add(this.robot);
    this.robot.updateMatrixWorld(true);
    return this.robot;
  }

  syncTarget(): void {
    if (!this.robot) return;
    const pose = forward(this.robot);
    const base = this.robot.links.link_base;
    base.updateWorldMatrix(true, false);
    this.target.position.copy(pose.position).applyMatrix4(base.matrixWorld);
    this.target.quaternion.copy(base.getWorldQuaternion(new THREE.Quaternion())).multiply(pose.quaternion);
    this.target.updateMatrixWorld(true);
  }

  setTarget(pose: Pose): void {
    const base = this.robot.links.link_base;
    base.updateWorldMatrix(true, false);
    this.target.position.copy(pose.position).applyMatrix4(base.matrixWorld);
    this.target.quaternion.copy(base.getWorldQuaternion(new THREE.Quaternion())).multiply(pose.quaternion);
    this.target.updateMatrixWorld(true);
  }

  setMode(mode: TransformMode): void {
    this.currentMode = mode;
    this.target.visible = mode !== 'off';
    this.transform.enabled = mode !== 'off';
    this.transform.getHelper().visible = mode !== 'off';
    if (mode !== 'off') this.transform.setMode(mode);
  }

  resetView(): void {
    // Drain any remaining damping before restoring the saved view, otherwise it drifts.
    this.orbit.enableDamping = false;
    this.orbit.update();
    this.camera.position.copy(this.initialCamera);
    this.orbit.target.copy(this.initialTarget);
    this.orbit.update();
    this.orbit.enableDamping = true;
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
