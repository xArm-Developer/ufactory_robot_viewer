import './style.css';
import { MathUtils, Vector3 } from 'three';
import {
  forward,
  fromRPY,
  homeJoints,
  IKSolver,
  jogVelocity,
  jointValues,
  limits,
  setJoints,
  stepBasePose,
  toRPY,
  type CartesianAxis,
  type Pose,
} from './kinematics';
import { DEFAULT_ROBOT_ID, getRobotSpec, ROBOTS, type RobotId, type RobotSpec } from './robots';
import { RobotScene } from './scene';
import type { URDFRobot } from 'urdf-loader';

type Language = 'zh' | 'en';
type ControlTab = 'joint' | 'cartesian';

const LONG_PRESS_MS = 220;

const copy = {
  zh: {
    navControl: '运动控制',
    modelBarLabel: '机械臂型号',
    loading: '正在加载 3D 模型…', ready: '模型已就绪', failed: '模型加载失败。请检查网络连接或刷新页面。',
    webgl: '无法启动 3D 视图。请确认浏览器支持 WebGL，然后刷新页面。', retry: '刷新页面',
    interaction: '拖动旋转 · 滚轮缩放 · 右键平移', interactionMobile: '单指旋转 · 双指缩放 / 平移',
    baseAxes: '基坐标系', tcpAxes: 'TCP 坐标系', resetView: '复位视角',
    telemetryPose: '末端位姿', telemetryJoints: '关节角度',
    panelTitle: '运动控制', panelSub: 'LIVE CONTROL · 实时运动学', controlButton: '运动控制',
    jointTitle: '关节控制', cartesianTitle: '笛卡尔控制', hide: '收起', show: '展开',
    jogTitle: '点动与连续控制', jogHint: '点按步进，长按连续运动（基坐标系 link_base · 固定轴 RPY）。',
    speed: '速度', posStep: '位置步进', rotStep: '姿态步进',
    position: '位置', orientation: '姿态',
    resetPose: '复位姿态', solverReady: '就绪', solverConverged: '目标已求解',
    solverFailed: '无法收敛到目标；已保留上一次有效姿态。', invalid: '请输入有效且在范围内的数值。',
    figure: '探索每一个细节', figureText: '切换机型、旋转视角、调整关节，或通过笛卡尔点动直观了解机械臂的运动方式。',
    specTitle: '为创造而生。', reach: '工作半径', payload: '负载', repeatability: '重复定位精度',
    noteTitle: '关于这个演示',
    noteText: '本页面仅演示运动学，不连接真实设备，也不包含碰撞检测、动力学或末端工具。实际使用请以官方文档和设备配置为准。',
    footer: '独立产品探索项目 · UFACTORY 与 xArm 是其各自所有者的商标',
  },
  en: {
    navControl: 'Motion controls',
    modelBarLabel: 'ROBOT MODEL',
    loading: 'Loading 3D model…', ready: 'Model ready', failed: 'Could not load the model. Check your connection or reload the page.',
    webgl: 'The 3D view could not start. Check WebGL support in your browser and reload the page.', retry: 'Reload page',
    interaction: 'Drag to rotate · Scroll to zoom · Right-drag to pan', interactionMobile: 'One finger to rotate · Two fingers to zoom / pan',
    baseAxes: 'Base frame', tcpAxes: 'TCP frame', resetView: 'Reset view',
    telemetryPose: 'TCP pose', telemetryJoints: 'Joint angles',
    panelTitle: 'Motion controls', panelSub: 'LIVE CONTROL · KINEMATICS', controlButton: 'Motion controls',
    jointTitle: 'Joint control', cartesianTitle: 'Cartesian control', hide: 'Hide', show: 'Show',
    jogTitle: 'Jog & continuous control', jogHint: 'Tap to step, hold for continuous motion (base frame link_base · fixed-axis RPY).',
    speed: 'Speed', posStep: 'Position step', rotStep: 'Attitude step',
    position: 'Position', orientation: 'Orientation',
    resetPose: 'Reset pose', solverReady: 'Ready', solverConverged: 'Target solved',
    solverFailed: 'Could not reach the target; the last valid pose is preserved.', invalid: 'Enter a valid value within the allowed range.',
    figure: 'Explore every detail', figureText: 'Switch models, change the view, move each joint, or jog in Cartesian space to see how the arm moves.',
    specTitle: 'Made to create.', reach: 'Reach', payload: 'Payload', repeatability: 'Repeatability',
    noteTitle: 'About this demo',
    noteText: 'This is a kinematics demonstration. It does not connect to hardware or include collision detection, dynamics, or end tools. Refer to the official documentation and your device configuration for actual use.',
    footer: 'Independent product exploration · UFACTORY and xArm are trademarks of their respective owners',
  },
} as const;
type Key = keyof typeof copy.zh;

