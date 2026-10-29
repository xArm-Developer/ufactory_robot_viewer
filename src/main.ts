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
import { DEFAULT_ROBOT_ID, getRobotSpec, ROBOTS, type RobotSpec } from './robots';
import { getGripper, GRIPPERS, supportsGripper, toolOffset, validOpening, type GripperSpec } from './grippers';
import { renderAssetInventory, type SceneAsset } from './assets';
import { RobotScene } from './scene';
import type { URDFRobot } from 'urdf-loader';

type Language = 'zh' | 'en';
type ControlTab = 'joint' | 'cartesian';

const LONG_PRESS_MS = 220;

const copy = {
  zh: {
    navControl: '运动控制',
    modelBarLabel: '机械臂', standaloneBadge: '夹爪',
    loading: '正在加载 3D 模型…', ready: '模型已就绪', failed: '模型加载失败。请检查网络连接或刷新页面。',
    webgl: '无法启动 3D 视图。请确认浏览器支持 WebGL，然后刷新页面。', retry: '刷新页面',
    interaction: '拖动旋转 · 滚轮缩放 · 右键平移', interactionMobile: '单指旋转 · 双指缩放 / 平移',
    baseAxes: '基坐标系', tcpAxes: 'TCP 坐标系', resetView: '复位视角',
    telemetryPose: 'TCP 位姿', telemetryJoints: '关节角度',
    panelTitle: '运动控制', panelSub: 'LIVE CONTROL · 实时运动学', controlButton: '运动控制',
    jointTitle: '关节控制', cartesianTitle: '笛卡尔控制', hide: '收起',
    jogTitle: '点动与连续控制', jogHint: '点按步进，长按连续运动（基坐标系 link_base · 固定轴 RPY）。',
    speed: '速度', posStep: '位置步进', rotStep: '姿态步进',
    position: '位置', orientation: '姿态',
    resetPose: '复位姿态', solverReady: '就绪', solverConverged: '目标已求解',
    solverFailed: '无法收敛到目标；已保留上一次有效姿态。', invalid: '请输入有效且在范围内的数值。',
    toolLabel: '末端工具', noTool: '无', liteUnavailable: 'Lite 6 暂不支持装配 Gripper G2 或 BIO Gripper G2。',
    standaloneSelect: '独立查看中', standaloneHint: '正在独立查看夹爪。选择机械臂或末端工具可返回装配。',
    standaloneTitle: '末端工具', standaloneIntro: '独立查看夹爪', returnAssembly: '返回装配',
    gripperTitle: '夹爪控制', gripperIntro: '调整两指夹持面的开口间距。', opening: '开口间距',
    inventoryTitle: '当前场景资产', inventoryHint: '查看当前产品的 UFACTORY 官方介绍。',
    official: '官网介绍',
    footer: '独立产品探索项目 · UFACTORY 与 xArm 是其各自所有者的商标',
  },
  en: {
    navControl: 'Motion controls',
    modelBarLabel: 'Robot arm', standaloneBadge: 'GRIPPER',
    loading: 'Loading 3D model…', ready: 'Model ready', failed: 'Could not load the model. Check your connection or reload the page.',
    webgl: 'The 3D view could not start. Check WebGL support in your browser and reload the page.', retry: 'Reload page',
    interaction: 'Drag to rotate · Scroll to zoom · Right-drag to pan', interactionMobile: 'One finger to rotate · Two fingers to zoom / pan',
    baseAxes: 'Base frame', tcpAxes: 'TCP frame', resetView: 'Reset view',
    telemetryPose: 'TCP pose', telemetryJoints: 'Joint angles',
    panelTitle: 'Motion controls', panelSub: 'LIVE CONTROL · KINEMATICS', controlButton: 'Motion controls',
    jointTitle: 'Joint control', cartesianTitle: 'Cartesian control', hide: 'Hide',
    jogTitle: 'Jog & continuous control', jogHint: 'Tap to step, hold for continuous motion (base frame link_base · fixed-axis RPY).',
    speed: 'Speed', posStep: 'Position step', rotStep: 'Attitude step',
    position: 'Position', orientation: 'Orientation',
    resetPose: 'Reset pose', solverReady: 'Ready', solverConverged: 'Target solved',
    solverFailed: 'Could not reach the target; the last valid pose is preserved.', invalid: 'Enter a valid value within the allowed range.',
    toolLabel: 'End effector', noTool: 'None', liteUnavailable: 'Gripper G2 and BIO Gripper G2 cannot be mounted on Lite 6.',
    standaloneSelect: 'Standalone view', standaloneHint: 'Viewing a gripper on its own. Select an arm or end effector to return to the assembly.',
    standaloneTitle: 'End effectors', standaloneIntro: 'View grippers individually', returnAssembly: 'Return to assembly',
    gripperTitle: 'Gripper control', gripperIntro: 'Adjust the gap between the gripping surfaces.', opening: 'Opening',
    inventoryTitle: 'Assets in this scene', inventoryHint: 'Explore the current products on the UFACTORY website.',
    official: 'Official product page',
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

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#top" aria-label="UF Robots home"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOTS <small> / STUDIO</small></span></a>
    <nav class="desktop-nav"><a href="#explore" id="nav-explore"></a><a href="#controls" id="nav-controls" data-t="navControl"></a></nav>
    <button class="language" id="language" type="button" aria-label="Switch language"><span class="language-icon">◎</span> <span id="language-label">EN</span></button>
  </header>
  <main id="top">
    <div class="selection-bar page-width">
      <div class="selection-field">
        <label for="robot-select" data-t="modelBarLabel"></label>
        <select id="robot-select">
          <option value="standalone" data-t="standaloneSelect" disabled hidden></option>
          ${ROBOTS.map(spec => `<option value="${spec.id}">${spec.name}</option>`).join('')}
        </select>
      </div>
      <div class="selection-field">
        <label for="gripper-select" data-t="toolLabel"></label>
        <select id="gripper-select">
          <option value="standalone" data-t="standaloneSelect" disabled hidden></option>
          <option value="" data-t="noTool"></option>
          ${GRIPPERS.map(spec => `<option value="${spec.id}">${spec.name}</option>`).join('')}
        </select>
        <small id="lite-unavailable" data-t="liteUnavailable" hidden></small>
      </div>
      <p id="standalone-hint" class="selection-hint" data-t="standaloneHint" hidden></p>
    </div>
    <section class="experience page-width" id="explore" aria-label="xArm 6 interactive experience">
      <div class="stage" id="stage">
        <div class="stage-top">
          <div class="stage-title"><span class="stage-overline" id="stage-overline"></span><h1 id="stage-heading">xArm 6</h1><div class="stage-product-links" id="stage-product-links"></div></div>
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
          <section class="standalone-tools" aria-labelledby="standalone-title">
            <h3 id="standalone-title" data-t="standaloneTitle"></h3>
            <p data-t="standaloneIntro"></p>
            <div class="standalone-buttons">${GRIPPERS.map(spec => `<button type="button" data-gripper-view="${spec.id}" aria-pressed="false">${spec.name}</button>`).join('')}</div>
            <button class="return-assembly" id="return-assembly" type="button" data-t="returnAssembly" hidden></button>
          </section>
          <section class="gripper-control" id="gripper-control" hidden>
            <div class="gripper-heading"><strong data-t="gripperTitle"></strong><span id="gripper-name"></span></div>
            <p data-t="gripperIntro"></p>
            <div class="gripper-inputs"><label for="opening-number" data-t="opening"></label><div class="joint-value"><input id="opening-number" type="number" step="0.1" /><span>mm</span></div></div>
            <input id="opening-range" type="range" step="0.1" aria-label="Gripper opening" />
            <div class="range-labels"><span id="opening-min"></span><span id="opening-max"></span></div>
          </section>
          <div id="arm-controls">
          <div class="control-tabs" role="tablist">
            <button id="joint-tab" class="control-tab" role="tab" type="button" aria-selected="false" aria-controls="joint-panel"><span data-t="jointTitle"></span></button>
            <button id="cartesian-tab" class="control-tab" role="tab" type="button" aria-selected="true" aria-controls="pose-panel"><span data-t="cartesianTitle"></span></button>
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
          </div>
          <div class="control-foot"><span id="solver-status" class="solver-status" role="status"><span class="status-dot"></span><span id="status-text"></span></span><button id="reset-pose" type="button" disabled><span aria-hidden="true">↺</span> <span data-t="resetPose"></span></button></div>
        </section>
      </aside>
    </section>
    <section class="inventory-section" id="assets" aria-labelledby="inventory-title"><div class="page-width inventory-inner"><div><span class="section-index">01 <span>/</span> ASSETS</span><h2 id="inventory-title" data-t="inventoryTitle"></h2><p data-t="inventoryHint"></p></div><div class="asset-list" id="asset-list" role="status" aria-live="polite" aria-atomic="true"></div></div></section>
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

const initialParams = new URLSearchParams(window.location.search);
const initialStandalone = getGripper(initialParams.get('model'));
const initialRobot: RobotSpec = getRobotSpec(initialParams.get('model'));
const initialGripper = initialStandalone ?? (supportsGripper(initialRobot.id) ? getGripper(initialParams.get('gripper')) : undefined);
const initialOpening = initialParams.get('opening');
const parsedOpening = initialGripper && initialOpening !== null && initialOpening.trim() !== '' && validOpening(initialGripper, Number(initialOpening))
  ? Number(initialOpening) : initialGripper?.maxMm ?? 0;
// The assembly remains intact while a separate standalone gripper is being viewed.
const assembly: { spec: RobotSpec; gripper: GripperSpec | undefined; opening: number } = {
  spec: initialRobot,
  gripper: initialStandalone ? undefined : initialGripper,
  opening: initialStandalone ? 0 : parsedOpening,
};
let standaloneSelection: { gripper: GripperSpec; opening: number } | undefined = initialStandalone
  ? { gripper: initialStandalone, opening: parsedOpening } : undefined;
const activeSelection = () => standaloneSelection ?? assembly;
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
let selectionToken = 0;
let sceneReady = false;

function syncOpeningFields() {
  const { gripper, opening } = activeSelection();
  if (!gripper) return;
  $('#gripper-name').textContent = gripper.name;
  for (const selector of ['#opening-number', '#opening-range']) {
    const input = $<HTMLInputElement>(selector);
    input.min = String(gripper.minMm); input.max = String(gripper.maxMm);
    input.value = opening.toFixed(1); input.disabled = !sceneReady;
  }
  $('#opening-range').setAttribute('aria-label', copy[language].opening);
  $('#opening-min').textContent = `${gripper.minMm} mm`;
  $('#opening-max').textContent = `${gripper.maxMm} mm`;
}

function renderSceneCopy() {
  const currentSpec = assembly.spec;
  const standalone = Boolean(standaloneSelection);
  const { gripper } = activeSelection();
  const productName = standaloneSelection?.gripper.name ?? currentSpec.name;
  document.title = `${productName} — UF Robots`;
  $('#nav-explore').textContent = language === 'zh' ? `探索 ${productName}` : `Explore ${productName}`;
  $('#explore').setAttribute('aria-label', `${productName} interactive experience`);
  $('#stage-overline').textContent = standalone ? copy[language].standaloneBadge : currentSpec.variantLabel[language];
  $('#stage-heading').textContent = productName;
  $('#telemetry-joints-range').textContent = `J1–J${currentSpec.dof} · °`;
  $('#joint-intro').textContent = currentSpec.jointIntro[language];
  $('#control-title').textContent = standalone ? copy[language].gripperTitle : copy[language].panelTitle;
  $('#stage-telemetry').hidden = standalone;
  $('#toggle-base-frame').hidden = standalone;
  $('#toggle-tcp-frame').hidden = standalone;
  $('#reset-pose').hidden = standalone;
  $('#arm-controls').hidden = standalone;
  $('#gripper-control').hidden = !gripper;
  const supported = supportsGripper(currentSpec.id);
  $('#lite-unavailable').hidden = supported;
  $('#standalone-hint').hidden = !standalone;
  $('#return-assembly').hidden = !standalone;
  const robotSelect = $<HTMLSelectElement>('#robot-select');
  robotSelect.value = standalone ? 'standalone' : currentSpec.id;
  if (standalone) robotSelect.setAttribute('aria-describedby', 'standalone-hint');
  else robotSelect.removeAttribute('aria-describedby');
  const gripperSelect = $<HTMLSelectElement>('#gripper-select');
  gripperSelect.disabled = !supported && !standalone;
  const descriptions = [standalone ? 'standalone-hint' : '', !supported ? 'lite-unavailable' : ''].filter(Boolean);
  if (descriptions.length) gripperSelect.setAttribute('aria-describedby', descriptions.join(' '));
  else gripperSelect.removeAttribute('aria-describedby');
  gripperSelect.querySelectorAll<HTMLOptionElement>('option').forEach(option => {
    if (getGripper(option.value)) option.disabled = !supported;
  });
  gripperSelect.value = standalone ? 'standalone' : gripper?.id ?? '';
  syncOpeningFields();
  const assets = [
    ...(!standalone ? [{ name: currentSpec.name, productUrl: currentSpec.productUrl, category: 'robot' as const }] : []),
    ...(gripper ? [{ name: gripper.name, productUrl: gripper.productUrl, category: 'accessory' as const }] : []),
  ] satisfies SceneAsset[];
  $('#stage-product-links').innerHTML = sceneReady ? assets.map(asset => `<a href="${asset.productUrl}" target="_blank" rel="noopener noreferrer" aria-label="${asset.name} — ${copy[language].official}">${asset.name} ↗</a>`).join('') : '';
  const inventoryState = sceneReady ? { status: 'ready' as const, assets } : { status: loadKey === 'webgl' ? 'webgl' as const : loadKey === 'failed' ? 'failed' as const : 'loading' as const };
  renderAssetInventory($('#asset-list'), inventoryState, language);
  document.querySelectorAll<HTMLButtonElement>('[data-gripper-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(standalone && button.dataset.gripperView === gripper?.id));
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
  renderSceneCopy();
}

function status(key: Key, error = false) {
  statusKey = key; statusError = error;
  $('#status-text').textContent = copy[language][key];
  $('#solver-status').classList.toggle('error', statusError);
}

function setLoadMessage(key: Key) {
  loadKey = key;
  renderSceneCopy();
  const element = $('#load-message');
  element.hidden = false;
  element.classList.toggle('failure', key !== 'loading');
  element.innerHTML = key === 'loading'
    ? `<span class="spinner"></span><span data-load-text>${copy[language][key]}</span>`
    : `<span data-load-text>${copy[language][key]}</span><button type="button" id="retry" data-t="retry">${copy[language].retry}</button>`;
  if (key !== 'loading') {
    $('#retry').addEventListener('click', () => {
      if (key === 'webgl') location.reload();
      else void loadSelection(!model || Boolean(standaloneSelection));
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
  return forward(model, assembly.spec.eeLink, toolOffset(assembly.spec.id, assembly.gripper?.id));
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
  scene?.requestRender();
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
  syncTelemetry();
}

function writeUrl() {
  const url = new URL(window.location.href);
  const { gripper, opening } = activeSelection();
  if (standaloneSelection) url.searchParams.set('model', standaloneSelection.gripper.id);
  else if (assembly.spec.id === DEFAULT_ROBOT_ID) url.searchParams.delete('model');
  else url.searchParams.set('model', assembly.spec.id);
  if (!standaloneSelection && gripper) url.searchParams.set('gripper', gripper.id);
  else url.searchParams.delete('gripper');
  if (gripper) url.searchParams.set('opening', opening.toFixed(1));
  else url.searchParams.delete('opening');
  window.history.replaceState(null, '', url);
}

/** A new selection invalidates both pending loads and their error messages. */
async function loadSelection(reloadRobot: boolean) {
  const token = ++selectionToken;
  stopJog(false);
  sceneReady = false;
  const spec = assembly.spec;
  const { gripper, opening } = activeSelection();
  const isStandalone = Boolean(standaloneSelection);
  if (reloadRobot || isStandalone) {
    model = undefined;
    solver = undefined;
    resetTelemetryPlaceholders(spec.dof);
    $('#joint-list').innerHTML = '';
  }
  renderSceneCopy();
  applyControlAvailability(spec, false);

  const stage = $('#stage');
  delete stage.dataset.ready;
  if (isStandalone) delete stage.dataset.robot;
  else stage.dataset.robot = spec.id;
  stage.dataset.mode = isStandalone ? 'gripper' : 'robot';
  if (gripper) stage.dataset.gripper = gripper.id;
  else delete stage.dataset.gripper;

  if (!scene) return;
  setLoadMessage('loading');
  status('solverReady');

  try {
    if (isStandalone) {
      scene.clear();
    } else if (reloadRobot || !model) {
      const loaded = await scene.load(spec);
      if (!loaded || token !== selectionToken) return;
      model = loaded;
      setJoints(model, homeJoints(spec.dof));
      // Construct the arm-only IK tree before attaching the separate gripper.
      solver = new IKSolver(model, spec.eeLink);
      setupControls(model, spec);
      applyControlAvailability(spec, false);
    }
    if (!(await scene.setGripper(gripper, opening, isStandalone ? undefined : spec)) || token !== selectionToken) return;
    if (!isStandalone) {
      const offset = toolOffset(spec.id, gripper?.id);
      solver!.setToolOffset(offset);
      scene.setToolOffset(offset);
      syncTelemetry();
    }
    sceneReady = true;
    renderSceneCopy();
    applyControlAvailability(spec, !isStandalone);
    $('#load-message').hidden = true;
    status('solverReady');
    stage.dataset.ready = 'true';
  } catch (error) {
    if (token === selectionToken) { console.error(error); setLoadMessage('failed'); }
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

$('#robot-select').addEventListener('change', event => {
  const nextSpec = getRobotSpec((event.target as HTMLSelectElement).value);
  if (!standaloneSelection && nextSpec.id === assembly.spec.id && sceneReady) return;
  assembly.spec = nextSpec;
  standaloneSelection = undefined;
  if (!supportsGripper(nextSpec.id)) { assembly.gripper = undefined; assembly.opening = 0; }
  writeUrl();
  void loadSelection(true);
});

document.querySelectorAll<HTMLButtonElement>('[data-gripper-view]').forEach(button => {
  button.addEventListener('click', () => {
    const next = getGripper(button.dataset.gripperView)!;
    if (standaloneSelection?.gripper.id === next.id) {
      if (sceneReady) return;
    } else {
      standaloneSelection = { gripper: next, opening: assembly.gripper?.id === next.id ? assembly.opening : next.maxMm };
    }
    writeUrl();
    void loadSelection(true);
  });
});

$('#return-assembly').addEventListener('click', () => {
  if (!standaloneSelection) return;
  standaloneSelection = undefined;
  writeUrl();
  void loadSelection(true);
});

$('#gripper-select').addEventListener('change', event => {
  const next = getGripper((event.target as HTMLSelectElement).value);
  if (next && !supportsGripper(assembly.spec.id)) return;
  const wasStandalone = Boolean(standaloneSelection);
  if (!wasStandalone && next?.id === assembly.gripper?.id && sceneReady) return;
  if (next?.id !== assembly.gripper?.id) assembly.opening = next?.maxMm ?? 0;
  assembly.gripper = next;
  standaloneSelection = undefined;
  writeUrl();
  void loadSelection(wasStandalone || !model);
});

function changeOpening(event: Event) {
  const selection = activeSelection();
  if (!selection.gripper || !sceneReady) return;
  const value = numberValue(event.target as HTMLInputElement);
  if (!validOpening(selection.gripper, value) || !scene?.setGripperOpening(value)) {
    syncOpeningFields(); status('invalid', true); return;
  }
  selection.opening = Math.round(value * 10) / 10;
  syncOpeningFields();
  status('solverReady');
  writeUrl();
}
$('#opening-range').addEventListener('input', changeOpening);
$('#opening-number').addEventListener('change', changeOpening);

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
  stopJog(false); setJoints(model, homeJoints(assembly.spec.dof)); syncTelemetry(); status('solverReady');
});

bindJogButtons();
updateSpeedReadout();
translate();
setLoadMessage('loading');

function sceneCanvas(): HTMLCanvasElement { return $<HTMLCanvasElement>('#canvas-area canvas'); }

async function start() {
  try {
    scene = new RobotScene($('#canvas-area'));
    sceneCanvas().addEventListener('webglcontextlost', event => {
      event.preventDefault();
      ++selectionToken;
      scene?.clear();
      scene = undefined;
      sceneReady = false;
      model = undefined;
      solver = undefined;
      stopJog(false);
      delete $('#stage').dataset.ready;
      applyControlAvailability(assembly.spec, false);
      setLoadMessage('webgl');
    });
  }
  catch (error) { console.error(error); setLoadMessage('webgl'); return; }
  if ((initialParams.has('gripper') && (standaloneSelection || !initialGripper)) ||
      (initialOpening !== null && (!initialGripper || initialOpening.trim() === '' || !validOpening(initialGripper, Number(initialOpening))))) writeUrl();
  await loadSelection(true);
}
void start();
