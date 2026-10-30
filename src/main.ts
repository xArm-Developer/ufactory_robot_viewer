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
import { getGripper, GRIPPERS, supportsGripper, validOpening, type GripperSpec } from './grippers';
import {
  assemblyToolOffset,
  RAIL_SPEC,
  SENSOR_SPEC,
  supportsLinearRail,
  supportsSensor,
  validRailPosition,
} from './accessories';
import { renderAssetInventory, type SceneAsset } from './assets';
import { RobotScene } from './scene';
import type { URDFRobot } from 'urdf-loader';

type Language = 'zh' | 'en';
type ControlTab = 'joint' | 'cartesian';
type StandaloneState =
  | { kind: 'gripper'; gripper: GripperSpec; opening: number }
  | { kind: 'sensor' };

const LONG_PRESS_MS = 220;
const DEFAULT_LINEAR_STEP_MM = 1;
const DEFAULT_ANGULAR_STEP_DEG = 1;

const copy = {
  zh: {
    modelBarLabel: '机械臂',
    railBarLabel: '直线滑轨',
    loading: '正在加载 3D 模型…',
    failed: '模型加载失败。请检查网络连接或刷新页面。',
    webgl: '无法启动 3D 视图。请确认浏览器支持 WebGL，然后刷新页面。',
    retry: '刷新页面',
    baseAxes: '基坐标系',
    tcpAxes: 'TCP 坐标系',
    resetView: '复位视角',
    telemetryPose: 'TCP 位姿',
    telemetryJoints: '关节角度',
    telemetryRail: '直线滑轨',
    railPosShort: '行程',
    panelTitle: '运动控制',
    jointTitle: '关节控制',
    cartesianTitle: '笛卡尔控制',
    railPosition: '滑轨位置',
    speed: '速度',
    position: '位置',
    orientation: '姿态',
    solverConverged: '目标已求解',
    solverFailed: '无法收敛到目标；已保留上一次有效姿态。',
    invalid: '请输入有效且在范围内的数值。',
    toolLabel: '末端工具',
    noTool: '无',
    sensorGroupLabel: '传感器（可叠加）',
    sensorName: '六维力矩传感器',
    gripperGroupLabel: '夹爪（单选）',
    noGripper: '无夹爪',
    standaloneSelect: '独立查看中',
    standaloneHint: '正在独立查看末端配件。选择机械臂或末端工具，或在兼容机型上打开直线滑轨，可返回装配。',
    standaloneTitle: '独立查看',
    standaloneIntro: '独立查看末端配件',
    returnAssembly: '返回装配',
    gripperTitle: '夹爪控制',
    gripperIntro: '调整两指夹持面的开口间距。',
    liteGripperIntro: '气动夹爪支持张开或闭合。',
    opening: '开口间距',
    gripperOpening: '夹爪开合',
    gripperOpen: '张开',
    gripperClosed: '闭合',
    inventoryTitle: '当前场景资产',
    inventoryHint: '查看当前产品的 UFACTORY 官方介绍。',
    footer: '独立产品探索项目 · UFACTORY 与 xArm 是其各自所有者的商标',
  },
  en: {
    modelBarLabel: 'Robot arm',
    railBarLabel: 'Linear motor',
    loading: 'Loading 3D model…',
    failed: 'Could not load the model. Check your connection or reload the page.',
    webgl: 'The 3D view could not start. Check WebGL support in your browser and reload the page.',
    retry: 'Reload page',
    baseAxes: 'Base frame',
    tcpAxes: 'TCP frame',
    resetView: 'Reset view',
    telemetryPose: 'TCP pose',
    telemetryJoints: 'Joint angles',
    telemetryRail: 'Linear motor',
    railPosShort: 'Travel',
    panelTitle: 'Motion controls',
    jointTitle: 'Joint control',
    cartesianTitle: 'Cartesian control',
    railPosition: 'Rail position',
    speed: 'Speed',
    position: 'Position',
    orientation: 'Orientation',
    solverConverged: 'Target solved',
    solverFailed: 'Could not reach the target; the last valid pose is preserved.',
    invalid: 'Enter a valid value within the allowed range.',
    toolLabel: 'End effector',
    noTool: 'None',
    sensorGroupLabel: 'Sensor (stackable)',
    sensorName: '6-Axis F/T Sensor',
    gripperGroupLabel: 'Gripper (single choice)',
    noGripper: 'No gripper',
    standaloneSelect: 'Standalone view',
    standaloneHint: 'Viewing an end effector on its own. Select an arm or end effector, or enable the linear motor on a compatible arm, to return to the assembly.',
    standaloneTitle: 'Standalone view',
    standaloneIntro: 'View end effectors individually',
    returnAssembly: 'Return to assembly',
    gripperTitle: 'Gripper control',
    gripperIntro: 'Adjust the gap between the gripping surfaces.',
    liteGripperIntro: 'The pneumatic gripper can be open or closed.',
    opening: 'Opening',
    gripperOpening: 'Gripper opening',
    gripperOpen: 'Open',
    gripperClosed: 'Closed',
    inventoryTitle: 'Assets in this scene',
    inventoryHint: 'Explore the current products on the UFACTORY website.',
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
    <div class="robot-models" id="robot-models">
      <div class="robot-model-row">
        <label class="robot-models-label" for="robot-select" data-t="modelBarLabel"></label>
        <select id="robot-select">
          <option value="standalone" data-t="standaloneSelect" disabled hidden></option>
          ${ROBOTS.map(spec => `<option value="${spec.id}">${spec.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="language" id="language" type="button" aria-label="Switch language"><span class="language-icon">◎</span> <span id="language-label">EN</span></button>
    <p id="standalone-hint" class="selection-hint" data-t="standaloneHint" hidden></p>
  </header>
  <main id="top">
    <section class="experience page-width" id="explore" aria-label="xArm 6 interactive experience">
      <div class="stage" id="stage">
        <div class="stage-top">
          <h1 id="stage-heading" class="visually-hidden">xArm 6</h1>
          <div class="stage-telemetry" id="stage-telemetry">
            <div class="telemetry-section">
              <div class="telemetry-head"><span data-t="telemetryPose"></span><small>BASE · mm / °</small></div>
              <div class="telemetry-grid" id="fk-fields" aria-live="off">${poseCellsHtml}</div>
            </div>
            <div class="telemetry-section">
              <div class="telemetry-head"><span data-t="telemetryJoints"></span><small id="telemetry-joints-range">J1–J6 · °</small></div>
              <div class="telemetry-grid" id="stage-joint-fields" aria-live="off">${buildJointTelemetryHtml(6)}</div>
            </div>
            <div class="telemetry-section" id="stage-rail-telemetry" hidden>
              <div class="telemetry-head"><span data-t="telemetryRail"></span><small>0–700 · mm</small></div>
              <div class="telemetry-grid telemetry-grid-single" aria-live="off">
                <div class="telemetry-cell">
                  <span data-t="railPosShort"></span>
                  <div><output id="stage-rail-pos">—</output><small>mm</small></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="canvas-area" id="canvas-area"></div>
        <div class="load-message" id="load-message" role="status"><span class="spinner"></span><span data-t="loading"></span></div>
        <div class="stage-bottom">
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
        <div class="sidebar-content">
        <div class="motion-panel" id="motion-panel">
        <section class="control-card" id="control-card">
          <div id="arm-controls">
          <div class="control-tabs" id="control-tabs" role="tablist">
            <button id="joint-tab" class="control-tab" role="tab" type="button" aria-selected="false" aria-controls="joint-panel"><span data-t="jointTitle"></span></button>
            <button id="cartesian-tab" class="control-tab" role="tab" type="button" aria-selected="true" aria-controls="pose-panel"><span data-t="cartesianTitle"></span></button>
          </div>
          <div id="joint-panel" role="tabpanel" aria-labelledby="joint-tab" hidden>
            <p class="panel-description" id="joint-intro"></p>
            <div class="joint-list" id="joint-list"></div>
          </div>
          <div id="pose-panel" role="tabpanel" aria-labelledby="cartesian-tab">
            <div class="jog-speed-box">
              <output id="jog-speed-readout" for="jog-speed">20%</output>
              <input id="jog-speed" type="range" min="1" max="100" step="1" value="20" aria-label="Cartesian speed percentage" />
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
          <div id="solver-status" class="control-foot solver-status" role="status" aria-atomic="true"><span class="status-dot" aria-hidden="true"></span><span id="status-text"></span></div>
        </section>
        </div>
        <div class="selection-stack">
          <section class="selector-card" id="tool-dropdown" aria-labelledby="tool-label">
            <div class="selector-heading">
              <h2 id="tool-label" data-t="toolLabel"></h2><strong id="tool-summary"></strong>
            </div>
            <div id="tool-menu" class="selector-panel tool-menu" role="group" aria-labelledby="tool-label">
              <div class="tool-group" id="tool-sensor-group">
                <span class="tool-group-title" data-t="sensorGroupLabel"></span>
                <label class="tool-option">
                  <input type="checkbox" id="tool-sensor-check" value="${SENSOR_SPEC.id}" />
                  <span data-t="sensorName"></span>
                </label>
              </div>
              <div class="tool-group">
                <span class="tool-group-title" data-t="gripperGroupLabel"></span>
                <label class="tool-option">
                  <input type="radio" name="tool-gripper" id="tool-gripper-none" value="" />
                  <span data-t="noGripper"></span>
                </label>
                ${GRIPPERS.map(spec => `
                  <label class="tool-option">
                    <input type="radio" name="tool-gripper" id="tool-gripper-${spec.id}" value="${spec.id}" />
                    <span>${spec.name}</span>
                  </label>
                `).join('')}
              </div>
              <section class="gripper-control" id="gripper-control" hidden>
                <div class="gripper-heading"><strong data-t="gripperTitle"></strong><span id="gripper-name"></span></div>
                <p id="gripper-intro"></p>
                <div id="opening-continuous">
                  <div class="gripper-inputs"><label for="opening-number" id="opening-label"></label><div class="joint-value"><input id="opening-number" type="number" step="0.1" /><span id="opening-unit">mm</span></div></div>
                  <input id="opening-range" type="range" step="0.1" aria-label="Gripper opening" />
                  <div class="range-labels"><span id="opening-min"></span><span id="opening-max"></span></div>
                </div>
                <div class="gripper-inputs" id="opening-binary" hidden>
                  <span id="opening-switch-label" data-t="gripperOpening"></span>
                  <div class="gripper-switch-controls">
                    <span id="opening-switch-state"></span>
                    <label class="rail-switch"><input id="opening-switch" type="checkbox" role="switch" aria-labelledby="opening-switch-label" aria-describedby="opening-switch-state" /></label>
                  </div>
                </div>
              </section>
              <section class="standalone-tools" aria-labelledby="standalone-title">
                <h3 id="standalone-title" data-t="standaloneTitle"></h3>
                <p data-t="standaloneIntro"></p>
                <div class="standalone-buttons">
                  <button type="button" data-standalone-view="${SENSOR_SPEC.id}" aria-pressed="false" data-t="sensorName"></button>
                  ${GRIPPERS.map(spec => `<button type="button" data-standalone-view="${spec.id}" data-gripper-view="${spec.id}" aria-pressed="false">${spec.name}</button>`).join('')}
                </div>
                <button class="return-assembly" id="return-assembly" type="button" data-t="returnAssembly" hidden></button>
              </section>
            </div>
          </section>
          <section class="selector-card" id="rail-selector" aria-labelledby="rail-selector-label" hidden>
            <div class="selector-heading">
              <h2 id="rail-selector-label" data-t="railBarLabel"></h2>
              <label class="rail-switch">
                <input id="rail-toggle" type="checkbox" role="switch" aria-labelledby="rail-selector-label" aria-controls="rail-panel" />
              </label>
            </div>
            <div id="rail-panel" class="selector-panel" hidden>
              <div class="gripper-inputs">
                <label for="rail-number" data-t="railPosition"></label>
                <div class="joint-value"><input id="rail-number" type="number" min="0" max="700" step="0.1" /><span>mm</span></div>
              </div>
              <input id="rail-range" type="range" min="0" max="700" step="0.1" aria-label="Rail position" />
              <div class="range-labels"><span>0 mm</span><span>700 mm</span></div>
            </div>
          </section>
        </div>
        </div>
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
const initialModelParam = initialParams.get('model');
const initialStandaloneGripper = getGripper(initialModelParam);
const initialStandaloneSensor = initialModelParam === SENSOR_SPEC.id;
const isInitialStandalone = Boolean(initialStandaloneGripper || initialStandaloneSensor);
const initialRobot: RobotSpec = getRobotSpec(initialModelParam);

const rawRailParam = initialParams.get('rail');
const initialRail = !isInitialStandalone && supportsLinearRail(initialRobot.id) && rawRailParam === RAIL_SPEC.id;
const rawRailPos = initialParams.get('railPos');
const validInitialRailPos = initialRail && rawRailPos !== null && rawRailPos.trim() !== '' && validRailPosition(Number(rawRailPos));
const parsedRailMm = validInitialRailPos ? Math.round(Number(rawRailPos) * 10) / 10 : 0;

const rawSensorParam = initialParams.get('sensor');
const initialSensor = !isInitialStandalone && supportsSensor(initialRobot.id) && rawSensorParam === SENSOR_SPEC.id;

const requestedGripper = getGripper(initialParams.get('gripper'));
const initialGripper = initialStandaloneGripper ?? (!isInitialStandalone && requestedGripper && supportsGripper(initialRobot.id, requestedGripper.id) ? requestedGripper : undefined);
const initialOpening = initialParams.get('opening');
const validInitialOpening = Boolean(initialGripper && initialOpening !== null && initialOpening.trim() !== '' && validOpening(initialGripper, Number(initialOpening)));
const parsedOpening = validInitialOpening ? Math.round(Number(initialOpening) * 10) / 10 : initialGripper?.opening?.max ?? 0;

// The assembly remains intact while a separate standalone accessory is being viewed.
const assembly: {
  spec: RobotSpec;
  rail: boolean;
  railMm: number;
  sensor: boolean;
  gripper: GripperSpec | undefined;
  opening: number;
} = {
  spec: initialRobot,
  rail: initialRail,
  railMm: parsedRailMm,
  sensor: initialSensor,
  gripper: isInitialStandalone ? undefined : initialGripper,
  opening: isInitialStandalone ? 0 : parsedOpening,
};

let standaloneSelection: StandaloneState | undefined = initialStandaloneGripper
  ? { kind: 'gripper', gripper: initialStandaloneGripper, opening: parsedOpening }
  : initialStandaloneSensor
    ? { kind: 'sensor' }
    : undefined;

let language: Language = 'zh';
let activeTab: ControlTab = 'cartesian';
type StatusKey = 'solverConverged' | 'solverFailed' | 'invalid';
let statusKey: StatusKey | null = null;
let loadKey: Key = 'loading';
let scene: RobotScene | undefined;
let model: URDFRobot | undefined;
let solver: IKSolver | undefined;
let showBaseFrame = false;
let showTcpFrame = false;
let activeJog: ActiveJog | undefined;
let selectionToken = 0;
let sceneReady = false;

function activeGripperState(): { gripper: GripperSpec | undefined; opening: number } {
  if (standaloneSelection) {
    return standaloneSelection.kind === 'gripper'
      ? { gripper: standaloneSelection.gripper, opening: standaloneSelection.opening }
      : { gripper: undefined, opening: 0 };
  }
  return { gripper: assembly.gripper, opening: assembly.opening };
}

function buildToolSummary(): string {
  if (standaloneSelection) return copy[language].standaloneSelect;
  const parts: string[] = [];
  if (assembly.sensor) parts.push(SENSOR_SPEC.name[language]);
  if (assembly.gripper) parts.push(assembly.gripper.name);
  return parts.length ? parts.join(' + ') : copy[language].noTool;
}

function syncOpeningFields() {
  const { gripper, opening } = activeGripperState();
  if (!gripper?.opening) return;
  const { min, max, mode } = gripper.opening;
  $('#gripper-name').textContent = gripper.name;
  $('#gripper-intro').textContent = mode === 'binary' ? copy[language].liteGripperIntro : copy[language].gripperIntro;
  $('#opening-continuous').hidden = mode !== 'continuous';
  $('#opening-binary').hidden = mode !== 'binary';
  const toggle = $<HTMLInputElement>('#opening-switch');
  toggle.checked = opening === max;
  toggle.disabled = !sceneReady;
  $('#opening-switch-state').textContent = toggle.checked ? copy[language].gripperOpen : copy[language].gripperClosed;
  if (mode === 'binary') return;
  const { unit } = gripper.opening;
  const label = copy[language].opening;
  $('#opening-label').textContent = label;
  $('#opening-unit').textContent = unit;
  for (const selector of ['#opening-number', '#opening-range']) {
    const input = $<HTMLInputElement>(selector);
    input.min = String(min);
    input.max = String(max);
    input.value = opening.toFixed(1);
    input.disabled = !sceneReady;
  }
  $('#opening-range').setAttribute('aria-label', label);
  $('#opening-min').textContent = `${min} ${unit}`;
  $('#opening-max').textContent = `${max} ${unit}`;
}

function syncRailFields() {
  const formatted = assembly.railMm.toFixed(1);
  for (const selector of ['#rail-number', '#rail-range']) {
    const input = $<HTMLInputElement>(selector);
    input.value = formatted;
    input.disabled = !sceneReady || !assembly.rail || Boolean(standaloneSelection);
  }
  $('#rail-range').setAttribute('aria-label', copy[language].railPosition);
  $('#stage-rail-pos').textContent = sceneReady && assembly.rail ? formatted : '—';
}

function setTab(tab: ControlTab) {
  stopJog(false);
  activeTab = tab;
  $('#joint-tab').setAttribute('aria-selected', String(tab === 'joint'));
  $('#cartesian-tab').setAttribute('aria-selected', String(tab === 'cartesian'));
  $('#joint-panel').hidden = tab !== 'joint';
  $('#pose-panel').hidden = tab !== 'cartesian';
}

function renderSceneCopy() {
  const currentSpec = assembly.spec;
  const standalone = Boolean(standaloneSelection);
  const { gripper } = activeGripperState();
  const productName = standaloneSelection
    ? standaloneSelection.kind === 'gripper'
      ? standaloneSelection.gripper.name
      : SENSOR_SPEC.name[language]
    : currentSpec.name;

  document.title = `${productName} — UF Robots`;
  $('#explore').setAttribute('aria-label', `${productName} interactive experience`);
  $('#stage-heading').textContent = productName;
  $('#telemetry-joints-range').textContent = `J1–J${currentSpec.dof} · °`;
  $('#joint-intro').textContent = currentSpec.jointIntro[language];
  $('#control-card').setAttribute('aria-label', copy[language].panelTitle);

  $('#stage-telemetry').hidden = standalone;
  $('#stage-rail-telemetry').hidden = standalone || !assembly.rail;
  $('#toggle-base-frame').hidden = standalone;
  $('#toggle-tcp-frame').hidden = standalone;
  $('#arm-controls').hidden = standalone;
  $('#gripper-control').hidden = !gripper?.opening;

  $('#rail-panel').hidden = standalone || !assembly.rail;

  const sensorSupported = supportsSensor(currentSpec.id);
  const railSupported = supportsLinearRail(currentSpec.id);
  $('#rail-selector').hidden = !railSupported;
  $('#tool-sensor-group').hidden = !sensorSupported;
  $<HTMLButtonElement>(`[data-standalone-view="${SENSOR_SPEC.id}"]`).hidden = !sensorSupported;
  const robotSelect = $<HTMLSelectElement>('#robot-select');
  robotSelect.value = standalone ? 'standalone' : currentSpec.id;
  if (standalone) robotSelect.setAttribute('aria-describedby', 'standalone-hint');
  else robotSelect.removeAttribute('aria-describedby');
  $('#standalone-hint').hidden = !standalone;
  $('#return-assembly').hidden = !standalone;

  const railToggle = $<HTMLInputElement>('#rail-toggle');
  railToggle.disabled = !railSupported;
  railToggle.checked = !standalone && assembly.rail;
  if (standalone) railToggle.setAttribute('aria-describedby', 'standalone-hint');
  else railToggle.removeAttribute('aria-describedby');

  if (standalone) $('#tool-dropdown').setAttribute('aria-describedby', 'standalone-hint');
  else $('#tool-dropdown').removeAttribute('aria-describedby');
  $('#tool-summary').textContent = buildToolSummary();

  const sensorCheck = $<HTMLInputElement>('#tool-sensor-check');
  sensorCheck.disabled = !sensorSupported;
  sensorCheck.checked = !standalone && assembly.sensor;

  document.querySelectorAll<HTMLInputElement>('input[name="tool-gripper"]').forEach(radio => {
    const option = getGripper(radio.value);
    const compatible = !option || supportsGripper(currentSpec.id, option.id);
    radio.disabled = !compatible;
    if (option) radio.closest('label')!.hidden = !compatible;
    if (standalone) {
      radio.checked = false;
    } else {
      radio.checked = radio.value === (assembly.gripper?.id ?? '');
    }
  });

  syncOpeningFields();
  syncRailFields();

  const assets: SceneAsset[] = standaloneSelection
    ? standaloneSelection.kind === 'gripper'
      ? [{ name: standaloneSelection.gripper.name, productUrl: standaloneSelection.gripper.productUrl, category: 'accessory' }]
      : [{ name: SENSOR_SPEC.name[language], productUrl: SENSOR_SPEC.productUrl, category: 'accessory' }]
    : [
        { name: currentSpec.name, productUrl: currentSpec.productUrl, category: 'robot' },
        ...(assembly.rail ? [{ name: RAIL_SPEC.name[language], productUrl: RAIL_SPEC.productUrl, category: 'accessory' as const }] : []),
        ...(assembly.sensor ? [{ name: SENSOR_SPEC.name[language], productUrl: SENSOR_SPEC.productUrl, category: 'accessory' as const }] : []),
        ...(assembly.gripper ? [{ name: assembly.gripper.name, productUrl: assembly.gripper.productUrl, category: 'accessory' as const }] : []),
      ];

  const inventoryState = sceneReady
    ? { status: 'ready' as const, assets }
    : { status: loadKey === 'webgl' ? 'webgl' as const : loadKey === 'failed' ? 'failed' as const : 'loading' as const };
  renderAssetInventory($('#asset-list'), inventoryState, language);

  document.querySelectorAll<HTMLButtonElement>('[data-standalone-view]').forEach(button => {
    const viewId = button.dataset.standaloneView;
    const pressed = standaloneSelection
      ? standaloneSelection.kind === 'gripper'
        ? viewId === standaloneSelection.gripper.id
        : viewId === SENSOR_SPEC.id
      : false;
    button.setAttribute('aria-pressed', String(pressed));
  });
}

function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el => { el.textContent = copy[language][el.dataset.t as Key]; });
  $('#language-label').textContent = language === 'zh' ? 'EN' : '中文';
  $('#language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
  $('#status-text').textContent = statusKey ? copy[language][statusKey] : '';
  $('#jog-speed').setAttribute('aria-label', copy[language].speed);
  const message = document.querySelector<HTMLElement>('#load-message [data-load-text]');
  if (message) message.textContent = copy[language][loadKey];
  renderSceneCopy();
}

function status(key: StatusKey | null, error = false) {
  statusKey = key;
  $('#status-text').textContent = key ? copy[language][key] : '';
  $('#solver-status').classList.toggle('has-message', key !== null);
  $('#solver-status').classList.toggle('error', error);
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

function currentToolOffset(): Pose {
  return assemblyToolOffset(assembly.spec.id, {
    sensor: assembly.sensor,
    gripperId: assembly.gripper?.id,
  });
}

function currentForward(): Pose {
  if (!model) throw new Error('Model not loaded');
  return forward(model, assembly.spec.eeLink, currentToolOffset());
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
  syncRailFields();
  scene?.requestRender();
}

function updateSpeedReadout() {
  const raw = numberValue($<HTMLInputElement>('#jog-speed'));
  const percent = Number.isFinite(raw) ? MathUtils.clamp(Math.round(raw), 1, 100) : 20;
  $('#jog-speed-readout').textContent = `${percent}%`;
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
  const step = axis === 'x' || axis === 'y' || axis === 'z' ? DEFAULT_LINEAR_STEP_MM : DEFAULT_ANGULAR_STEP_DEG;
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
  document.querySelectorAll<HTMLButtonElement>('#toggle-base-frame, #toggle-tcp-frame').forEach(button => {
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
  $('#stage-rail-pos').textContent = '—';
}

function setupControls(robot: URDFRobot) {
  const jointList = $('#joint-list');
  const jointLimits = limits(robot);
  jointList.innerHTML = jointLimits.map((limit, i) => {
    const min = MathUtils.radToDeg(limit.min);
    const max = MathUtils.radToDeg(limit.max);
    return `<div class="joint-row"><div class="joint-top"><label for="joint-range-${i}"><span class="joint-index">0${i + 1}</span> Joint ${i + 1}</label><div class="joint-value"><input id="joint-number-${i}" type="number" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1} angle" /> <span>°</span></div></div><input id="joint-range-${i}" type="range" min="${min}" max="${max}" step="0.01" aria-label="Joint ${i + 1}" /><div class="range-labels"><span>${Math.ceil(min)}°</span><span>${Math.floor(max)}°</span></div></div>`;
  }).join('');
  jointLimits.forEach((_, i) => {
    const change = (event: Event) => {
      if (!model) return;
      stopJog(false);
      const value = numberValue(event.target as HTMLInputElement);
      const angles = jointValues(model);
      angles[i] = MathUtils.degToRad(value);
      if (!setJoints(model, angles)) { status('invalid', true); return; }
      syncTelemetry();
      status(null);
    };
    $<HTMLInputElement>(`#joint-range-${i}`).addEventListener('input', change);
    $<HTMLInputElement>(`#joint-number-${i}`).addEventListener('change', change);
  });
  syncTelemetry();
}