const poseCellsHtml = ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw']
  .map((name, i) => `<div class="telemetry-cell"><span>${name}</span><div><output id="fk-${i}">—</output><small>${i < 3 ? 'mm' : '°'}</small></div></div>`)
  .join('');

function buildJointTelemetryHtml(dof: number): string {
  return Array.from({ length: dof }, (_, i) =>
    `<div class="telemetry-cell"><span>J${i + 1}</span><div><output id="stage-joint-${i}">—</output><small>°</small></div></div>`,
  ).join('');
}

const modelTabsHtml = ROBOTS.map(spec =>
  `<button type="button" class="model-tab" role="tab" data-robot-id="${spec.id}" aria-selected="false"><span class="model-tab-name">${spec.name}</span><small data-dof="${spec.dof}">${spec.dof} 轴</small></button>`,
).join('');

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#top" aria-label="UF Robots home"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOTS <small> / STUDIO</small></span></a>
    <nav class="desktop-nav"><a href="#explore" id="nav-explore"></a><a href="#controls" id="nav-controls" data-t="navControl"></a></nav>
    <button class="language" id="language" type="button" aria-label="Switch language"><span class="language-icon">◎</span> <span id="language-label">EN</span></button>
  </header>
  <main id="top">
    <div class="model-bar page-width">
      <span class="model-bar-label" data-t="modelBarLabel"></span>
      <div class="model-switcher" id="model-switcher" role="tablist" aria-label="Robot models">${modelTabsHtml}</div>
    </div>
    <section class="experience page-width" id="explore" aria-label="xArm 6 interactive experience">
      <div class="stage" id="stage">
        <div class="stage-top">
          <div class="stage-title"><span class="stage-overline" id="stage-overline"></span><h1 id="stage-heading">xArm 6</h1></div>
          <div class="stage-telemetry" id="stage-telemetry">
            <div class="telemetry-section">
              <div class="telemetry-head"><span data-t="telemetryPose"></span><small>BASE · mm / °</small></div>
              <div class="telemetry-grid" id="fk-fields" aria-live="off">${poseCellsHtml}</div>
            </div>
            <div class="telemetry-section">
              <div class="telemetry-head"><span data-t="telemetryJoints"></span><small id="telemetry-joints-range">J1–J6 · °</small></div>
              <div class="telemetry-grid" id="stage-joint-fields" aria-live="off">${buildJointTelemetryHtml(6)}</div>
            </div>
          </div>
        </div>
        <div class="canvas-area" id="canvas-area"></div>
        <div class="load-message" id="load-message" role="status"><span class="spinner"></span><span data-t="loading"></span></div>
        <div class="stage-bottom">
          <div class="stage-help"><span class="help-desktop" data-t="interaction"></span><span class="help-mobile" data-t="interactionMobile"></span></div>
          <div class="stage-actions">
            <button class="stage-btn" id="toggle-base-frame" type="button" aria-pressed="false" disabled>
              <span class="axes-icon" aria-hidden="true"><i class="ax-r"></i><i class="ax-g"></i><i class="ax-b"></i></span>
              <span data-t="baseAxes"></span>
            </button>
            <button class="stage-btn" id="toggle-tcp-frame" type="button" aria-pressed="false" disabled>
              <span class="axes-icon" aria-hidden="true"><i class="ax-r"></i><i class="ax-g"></i><i class="ax-b"></i></span>
              <span data-t="tcpAxes"></span>
            </button>
            <button class="stage-btn view-reset" id="view-reset" type="button"><span aria-hidden="true">↺</span> <span data-t="resetView"></span></button>
          </div>
        </div>
        <span class="stage-corner corner-tl"></span><span class="stage-corner corner-br"></span>
      </div>
      <aside class="control-shell" id="controls">
        <button id="control-expand" class="control-expand" type="button" aria-expanded="false" aria-controls="control-card" hidden>
          <span class="orange-dot" aria-hidden="true"></span>
          <span class="control-expand-text" data-t="controlButton"></span>
          <span class="control-expand-plus" aria-hidden="true">+</span>
        </button>
        <section class="control-card" id="control-card" aria-labelledby="control-title">
          <div class="control-head">
            <div><span class="control-kicker" data-t="panelSub"></span><h2 id="control-title" data-t="panelTitle"></h2></div>
            <button id="control-toggle" class="panel-toggle" type="button" aria-expanded="true" aria-controls="control-card"><span data-t="hide"></span> <span aria-hidden="true">−</span></button>
          </div>
          <div class="control-tabs" role="tablist">
            <button id="joint-tab" class="control-tab" role="tab" type="button" aria-selected="false" aria-controls="joint-panel"><span data-t="jointTitle"></span><small>FK</small></button>
            <button id="cartesian-tab" class="control-tab" role="tab" type="button" aria-selected="true" aria-controls="pose-panel"><span data-t="cartesianTitle"></span><small>IK</small></button>
          </div>
          <div id="joint-panel" role="tabpanel" aria-labelledby="joint-tab" hidden>
            <p class="panel-description" id="joint-intro"></p>
            <div class="joint-list" id="joint-list"></div>
          </div>
          <div id="pose-panel" role="tabpanel" aria-labelledby="cartesian-tab">
            <div class="pose-heading first-heading"><div><span class="pose-tag">JOG</span><span data-t="jogTitle"></span></div><span class="coord-badge">BASE</span></div>
            <p class="panel-description cartesian-description" data-t="jogHint"></p>

            <div class="jog-speed-box">
              <div class="jog-speed-top">
                <label for="jog-speed" data-t="speed"></label>
                <output id="jog-speed-readout" for="jog-speed">20% · 50.0 mm/s · 20 °/s</output>
              </div>
              <input id="jog-speed" type="range" min="1" max="100" step="1" value="20" aria-label="Cartesian speed percentage" />
              <div class="range-labels"><span>1% (2.5 mm/s)</span><span>100% (250 mm/s)</span></div>
            </div>

            <div class="jog-steps">
              <label class="step-field"><span data-t="posStep"></span><div><input id="pos-step" type="number" min="0.1" max="100" step="0.1" value="1" aria-label="Position step in millimeters" /><small>mm</small></div></label>
              <label class="step-field"><span data-t="rotStep"></span><div><input id="rot-step" type="number" min="0.1" max="45" step="0.1" value="1" aria-label="Attitude step in degrees" /><small>°</small></div></label>
            </div>

            <div class="jog-group">
              <div class="jog-group-label"><span data-t="position"></span><span>X / Y / Z · mm</span></div>
              <div class="jog-pad-row">
                <div class="dpad-cross">
                  <button type="button" class="jog-btn dpad-up" data-jog-axis="x" data-jog-dir="1" aria-label="X+" disabled>X+</button>
                  <button type="button" class="jog-btn dpad-left" data-jog-axis="y" data-jog-dir="1" aria-label="Y+" disabled>Y+</button>
                  <span class="dpad-center" aria-hidden="true">XY</span>
                  <button type="button" class="jog-btn dpad-right" data-jog-axis="y" data-jog-dir="-1" aria-label="Y-" disabled>Y-</button>
                  <button type="button" class="jog-btn dpad-down" data-jog-axis="x" data-jog-dir="-1" aria-label="X-" disabled>X-</button>
                </div>
                <div class="dpad-vertical">
                  <button type="button" class="jog-btn" data-jog-axis="z" data-jog-dir="1" aria-label="Z+" disabled>Z+</button>
                  <span class="dpad-v-label" aria-hidden="true">Z</span>
                  <button type="button" class="jog-btn" data-jog-axis="z" data-jog-dir="-1" aria-label="Z-" disabled>Z-</button>
                </div>
              </div>
            </div>

            <div class="jog-group jog-group-last">
              <div class="jog-group-label"><span data-t="orientation"></span><span>Roll / Pitch / Yaw · °</span></div>
              <div class="jog-pad-row">
                <div class="dpad-cross">
                  <button type="button" class="jog-btn dpad-up" data-jog-axis="pitch" data-jog-dir="1" aria-label="Pitch+" disabled>Pitch+</button>
                  <button type="button" class="jog-btn dpad-left" data-jog-axis="roll" data-jog-dir="-1" aria-label="Roll-" disabled>Roll-</button>
                  <span class="dpad-center" aria-hidden="true">RP</span>
                  <button type="button" class="jog-btn dpad-right" data-jog-axis="roll" data-jog-dir="1" aria-label="Roll+" disabled>Roll+</button>
                  <button type="button" class="jog-btn dpad-down" data-jog-axis="pitch" data-jog-dir="-1" aria-label="Pitch-" disabled>Pitch-</button>
                </div>
                <div class="dpad-vertical">
                  <button type="button" class="jog-btn" data-jog-axis="yaw" data-jog-dir="1" aria-label="Yaw+" disabled>Yaw+</button>
                  <span class="dpad-v-label" aria-hidden="true">Yaw</span>
                  <button type="button" class="jog-btn" data-jog-axis="yaw" data-jog-dir="-1" aria-label="Yaw-" disabled>Yaw-</button>
                </div>
              </div>
            </div>
          </div>
          <div class="control-foot"><span id="solver-status" class="solver-status" role="status"><span class="status-dot"></span><span id="status-text"></span></span><button id="reset-pose" type="button" disabled><span aria-hidden="true">↺</span> <span data-t="resetPose"></span></button></div>
        </section>
      </aside>
    </section>
    <section class="intro-strip page-width"><div class="section-index">01 <span>/</span> EXPERIENCE</div><h2 data-t="figure"></h2><p data-t="figureText"></p></section>
    <section class="spec-section"><div class="page-width spec-inner"><div class="spec-copy"><div class="eyebrow light-eyebrow"><span class="orange-dot"></span> <span id="spec-eyebrow">XARM 6 / AT A GLANCE</span></div><h2 data-t="specTitle"></h2><p id="spec-description"></p></div>
      <div class="spec-grid"><div><strong id="spec-reach">700 <small>mm</small></strong><span data-t="reach"></span></div><div><strong id="spec-payload">5 <small>kg</small></strong><span data-t="payload"></span></div><div><strong id="spec-repeatability">±0.1 <small>mm</small></strong><span data-t="repeatability"></span></div></div>
      <a class="source-link" id="spec-source-link" href="https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf" target="_blank" rel="noopener noreferrer"><span id="spec-source-text"></span> ↗</a></div></section>
    <section class="about page-width"><span class="section-index">02 <span>/</span> ABOUT</span><div><h2 data-t="noteTitle"></h2><p data-t="noteText"></p></div><a href="https://www.ufactory.cc/" target="_blank" rel="noopener noreferrer">UFACTORY.COM ↗</a></section>
  </main>
  <footer class="page-width"><div class="brand footer-brand"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOTS</span></div><span data-t="footer"></span><span>© 2026</span></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

