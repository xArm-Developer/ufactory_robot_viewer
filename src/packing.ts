import * as THREE from 'three';
import loadMujoco, { type MainModule, type MjData, type MjModel } from '@mujoco/mujoco';
import wasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import type { URDFRobot } from 'urdf-loader';
import { setJoints } from './kinematics';
import { packingJoints } from './packing-kinematics';
import config from './packing-config.json' with { type: 'json' };
import { planPackingSegment, stationary, type MotionState, type PackingSegment, type Vec3 } from './packing-trajectory';
import { getRobotSpec } from './robots';
import { getGripper } from './grippers';
import { RobotScene } from './scene';
import type { CollisionBodyId } from './collision';

type Language = 'zh' | 'en';
type Phase = 'wait' | 'approach' | 'descend' | 'close' | 'lift' | 'carry' | 'transfer' | 'release' | 'rise' | 'exit' | 'finish';
type Reason = 'load' | 'runtime' | 'miss' | 'drop' | 'outside' | 'collision' | 'ik';
type Status = 'loading' | 'running' | 'paused' | 'complete' | 'error';

const text = {
  zh: {
    title: '示例 01：装箱', label: '选择示例', subtitle: 'xArm 6 + Gripper G2', description: '跟踪运动中的工件，逐件放入箱内。',
    progress: '装箱进度', elapsed: '仿真耗时', cycle: '平均节拍', play: '播放', pause: '暂停', resume: '继续', reset: '重置', replay: '重新播放', retry: '重试',
    loading: '正在加载模型和物理引擎…', running: '运行中', paused: '已暂停', complete: '装箱完成',
    load: '场景加载失败，请重试。', runtime: '仿真运行失败，请重试。', miss: '抓取失败：未夹住工件。', drop: '工件在搬运中掉落。', outside: '工件未在箱内稳定落下。', collision: '检测到非预期碰撞：', ik: '机械臂无法到达目标位置。',
    mobile: '建议使用桌面浏览器体验完整仿真。', note: '物理参数仅用于展示，未经实机标定；示例不连接真机。', resetView: '复位视角',
  },
  en: {
    title: 'Example 01: Packing', label: 'Choose example', subtitle: 'xArm 6 + Gripper G2', description: 'Track moving parts and place them in the box one at a time.',
    progress: 'Packing progress', elapsed: 'Simulation time', cycle: 'Average cycle', play: 'Play', pause: 'Pause', resume: 'Resume', reset: 'Reset', replay: 'Replay', retry: 'Retry',
    loading: 'Loading the model and physics engine…', running: 'Running', paused: 'Paused', complete: 'Packing complete',
    load: 'Could not load the scene. Please retry.', runtime: 'The simulation stopped unexpectedly. Please retry.', miss: 'Grasp failed: the part was not held.', drop: 'The part fell during transport.', outside: 'The part did not settle in the box.', collision: 'Unexpected collision: ', ik: 'The arm could not reach the target.',
    mobile: 'For the full simulation, use a desktop browser.', note: 'Physics parameters are illustrative and not calibrated to hardware. This example does not connect to a robot.', resetView: 'Reset view',
  },
} as const;

const INITIAL_JOINTS = [0.244977603, -0.122664793, -0.787690455, 0.0000093, 0.910355278, 0.244971898];
const STEP = config.step;
const PICK_CENTRE_Z = config.belt.top + config.part.size / 2;
const TRACK_LEAD_SECONDS = .08;
const ZERO: Vec3 = [0, 0, 0];
interface PackingEvent { type: 'grip' | 'release' | 'settled'; part: number; time: number; position?: number[] }
interface RecordedSegment { phase: Phase; part: number; startTime: number; segment: PackingSegment }

