import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';

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
  robot!: URDFRobot;
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private resizeObserver: ResizeObserver;
  private baseFrame?: THREE.Group;
  private tcpFrame?: THREE.Group;
  private baseFrameVisible = false;
  private tcpFrameVisible = false;
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

    this.baseFrame = createCoordinateFrame(0.14, 0.0026);
    this.baseFrame.name = 'base_coordinate_frame';
    this.baseFrame.visible = this.baseFrameVisible;
    this.robot.links.link_base.add(this.baseFrame);

    this.tcpFrame = createCoordinateFrame(0.1, 0.0022);
    this.tcpFrame.name = 'tcp_coordinate_frame';
    this.tcpFrame.visible = this.tcpFrameVisible;
    this.robot.links.link_eef.add(this.tcpFrame);

    this.scene.add(this.robot);
    this.robot.updateMatrixWorld(true);
    return this.robot;
  }

  setBaseFrameVisible(visible: boolean): void {
    this.baseFrameVisible = visible;
    if (this.baseFrame) this.baseFrame.visible = visible;
  }

  setTcpFrameVisible(visible: boolean): void {
    this.tcpFrameVisible = visible;
    if (this.tcpFrame) this.tcpFrame.visible = visible;
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