interface ActiveJog {
  button: HTMLButtonElement;
  pointerId: number;
  axis: CartesianAxis;
  dir: 1 | -1;
  continuous: boolean;
  holdTimer: number;
  rafId: number;
  lastTime: number;
  position: Vector3;
  rpy: [number, number, number];
}

let currentSpec: RobotSpec = getRobotSpec(new URLSearchParams(window.location.search).get('model'));
let language: Language = 'zh';
let statusKey: Key = 'solverReady';
let statusError = false;
let loadKey: Key = 'loading';
let scene: RobotScene | undefined;
let model: URDFRobot | undefined;
let solver: IKSolver | undefined;
let panelOpen = true;
let showBaseFrame = false;
let showTcpFrame = false;
let activeJog: ActiveJog | undefined;

function renderRobotCopy() {
  document.title = `${currentSpec.name} — UF Robots`;
  $('#nav-explore').textContent = language === 'zh' ? `探索 ${currentSpec.name}` : `Explore ${currentSpec.name}`;
  $('#explore').setAttribute('aria-label', `${currentSpec.name} interactive experience`);
  $('#stage-overline').textContent = currentSpec.variantLabel[language];
  $('#stage-heading').textContent = currentSpec.name;
  $('#telemetry-joints-range').textContent = `J1–J${currentSpec.dof} · °`;
  $('#joint-intro').textContent = currentSpec.jointIntro[language];
  $('#spec-eyebrow').textContent = `${currentSpec.name.toUpperCase()} / AT A GLANCE`;
  $('#spec-description').textContent = currentSpec.specDescription[language];
  $('#spec-reach').innerHTML = `${currentSpec.specs.reachMm} <small>mm</small>`;
  $('#spec-payload').innerHTML = `${currentSpec.specs.payload.value} <small>${currentSpec.specs.payload.unit}</small>`;
  $('#spec-repeatability').innerHTML = `${currentSpec.specs.repeatabilityMm} <small>mm</small>`;
  $<HTMLAnchorElement>('#spec-source-link').href = currentSpec.specs.manualUrl;
  $('#spec-source-text').textContent = currentSpec.specs.manualLabel[language];
  document.querySelectorAll<HTMLElement>('#model-switcher small[data-dof]').forEach(badge => {
    const dof = badge.dataset.dof ?? '6';
    badge.textContent = language === 'zh' ? `${dof} 轴` : `${dof} DoF`;
  });
}