function box(size: [number, number, number], position: [number, number, number], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Owns an independent MuJoCo state and visual scene for the example. */
export class PackingExample {
  private language: Language = 'zh';
  private status: Status = 'loading';
  private reason?: Reason;
  private collisionNames: string[] = [];
  private visible = false;
  private wantsPlayback = true;
  private frame = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private engine?: MainModule;
  private model?: MjModel;
  private data?: MjData;
  private scene?: RobotScene;
  private robot?: URDFRobot;
  private siteId = 0;
  private blockIds: number[] = [];
  private blockDofs: number[] = [];
  private geomNames: string[] = [];
  private cubes: THREE.Mesh[] = [];
  private stripes: THREE.Mesh[] = [];
  private phase: Phase = 'wait';
  private phaseStart = 0;
  private command: MotionState = stationary([.4, .1, .17]);
  private motion?: PackingSegment;
  private segments: RecordedSegment[] = [];
  private events: PackingEvent[] = [];
  private releasedAt: Array<number | undefined> = [];
  private stableSince: Array<number | undefined> = [];
  private unstableSince: Array<number | undefined> = [];
  private settled: boolean[] = [];
  private releaseStarted = false;
  private padLeft = false;
  private padRight = false;
  private opening = config.gripper.pregraspOpening;
  private current = 0;
  private gripLeft = false;
  private gripRight = false;
  private gripSince?: number;
  private steps = 0;
  private loadingToken = 0;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="packing-experience page-width">
        <div class="stage packing-stage" id="packing-stage">
          <div class="canvas-area" id="packing-canvas"></div>
          <div class="load-message" id="packing-loading" role="status"><span class="spinner"></span><span></span></div>
          <div class="stage-notices"><div id="packing-error" class="stage-notice" role="status" aria-live="polite" hidden></div></div>
          <div class="stage-bottom"><div class="stage-actions"><button class="stage-btn view-reset" id="packing-view-reset" type="button"><span aria-hidden="true">↺</span> <span></span></button></div></div>
          <span class="stage-corner corner-tl"></span><span class="stage-corner corner-br"></span>
        </div>
        <aside class="packing-panel">
          <label for="example-select" id="packing-label"></label>
          <select id="example-select"><option value="packing-01"></option></select>
          <p class="packing-subtitle"></p><h2></h2><p class="packing-description"></p>
          <div class="packing-progress"><div><span id="packing-progress-label"></span><strong id="packing-count">0 / 9</strong></div><progress id="packing-progress" aria-labelledby="packing-progress-label" max="${config.part.count}" value="0"></progress></div>
          <div class="packing-metrics"><span id="packing-elapsed"></span><span id="packing-cycle"></span></div>
          <p id="packing-status" class="packing-status" role="status" aria-live="polite"></p>
          <div class="packing-actions"><button id="packing-play" type="button" disabled></button><button id="packing-reset" type="button" disabled></button></div>
          <p class="packing-mobile"></p><p class="packing-note"></p>
        </aside>
      </div>`;
    this.find<HTMLButtonElement>('#packing-play').addEventListener('click', () => this.togglePlayback());
    this.find<HTMLButtonElement>('#packing-reset').addEventListener('click', () => this.reset(false));
    this.find<HTMLButtonElement>('#packing-view-reset').addEventListener('click', () => this.scene?.resetView());
    this.translate();
  }

  private find<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  }

  setLanguage(language: Language): void { this.language = language; this.translate(); }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      if (!this.scene && this.status === 'loading') void this.load();
      else if (this.wantsPlayback && this.status === 'paused') this.play();
    } else if (this.status === 'running') {
      this.stopFrames();
      this.status = 'paused';
      this.translate();
    }
  }

  private translate(): void {
    const c = text[this.language];
    this.find('#packing-label').textContent = c.label;
    this.find('#example-select option').textContent = c.title;
    this.find('.packing-subtitle').textContent = c.subtitle;
    this.find('.packing-panel h2').textContent = c.title;
    this.find('.packing-description').textContent = c.description;
    this.find('.packing-progress span').textContent = c.progress;
    this.find('.packing-mobile').textContent = c.mobile;
    this.find('.packing-note').textContent = c.note;
    this.find('#packing-view-reset span:last-child').textContent = c.resetView;
    this.find('#packing-loading span:last-child').textContent = this.reason === 'load' ? c.load : c.loading;
    const message = this.status === 'error'
      ? c[this.reason ?? 'load'] + (this.reason === 'collision' ? this.collisionNames.map(name => this.collisionLabel(name)).join('-') : '')
      : c[this.status];
    this.find('#packing-status').textContent = this.status === 'error' ? '' : message;
    this.find('#packing-error').textContent = this.status === 'error' ? message : '';
    this.find('#packing-error').hidden = this.status !== 'error';
    const play = this.find<HTMLButtonElement>('#packing-play');
    play.textContent = this.status === 'running' ? c.pause : this.reason === 'load' || this.reason === 'runtime' ? c.retry : this.status === 'complete' || this.status === 'error' ? c.replay : this.current === 0 && this.data?.time === 0 ? c.play : c.resume;
    play.disabled = this.status === 'loading';
    this.find<HTMLButtonElement>('#packing-reset').textContent = c.reset;
    this.find<HTMLButtonElement>('#packing-reset').disabled = !this.data;
    this.find('#packing-loading').hidden = this.status !== 'loading';
    const progress = this.settled.filter(Boolean).length;
    this.find('#packing-count').textContent = `${progress} / ${config.part.count}`;
    this.find<HTMLProgressElement>('#packing-progress').value = progress;
    this.updateMetrics();
    this.find('#packing-stage').dataset.status = this.status;
    this.find('#packing-stage').dataset.progress = String(progress);
  }

  private updateMetrics(): void {
    const c = text[this.language];
    const releases = this.events.filter(event => event.type === 'release');
    const average = releases.length > 1 ? (releases[releases.length - 1].time - releases[0].time) / (releases.length - 1) : undefined;
    this.find('#packing-elapsed').textContent = `${c.elapsed}  ${(this.data?.time ?? 0).toFixed(1)} s`;
    this.find('#packing-cycle').textContent = `${c.cycle}  ${average === undefined ? '—' : `${average.toFixed(2)} s`}`;
  }

  private collisionLabel(name: string): string {
    const chinese = this.language === 'zh';
    const link = /^link(\d+)_h/.exec(name);
    const block = /^block_(\d+)$/.exec(name);
    if (link) {
      if (link[1] === '6') return chinese ? '末端法兰' : 'End flange';
      return chinese ? `连杆${link[1]}` : `Link ${link[1]}`;
    }
    if (block) return chinese ? `工件 ${Number(block[1]) + 1}` : `Part ${Number(block[1]) + 1}`;
    if (name.startsWith('link_base_')) return chinese ? '机械臂基座' : 'Arm base';
    if (name === 'gripper_base') return chinese ? '夹爪基座' : 'Gripper base';
    if (name === 'pad_left') return chinese ? '夹爪左指' : 'Left jaw';
    if (name === 'pad_right') return chinese ? '夹爪右指' : 'Right jaw';
    if (name === 'belt') return chinese ? '传送带' : 'Conveyor';
    if (name.startsWith('box_')) return chinese ? '箱体' : 'Box';
    if (name === 'ground') return chinese ? '地面' : 'Ground';
    return name;
  }

  private async load(): Promise<void> {
    const token = ++this.loadingToken;
    try {
      const [engine, xmlResponse] = await Promise.all([
        loadMujoco({ locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : path }),
        fetch(new URL(`${import.meta.env.BASE_URL}examples/packing-01/scene.xml`, document.baseURI)),
      ]);
      if (!xmlResponse.ok) throw new Error(`Scene HTTP ${xmlResponse.status}`);
      const xml = await xmlResponse.text();
      if (token !== this.loadingToken) return;
      this.engine = engine;
      this.model = engine.MjModel.from_xml_string(xml);
      this.data = new engine.MjData(this.model);
      this.siteId = engine.mj_name2id(this.model, engine.mjtObj.mjOBJ_SITE.value, 'grasp');
      this.blockIds = Array.from({ length: config.part.count }, (_, i) => engine.mj_name2id(this.model!, engine.mjtObj.mjOBJ_BODY.value, `block_${i}`));
      this.blockDofs = Array.from({ length: config.part.count }, (_, i) => {
        const joint = engine.mj_name2id(this.model!, engine.mjtObj.mjOBJ_JOINT.value, `block_${i}`);
        return this.model!.jnt_dofadr[joint] as number;
      });
      this.geomNames = Array.from({ length: this.model.ngeom }, (_, i) => engine.mj_id2name(this.model!, engine.mjtObj.mjOBJ_GEOM.value, i));
      this.scene = new RobotScene(this.find('#packing-canvas'));
      this.find<HTMLCanvasElement>('#packing-canvas canvas').addEventListener('webglcontextlost', event => {
        event.preventDefault();
        this.fail('load');
        this.disposeResources();
        this.translate();
      });
      const spec = getRobotSpec('xarm6');
      const robot = await this.scene.load(spec);
      if (!robot || token !== this.loadingToken) throw new Error('Robot unavailable');
      this.robot = robot;
      setJoints(robot, INITIAL_JOINTS);
      const configured = await this.scene.setAssemblyAccessories({ rail: false, railMm: 0, sensor: false, gripper: getGripper('gripper-g2'), opening: config.gripper.pregraspOpening * 1000 }, spec);
      if (!configured) throw new Error('Gripper unavailable');
      this.makeEnvironment();
      this.reset(this.wantsPlayback);
      if (import.meta.env.DEV) this.installTestAccess();
    } catch (error) {
      if (token !== this.loadingToken) return;
      console.error('Packing example:', error);
      this.stopFrames();
      this.disposeResources();
      this.reason = 'load';
      this.status = 'error';
      this.translate();
    }
  }

  private disposeResources(): void {
    const scene = this.scene, data = this.data, model = this.model;
    this.scene = undefined; this.robot = undefined;
    this.data = undefined; this.model = undefined; this.engine = undefined;
    this.cubes = []; this.stripes = [];
    try { scene?.destroy(); } finally {
      try { data?.delete(); } finally { model?.delete(); }
    }
  }

  /** Deterministic fault injection and stepping for browser tests; excluded from production. */
  private installTestAccess(): void {
    const self = this;
    const snapshot = () => {
      const data = self.data!, part = self.current;
      const contacts = data.contact;
      let left = false, right = false, belt = false;
      try {
        for (let i = 0; i < data.ncon; i++) {
          const contact = contacts.get(i);
          if (!contact) continue;
          const names = [self.geomNames[contact.geom1], self.geomNames[contact.geom2]];
          const active = contact.dist <= 0;
          contact.delete();
          if (!active || !names.includes(`block_${part}`)) continue;
          left ||= names.includes('pad_left');
          right ||= names.includes('pad_right');
          belt ||= names.includes('belt');
        }
      } finally { contacts.delete(); }
      self.syncVisual();
      const gripper = self.robot!.getObjectByName('gripper-g2')!;
      return {
        time: data.time, phase: self.phase, part, position: self.blockPosition(part).toArray(),
        site: self.sitePosition().toArray(), velocityY: data.qvel[self.blockDofs[part] + 1] as number,
        jaws: Array.from(data.qpos.slice(6, 8)) as number[], jawCommand: self.opening, left, right, belt,
        fingertipZ: new THREE.Box3().setFromObject(gripper).min.z,
        bottomZ: new THREE.Box3().setFromObject(self.cubes[part]).min.z,
      };
    };
    // Exact triangle-to-box separation after a conservative 5 mm broad phase.
    const segmentDistanceSquared = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number => {
      const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
      const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
      const denominator = aa * cc - bb * bb;
      let sn = denominator < 1e-18 ? 0 : bb * ee - cc * dd;
      let sd = denominator < 1e-18 ? 1 : denominator;
      let tn = denominator < 1e-18 ? ee : aa * ee - bb * dd;
      let td = denominator < 1e-18 ? cc : denominator;
      if (sn < 0) { sn = 0; tn = ee; td = cc; }
      else if (sn > sd) { sn = sd; tn = ee + bb; td = cc; }
      if (tn < 0) { tn = 0; sn = THREE.MathUtils.clamp(-dd, 0, aa); sd = aa; }
      else if (tn > td) { tn = td; sn = THREE.MathUtils.clamp(bb - dd, 0, aa); sd = aa; }
      const sc = Math.abs(sn) < 1e-18 ? 0 : sn / sd, tc = Math.abs(tn) < 1e-18 ? 0 : tn / td;
      return w.addScaledVector(u, sc).addScaledVector(v, -tc).lengthSq();
    };
    const triangleBoxDistance = (triangle: THREE.Triangle, target: THREE.Box3): number => {
      if (target.intersectsTriangle(triangle)) return 0;
      let best = Infinity;
      for (const point of [triangle.a, triangle.b, triangle.c]) best = Math.min(best, target.distanceToPoint(point));
      const vertices: THREE.Vector3[] = [];
      for (const x of [target.min.x, target.max.x]) for (const y of [target.min.y, target.max.y]) for (const z of [target.min.z, target.max.z]) vertices.push(new THREE.Vector3(x, y, z));
      const closest = new THREE.Vector3();
      for (const point of vertices) best = Math.min(best, triangle.closestPointToPoint(point, closest).distanceTo(point));
      for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
        for (const [i, j] of [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]]) {
          best = Math.min(best, Math.sqrt(segmentDistanceSquared(a, b, vertices[i], vertices[j])));
        }
      }
      return best;
    };
    const visualClearance = () => {
      self.syncVisual();
      const { center: [cx, cy], innerSize, wall, floorThickness, wallHeight } = config.box;
      const half = innerSize / 2, margin = config.placement.clearance;
      const bounds: Array<{ name: string; box: THREE.Box3 }> = [];
      for (const sign of [-1, 1]) {
        const x = cx + sign * (half + wall / 2), y = cy + sign * (half + wall / 2);
        bounds.push({ name: `wall-x-${sign}`, box: new THREE.Box3(new THREE.Vector3(x - wall / 2, cy - half - wall, floorThickness), new THREE.Vector3(x + wall / 2, cy + half + wall, floorThickness + wallHeight)) });
        bounds.push({ name: `wall-y-${sign}`, box: new THREE.Box3(new THREE.Vector3(cx - half, y - wall / 2, floorThickness), new THREE.Vector3(cx + half, y + wall / 2, floorThickness + wallHeight)) });
      }
      for (let i = 0; i < config.part.count; i++) if (i !== self.current && self.releasedAt[i] !== undefined) {
        bounds.push({ name: `block-${i}`, box: new THREE.Box3().setFromObject(self.cubes[i]) });
      }
      const findings: string[] = [], tri = new THREE.Triangle();
      let minimum = Infinity;
      self.robot!.getObjectByName('gripper-g2')!.traverse(object => {
        if (!(object instanceof THREE.Mesh) || findings.length) return;
        const geometry = object.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const worldBox = geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);
        const nearby = bounds.filter(item => item.box.clone().expandByScalar(margin).intersectsBox(worldBox));
        if (!nearby.length) return;
        const positions = geometry.getAttribute('position'), indices = geometry.index;
        const count = indices ? indices.count : positions.count;
        for (let i = 0; i + 2 < count && !findings.length; i += 3) {
          const read = (j: number, out: THREE.Vector3) => out.fromBufferAttribute(positions, indices ? indices.getX(j) : j).applyMatrix4(object.matrixWorld);
          read(i, tri.a); read(i + 1, tri.b); read(i + 2, tri.c);
          for (const item of nearby) {
            if (!item.box.clone().expandByScalar(margin).intersectsTriangle(tri)) continue;
            const distance = triangleBoxDistance(tri, item.box);
            minimum = Math.min(minimum, distance);
            if (distance < margin - 1e-6) {
              findings.push(`${object.name || 'gripper'} / ${item.name} / ${(distance * 1000).toFixed(2)} mm`); break;
            }
          }
        }
      });
      return { findings, minimum };
    };
    (window as Window & { __packingTest?: unknown }).__packingTest = {
      reach: () => self.scene?.reachRingState(),
      run(seconds: number, recordGrasp = false, recordClearance = false) {
        if (self.status === 'running') { self.wantsPlayback = false; self.stopFrames(); self.status = 'paused'; }
        const transitions = [];
        const graspSamples = [];
        let minimumClearance = Infinity;
        const clearanceFindings: Array<{ time: number; part: number; phase: Phase; collision: string[] }> = [];
        for (let i = 0; i < Math.round(seconds / STEP) && self.status === 'paused'; i++) {
          const phase = self.phase, part = self.current;
          self.advance();
          if (phase !== self.phase || part !== self.current || self.status !== 'paused') {
            transitions.push({
              phase: self.phase, part, time: self.data!.time, left: self.gripLeft, right: self.gripRight,
              z: part < config.part.count ? self.blockPosition(part).z : 0, velocityY: part < config.part.count ? self.data!.qvel[self.blockDofs[part] + 1] as number : 0,
            });
          }
          if (recordClearance && clearanceFindings.length < 20 && self.status === 'paused' && self.steps % 10 === 0
            && self.phase !== 'wait') {
            const clearance = visualClearance();
            minimumClearance = Math.min(minimumClearance, clearance.minimum);
            if (clearance.findings.length) clearanceFindings.push({ time: self.data!.time, part: self.current, phase: self.phase, collision: clearance.findings });
          }
          if (recordGrasp && self.status === 'paused' && self.steps % 4 === 0 && ['approach', 'descend', 'close', 'lift', 'carry', 'transfer', 'release', 'rise', 'exit'].includes(self.phase)) {
            graspSamples.push(snapshot());
          }
        }
        self.syncVisual(); self.translate();
        return {
          status: self.status, progress: self.settled.filter(Boolean).length, time: self.data!.time, reason: self.reason, transitions,
          events: self.events.map(event => ({ ...event })), segments: self.segments.map(({ phase, part, startTime, segment }) => ({ phase, part, startTime, duration: segment.duration, start: segment.start, end: segment.end })),
          graspSamples, clearanceFindings, minimumClearance, allInBox: self.blockIds.every((_, i) => self.inBox(i)), wasmBytes: (self.data!.qpos as Float64Array).buffer.byteLength,
        };
      },
      advanceTo(kind: 'phase' | 'event', name: string, part: number, seconds = 10) {
        if (self.status === 'running') { self.wantsPlayback = false; self.stopFrames(); self.status = 'paused'; }
        const reached = () => kind === 'phase' ? self.phase === name && self.current === part
          : self.events.some(event => event.type === name && event.part === part);
        for (let i = 0; i < Math.round(seconds / STEP) && self.status === 'paused' && !reached(); i++) self.advance();
        self.syncVisual(); self.translate();
        return { reached: reached(), status: self.status, phase: self.phase, part: self.current, time: self.data!.time, reason: self.reason };
      },
      reset() { self.reset(false); },
      block(index: number) { return self.blockPosition(index).toArray(); },
      snapshot,
      moveBlock(index: number, position: number[]) {
        const joint = self.engine!.mj_name2id(self.model!, self.engine!.mjtObj.mjOBJ_JOINT.value, `block_${index}`);
        const adr = self.model!.jnt_qposadr[joint] as number, dof = self.blockDofs[index];
        self.data!.qpos.set(position, adr); self.data!.qvel.fill(0, dof, dof + 6);
        self.engine!.mj_forward(self.model!, self.data!);
      },
      disablePads() {
        for (const name of ['pad_left', 'pad_right']) {
          const id = self.geomNames.indexOf(name);
          self.model!.geom_contype[id] = self.model!.geom_conaffinity[id] = 0;
        }
      },
      collide(index: number) {
        const geom = self.geomNames.findIndex(name => name.startsWith('link2_h'));
        const p = self.data!.geom_xpos, rotation = self.data!.geom_xmat;
        const mesh = self.model!.geom_dataid[geom], first = self.model!.mesh_vertadr[mesh], count = self.model!.mesh_vertnum[mesh];
        const center = [0, 0, 0];
        for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) center[axis] += self.model!.mesh_vert[(first + i) * 3 + axis] / count;
        const world = center.map((_, axis) => p[geom * 3 + axis] + center.reduce((sum, value, j) => sum + rotation[geom * 9 + axis * 3 + j] * value, 0));
        const joint = self.engine!.mj_name2id(self.model!, self.engine!.mjtObj.mjOBJ_JOINT.value, `block_${index}`);
        self.data!.qpos.set(world, self.model!.jnt_qposadr[joint]);
        self.engine!.mj_forward(self.model!, self.data!); self.inspectContacts(); self.syncVisual();
      },
      highlighted() { return self.scene!.getHighlightedBodies(); },
    };
  }

  private makeEnvironment(): void {
    const group = new THREE.Group();
    const belt = new THREE.MeshStandardMaterial({ color: 0x303c39, roughness: 0.8 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x9aa49e, metalness: 0.5, roughness: 0.55 });
    const cardboard = new THREE.MeshStandardMaterial({ color: 0xc89c6a, roughness: 0.95 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0x52625d, roughness: 0.8 });
    group.add(box([.18, 1.2, .03], [config.belt.x, .02, config.belt.top - .015], belt));
    for (const x of [config.belt.x - .096, config.belt.x + .096]) group.add(box([.012, 1.2, .04], [x, .02, .02], edge));
    // The physical queue continues behind this feed enclosure.
    group.add(box([.22, .18, .018], [config.belt.x, .57, .13], edge));
    for (const x of [config.belt.x - .106, config.belt.x + .106]) group.add(box([.012, .18, .10], [x, .57, .08], edge));
    for (let i = 0; i < 15; i++) {
      const mark = box([.16, .006, .0005], [config.belt.x, -.55 + i * .08, config.belt.top + .0004], stripe);
      this.stripes.push(mark); group.add(mark);
    }
    const { center: [cx, cy], innerSize, wall, floorThickness, wallHeight } = config.box;
    const half = innerSize / 2;
    group.add(box([innerSize + 2 * wall, innerSize + 2 * wall, floorThickness], [cx, cy, floorThickness / 2], cardboard));
    for (const sign of [-1, 1]) {
      group.add(box([wall, innerSize + 2 * wall, wallHeight], [cx + sign * (half + wall / 2), cy, floorThickness + wallHeight / 2], cardboard));
      group.add(box([innerSize, wall, wallHeight], [cx, cy + sign * (half + wall / 2), floorThickness + wallHeight / 2], cardboard));
    }
    const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0xe16b43, roughness: .65 });
    for (let i = 0; i < config.part.count; i++) {
      const cube = box([config.part.size, config.part.size, config.part.size], [0, 0, 0], cubeMaterial);
      this.cubes.push(cube); group.add(cube);
    }
    this.scene!.addExampleGeometry(group);
  }

  private reset(play: boolean): void {
    if (!this.engine || !this.model || !this.data) {
      if (this.status === 'error') {
        this.wantsPlayback = play; this.status = 'loading'; this.reason = undefined; this.translate(); void this.load();
      }
      return;
    }
    this.stopFrames();
    this.engine.mj_resetData(this.model, this.data);
    this.data.qpos.set(INITIAL_JOINTS, 0);
    this.data.ctrl.set(INITIAL_JOINTS, 0);
    this.opening = config.gripper.pregraspOpening;
    this.data.qpos[6] = this.data.qpos[7] = this.opening / 2;
    this.data.ctrl[6] = this.data.ctrl[7] = this.opening / 2;
    this.engine.mj_forward(this.model, this.data);
    this.phase = 'wait'; this.phaseStart = 0;
    this.command = stationary(this.sitePosition().toArray() as Vec3); this.motion = undefined;
    this.current = 0; this.steps = 0; this.segments = []; this.events = [];
    this.releasedAt = Array(config.part.count).fill(undefined); this.stableSince = Array(config.part.count).fill(undefined);
    this.unstableSince = Array(config.part.count).fill(undefined);
    this.settled = Array(config.part.count).fill(false); this.releaseStarted = false;
    this.padLeft = this.padRight = false;
    this.gripLeft = false; this.gripRight = false; this.gripSince = undefined; this.reason = undefined; this.collisionNames = [];
    this.scene?.clearCollisionHighlight();
    const stage = this.find('#packing-stage'); delete stage.dataset.reason; delete stage.dataset.failurePhase; delete stage.dataset.grip; delete stage.dataset.block;
    this.wantsPlayback = play; this.status = 'paused';
    this.syncVisual(); this.translate();
    if (play && this.visible) this.play();
  }

  private togglePlayback(): void {
    if (this.status === 'running') {
      this.wantsPlayback = false; this.stopFrames(); this.status = 'paused'; this.translate();
    } else if (this.status === 'error' || this.status === 'complete') {
      this.reset(true);
    } else if (this.status === 'paused') {
      this.wantsPlayback = true; this.play();
    }
  }

  private play(): void {
    if (!this.visible || !this.data || this.status !== 'paused') return;
    this.status = 'running'; this.lastFrame = 0; this.accumulator = 0; this.translate();
    this.frame = requestAnimationFrame(this.animate);
  }

  private stopFrames(): void { cancelAnimationFrame(this.frame); this.frame = 0; this.lastFrame = 0; this.accumulator = 0; }

  private animate = (now: number): void => {
    if (this.status !== 'running' || !this.visible) return;
    if (!this.lastFrame) this.lastFrame = now;
    this.accumulator += Math.min((now - this.lastFrame) / 1000, .1);
    this.lastFrame = now;
    try {
      while (this.accumulator >= STEP && this.status === 'running') {
        this.advance(); this.accumulator -= STEP;
      }
      this.syncVisual();
    } catch (error) {
      console.error('Packing simulation:', error);
      this.fail('runtime');
      try { this.disposeResources(); } catch (cleanupError) { console.error('Packing cleanup:', cleanupError); }
      this.translate();
      return;
    }
    if (this.status === 'running') this.frame = requestAnimationFrame(this.animate);
  };

  private sitePosition(): THREE.Vector3 {
    const v = this.data!.site_xpos; const i = this.siteId * 3;
    return new THREE.Vector3(v[i], v[i + 1], v[i + 2]);
  }

  private blockPosition(index: number): THREE.Vector3 {
    const v = this.data!.xpos; const i = this.blockIds[index] * 3;
    return new THREE.Vector3(v[i], v[i + 1], v[i + 2]);
  }

  private enter(phase: Phase): void { this.phase = phase; this.phaseStart = this.data!.time; }

  private beginMotion(phase: Phase, end: MotionState, minimum = .2): void {
    this.motion = planPackingSegment(this.command, end, minimum);
    this.enter(phase);
    this.segments.push({ phase, part: this.current, startTime: this.phaseStart, segment: this.motion });
  }

  private startApproach(): void {
    const block = this.blockPosition(this.current);
    // Solve interception and trajectory duration together; the belt continues to move.
    let duration = .8;
    let segment: PackingSegment | undefined;
    for (let i = 0; i < 8; i++) {
      const target: MotionState = {
        position: [config.belt.x, block.y - config.belt.speed * (duration + TRACK_LEAD_SECONDS), .095],
        velocity: [0, -config.belt.speed, -.12], acceleration: [...ZERO],
      };
      segment = planPackingSegment(this.command, target, .2);
      if (Math.abs(segment.duration - duration) < .0001) break;
      duration = segment.duration;
    }
    this.motion = segment!;
    this.enter('approach');
    this.segments.push({ phase: this.phase, part: this.current, startTime: this.phaseStart, segment: this.motion });
  }

  private startDescent(): void {
    let duration = .45;
    let segment: PackingSegment | undefined;
    for (let i = 0; i < 8; i++) {
      const target: MotionState = { position: [config.belt.x, this.command.position[1] - config.belt.speed * duration, PICK_CENTRE_Z],
        velocity: [0, -config.belt.speed, 0], acceleration: [...ZERO] };
      segment = planPackingSegment(this.command, target, .2);
      if (Math.abs(segment.duration - duration) < .0001) break;
      duration = segment.duration;
    }
    this.motion = segment!; this.enter('descend');
    this.segments.push({ phase: this.phase, part: this.current, startTime: this.phaseStart, segment: this.motion });
  }

  private targetPosition(index: number): Vec3 {
    return [config.box.center[0] + (1 - index % 3) * config.box.spacing,
      config.box.center[1] + (1 - Math.floor(index / 3)) * config.box.spacing, config.placement.releaseHeight];
  }

  private beginLift(): void {
    this.events.push({ type: 'grip', part: this.current, time: this.data!.time });
    let duration = .24;
    let segment: PackingSegment | undefined;
    for (let i = 0; i < 8; i++) {
      const target: MotionState = { position: [this.command.position[0], this.command.position[1] - config.belt.speed * duration, PICK_CENTRE_Z + .01],
        velocity: [0, -config.belt.speed, .08], acceleration: [...ZERO] };
      segment = planPackingSegment(this.command, target, .1);
      if (Math.abs(segment.duration - duration) < .0001) break;
      duration = segment.duration;
    }
    this.motion = segment!; this.enter('lift');
    this.segments.push({ phase: this.phase, part: this.current, startTime: this.phaseStart, segment: this.motion });
  }

  private fail(reason: Reason, collisionNames: string[] = [], highlighted: CollisionBodyId[] = []): void {
    this.reason = reason; this.collisionNames = collisionNames; this.status = 'error'; this.wantsPlayback = false;
    const stage = this.find('#packing-stage');
    stage.dataset.reason = reason; stage.dataset.failurePhase = this.phase;
    stage.dataset.grip = `${this.gripLeft},${this.gripRight}`;
    stage.dataset.block = reason !== 'runtime' && this.data && this.current < config.part.count ? this.blockPosition(this.current).toArray().map(v => v.toFixed(3)).join(',') : '';
    this.stopFrames(); this.scene?.setCollisionHighlight(highlighted); this.translate();
  }

  private inBox(index: number): boolean {
    const p = this.blockPosition(index), v = this.data!.qvel, d = this.blockDofs[index];
    const body = this.blockIds[index], q = this.data!.xquat, k = body * 4;
    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(q[k + 1], q[k + 2], q[k + 3], q[k]));
    const e = rotation.elements, half = config.part.size / 2;
    const rx = half * (Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]));
    const ry = half * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
    const { center, innerSize, floorThickness } = config.box;
    return Math.abs(p.x - center[0]) + rx <= innerSize / 2 && Math.abs(p.y - center[1]) + ry <= innerSize / 2
      && p.z > floorThickness && p.z < floorThickness + config.part.size
      && Math.hypot(v[d], v[d + 1], v[d + 2]) < .03 && Math.hypot(v[d + 3], v[d + 4], v[d + 5]) < 1;
  }

  private updateSettled(): void {
    for (let i = 0; i < config.part.count; i++) {
      const released = this.releasedAt[i];
      if (released === undefined) continue;
      if (this.inBox(i)) {
        this.unstableSince[i] = undefined;
        this.stableSince[i] ??= this.data!.time;
        if (!this.settled[i] && this.data!.time - this.stableSince[i]! >= config.placement.stableTime) {
          this.settled[i] = true; this.events.push({ type: 'settled', part: i, time: this.data!.time }); this.translate();
        }
      } else {
        this.stableSince[i] = undefined;
        this.unstableSince[i] ??= this.data!.time;
      }
      if ((!this.settled[i] && this.data!.time - released > config.placement.timeout)
        || (this.settled[i] && this.unstableSince[i] !== undefined && this.data!.time - this.unstableSince[i]! > config.placement.timeout)) { this.fail('outside'); return; }
    }
  }

  private allStable(): boolean {
    return this.settled.every(Boolean) && this.stableSince.every(since => since !== undefined && this.data!.time - since >= config.placement.stableTime);
  }

  private advance(): void {
    const data = this.data!;
    this.updateSettled();
    if (this.status === 'error') return;
    let elapsed = data.time - this.phaseStart;
    if (this.motion) this.command = this.motion.sample(elapsed);
    const finished = Boolean(this.motion && elapsed >= this.motion.duration - 1e-9);
    const p = this.current < config.part.count ? this.blockPosition(this.current) : undefined;
    try {
      if (this.phase === 'wait' && this.current < config.part.count) this.startApproach();
      else if (this.phase === 'approach' && finished) this.startDescent();
      else if (this.phase === 'descend' && finished) { this.motion = undefined; this.phaseStart = data.time; }
      else if (this.phase === 'descend' && !this.motion) {
        this.command.position[1] -= config.belt.speed * STEP;
        const site = this.sitePosition();
        if (p && Math.abs(site.z - PICK_CENTRE_Z) < .0015 && Math.hypot(site.x - p.x, site.y - p.y) < .004) {
          this.enter('close'); this.gripLeft = this.gripRight = false; this.gripSince = undefined;
        } else if (elapsed > .8) { this.fail('miss'); return; }
      } else if (this.phase === 'close') {
        this.command.position[1] -= config.belt.speed * STEP;
        if (this.gripSince !== undefined && data.time - this.gripSince >= config.gripper.gripConfirm) this.beginLift();
        else if (elapsed > .7) { this.fail('miss'); return; }
      } else if (this.phase === 'lift' && finished) {
        const target = this.targetPosition(this.current);
        this.beginMotion('carry', { position: [target[0], target[1], .14], velocity: [0, 0, -.16], acceleration: [...ZERO] });
      } else if (this.phase === 'carry' && finished) this.beginMotion('transfer', stationary(this.targetPosition(this.current)));
      else if (this.phase === 'transfer' && finished) { this.motion = undefined; this.releaseStarted = false; this.enter('release'); }
      else if (this.phase === 'release') {
        const target = new THREE.Vector3(...this.targetPosition(this.current));
        if (!this.releaseStarted && this.sitePosition().distanceTo(target) < .0003) this.releaseStarted = true;
        if (this.releaseStarted && !this.padLeft && !this.padRight && data.qpos[6] + data.qpos[7] >= config.part.size + .0002) {
          this.releasedAt[this.current] = data.time;
          this.events.push({ type: 'release', part: this.current, time: data.time, position: this.blockPosition(this.current).toArray() });
          const pos = this.command.position;
          this.beginMotion('rise', { position: [pos[0], pos[1], .115], velocity: [0, 0, .2], acceleration: [...ZERO] });
        } else if (elapsed > 1) { this.fail('drop'); return; }
      } else if (this.phase === 'rise' && finished) {
        this.motion = undefined;
        // Continue vertically until the actual fingers have cleared the wall.
        this.enter('exit');
      } else if (this.phase === 'exit') {
        this.command.position[2] += .2 * STEP;
        // G2 linkage length varies with the measured opening (manufacturer geometry).
        const openingMm = THREE.MathUtils.clamp((data.qpos[6] + data.qpos[7]) * 1000, 0, 84);
        const fingertipFromFlange = (121.606 + Math.sqrt(55 ** 2 - (openingMm / 2 - 8.997) ** 2)) / 1000;
        const clearHeight = config.box.floorThickness + config.box.wallHeight + config.placement.clearance
          + fingertipFromFlange - config.gripper.graspSite + .001;
        if (this.sitePosition().z >= clearHeight) {
          this.current++;
          if (this.current < config.part.count) this.startApproach();
          else {
            const pos = this.command.position;
            this.beginMotion('finish', stationary([pos[0], pos[1], pos[2] + .04]));
          }
        }
      } else if (this.phase === 'finish' && finished) { this.motion = undefined; }
    } catch (error) { console.error('Packing trajectory:', error); this.fail('ik'); return; }

    if (this.current >= config.part.count) {
      if (this.phase === 'finish' && !this.motion && this.allStable()) {
        this.status = 'complete'; this.wantsPlayback = false; this.stopFrames(); this.translate(); return;
      }
    } else if (p && ['lift', 'carry', 'transfer'].includes(this.phase) && (this.sitePosition().distanceTo(p) > .035 || p.z < .04)) { this.fail('drop'); return; }

    const desiredOpening = ['close', 'lift', 'carry', 'transfer'].includes(this.phase) || (this.phase === 'release' && !this.releaseStarted)
      ? config.gripper.closedOpening : this.phase === 'release' || this.phase === 'rise' || this.phase === 'exit'
        ? config.gripper.releaseOpening : config.gripper.pregraspOpening;
    this.opening += THREE.MathUtils.clamp(desiredOpening - this.opening, -config.gripper.speed * STEP, config.gripper.speed * STEP);
    data.ctrl[6] = data.ctrl[7] = this.opening / 2;
    const target = packingJoints(...this.command.position);
    if (!target) { this.fail('ik'); return; }
    data.ctrl.set(target, 0);
    this.engine!.mj_step(this.model!, data);
    this.steps++;
    if (this.steps % 4 === 0) this.inspectContacts();
  }

  private inspectContacts(): void {
    const data = this.data!;
    let left = false, right = false;
    // The bindings return a newly allocated snapshot on each access.
    const contacts = data.contact;
    try {
      for (let i = 0; i < data.ncon; i++) {
        const contact = contacts.get(i);
        if (!contact) continue;
        const a = this.geomNames[contact.geom1] ?? ''; const b = this.geomNames[contact.geom2] ?? '';
        const distance = contact.dist;
        contact.delete();
        const names = [a, b];
        if (distance > 0) continue;
        if (names.includes(`block_${this.current}`)) {
          if (names.includes('pad_left')) left = true;
          if (names.includes('pad_right')) right = true;
        }
        const robot = names.filter(name => /^link\d+_h|^link_base_h|^gripper_base$|^pad_/.test(name));
        if (!robot.length) continue;
        const other = names.find(name => !robot.includes(name));
        if (other === `block_${this.current}` && robot.every(name => name.startsWith('pad_'))) continue;
        if (other === 'ground' && robot.every(name => name.startsWith('link_base_'))) continue;
        const bodies: CollisionBodyId[] = robot.map(name => {
          if (name === 'gripper_base') return 'gripper:base';
          if (name === 'pad_left') return 'gripper:left';
          if (name === 'pad_right') return 'gripper:right';
          return `arm:${name.split('_h')[0]}` as CollisionBodyId;
        });
        this.fail('collision', names, bodies); return;
      }
    } finally {
      contacts.delete();
    }
    this.padLeft = left; this.padRight = right;
    if (this.phase === 'close') {
      this.gripLeft ||= left; this.gripRight ||= right;
      if (left && right) this.gripSince ??= data.time;
      else this.gripSince = undefined;
    }
  }

  private syncVisual(): void {
    if (!this.data || !this.robot || !this.scene) return;
    setJoints(this.robot, Array.from(this.data.qpos.slice(0, 6)));
    const opening = THREE.MathUtils.clamp(Math.round((this.data.qpos[6] + this.data.qpos[7]) * 10000) / 10, 0, 84);
    this.scene.setGripperOpening(opening);
    for (let i = 0; i < config.part.count; i++) {
      const body = this.blockIds[i]; const p = body * 3; const q = body * 4;
      this.cubes[i].position.set(this.data.xpos[p], this.data.xpos[p + 1], this.data.xpos[p + 2]);
      this.cubes[i].quaternion.set(this.data.xquat[q + 1], this.data.xquat[q + 2], this.data.xquat[q + 3], this.data.xquat[q]);
      this.cubes[i].visible = this.data.xpos[p + 1] < .49;
    }
    const offset = (this.data.time * config.belt.speed) % .08;
    this.stripes.forEach((mark, i) => {
      mark.position.y = -.55 + i * .08 - offset;
      mark.visible = mark.position.y > -.577 && mark.position.y < .617;
    });
    this.updateMetrics();
    this.find('#packing-stage').dataset.time = this.data.time.toFixed(2);
    this.find('#packing-stage').dataset.phase = this.phase;
    this.scene.requestRender();
  }
}