function writeUrl() {
  const url = new URL(window.location.href);
  const { gripper, opening } = activeGripperState();
  if (standaloneSelection) {
    url.searchParams.set('model', standaloneSelection.kind === 'gripper' ? standaloneSelection.gripper.id : SENSOR_SPEC.id);
    url.searchParams.delete('rail');
    url.searchParams.delete('railPos');
    url.searchParams.delete('sensor');
    url.searchParams.delete('gripper');
  } else {
    if (assembly.spec.id === DEFAULT_ROBOT_ID) url.searchParams.delete('model');
    else url.searchParams.set('model', assembly.spec.id);

    if (assembly.rail) {
      url.searchParams.set('rail', RAIL_SPEC.id);
      url.searchParams.set('railPos', assembly.railMm.toFixed(1));
    } else {
      url.searchParams.delete('rail');
      url.searchParams.delete('railPos');
    }

    if (assembly.sensor) url.searchParams.set('sensor', SENSOR_SPEC.id);
    else url.searchParams.delete('sensor');

    if (assembly.gripper) url.searchParams.set('gripper', assembly.gripper.id);
    else url.searchParams.delete('gripper');
  }

  if (gripper?.opening) url.searchParams.set('opening', opening.toFixed(1));
  else url.searchParams.delete('opening');

  window.history.replaceState(null, '', url);
}