function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el => { el.textContent = copy[language][el.dataset.t as Key]; });
  $('#language-label').textContent = language === 'zh' ? 'EN' : '中文';
  $('#language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
  $('#status-text').textContent = copy[language][statusKey];
  const message = document.querySelector<HTMLElement>('#load-message [data-load-text]');
  if (message) message.textContent = copy[language][loadKey];
  renderRobotCopy();
}

function status(key: Key, error = false) {
  statusKey = key; statusError = error;
  $('#status-text').textContent = copy[language][key];
  $('#solver-status').classList.toggle('error', statusError);
}

function setLoadMessage(key: Key) {
  loadKey = key;
  const element = $('#load-message');
  element.hidden = false;
  element.classList.toggle('failure', key !== 'loading');
  element.innerHTML = key === 'loading'
    ? `<span class="spinner"></span><span data-load-text>${copy[language][key]}</span>`
    : `<span data-load-text>${copy[language][key]}</span><button type="button" id="retry" data-t="retry">${copy[language].retry}</button>`;
  if (key !== 'loading') {
    $('#retry').addEventListener('click', () => {
      if (key === 'webgl') location.reload();
      else void loadRobot(currentSpec);
    });
  }
}

function numberValue(el: HTMLInputElement): number {
  return el.value.trim() === '' ? NaN : Number(el.value);
}

