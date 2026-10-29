import './style.css';
import { MathUtils, Vector3 } from 'three';
import { forward, fromRPY, HOME, IKSolver, jointValues, limits, setJoints, toRPY, type Pose } from './kinematics';
import { RobotScene, type TransformMode } from './scene';
import type { URDFRobot } from 'urdf-loader';

type Language = 'zh' | 'en';
const copy = {
  zh: {
    navExplore: '探索 xArm 6', navControl: '运动控制', eyebrow: 'UFACTORY · 六轴协作机械臂',
    heroTitle: '让想象，<br>动起来。', heroText: '从每一个角度，探索 xArm 6 的结构与运动。一个属于创造者的机械臂，现已触手可及。',
    explore: '开始探索', heroIndex: '产品探索 / 001', stageLabel: '交互式 3D 模型',
    loading: '正在加载 3D 模型…', ready: '模型已就绪', failed: '模型加载失败。请检查网络连接或刷新页面。',
    webgl: '无法启动 3D 视图。请确认浏览器支持 WebGL，然后刷新页面。', retry: '刷新页面',
    interaction: '拖动旋转 · 滚轮缩放 · 右键平移', interactionMobile: '单指旋转 · 双指缩放 / 平移',
    resetView: '复位视角', modelVariant: '1305 版本 · 交互式模型', modelHint: '探索结构与运动',
    panelLabel: '运动控制', panelSub: '实时运动学演示', hide: '收起', show: '展开',
    jointTab: '关节角度', poseTab: '末端位姿', jointIntro: '拖动滑杆或输入角度，观察六个关节的运动。',
    poseIntro: '输入目标位姿，或在模型上拖动坐标轴。', position: '位置', orientation: '姿态',
    baseFrame: '相对于 link_base · 末端 link_eef', rpyHint: '固定轴 RPY：Rz(yaw) × Ry(pitch) × Rx(roll)',
    apply: '应用目标', translate: '平移目标', rotate: '旋转目标', off: '关闭手柄',
    resetPose: '复位姿态', solverReady: '就绪', solverConverged: '目标已求解',
    solverFailed: '无法收敛到目标；已保留上一次有效姿态。', invalid: '请输入有效且在范围内的数值。',
    values: '角度', figure: '探索每一个细节', figureText: '旋转视角、调整关节，或设定末端目标，直观了解机械臂的运动方式。',
    specTitle: '为创造而生。', specText: '六个自由度，让运动的可能性延伸至三维空间。', reach: '工作半径', payload: '负载', repeatability: '重复定位精度',
    specSource: '参数来源：UFACTORY xArm 用户手册', noteTitle: '关于这个演示',
    noteText: '本页面仅演示运动学，不连接真实设备，也不包含碰撞检测、动力学或末端工具。实际使用请以官方文档和设备配置为准。',
    footer: '独立产品探索项目 · xArm 是 UFACTORY 的商标', angle: '角度',
  },
  en: {
    navExplore: 'Explore xArm 6', navControl: 'Motion controls', eyebrow: 'UFACTORY · 6-AXIS COLLABORATIVE ROBOT',
    heroTitle: 'Make ideas<br>move.', heroText: 'Explore the form and motion of xArm 6 from every angle. A robot arm for creators, now at your fingertips.',
    explore: 'Explore the arm', heroIndex: 'PRODUCT EXPLORATION / 001', stageLabel: 'Interactive 3D model',
    loading: 'Loading 3D model…', ready: 'Model ready', failed: 'Could not load the model. Check your connection or reload the page.',
    webgl: 'The 3D view could not start. Check WebGL support in your browser and reload the page.', retry: 'Reload page',
    interaction: 'Drag to rotate · Scroll to zoom · Right-drag to pan', interactionMobile: 'One finger to rotate · Two fingers to zoom / pan',
    resetView: 'Reset view', modelVariant: '1305 VARIANT · INTERACTIVE MODEL', modelHint: 'Explore form and motion',
    panelLabel: 'Motion controls', panelSub: 'LIVE KINEMATICS DEMO', hide: 'Hide', show: 'Show',
    jointTab: 'Joint angles', poseTab: 'End pose', jointIntro: 'Move a slider or enter an angle to explore all six joints.',
    poseIntro: 'Enter a target pose or drag the axes on the model.', position: 'Position', orientation: 'Orientation',
    baseFrame: 'Relative to link_base · end frame link_eef', rpyHint: 'Fixed-axis RPY: Rz(yaw) × Ry(pitch) × Rx(roll)',
    apply: 'Apply target', translate: 'Move target', rotate: 'Rotate target', off: 'Hide handles',
    resetPose: 'Reset pose', solverReady: 'Ready', solverConverged: 'Target solved',
    solverFailed: 'Could not reach the target; the last valid pose is preserved.', invalid: 'Enter a valid value within the allowed range.',
    values: 'Angle', figure: 'Explore every detail', figureText: 'Change the view, move each joint, or set an end target to see how the arm moves.',
    specTitle: 'Made to create.', specText: 'Six degrees of freedom open up possibilities in three-dimensional space.', reach: 'Reach', payload: 'Payload', repeatability: 'Repeatability',
    specSource: 'Source: UFACTORY xArm user manual', noteTitle: 'About this demo',
    noteText: 'This is a kinematics demonstration. It does not connect to hardware or include collision detection, dynamics, or end tools. Refer to the official documentation and your device configuration for actual use.',
    footer: 'Independent product exploration · xArm is a trademark of UFACTORY', angle: 'Angle',
  },
} as const;
type Key = keyof typeof copy.zh;