/** A new selection invalidates both pending loads and their error messages. */
async function loadSelection(reloadRobot: boolean) {
  const token = ++selectionToken;
  stopJog(false);
  sceneReady = false;
  const spec = assembly.spec;
  const standalone = standaloneSelection;
  const isStandalone = Boolean(standalone);
  const { gripper, opening } = activeGripperState();

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
  stage.dataset.mode = standalone ? standalone.kind : 'robot';
  if (gripper) stage.dataset.gripper = gripper.id;
  else delete stage.dataset.gripper;
  const hasSensor = standalone ? standalone.kind === 'sensor' : assembly.sensor;
  if (hasSensor) stage.dataset.sensor = SENSOR_SPEC.id;
  else delete stage.dataset.sensor;
  if (!isStandalone && assembly.rail) stage.dataset.rail = RAIL_SPEC.id;
  else delete stage.dataset.rail;

  if (!scene) return;
  setLoadMessage('loading');
  status(null);

  try {
    if (standalone) {
      scene.clear();
      const loadedStandalone = await scene.setStandaloneAccessory(
        standalone.kind === 'gripper'
          ? { kind: 'gripper', spec: standalone.gripper, opening: standalone.opening }
          : { kind: 'sensor' },
      );
      if (!loadedStandalone || token !== selectionToken) return;
    } else {
      if (reloadRobot || !model) {
        const loaded = await scene.load(spec);
        if (!loaded || token !== selectionToken) return;
        model = loaded;
        setJoints(model, homeJoints(spec.dof));
        // Construct the arm-only IK tree before attaching accessories.
        solver = new IKSolver(model, spec.eeLink);
        setupControls(model);
        applyControlAvailability(spec, false);
      }
      const configured = await scene.setAssemblyAccessories(
        {
          rail: assembly.rail,
          railMm: assembly.railMm,
          sensor: assembly.sensor,
          gripper: assembly.gripper,
          opening: assembly.opening,
        },
        spec,
      );
      if (!configured || token !== selectionToken) return;
      const offset = currentToolOffset();
      solver!.setToolOffset(offset);
      scene.setToolOffset(offset);
      syncTelemetry();
    }
    sceneReady = true;
    renderSceneCopy();
    applyControlAvailability(spec, !isStandalone);
    $('#load-message').hidden = true;
    status(null);
    stage.dataset.ready = 'true';
  } catch (error) {
    if (token === selectionToken) {
      console.error(error);
      setLoadMessage('failed');
    }
  }
}