function formatValue(value: number): string {
  return (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
}

function currentForward(): Pose {
  if (!model) throw new Error('Model not loaded');
  return forward(model, currentSpec.eeLink);
}

function syncJointFields() {
  if (!model) return;
  const values = jointValues(model);
  values.forEach((radians, i) => {
    const deg = MathUtils.radToDeg(radians);
    const formatted = formatValue(deg);
    $<HTMLInputElement>(`#joint-range-${i}`).value = String(deg);
    $<HTMLInputElement>(`#joint-number-${i}`).value = formatted;
    $(`#stage-joint-${i}`).textContent = formatted;
  });
}

function poseValues(pose: Pose): number[] {
  return [...pose.position.toArray().map(value => value * 1000), ...toRPY(pose.quaternion).map(MathUtils.radToDeg)];
}

function syncFKFields() {
  if (!model) return;
  poseValues(currentForward()).forEach((value, i) => { $(`#fk-${i}`).textContent = formatValue(value); });
}

function syncTelemetry() {
  syncJointFields();
  syncFKFields();
}

function updateSpeedReadout() {
  const raw = numberValue($<HTMLInputElement>('#jog-speed'));
  const percent = Number.isFinite(raw) ? MathUtils.clamp(Math.round(raw), 1, 100) : 20;
  const { linearMmPerSec, angularDegPerSec } = jogVelocity(percent);
  $('#jog-speed-readout').textContent = `${percent}% · ${linearMmPerSec.toFixed(1)} mm/s · ${angularDegPerSec} °/s`;
}

function readStep(axis: CartesianAxis): number | undefined {
  const linear = axis === 'x' || axis === 'y' || axis === 'z';
  const input = $<HTMLInputElement>(linear ? '#pos-step' : '#rot-step');
  const value = numberValue(input);
  const max = linear ? 100 : 45;
  if (!Number.isFinite(value) || value < 0.01 || value > max) {
    status('invalid', true);
    return undefined;
  }
  return value;
}

function solveTarget(pose: Pose) {
  if (!solver) return;
  const result = solver.solve(pose);
  if (result.ok) {
    syncTelemetry();
    status('solverConverged');
  } else {
    status(result.reason === 'invalid' ? 'invalid' : 'solverFailed', true);
  }
}

function executeSingleStep(axis: CartesianAxis, dir: 1 | -1) {
  if (!model) return;
  const step = readStep(axis);
  if (step === undefined) return;
  solveTarget(stepBasePose(currentForward(), axis, dir * step));
}

function startContinuousJog(jog: ActiveJog) {
  if (!model || activeJog !== jog) return;
  jog.continuous = true;
  const startPose = currentForward();
  jog.position = startPose.position.clone();
  jog.rpy = toRPY(startPose.quaternion);
  jog.lastTime = performance.now();
  const initialQuaternion = startPose.quaternion.clone();

  const advance = (dt: number) => {
    if (!model || !solver || dt <= 0) return;
    const rawPercent = numberValue($<HTMLInputElement>('#jog-speed'));
    const { linearMmPerSec, angularDegPerSec } = jogVelocity(Number.isFinite(rawPercent) ? rawPercent : 20);
    const nextPos = jog.position.clone();
    const nextRpy: [number, number, number] = [...jog.rpy];
    let nextPose: Pose;
    if (jog.axis === 'x' || jog.axis === 'y' || jog.axis === 'z') {
      nextPos[jog.axis] += (jog.dir * linearMmPerSec * dt) / 1000;
      nextPose = { position: nextPos, quaternion: initialQuaternion.clone() };
    } else {
      const index = jog.axis === 'roll' ? 0 : jog.axis === 'pitch' ? 1 : 2;
      nextRpy[index] += MathUtils.degToRad(jog.dir * angularDegPerSec * dt);
      nextPose = { position: nextPos, quaternion: fromRPY(...nextRpy) };
    }
    const result = solver.solve(nextPose);
    if (result.ok) {
      jog.position.copy(nextPos);
      jog.rpy = nextRpy;
      syncTelemetry();
      status('solverConverged');
    } else {
      status(result.reason === 'invalid' ? 'invalid' : 'solverFailed', true);
    }
  };

  const tick = () => {
    if (activeJog !== jog) return;
    const now = performance.now();
    const dt = Math.min(Math.max((now - jog.lastTime) / 1000, 0), 0.25);
    jog.lastTime = now;
    advance(dt);
    jog.rafId = requestAnimationFrame(tick);
  };
  advance(1 / 60);
  jog.rafId = requestAnimationFrame(tick);
}

function stopJog(executeTapIfShort = false) {
  if (!activeJog) return;
  const jog = activeJog;
  activeJog = undefined;
  window.clearTimeout(jog.holdTimer);
  if (jog.rafId) cancelAnimationFrame(jog.rafId);
  jog.button.classList.remove('is-jogging');
  if (jog.button.hasPointerCapture?.(jog.pointerId)) {
    try { jog.button.releasePointerCapture(jog.pointerId); } catch { /* ignore released pointer */ }
  }
  if (executeTapIfShort && !jog.continuous) executeSingleStep(jog.axis, jog.dir);
}

function bindJogButtons() {
  document.querySelectorAll<HTMLButtonElement>('.jog-btn').forEach(button => {
    const axis = button.dataset.jogAxis as CartesianAxis;
    const dir = Number(button.dataset.jogDir) as 1 | -1;

    button.addEventListener('pointerdown', event => {
      if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      stopJog(false);
      try { button.setPointerCapture(event.pointerId); } catch { /* synthetic events may omit active pointer */ }
      button.classList.add('is-jogging');
      const current = model ? currentForward() : { position: new Vector3(), quaternion: fromRPY(0, 0, 0) };
      const jog: ActiveJog = {
        button,
        pointerId: event.pointerId,
        axis,
        dir,
        continuous: false,
        holdTimer: 0,
        rafId: 0,
        lastTime: 0,
        position: current.position.clone(),
        rpy: toRPY(current.quaternion),
      };
      activeJog = jog;
      jog.holdTimer = window.setTimeout(() => startContinuousJog(jog), LONG_PRESS_MS);
    });

    button.addEventListener('pointerup', event => {
      if (activeJog?.button === button && activeJog.pointerId === event.pointerId) stopJog(true);
    });
    button.addEventListener('pointercancel', () => {
      if (activeJog?.button === button) stopJog(false);
    });
    button.addEventListener('lostpointercapture', () => {
      if (activeJog?.button === button) stopJog(false);
    });
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.addEventListener('keydown', event => {
      if (button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      if (!event.repeat) {
        stopJog(false);
        executeSingleStep(axis, dir);
      }
    });
  });

  window.addEventListener('blur', () => stopJog(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopJog(false); });
}

function applyControlAvailability(spec: RobotSpec, ready: boolean) {
  const disabledAxes = new Set(spec.disabledJogAxes ?? []);
  document.querySelectorAll<HTMLButtonElement>('#reset-pose, #toggle-base-frame, #toggle-tcp-frame').forEach(button => {
    button.disabled = !ready;
  });
  document.querySelectorAll<HTMLButtonElement>('.jog-btn').forEach(button => {
    const axis = button.dataset.jogAxis as CartesianAxis;
    const axisDisabled = disabledAxes.has(axis);
    button.disabled = !ready || axisDisabled;
    button.classList.toggle('axis-unsupported', axisDisabled);
  });
}

function resetTelemetryPlaceholders(dof: number) {
  $('#stage-joint-fields').innerHTML = buildJointTelemetryHtml(dof);
  for (let i = 0; i < 6; i++) $(`#fk-${i}`).textContent = '—';
}

function setupControls(robot: URDFRobot, spec: RobotSpec) {
  const jointList = $('#joint-list');
  const jointLimits = limits(robot);
  jointList.innerHTML = jointLimits.map((limit, i) => {
    const min = MathUtils.radToDeg(limit.min); const max = MathUtils.radToDeg(limit.max);
    return `<div class="joint-row"><div class="joint-top"><label for="joint-range-${i}"><span class="joint-index">0${i + 1}</span> Joint ${i + 1}</label><div class="joint-value"><input id="joint-number-${i}" type="number" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1} angle" /> <span>°</span></div></div><input id="joint-range-${i}" type="range" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1}" /><div class="range-labels"><span>${Math.ceil(min)}°</span><span>${Math.floor(max)}°</span></div></div>`;
  }).join('');
  jointLimits.forEach((_, i) => {
    const change = (event: Event) => {
      if (!model) return;
      stopJog(false);
      const value = numberValue(event.target as HTMLInputElement);
      const angles = jointValues(model); angles[i] = MathUtils.degToRad(value);
      if (!setJoints(model, angles)) { status('invalid', true); return; }
      syncTelemetry(); status('solverReady');
    };
    $<HTMLInputElement>(`#joint-range-${i}`).addEventListener('input', change);
    $<HTMLInputElement>(`#joint-number-${i}`).addEventListener('change', change);
  });
  applyControlAvailability(spec, true);
  syncTelemetry();
}

function syncModelSwitcherSelection(id: RobotId) {
  document.querySelectorAll<HTMLButtonElement>('#model-switcher .model-tab').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.robotId === id));
  });
}