const app = document.querySelector<HTMLDivElement>('#app')!;
const arrow = '<span aria-hidden="true">↗</span>';
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#top" aria-label="UF Robots home"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOTS <small> / STUDIO</small></span></a>
    <nav class="desktop-nav"><a href="#explore" data-t="navExplore"></a><a href="#controls" data-t="navControl"></a></nav>
    <button class="language" id="language" type="button" aria-label="Switch language"><span class="language-icon">◎</span> <span id="language-label">EN</span></button>
  </header>
  <main id="top">
    <section class="hero page-width">
      <div class="hero-copy"><div class="eyebrow"><span class="orange-dot"></span><span data-t="eyebrow"></span></div>
        <h1 data-html="heroTitle"></h1><p data-t="heroText"></p>
        <a class="primary-link" href="#explore"><span data-t="explore"></span>${arrow}</a>
      </div>
      <div class="hero-aside"><span data-t="heroIndex"></span><span class="hero-line"></span><span>01 / 03</span></div>
    </section>
    <section class="experience page-width" id="explore" aria-label="xArm 6 interactive experience">
      <div class="stage" id="stage">
        <div class="stage-top"><div><span class="stage-overline" data-t="modelVariant"></span><strong>xArm 6</strong></div><span class="stage-counter">01 — 06</span></div>
        <div class="canvas-area" id="canvas-area"></div>
        <div class="load-message" id="load-message" role="status"><span class="spinner"></span><span data-t="loading"></span></div>
        <div class="stage-bottom"><div class="stage-help"><span class="help-desktop" data-t="interaction"></span><span class="help-mobile" data-t="interactionMobile"></span></div>
          <button class="view-reset" id="view-reset" type="button"><span aria-hidden="true">↺</span> <span data-t="resetView"></span></button></div>
        <span class="stage-corner corner-tl"></span><span class="stage-corner corner-br"></span>
      </div>
      <aside class="control-card" id="controls">
        <div class="control-head"><div><span class="control-kicker" data-t="panelSub"></span><h2 data-t="panelLabel"></h2></div><button id="panel-toggle" class="panel-toggle" type="button" aria-expanded="true"><span data-t="hide"></span><span aria-hidden="true"> −</span></button></div>
        <div id="panel-content">
          <div class="tabs" role="tablist"><button id="joint-tab" role="tab" aria-selected="true" aria-controls="joint-panel" data-t="jointTab"></button><button id="pose-tab" role="tab" aria-selected="false" aria-controls="pose-panel" data-t="poseTab"></button></div>
          <div id="joint-panel" role="tabpanel" aria-labelledby="joint-tab"><p class="panel-description" data-t="jointIntro"></p><div class="joint-list" id="joint-list"></div></div>
          <div id="pose-panel" role="tabpanel" aria-labelledby="pose-tab" hidden><p class="panel-description" data-t="poseIntro"></p>
            <div class="field-title"><span data-t="position"></span><span>mm</span></div><div class="pose-grid" id="position-fields"></div>
            <div class="field-title"><span data-t="orientation"></span><span>°</span></div><div class="pose-grid" id="rotation-fields"></div>
            <p class="frame-note" data-t="baseFrame"></p><p class="frame-note" data-t="rpyHint"></p>
            <button id="apply-target" class="apply-button" type="button" data-t="apply" disabled></button>
            <div class="gizmo-buttons"><button data-mode="translate" type="button" data-t="translate" aria-pressed="false" disabled></button><button data-mode="rotate" type="button" data-t="rotate" aria-pressed="false" disabled></button><button data-mode="off" type="button" data-t="off" aria-pressed="true" disabled></button></div>
          </div>
          <div class="control-foot"><span id="solver-status" class="solver-status" role="status"><span class="status-dot"></span><span id="status-text"></span></span><button id="reset-pose" type="button" disabled><span aria-hidden="true">↺</span> <span data-t="resetPose"></span></button></div>
        </div>
      </aside>
    </section>
    <section class="intro-strip page-width"><div class="section-index">01 <span>/</span> EXPERIENCE</div><h2 data-t="figure"></h2><p data-t="figureText"></p></section>
    <section class="spec-section"><div class="page-width spec-inner"><div class="spec-copy"><div class="eyebrow light-eyebrow"><span class="orange-dot"></span> XARM 6 / AT A GLANCE</div><h2 data-t="specTitle"></h2><p data-t="specText"></p></div>
      <div class="spec-grid"><div><strong>700 <small>mm</small></strong><span data-t="reach"></span></div><div><strong>5 <small>kg</small></strong><span data-t="payload"></span></div><div><strong>±0.1 <small>mm</small></strong><span data-t="repeatability"></span></div></div>
      <a class="source-link" href="https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf" target="_blank" rel="noopener noreferrer"><span data-t="specSource"></span> ↗</a></div></section>
    <section class="about page-width"><span class="section-index">02 <span>/</span> ABOUT</span><div><h2 data-t="noteTitle"></h2><p data-t="noteText"></p></div><a href="https://www.ufactory.cc/" target="_blank" rel="noopener noreferrer">UFACTORY.COM ↗</a></section>
  </main>
  <footer class="page-width"><div class="brand footer-brand"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOTS</span></div><span data-t="footer"></span><span>© 2026</span></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};