$('#robot-select').addEventListener('change', event => {
  const nextSpec = getRobotSpec((event.target as HTMLSelectElement).value);
  if (!standaloneSelection && nextSpec.id === assembly.spec.id && sceneReady) return;
  assembly.spec = nextSpec;
  standaloneSelection = undefined;
  if (!supportsLinearRail(nextSpec.id)) {
    assembly.rail = false;
    assembly.railMm = 0;
  }
  if (!supportsSensor(nextSpec.id)) assembly.sensor = false;
  if (assembly.gripper && !supportsGripper(nextSpec.id, assembly.gripper.id)) {
    assembly.gripper = undefined;
    assembly.opening = 0;
  }
  writeUrl();
  void loadSelection(true);
});

$('#rail-toggle').addEventListener('change', event => {
  const nextRail = (event.target as HTMLInputElement).checked;
  if (nextRail && !supportsLinearRail(assembly.spec.id)) {
    renderSceneCopy();
    return;
  }
  const wasStandalone = Boolean(standaloneSelection);
  if (!wasStandalone && nextRail === assembly.rail && sceneReady) return;
  if (nextRail !== assembly.rail) assembly.railMm = 0;
  assembly.rail = nextRail;
  standaloneSelection = undefined;
  writeUrl();
  void loadSelection(wasStandalone || !model);
});