async function loadRobot(spec: RobotSpec, syncUrl = false) {
  stopJog(false);
  currentSpec = spec;
  model = undefined;
  solver = undefined;
  syncModelSwitcherSelection(spec.id);
  renderRobotCopy();
  resetTelemetryPlaceholders(spec.dof);
  $('#joint-list').innerHTML = '';
  applyControlAvailability(spec, false);

  const stage = $('#stage');
  delete stage.dataset.ready;
  stage.dataset.robot = spec.id;

  if (syncUrl) {
    const url = new URL(window.location.href);
    if (spec.id === DEFAULT_ROBOT_ID) url.searchParams.delete('model');
    else url.searchParams.set('model', spec.id);
    window.history.replaceState(null, '', url);
  }

  if (!scene) return;
  setLoadMessage('loading');
  status('solverReady');

  try {
    const loaded = await scene.load(spec);
    if (!loaded) return; // Superseded by a newer model selection
    model = loaded;
    setJoints(model, homeJoints(spec.dof));
    solver = new IKSolver(model, spec.eeLink);
    setupControls(model, spec);
    $('#load-message').hidden = true;
    status('solverReady');
    stage.dataset.ready = 'true';
  } catch (error) {
    console.error(error);
    if (currentSpec.id === spec.id) setLoadMessage('failed');
  }
}