let language: Language = 'zh';
let statusKey: Key = 'solverReady';
let statusError = false;
let loadKey: Key = 'loading';
let scene: RobotScene | undefined;
let model: URDFRobot | undefined;
let solver: IKSolver | undefined;
let pendingDrag: Pose | undefined;
let dragFrame = 0;
let panelOpen = true;

function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el => { el.textContent = copy[language][el.dataset.t as Key]; });
  document.querySelectorAll<HTMLElement>('[data-html]').forEach(el => { el.innerHTML = copy[language][el.dataset.html as Key]; });
  $('#language-label').textContent = language === 'zh' ? 'EN' : '中文';
  $('#language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
  $('#panel-toggle').innerHTML = `${copy[language][panelOpen ? 'hide' : 'show']} <span aria-hidden="true">${panelOpen ? '−' : '+'}</span>`;
  $('#status-text').textContent = copy[language][statusKey];
  const message = document.querySelector<HTMLElement>('#load-message [data-load-text]');
  if (message) message.textContent = copy[language][loadKey];
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
  element.innerHTML = key === 'loading' ? `<span class="spinner"></span><span data-load-text>${copy[language][key]}</span>` : `<span data-load-text>${copy[language][key]}</span><button type="button" id="retry" data-t="retry">${copy[language].retry}</button>`;
  if (key !== 'loading') $('#retry').addEventListener('click', () => location.reload());
}
function numberValue(el: HTMLInputElement): number {
  return el.value.trim() === '' ? NaN : Number(el.value);
}
function syncJointFields() {
  if (!model) return;
  const values = jointValues(model);
  values.forEach((radians, i) => {
    const deg = MathUtils.radToDeg(radians);
    $<HTMLInputElement>(`#joint-range-${i}`).value = String(deg);
    $<HTMLInputElement>(`#joint-number-${i}`).value = deg.toFixed(2);
  });
}
function syncPoseFields(pose?: Pose) {
  if (!model) return;
  const actual = pose ?? forward(model);
  const values = [...actual.position.toArray().map(value => value * 1000), ...toRPY(actual.quaternion).map(MathUtils.radToDeg)];
  values.forEach((value, i) => { $<HTMLInputElement>(`#pose-${i}`).value = (Math.abs(value) < 0.0005 ? 0 : value).toFixed(2); });
}
function setupControls(robot: URDFRobot) {
  const jointList = $('#joint-list');
  const jointLimits = limits(robot);
  jointList.innerHTML = jointLimits.map((limit, i) => {
    const min = MathUtils.radToDeg(limit.min); const max = MathUtils.radToDeg(limit.max);
    return `<div class="joint-row"><div class="joint-top"><label for="joint-range-${i}"><span class="joint-index">0${i + 1}</span> Joint ${i + 1}</label><div class="joint-value"><input id="joint-number-${i}" type="number" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1} angle" /> <span>°</span></div></div><input id="joint-range-${i}" type="range" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1}" /><div class="range-labels"><span>${Math.ceil(min)}°</span><span>${Math.floor(max)}°</span></div></div>`;
  }).join('');
  $('#position-fields').innerHTML = ['X', 'Y', 'Z'].map((name, i) => `<label><span>${name}</span><input type="number" step="0.1" id="pose-${i}" aria-label="${name} position in millimeters" /></label>`).join('');
  $('#rotation-fields').innerHTML = ['Roll', 'Pitch', 'Yaw'].map((name, i) => `<label><span>${name}</span><input type="number" step="0.1" id="pose-${i + 3}" aria-label="${name} in degrees" /></label>`).join('');
  jointLimits.forEach((_, i) => {
    const change = (event: Event) => {
      if (!model || !scene) return;
      const value = numberValue(event.target as HTMLInputElement);
      const angles = jointValues(model); angles[i] = MathUtils.degToRad(value);
      if (!setJoints(model, angles)) { status('invalid', true); return; }
      syncJointFields(); syncPoseFields(); scene.syncTarget(); status('solverReady');
    };
    $<HTMLInputElement>(`#joint-range-${i}`).addEventListener('input', change);
    $<HTMLInputElement>(`#joint-number-${i}`).addEventListener('change', change);
  });
  document.querySelectorAll<HTMLButtonElement>('#apply-target, #reset-pose, [data-mode]').forEach(button => { button.disabled = false; });
  syncJointFields(); syncPoseFields();
}
function solveTarget(pose: Pose, updateTarget: boolean) {
  if (!solver || !scene) return;
  if (updateTarget) scene.setTarget(pose);
  const result = solver.solve(pose);
  if (result.ok) {
    syncJointFields();
    if (updateTarget) { scene.syncTarget(); syncPoseFields(); }
    else syncPoseFields(pose);
    status('solverConverged');
  } else status(result.reason === 'invalid' ? 'invalid' : 'solverFailed', true);
}
function applyPoseFields() {
  const values = Array.from({ length: 6 }, (_, i) => numberValue($<HTMLInputElement>(`#pose-${i}`)));
  if (!values.every(Number.isFinite)) { status('invalid', true); return; }
  solveTarget({ position: new Vector3(values[0] / 1000, values[1] / 1000, values[2] / 1000), quaternion: fromRPY(...values.slice(3).map(MathUtils.degToRad) as [number, number, number]) }, true);
}
function chooseTab(name: 'joint' | 'pose') {
  for (const tab of ['joint', 'pose'] as const) {
    $(`#${tab}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`#${tab}-panel`).hidden = tab !== name;
  }
  if (name === 'joint') setMode('off');
}
function setMode(mode: TransformMode) {
  scene?.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
}
$('#language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; translate(); });
$('#joint-tab').addEventListener('click', () => chooseTab('joint'));
$('#pose-tab').addEventListener('click', () => chooseTab('pose'));
$('#panel-toggle').addEventListener('click', () => {
  panelOpen = !panelOpen; $('#panel-content').hidden = !panelOpen;
  $('#panel-toggle').setAttribute('aria-expanded', String(panelOpen));
  if (!panelOpen) setMode('off');
  translate();
});
$('#view-reset').addEventListener('click', () => scene?.resetView());
$('#apply-target').addEventListener('click', applyPoseFields);
$('#pose-panel').addEventListener('change', event => { if ((event.target as HTMLElement).matches('input')) applyPoseFields(); });
$('#reset-pose').addEventListener('click', () => {
  if (!model || !scene) return;
  setJoints(model, HOME); syncJointFields(); syncPoseFields(); scene.syncTarget(); status('solverReady');
});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode as TransformMode)));
translate();
setLoadMessage('loading');

function sceneCanvas(): HTMLCanvasElement { return $<HTMLCanvasElement>('#canvas-area canvas'); }

async function start() {
  try {
    scene = new RobotScene($('#canvas-area'));
    sceneCanvas().addEventListener('webglcontextlost', event => { event.preventDefault(); setLoadMessage('webgl'); });
  }
  catch (error) { console.error(error); setLoadMessage('webgl'); return; }
  try {
    model = await scene.load();
    setJoints(model, HOME);
    solver = new IKSolver(model);
    scene.syncTarget();
    scene.onTargetChange = pose => {
      pendingDrag = pose;
      if (!dragFrame) dragFrame = requestAnimationFrame(() => {
        dragFrame = 0;
        if (pendingDrag) solveTarget(pendingDrag, false);
      });
    };
    setupControls(model);
    $('#load-message').hidden = true;
    status('solverReady');
    $('#stage').dataset.ready = 'true';
  } catch (error) { console.error(error); setLoadMessage('failed'); }
}
void start();