$('#tool-sensor-check').addEventListener('change', event => {
  const nextSensor = (event.target as HTMLInputElement).checked;
  if (nextSensor && !supportsSensor(assembly.spec.id)) {
    renderSceneCopy();
    return;
  }
  const wasStandalone = Boolean(standaloneSelection);
  if (!wasStandalone && nextSensor === assembly.sensor && sceneReady) return;
  assembly.sensor = nextSensor;
  standaloneSelection = undefined;
  writeUrl();
  void loadSelection(wasStandalone || !model);
});

document.querySelectorAll<HTMLInputElement>('input[name="tool-gripper"]').forEach(radio => {
  radio.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (!target.checked) return;
    const next = getGripper(target.value);
    if (next && !supportsGripper(assembly.spec.id, next.id)) {
      renderSceneCopy();
      return;
    }
    const wasStandalone = Boolean(standaloneSelection);
    if (!wasStandalone && next?.id === assembly.gripper?.id && sceneReady) return;
    if (next?.id !== assembly.gripper?.id) assembly.opening = next?.opening?.max ?? 0;
    assembly.gripper = next;
    standaloneSelection = undefined;
    writeUrl();
    void loadSelection(wasStandalone || !model);
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-standalone-view]').forEach(button => {
  button.addEventListener('click', () => {
    const viewId = button.dataset.standaloneView;
    if (viewId === SENSOR_SPEC.id) {
      if (standaloneSelection?.kind === 'sensor' && sceneReady) return;
      standaloneSelection = { kind: 'sensor' };
    } else {
      const next = getGripper(viewId)!;
      if (standaloneSelection?.kind === 'gripper' && standaloneSelection.gripper.id === next.id) {
        if (sceneReady) return;
      } else {
        standaloneSelection = {
          kind: 'gripper',
          gripper: next,
          opening: assembly.gripper?.id === next.id ? assembly.opening : next.opening?.max ?? 0,
        };
      }
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

function setOpening(value: number) {
  const active = activeGripperState();
  if (!active.gripper || !sceneReady) { syncOpeningFields(); return; }
  if (!validOpening(active.gripper, value) || !scene?.setGripperOpening(value)) {
    syncOpeningFields();
    status('invalid', true);
    return;
  }
  const rounded = Math.round(value * 10) / 10;
  if (standaloneSelection?.kind === 'gripper') standaloneSelection.opening = rounded;
  else assembly.opening = rounded;
  syncOpeningFields();
  status(null);
  writeUrl();
}
$('#opening-range').addEventListener('input', event => setOpening(numberValue(event.target as HTMLInputElement)));
$('#opening-number').addEventListener('change', event => setOpening(numberValue(event.target as HTMLInputElement)));
$('#opening-switch').addEventListener('change', event => {
  const opening = activeGripperState().gripper?.opening;
  if (opening?.mode !== 'binary') return;
  setOpening((event.target as HTMLInputElement).checked ? opening.max : opening.min);
});

function changeRailPosition(event: Event) {
  if (!assembly.rail || Boolean(standaloneSelection) || !sceneReady) return;
  const value = numberValue(event.target as HTMLInputElement);
  if (!validRailPosition(value) || !scene?.setRailPosition(value)) {
    syncRailFields();
    status('invalid', true);
    return;
  }
  assembly.railMm = Math.round(value * 10) / 10;
  syncRailFields();
  status(null);
  writeUrl();
}
$('#rail-range').addEventListener('input', changeRailPosition);
$('#rail-number').addEventListener('change', changeRailPosition);

$('#language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; translate(); });
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
  } catch (error) {
    console.error(error);
    setLoadMessage('webgl');
    return;
  }

  const invalidQuery =
    (initialParams.has('rail') && !initialRail) ||
    (rawRailPos !== null && (!initialRail || !validInitialRailPos)) ||
    (initialParams.has('sensor') && !initialSensor) ||
    (initialParams.has('gripper') && (Boolean(standaloneSelection) || !initialGripper)) ||
    (initialOpening !== null && (!initialGripper || !validInitialOpening));
  if (invalidQuery) writeUrl();

  await loadSelection(true);
}
void start();