function setTab(tab: ControlTab) {
  stopJog(false);
  $('#joint-tab').setAttribute('aria-selected', String(tab === 'joint'));
  $('#cartesian-tab').setAttribute('aria-selected', String(tab === 'cartesian'));
  $('#joint-panel').hidden = tab !== 'joint';
  $('#pose-panel').hidden = tab !== 'cartesian';
}

function setPanelOpen(open: boolean) {
  stopJog(false);
  panelOpen = open;
  $('#explore').classList.toggle('controls-collapsed', !open);
  $('#control-card').hidden = !open;
  $('#control-expand').hidden = open;
  $('#control-toggle').setAttribute('aria-expanded', String(open));
  $('#control-expand').setAttribute('aria-expanded', String(open));
}

document.querySelectorAll<HTMLButtonElement>('#model-switcher .model-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const nextSpec = getRobotSpec(tab.dataset.robotId);
    if (nextSpec.id === currentSpec.id && model) return;
    void loadRobot(nextSpec, true);
  });
});

$('#language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; translate(); });
$('#control-toggle').addEventListener('click', () => setPanelOpen(false));
$('#control-expand').addEventListener('click', () => setPanelOpen(true));
$('#nav-controls').addEventListener('click', () => { if (!panelOpen) setPanelOpen(true); });
$('#joint-tab').addEventListener('click', () => setTab('joint'));
$('#cartesian-tab').addEventListener('click', () => setTab('cartesian'));
$('#jog-speed').addEventListener('input', updateSpeedReadout);
$('#view-reset').addEventListener('click', () => scene?.resetView());
$('#toggle-base-frame').addEventListener('click', () => {
  showBaseFrame = !showBaseFrame;
  scene?.setBaseFrameVisible(showBaseFrame);
  $('#toggle-base-frame').setAttribute('aria-pressed', String(showBaseFrame));
});
$('#toggle-tcp-frame').addEventListener('click', () => {
  showTcpFrame = !showTcpFrame;
  scene?.setTcpFrameVisible(showTcpFrame);
  $('#toggle-tcp-frame').setAttribute('aria-pressed', String(showTcpFrame));
});
$('#reset-pose').addEventListener('click', () => {
  if (!model) return;
  stopJog(false); setJoints(model, homeJoints(currentSpec.dof)); syncTelemetry(); status('solverReady');
});

bindJogButtons();
updateSpeedReadout();
syncModelSwitcherSelection(currentSpec.id);
translate();
setLoadMessage('loading');

function sceneCanvas(): HTMLCanvasElement { return $<HTMLCanvasElement>('#canvas-area canvas'); }

async function start() {
  try {
    scene = new RobotScene($('#canvas-area'));
    sceneCanvas().addEventListener('webglcontextlost', event => { event.preventDefault(); setLoadMessage('webgl'); });
  }
  catch (error) { console.error(error); setLoadMessage('webgl'); return; }
  await loadRobot(currentSpec, false);
}
void start();
