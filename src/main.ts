import './style.css';
import { MathUtils, Vector3 } from 'three';
import {
  formatJointLimitMessage,
  forward,
  fromRPY,
  homeJoints,
  IKSolver,
  jogVelocity,
  jointVelocity,
  jointValues,
  limits,
  setJoints,
  stepBasePose,
  toRPY,
  type CartesianAxis,
  type Pose,
  type RPY,
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
import { formatCollisionBodyName, type CollisionBodyId, type CollisionPair } from './collision';
import { levelFlange } from './leveling';
import { RobotScene } from './scene';
import { SiteFooter } from './footer';
import { SCENE_VERSION, SceneStorage, type SceneSnapshot } from './scene-storage';
import type { URDFRobot } from 'urdf-loader';
import type { PackingExample } from './packing';

type Language = 'zh' | 'en';
type ControlTab = 'joint' | 'cartesian';

const LONG_PRESS_MS = 220;
const DEFAULT_LINEAR_STEP_MM = 1;
const DEFAULT_ANGULAR_STEP_DEG = 1;
const DEFAULT_JOG_SPEED = 50;
const JOG_SPEED_STORAGE_KEY = 'uf-robots:jog-speed';

const copy = {
  zh: {
    pageRobot: '机械臂',
    pageExamples: '示例',
    exampleFailed: '示例加载失败，请刷新页面重试。',
    savedSceneInvalid: '保存的场景无效，已回退到链接场景；新的有效操作将更新保存。',
    savedSceneCollision: '保存的场景发生碰撞，已回退到链接场景；新的有效操作将更新保存。',
    linkSceneCollision: '链接场景发生碰撞，已回退到 xArm 6 无配件零位。',
    storageUnavailable: '无法使用浏览器存储，场景可能无法保存；当前操作不受影响。',
    dismissSceneNotices: '关闭场景提示',
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
    railDecrease: '滑轨位置减小',
    railIncrease: '滑轨位置增加',
    speed: '速度',
    expandMotion: '展开笛卡尔控制',
    collapseMotion: '收起笛卡尔控制',
    expandJointMotion: '展开关节控制',
    collapseJointMotion: '收起关节控制',
    position: '位置',
    orientation: '姿态',
    homePose: '初始位置',
    levelFlange: '末端调平',
    levelFailed: '无法在关节限位内调平末端；已保留当前姿态。',
    invalid: '请输入有效且在范围内的数值。',
    toolLabel: '末端工具',
    sensorName: '六维力矩传感器',
    gripperGroupLabel: '末端执行器',
    noGripper: '无夹爪',
    liteGripperIntro: '气动夹爪支持张开或闭合。',
    opening: '开口间距',
    gripperOpening: '夹爪开合',
    gripperOpen: '张开',
    gripperClosed: '闭合',
    inventoryTitle: '当前场景资产',
    inventoryHint: '查看当前产品的 UFACTORY 官方介绍。',
  },
  en: {
    pageRobot: 'Robot',
    pageExamples: 'Examples',
    exampleFailed: 'Could not load the example. Reload the page to retry.',
    savedSceneInvalid: 'The saved scene is invalid. The link scene is used; a new valid action will update the saved scene.',
    savedSceneCollision: 'The saved scene collides. The link scene is used; a new valid action will update the saved scene.',
    linkSceneCollision: 'The link scene collides. The default xArm 6 scene is used.',
    storageUnavailable: 'Browser storage is unavailable. The scene may not be saved; controls remain usable.',
    dismissSceneNotices: 'Dismiss scene notices',
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
    railDecrease: 'Decrease rail position',
    railIncrease: 'Increase rail position',
    speed: 'Speed',
    expandMotion: 'Expand Cartesian controls',
    collapseMotion: 'Collapse Cartesian controls',
    expandJointMotion: 'Expand joint controls',
    collapseJointMotion: 'Collapse joint controls',
    position: 'Position',
    orientation: 'Orientation',
    homePose: 'Initial position',
    levelFlange: 'Level flange',
    levelFailed: 'Could not level the flange within joint limits; the current pose is preserved.',
    invalid: 'Enter a valid value within the allowed range.',
    toolLabel: 'End effector',
    sensorName: '6-Axis F/T Sensor',
    gripperGroupLabel: 'End effector',
    noGripper: 'No gripper',
    liteGripperIntro: 'The pneumatic gripper can be open or closed.',
    opening: 'Opening',
    gripperOpening: 'Gripper opening',
    gripperOpen: 'Open',
    gripperClosed: 'Closed',
    inventoryTitle: 'Assets in this scene',
    inventoryHint: 'Explore the current products on the UFACTORY website.',
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
    <a class="brand" href="#top" aria-label="UFACTORY Robot Viewer home"><span class="brand-mark">UF<span>•</span></span><span class="brand-name">ROBOT VIEWER</span></a>
    <nav class="page-nav" aria-label="Pages"><a id="page-robot" href="?" data-t="pageRobot"></a><a id="page-examples" href="?example=packing-01" data-t="pageExamples"></a></nav>
    <button class="language" id="language" type="button" aria-label="Switch language"><span class="language-icon">◎</span> <span id="language-label">EN</span></button>
  </header>
  <main id="top">
    <div id="packing-page" hidden></div>
    <section class="experience page-width" id="explore" aria-label="xArm 6 interactive experience">
      <div class="stage" id="stage">
        <div class="stage-top">
          <h1 id="stage-heading" class="visually-hidden">xArm 6</h1>
          <div class="robot-models" id="robot-models">
            <label class="visually-hidden" for="robot-select" data-t="modelBarLabel"></label>
            <select id="robot-select">
              ${ROBOTS.map(spec => `<option value="${spec.id}">${spec.name}</option>`).join('')}
            </select>
          </div>
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
        <div class="stage-notices">
          <div id="collision-toast" class="stage-notice" role="alert" aria-atomic="true" hidden>
            <svg class="collision-toast-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
              <path d="M8 2.1L14.4 13.3a.8.8 0 0 1-.7 1.2H2.3a.8.8 0 0 1-.7-1.2L8 2.1z" fill="#dc2626" fill-opacity="0.14" stroke="#dc2626" stroke-width="1.4" stroke-linejoin="round" />
              <path d="M8 6.2v3.6M8 11.9h.01" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" />
            </svg>
            <span id="collision-toast-text"></span>
          </div>
          <div id="load-message" class="stage-notice load-error" role="status" aria-atomic="true" hidden></div>
          <div id="solver-status" class="stage-notice" role="status" aria-atomic="true" hidden><span id="status-text"></span></div>
          <div id="opening-error" class="stage-notice" role="status" aria-live="polite" hidden><span data-t="opening"></span><span id="opening-error-text"></span></div>
          <div id="rail-error" class="stage-notice" role="status" aria-live="polite" hidden><span data-t="railPosition"></span><span id="rail-error-text"></span></div>
          <div id="scene-notices" class="stage-notice scene-notices" hidden>
            <div id="scene-notice-messages" role="status" aria-live="polite"></div>
            <button id="dismiss-scene-notices" type="button">×</button>
          </div>
        </div>
        <div class="canvas-area" id="canvas-area"></div>
        <div class="load-message" id="load-overlay" role="status"><span class="spinner"></span><span data-t="loading"></span></div>
        <div class="stage-bottom">
          <div class="stage-actions">
            <button class="stage-btn" id="toggle-base-frame" type="button" aria-pressed="false" disabled>
              <svg class="axes-icon axes-icon-base" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false">
                <g class="axes-marker axes-marker-base" data-marker="base">
                  <path d="M2.5 16.2h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                  <path d="M5.2 16.2l0.9-3h5.8l0.9 3" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
                </g>
                <g class="axes-triad">
                  <path class="axis-x" d="M9 11.4L3 8.8" stroke="#e53935" stroke-width="1.65" stroke-linecap="round" />
                  <path class="axis-y" d="M9 11.4L15 8.8" stroke="#2ea043" stroke-width="1.65" stroke-linecap="round" />
                  <path class="axis-z" d="M9 11.4V2.4M7.3 4.2L9 2.2l1.7 2" fill="none" stroke="#2574e8" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
                  <circle cx="9" cy="11.4" r="1.25" fill="currentColor" />
                </g>
              </svg>
              <span data-t="baseAxes"></span>
            </button>
            <button class="stage-btn" id="toggle-tcp-frame" type="button" aria-pressed="false" disabled>
              <svg class="axes-icon axes-icon-tcp" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false">
                <g class="axes-marker axes-marker-flange" data-marker="flange">
                  <path d="M7.2 1.6v2.1M10.8 1.6v2.1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
                  <ellipse cx="9" cy="4.9" rx="4.6" ry="1.65" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.25" />
                </g>
                <g class="axes-triad">
                  <path class="axis-x" d="M9 6.8L3 9.4" stroke="#e53935" stroke-width="1.65" stroke-linecap="round" />
                  <path class="axis-y" d="M9 6.8L15 9.4" stroke="#2ea043" stroke-width="1.65" stroke-linecap="round" />
                  <path class="axis-z" d="M9 6.8v9M7.3 14L9 16l1.7-2" fill="none" stroke="#2574e8" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
                  <circle cx="9" cy="6.8" r="1.25" fill="currentColor" />
                </g>
              </svg>
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
          <div class="control-tabs" id="control-tabs">
            <div class="control-tab-list" role="tablist" aria-label="Motion controls">
              <button id="cartesian-tab" class="control-tab" role="tab" type="button" aria-selected="true" aria-controls="pose-panel"><span data-t="cartesianTitle"></span></button>
              <button id="joint-tab" class="control-tab" role="tab" type="button" aria-selected="false" aria-controls="joint-panel"><span data-t="jointTitle"></span></button>
            </div>
            <button id="motion-collapse" class="motion-collapse" type="button" aria-expanded="true" aria-controls="pose-panel motion-speed pose-actions" aria-label="Collapse Cartesian controls" data-chevron="up">
              <svg class="chevron-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <polyline id="motion-collapse-chevron" points="3.5 10.2 8 5.8 12.5 10.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
          <div class="jog-speed-box" id="motion-speed">
            <div class="jog-speed-heading"><span data-t="speed"></span><output id="jog-speed-readout" for="jog-speed">${DEFAULT_JOG_SPEED}%</output></div>
            <input id="jog-speed" type="range" min="1" max="100" step="1" value="${DEFAULT_JOG_SPEED}" aria-label="Speed" />
          </div>
          <div class="pose-actions" id="pose-actions">
            <button type="button" class="pose-action-btn" id="pose-home" data-t="homePose" disabled></button>
            <button type="button" class="pose-action-btn" id="pose-level" data-t="levelFlange" disabled></button>
          </div>
          <div id="joint-panel" role="tabpanel" aria-labelledby="joint-tab" hidden>
            <div class="joint-list" id="joint-list"></div>
          </div>
          <div id="pose-panel" role="tabpanel" aria-labelledby="cartesian-tab">
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

            <div class="jog-group">
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
        </section>
        </div>
        <div class="selection-stack">
          <section class="selector-card" id="tool-dropdown" aria-labelledby="tool-label">
            <div class="selector-heading">
              <h2 id="tool-label" data-t="toolLabel"></h2>
            </div>
            <div id="tool-menu" class="selector-panel tool-menu" role="group" aria-labelledby="tool-label">
              <label class="tool-group tool-sensor-row" id="tool-sensor-group">
                <span class="tool-group-title" data-t="sensorName"></span>
                <input type="checkbox" id="tool-sensor-check" value="${SENSOR_SPEC.id}" />
              </label>
              <div class="tool-group tool-gripper-group">
                <label class="tool-group-title" for="tool-gripper-select" data-t="gripperGroupLabel"></label>
                <select id="tool-gripper-select"><option value="" data-t="noGripper"></option></select>
              </div>
              <section class="gripper-control" id="gripper-control" hidden>
                <div id="opening-continuous">
                  <label class="visually-hidden" for="opening-number" data-t="opening"></label>
                  <div class="opening-row">
                    <div class="opening-slider">
                      <input id="opening-range" type="range" step="0.1" aria-label="Gripper opening" />
                    </div>
                    <div class="opening-value"><div class="joint-value"><input id="opening-number" type="number" step="0.1" /><span id="opening-unit">mm</span></div></div>
                  </div>
                </div>
                <div id="opening-binary" hidden>
                  <p id="gripper-intro" data-t="liteGripperIntro"></p>
                  <div class="gripper-inputs">
                    <span id="opening-switch-label" data-t="gripperOpening"></span>
                    <div class="gripper-switch-controls">
                      <span id="opening-switch-state"></span>
                      <label class="rail-switch"><input id="opening-switch" type="checkbox" role="switch" aria-labelledby="opening-switch-label" aria-describedby="opening-switch-state" /></label>
                    </div>
                  </div>
                </div>
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
              <div class="rail-motion">
                <button type="button" id="rail-minus" class="rail-jog-btn" data-rail-dir="-1" disabled>−</button>
                <div id="rail-progress" class="joint-progress" role="progressbar" aria-valuemin="${RAIL_SPEC.minMm}" aria-valuemax="${RAIL_SPEC.maxMm}" aria-valuenow="0.0" aria-valuetext="0.0 mm">
                  <span id="rail-fill" class="joint-progress-fill" aria-hidden="true"></span>
                  <span id="rail-marker" class="joint-progress-marker" aria-hidden="true"></span>
                </div>
                <button type="button" id="rail-plus" class="rail-jog-btn" data-rail-dir="1" disabled>+</button>
              </div>
            </div>
          </section>
        </div>
        </div>
      </aside>
    </section>
    <section class="inventory-section" id="assets" aria-labelledby="inventory-title"><div class="page-width inventory-inner"><div><span class="section-index">01 <span>/</span> ASSETS</span><h2 id="inventory-title" data-t="inventoryTitle"></h2><p data-t="inventoryHint"></p></div><div class="asset-list" id="asset-list" role="status" aria-live="polite" aria-atomic="true"></div></div></section>
  </main>
  <footer id="site-footer" class="site-footer"></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

const siteFooter = new SiteFooter($('#site-footer'));

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
  rpy: RPY;
}

interface ActiveJointJog {
  button: HTMLButtonElement;
  pointerId: number;
  index: number;
  dir: 1 | -1;
  continuous: boolean;
  holdTimer: number;
  rafId: number;
  lastTime: number;
}

interface ActiveRailJog {
  button: HTMLButtonElement;
  pointerId: number;
  dir: 1 | -1;
  continuous: boolean;
  holdTimer: number;
  rafId: number;
  lastTime: number;
  targetMm: number;
}

type PresetMotionKind = 'home' | 'level';

interface ActivePresetJog {
  button: HTMLButtonElement;
  pointerId: number;
  kind: PresetMotionKind;
  continuous: boolean;
  holdTimer: number;
  rafId: number;
  lastTime: number;
  target: number[] | undefined;
}

const initialParams = new URLSearchParams(window.location.search);
const initialModelParam = initialParams.get('model');
const legacyGripper = getGripper(initialModelParam);
const legacySensor = initialModelParam === SENSOR_SPEC.id;
const legacyAccessory = Boolean(legacyGripper || legacySensor);
const legacyLite = legacyGripper?.id === 'lite6-gripper' || legacyGripper?.id === 'lite6-vacuum-gripper';
const initialRobot: RobotSpec = getRobotSpec(legacyAccessory ? (legacyLite ? 'lite6' : DEFAULT_ROBOT_ID) : initialModelParam);

const rawRailParam = initialParams.get('rail');
const initialRail = !legacyAccessory && supportsLinearRail(initialRobot.id) && rawRailParam === RAIL_SPEC.id;
const rawRailPos = initialParams.get('railPos');
const validInitialRailPos = initialRail && rawRailPos !== null && rawRailPos.trim() !== '' && validRailPosition(Number(rawRailPos));
const parsedRailMm = validInitialRailPos ? Math.round(Number(rawRailPos) * 10) / 10 : 0;

const rawSensorParam = initialParams.get('sensor');
const initialSensor = legacySensor || (!legacyAccessory && supportsSensor(initialRobot.id) && rawSensorParam === SENSOR_SPEC.id);

const requestedGripper = getGripper(initialParams.get('gripper'));
const initialGripper = legacyGripper ?? (!legacyAccessory && requestedGripper && supportsGripper(initialRobot.id, requestedGripper.id) ? requestedGripper : undefined);
const initialOpening = initialParams.get('opening');
const validInitialOpening = Boolean(initialGripper && initialOpening !== null && initialOpening.trim() !== '' && validOpening(initialGripper, Number(initialOpening)));
const parsedOpening = validInitialOpening ? Math.round(Number(initialOpening) * 10) / 10 : initialGripper?.opening?.max ?? 0;

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
  gripper: initialGripper,
  opening: parsedOpening,
};

type AssemblySnapshot = typeof assembly;
function snapshotAssembly(): AssemblySnapshot {
  return { ...assembly };
}
const linkAssembly = snapshotAssembly();

let language: Language = 'zh';
type SceneNotice = 'savedSceneInvalid' | 'savedSceneCollision' | 'linkSceneCollision' | 'storageUnavailable';
const sceneNotices = new Set<SceneNotice>();
function renderSceneNotices() {
  const target = $('#scene-notices');
  $('#scene-notice-messages').replaceChildren(...[...sceneNotices].map(key => {
    const message = document.createElement('p');
    message.textContent = copy[language][key];
    return message;
  }));
  $('#dismiss-scene-notices').setAttribute('aria-label', copy[language].dismissSceneNotices);
  target.hidden = sceneNotices.size === 0;
}
function showSceneNotice(key: SceneNotice) {
  sceneNotices.add(key);
  renderSceneNotices();
}
$('#dismiss-scene-notices').addEventListener('click', () => {
  sceneNotices.clear();
  renderSceneNotices();
});
const sceneStorage = new SceneStorage(() => window.localStorage, () => showSceneNotice('storageUnavailable'));
const storedScene = sceneStorage.read();
let protectInitialRecord = storedScene.kind === 'invalid' || storedScene.kind === 'unavailable';
if (storedScene.kind === 'invalid') showSceneNotice('savedSceneInvalid');

function useSceneSnapshot(snapshot: SceneSnapshot) {
  Object.assign(assembly, {
    spec: getRobotSpec(snapshot.robot),
    rail: snapshot.rail !== null,
    railMm: snapshot.railMm,
    sensor: snapshot.sensor !== null,
    gripper: getGripper(snapshot.gripper),
    opening: snapshot.opening ?? 0,
  });
}
type LoadAttempt = {
  kind: 'saved' | 'link' | 'default' | 'rollback';
  joints?: number[];
  tcpRpy?: RPY;
  blocked?: CollisionStatusState;
};
let loadAttempt: LoadAttempt | undefined = storedScene.kind === 'valid'
  ? { kind: 'saved', joints: storedScene.snapshot.joints, tcpRpy: storedScene.snapshot.tcpRpy }
  : { kind: 'link' };
if (storedScene.kind === 'valid') useSceneSnapshot(storedScene.snapshot);
let lastValidAssembly: AssemblySnapshot = snapshotAssembly();
let lastValidScene: SceneSnapshot | undefined;

let activeTab: ControlTab = 'cartesian';
const collapsedTabs: Record<ControlTab, boolean> = { cartesian: false, joint: false };
type StatusKey = 'levelFailed' | 'invalid';
type NumericField = 'opening' | 'rail';
interface CollisionStatusState {
  kind: 'motion' | 'accessory';
  pairs: readonly CollisionPair[];
  gripper?: GripperSpec;
}
let statusKey: StatusKey | null = null;
let statusMessage: string | null = null;
let activeCollision: CollisionStatusState | null = null;
const fieldInvalid: Record<NumericField, boolean> = { opening: false, rail: false };
let loadKey: Key = 'loading';
let scene: RobotScene | undefined;
let model: URDFRobot | undefined;
let solver: IKSolver | undefined;
let tcpRpy: RPY | undefined;
let showBaseFrame = false;
let showTcpFrame = false;
let activeJog: ActiveJog | undefined;
let activeJointJog: ActiveJointJog | undefined;
let activeRailJog: ActiveRailJog | undefined;
let activePresetJog: ActivePresetJog | undefined;
let selectionToken = 0;
let selectionAbort: AbortController | undefined;
let sceneReady = false;
let page: 'robot' | 'example' = initialParams.get('example') === 'packing-01' ? 'example' : 'robot';
let packing: PackingExample | undefined;
let packingLoad: Promise<void> | undefined;

function currentSceneSnapshot(): SceneSnapshot | undefined {
  if (!model || !sceneReady) return undefined;
  return {
    version: SCENE_VERSION,
    robot: assembly.spec.id,
    joints: jointValues(model),
    rail: assembly.rail ? RAIL_SPEC.id : null,
    railMm: assembly.rail ? assembly.railMm : 0,
    sensor: assembly.sensor ? SENSOR_SPEC.id : null,
    gripper: assembly.gripper?.id ?? null,
    opening: assembly.gripper?.opening ? assembly.opening : null,
    ...(tcpRpy ? { tcpRpy: [...tcpRpy] as RPY } : {}),
  };
}

/** Called only after a user change has passed its collision check. */
function recordSceneChange() {
  const snapshot = currentSceneSnapshot();
  if (!snapshot || JSON.stringify(snapshot) === JSON.stringify(lastValidScene)) return;
  lastValidScene = snapshot;
  protectInitialRecord = false;
  sceneStorage.queue(snapshot);
}

function updatePageLinks() {
  const robotUrl = new URL(window.location.href);
  robotUrl.searchParams.delete('example');
  const exampleUrl = new URL(robotUrl);
  exampleUrl.searchParams.set('example', 'packing-01');
  $<HTMLAnchorElement>('#page-robot').href = robotUrl.href;
  $<HTMLAnchorElement>('#page-examples').href = exampleUrl.href;
  for (const [selector, selected] of [['#page-robot', page === 'robot'], ['#page-examples', page === 'example']] as const) {
    if (selected) $(selector).setAttribute('aria-current', 'page');
    else $(selector).removeAttribute('aria-current');
  }
}

function setPage(next: 'robot' | 'example', push = false) {
  if (push && next !== page) {
    const url = new URL(window.location.href);
    if (next === 'example') url.searchParams.set('example', 'packing-01');
    else url.searchParams.delete('example');
    window.history.pushState(null, '', url);
  }
  if (page !== next) stopJog(false);
  page = next;
  $('#explore').hidden = next !== 'robot';
  $('#assets').hidden = next !== 'robot';
  $('#packing-page').hidden = next !== 'example';
  updatePageLinks();
  packing?.setVisible(next === 'example');
  if (next === 'example' && !packingLoad) {
    packingLoad = import('./packing').then(({ PackingExample }) => {
      packing = new PackingExample($('#packing-page'));
      packing.setLanguage(language);
      packing.setVisible(page === 'example');
    }).catch(error => {
      console.error('Packing module:', error);
      packingLoad = undefined;
      const target = $('#packing-page');
      target.innerHTML = `<div class="packing-experience page-width packing-module-failure"><div class="stage packing-stage"><div class="stage-notices"><div class="stage-notice load-error" role="alert"><span data-t="exampleFailed"></span><button type="button" data-t="retry"></button></div></div></div></div>`;
      target.querySelector<HTMLElement>('[data-t="exampleFailed"]')!.textContent = copy[language].exampleFailed;
      const retry = target.querySelector<HTMLButtonElement>('button')!;
      retry.textContent = copy[language].retry;
      retry.addEventListener('click', () => location.reload());
    });
  }
  renderSceneCopy();
}

$('#page-robot').addEventListener('click', event => {
  const click = event as MouseEvent;
  if (click.button || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return;
  event.preventDefault(); setPage('robot', true);
});
$('#page-examples').addEventListener('click', event => {
  const click = event as MouseEvent;
  if (click.button || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return;
  event.preventDefault(); setPage('example', true);
});
window.addEventListener('popstate', () => {
  setPage(new URLSearchParams(window.location.search).get('example') === 'packing-01' ? 'example' : 'robot');
  writeUrl();
});

function activeGripperState(): { gripper: GripperSpec | undefined; opening: number } {
  return { gripper: assembly.gripper, opening: assembly.opening };
}

function syncOpeningFields() {
  const { gripper, opening } = activeGripperState();
  if (!gripper?.opening) return;
  const { min, max, mode } = gripper.opening;
  $('#opening-continuous').hidden = mode !== 'continuous';
  $('#opening-binary').hidden = mode !== 'binary';
  const toggle = $<HTMLInputElement>('#opening-switch');
  toggle.checked = opening === max;
  toggle.disabled = !sceneReady;
  $('#opening-switch-state').textContent = toggle.checked ? copy[language].gripperOpen : copy[language].gripperClosed;
  if (mode === 'binary') return;
  const { unit } = gripper.opening;
  const label = copy[language].opening;
  $('#opening-unit').textContent = unit;
  for (const selector of ['#opening-number', '#opening-range']) {
    const input = $<HTMLInputElement>(selector);
    input.min = String(min);
    input.max = String(max);
    input.value = opening.toFixed(1);
    input.disabled = !sceneReady;
  }
  $('#opening-range').setAttribute('aria-label', label);
}

function syncRailFields() {
  const formatted = assembly.railMm.toFixed(1);
  const input = $<HTMLInputElement>('#rail-number');
  input.value = formatted;
  input.disabled = !sceneReady || !assembly.rail;
  const progress = $('#rail-progress');
  progress.setAttribute('aria-label', copy[language].railPosition);
  progress.setAttribute('aria-valuenow', formatted);
  progress.setAttribute('aria-valuetext', `${formatted} mm`);
  const percent = (assembly.railMm - RAIL_SPEC.minMm) / (RAIL_SPEC.maxMm - RAIL_SPEC.minMm) * 100;
  $('#rail-fill').style.left = '0%';
  $('#rail-fill').style.width = `${percent}%`;
  $('#rail-marker').style.left = `${percent}%`;
  for (const [selector, key] of [['#rail-minus', 'railDecrease'], ['#rail-plus', 'railIncrease']] as const) {
    const button = $<HTMLButtonElement>(selector);
    button.disabled = !sceneReady || !assembly.rail;
    button.setAttribute('aria-label', copy[language][key]);
  }
  $('#stage-rail-pos').textContent = sceneReady && assembly.rail ? formatted : '—';
}

function renderMotionPanel() {
  const collapsed = collapsedTabs[activeTab];
  $('#joint-tab').setAttribute('aria-selected', String(activeTab === 'joint'));
  $('#cartesian-tab').setAttribute('aria-selected', String(activeTab === 'cartesian'));
  $('#joint-panel').hidden = activeTab !== 'joint' || collapsed;
  $('#pose-panel').hidden = activeTab !== 'cartesian' || collapsed;
  $('#motion-speed').hidden = collapsed;
  $('#pose-actions').hidden = collapsed;
  const toggle = $<HTMLButtonElement>('#motion-collapse');
  const label = activeTab === 'joint'
    ? copy[language][collapsed ? 'expandJointMotion' : 'collapseJointMotion']
    : copy[language][collapsed ? 'expandMotion' : 'collapseMotion'];
  toggle.setAttribute('aria-controls', `${activeTab === 'joint' ? 'joint-panel' : 'pose-panel'} motion-speed pose-actions`);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', label);
  toggle.dataset.chevron = collapsed ? 'down' : 'up';
  $('#motion-collapse-chevron').setAttribute(
    'points',
    collapsed ? '3.5 5.8 8 10.2 12.5 5.8' : '3.5 10.2 8 5.8 12.5 10.2',
  );
}

function setTab(tab: ControlTab) {
  stopJog(false);
  activeTab = tab;
  renderMotionPanel();
}

function renderSceneCopy() {
  const currentSpec = assembly.spec;
  const { gripper } = activeGripperState();
  const productName = currentSpec.name;
  document.title = page === 'example' ? `${language === 'zh' ? '示例 01：装箱' : 'Example 01: Packing'} — UFACTORY Robot Viewer` : `${productName} — UFACTORY Robot Viewer`;
  $('#explore').setAttribute('aria-label', `${productName} interactive experience`);
  $('#stage-heading').textContent = productName;
  $('#telemetry-joints-range').textContent = `J1–J${currentSpec.dof} · °`;
  $('#control-card').setAttribute('aria-label', copy[language].panelTitle);
  $('#control-tabs [role="tablist"]').setAttribute('aria-label', copy[language].panelTitle);
  renderMotionPanel();
  document.querySelectorAll<HTMLOutputElement>('.joint-angle').forEach((output, index) => {
    output.setAttribute('aria-label', language === 'zh' ? `关节 ${index + 1} 角度` : `Joint ${index + 1} angle`);
  });
  document.querySelectorAll<HTMLElement>('#joint-list .joint-progress').forEach((bar, index) => {
    bar.setAttribute('aria-label', language === 'zh' ? `关节 ${index + 1} 位置` : `Joint ${index + 1} position`);
  });
  document.querySelectorAll<HTMLButtonElement>('.joint-jog-btn').forEach(button => {
    const index = Number(button.dataset.jointIndex) + 1;
    const increase = button.dataset.jointDir === '1';
    button.setAttribute('aria-label', language === 'zh'
      ? `关节 ${index} ${increase ? '增加' : '减小'}`
      : `Joint ${index} ${increase ? 'increase' : 'decrease'}`);
  });
  $('#stage-rail-telemetry').hidden = !assembly.rail;
  $('#gripper-control').hidden = !gripper?.opening;
  $('#rail-panel').hidden = !assembly.rail;
  const sensorSupported = supportsSensor(currentSpec.id);
  const railSupported = supportsLinearRail(currentSpec.id);
  $('#rail-selector').hidden = !railSupported;
  $('#tool-sensor-group').hidden = !sensorSupported;
  $<HTMLSelectElement>('#robot-select').value = currentSpec.id;
  const railToggle = $<HTMLInputElement>('#rail-toggle');
  railToggle.disabled = !railSupported;
  railToggle.checked = assembly.rail;
  const sensorCheck = $<HTMLInputElement>('#tool-sensor-check');
  sensorCheck.disabled = !sensorSupported;
  sensorCheck.checked = assembly.sensor;
  const gripperSelect = $<HTMLSelectElement>('#tool-gripper-select');
  const compatibleGrippers = GRIPPERS.filter(option => supportsGripper(currentSpec.id, option.id));
  const optionIds = Array.from(gripperSelect.options, option => option.value);
  if (optionIds.length !== compatibleGrippers.length + 1 ||
      compatibleGrippers.some((option, index) => optionIds[index + 1] !== option.id)) {
    const noGripperOption = gripperSelect.options[0];
    gripperSelect.replaceChildren(noGripperOption, ...compatibleGrippers.map(option => new Option(option.name, option.id)));
  }
  gripperSelect.value = assembly.gripper?.id ?? '';
  syncOpeningFields();
  syncRailFields();
  const assets: SceneAsset[] = [
    { name: currentSpec.name, productUrl: currentSpec.productUrl, category: 'robot' },
    ...(assembly.rail ? [{ name: RAIL_SPEC.name[language], productUrl: RAIL_SPEC.productUrl, category: 'accessory' as const }] : []),
    ...(assembly.sensor ? [{ name: SENSOR_SPEC.name[language], productUrl: SENSOR_SPEC.productUrl, category: 'accessory' as const }] : []),
    ...(assembly.gripper ? [{ name: assembly.gripper.name, productUrl: assembly.gripper.productUrl, category: 'accessory' as const }] : []),
  ];
  const inventoryState = sceneReady
    ? { status: 'ready' as const, assets }
    : { status: loadKey === 'webgl' ? 'webgl' as const : loadKey === 'failed' ? 'failed' as const : 'loading' as const };
  renderAssetInventory($('#asset-list'), inventoryState, language);
}

function collectCollisionBodies(pairs: readonly CollisionPair[]): CollisionBodyId[] {
  const ids = new Set<CollisionBodyId>();
  for (const pair of pairs) {
    ids.add(pair.first);
    ids.add(pair.second);
  }
  return [...ids];
}

function formatCollisionMessage(state: CollisionStatusState, lang: Language): string {
  const dof = assembly.spec.dof;
  const shown = state.pairs
    .slice(0, 2)
    .map(
      pair =>
        `${formatCollisionBodyName(pair.first, lang, state.gripper, dof)}-${formatCollisionBodyName(pair.second, lang, state.gripper, dof)}`,
    );
  const sep = lang === 'zh' ? '、' : ', ';
  const extraCount = state.pairs.length - shown.length;
  const suffix =
    extraCount > 0
      ? lang === 'zh'
        ? ` 等 ${state.pairs.length} 处`
        : ` (+${extraCount} more)`
      : '';
  const prefix =
    state.kind === 'accessory'
      ? lang === 'zh'
        ? '当前姿态下装配该配件会发生碰撞，已恢复上一配置：'
        : 'Accessory collides at the current pose; previous setup restored: '
      : lang === 'zh'
        ? '检测到碰撞，已阻止继续运动：'
        : 'Collision detected; motion blocked: ';
  return `${prefix}${shown.join(sep)}${suffix}`;
}

function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  siteFooter.setLanguage(language);
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el => { el.textContent = copy[language][el.dataset.t as Key]; });
  $('#language-label').textContent = language === 'zh' ? 'EN' : '中文';
  $('#language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
  $('.page-nav').setAttribute('aria-label', language === 'zh' ? '页面' : 'Pages');
  $('#status-text').textContent = statusMessage ?? (statusKey ? copy[language][statusKey] : '');
  $('#collision-toast-text').textContent = activeCollision ? formatCollisionMessage(activeCollision, language) : '';
  for (const field of ['opening', 'rail'] as const) {
    if (fieldInvalid[field]) $(`#${field}-error-text`).textContent = copy[language].invalid;
  }
  $('#jog-speed').setAttribute('aria-label', copy[language].speed);
  const message = document.querySelector<HTMLElement>('#load-message [data-load-text]');
  if (message) message.textContent = copy[language][loadKey];
  renderSceneNotices();
  renderSceneCopy();
  packing?.setLanguage(language);
}

function setFieldError(field: NumericField, invalid: boolean) {
  fieldInvalid[field] = invalid;
  const input = $<HTMLInputElement>(`#${field}-number`);
  const errorBox = $(`#${field}-error`);
  const errorText = $(`#${field}-error-text`);
  errorBox.hidden = !invalid;
  errorText.textContent = invalid ? copy[language].invalid : '';
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${field}-error`);
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function clearCollisionStatus() {
  activeCollision = null;
  $('#collision-toast').hidden = true;
  $('#collision-toast-text').textContent = '';
}

function status(key: StatusKey | null, error = false) {
  statusKey = key;
  statusMessage = null;
  clearCollisionStatus();
  if (key !== null) scene?.clearCollisionHighlight();
  $('#status-text').textContent = key ? copy[language][key] : '';
  $('#solver-status').hidden = key === null;
  $('#solver-status').classList.toggle('has-message', key !== null);
  $('#solver-status').classList.toggle('error', error);
}

function setJointLimitStatus(jointId: number, angleDeg: number) {
  statusKey = null;
  statusMessage = formatJointLimitMessage(jointId, angleDeg);
  clearCollisionStatus();
  scene?.clearCollisionHighlight();
  $('#status-text').textContent = statusMessage;
  $('#solver-status').hidden = false;
  $('#solver-status').classList.add('has-message', 'error');
}

function setCollisionStatus(state: CollisionStatusState) {
  statusKey = null;
  statusMessage = null;
  $('#status-text').textContent = '';
  $('#solver-status').hidden = true;
  $('#solver-status').classList.remove('has-message', 'error');
  activeCollision = state;
  $('#collision-toast-text').textContent = formatCollisionMessage(state, language);
  $('#collision-toast').hidden = false;
}

function setLoadMessage(key: Key) {
  loadKey = key;
  renderSceneCopy();
  const element = $('#load-message');
  $('#load-overlay').hidden = key !== 'loading';
  element.hidden = key === 'loading';
  element.innerHTML = key === 'loading' ? ''
    : `<span data-load-text>${copy[language][key]}</span><button type="button" id="retry" data-t="retry">${copy[language].retry}</button>`;
  if (key !== 'loading') {
    $('#retry').addEventListener('click', () => {
      if (key === 'webgl') location.reload();
      else void loadSelection(!model);
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

function formatLimitDeg(radians: number): number {
  const rounded = Math.round(MathUtils.radToDeg(radians) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function jointProgressFraction(valueRad: number, bounds: { min: number; max: number }): number {
  const span = bounds.max - bounds.min;
  return span > 0 ? MathUtils.clamp(((valueRad - bounds.min) / span) * 100, 0, 100) : 50;
}

function syncJointFields() {
  if (!model) return;
  const values = jointValues(model);
  const jointLimits = limits(model);
  values.forEach((radians, i) => {
    const deg = MathUtils.radToDeg(radians);
    const formatted = formatValue(deg);
    $(`#joint-angle-${i}`).textContent = `${formatted}°`;
    $(`#stage-joint-${i}`).textContent = formatted;
    const bounds = jointLimits[i];
    if (!bounds) return;
    const zeroPct = jointProgressFraction(0, bounds);
    const currentPct = jointProgressFraction(radians, bounds);
    const fillLeft = Math.min(zeroPct, currentPct);
    const fillWidth = Math.abs(currentPct - zeroPct);
    const bar = $(`#joint-progress-${i}`);
    bar.setAttribute('aria-valuenow', formatted);
    bar.setAttribute('aria-valuetext', `${formatted}°`);
    const fill = $(`#joint-fill-${i}`);
    fill.style.left = `${fillLeft.toFixed(3)}%`;
    fill.style.width = `${fillWidth.toFixed(3)}%`;
    $(`#joint-marker-${i}`).style.left = `${currentPct.toFixed(3)}%`;
  });
}

function syncFKFields() {
  if (!model) return;
  const pose = currentForward();
  tcpRpy = toRPY(pose.quaternion, tcpRpy);
  [...pose.position.toArray().map(value => value * 1000), ...tcpRpy.map(MathUtils.radToDeg)]
    .forEach((value, i) => { $(`#fk-${i}`).textContent = formatValue(value); });
}

function syncTelemetry() {
  syncJointFields();
  syncFKFields();
  syncRailFields();
  scene?.requestRender();
}

function loadJogSpeed(): number {
  try {
    const saved = window.localStorage.getItem(JOG_SPEED_STORAGE_KEY);
    if (saved === null || saved.trim() === '') return DEFAULT_JOG_SPEED;
    const speed = Number(saved);
    return Number.isInteger(speed) && speed >= 1 && speed <= 100 ? speed : DEFAULT_JOG_SPEED;
  } catch {
    return DEFAULT_JOG_SPEED;
  }
}

function updateSpeedReadout() {
  const raw = numberValue($<HTMLInputElement>('#jog-speed'));
  const percent = Number.isFinite(raw) ? MathUtils.clamp(Math.round(raw), 1, 100) : DEFAULT_JOG_SPEED;
  $('#jog-speed-readout').textContent = `${percent}%`;
}

function saveJogSpeed() {
  updateSpeedReadout();
  try {
    window.localStorage.setItem(JOG_SPEED_STORAGE_KEY, $<HTMLInputElement>('#jog-speed').value);
  } catch {
    // Keep the slider usable when browser storage is unavailable.
  }
}

function solveTarget(pose: Pose, referenceRpy?: RPY) {
  if (!solver || !model || !scene) return;
  const prev = jointValues(model);
  const result = solver.solve(pose);
  if (result.ok) {
    const hits = scene.detectCollisions();
    if (hits.length > 0) {
      setJoints(model, prev);
      syncTelemetry();
      scene.setCollisionHighlight(collectCollisionBodies(hits));
      setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
      return;
    }
    scene.clearCollisionHighlight();
    if (referenceRpy) tcpRpy = [...referenceRpy];
    syncTelemetry();
    status(null);
    recordSceneChange();
  } else {
    if (result.reason === 'invalid') status('invalid', true);
    else if (result.reason === 'joint_limit' && result.exceededJointId !== undefined && result.exceededAngleDeg !== undefined) {
      setJointLimitStatus(result.exceededJointId, result.exceededAngleDeg);
    } else {
      scene.clearCollisionHighlight();
      status(null);
    }
  }
}

function executeSingleStep(axis: CartesianAxis, dir: 1 | -1) {
  if (!model) return;
  const step = axis === 'x' || axis === 'y' || axis === 'z' ? DEFAULT_LINEAR_STEP_MM : DEFAULT_ANGULAR_STEP_DEG;
  const nextPose = stepBasePose(currentForward(), axis, dir * step, tcpRpy);
  const nextRpy = toRPY(nextPose.quaternion, tcpRpy);
  solveTarget(nextPose, nextRpy);
}

function startContinuousJog(jog: ActiveJog) {
  if (!model || activeJog !== jog) return;
  jog.continuous = true;
  const startPose = currentForward();
  jog.position = startPose.position.clone();
  jog.rpy = toRPY(startPose.quaternion, tcpRpy);
  jog.lastTime = performance.now();
  const initialQuaternion = startPose.quaternion.clone();

  const advance = (dt: number) => {
    if (!model || !solver || dt <= 0) return;
    const rawPercent = numberValue($<HTMLInputElement>('#jog-speed'));
    const { linearMmPerSec, angularDegPerSec } = jogVelocity(Number.isFinite(rawPercent) ? rawPercent : DEFAULT_JOG_SPEED);
    const nextPos = jog.position.clone();
    const nextRpy: RPY = [...jog.rpy];
    let nextPose: Pose;
    if (jog.axis === 'x' || jog.axis === 'y' || jog.axis === 'z') {
      nextPos[jog.axis] += (jog.dir * linearMmPerSec * dt) / 1000;
      nextPose = { position: nextPos, quaternion: initialQuaternion.clone() };
    } else {
      const index = jog.axis === 'roll' ? 0 : jog.axis === 'pitch' ? 1 : 2;
      nextRpy[index] += MathUtils.degToRad(jog.dir * angularDegPerSec * dt);
      nextPose = { position: nextPos, quaternion: fromRPY(...nextRpy) };
    }
    const prev = jointValues(model);
    const result = solver.solve(nextPose);
    if (result.ok) {
      const hits = scene?.detectCollisions() ?? [];
      if (hits.length > 0) {
        setJoints(model, prev);
        syncTelemetry();
        scene?.setCollisionHighlight(collectCollisionBodies(hits));
        setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
        stopJog(false);
        return;
      }
      scene?.clearCollisionHighlight();
      jog.position.copy(nextPos);
      jog.rpy = nextRpy;
      tcpRpy = [...nextRpy];
      syncTelemetry();
      status(null);
      recordSceneChange();
    } else {
      if (result.reason === 'invalid') status('invalid', true);
      else if (result.reason === 'joint_limit' && result.exceededJointId !== undefined && result.exceededAngleDeg !== undefined) {
        setJointLimitStatus(result.exceededJointId, result.exceededAngleDeg);
        stopJog(false);
      } else {
        scene?.clearCollisionHighlight();
        status(null);
      }
    }
  };

  const tick = () => {
    if (activeJog !== jog) return;
    const now = performance.now();
    const dt = Math.min(Math.max((now - jog.lastTime) / 1000, 0), 0.25);
    jog.lastTime = now;
    advance(dt);
    if (activeJog === jog) jog.rafId = requestAnimationFrame(tick);
  };
  advance(1 / 60);
  if (activeJog === jog) jog.rafId = requestAnimationFrame(tick);
}

function stopJog(executeTapIfShort = false) {
  const wasJogging = Boolean(activeJog || activeJointJog || activeRailJog || activePresetJog);
  const jog = activeJog;
  activeJog = undefined;
  if (jog) {
    window.clearTimeout(jog.holdTimer);
    if (jog.rafId) cancelAnimationFrame(jog.rafId);
    jog.button.classList.remove('is-jogging');
    if (jog.button.hasPointerCapture?.(jog.pointerId)) {
      try { jog.button.releasePointerCapture(jog.pointerId); } catch { /* already released */ }
    }
    if (executeTapIfShort && !jog.continuous) executeSingleStep(jog.axis, jog.dir);
  }
  const joint = activeJointJog;
  activeJointJog = undefined;
  if (joint) {
    window.clearTimeout(joint.holdTimer);
    if (joint.rafId) cancelAnimationFrame(joint.rafId);
    joint.button.classList.remove('is-jogging');
    if (joint.button.hasPointerCapture?.(joint.pointerId)) {
      try { joint.button.releasePointerCapture(joint.pointerId); } catch { /* already released */ }
    }
    if (executeTapIfShort && !joint.continuous) moveJoint(joint.index, joint.dir);
  }
  const rail = activeRailJog;
  activeRailJog = undefined;
  if (rail) {
    window.clearTimeout(rail.holdTimer);
    if (rail.rafId) cancelAnimationFrame(rail.rafId);
    rail.button.classList.remove('is-jogging');
    if (rail.button.hasPointerCapture?.(rail.pointerId)) {
      try { rail.button.releasePointerCapture(rail.pointerId); } catch { /* already released */ }
    }
    if (executeTapIfShort && !rail.continuous) moveRailToward(assembly.railMm + rail.dir * DEFAULT_LINEAR_STEP_MM);
  }
  const preset = activePresetJog;
  activePresetJog = undefined;
  if (preset) {
    window.clearTimeout(preset.holdTimer);
    if (preset.rafId) cancelAnimationFrame(preset.rafId);
    preset.button.classList.remove('is-jogging');
    if (preset.button.hasPointerCapture?.(preset.pointerId)) {
      try { preset.button.releasePointerCapture(preset.pointerId); } catch { /* already released */ }
    }
    if (executeTapIfShort && !preset.continuous) executePresetStep(preset.kind);
  }
  if (wasJogging) sceneStorage.flush();
}

/** Synchronized joint-space interpolation with <= 1° per-joint travel between collision checks. */
function stepTowardsJointTarget(target: readonly number[], maxAngleRad: number): 'moving' | 'done' | 'blocked' {
  if (!model || !scene || !sceneReady) return 'blocked';
  let budget = maxAngleRad;
  const maxSubstep = MathUtils.degToRad(1);
  while (true) {
    const prev = jointValues(model);
    const deltas = target.map((goal, i) => goal - prev[i]);
    const maxDelta = Math.max(0, ...deltas.map(Math.abs));
    if (maxDelta <= 1e-10) {
      setJoints(model, target);
      scene.clearCollisionHighlight();
      syncTelemetry();
      status(null);
      return 'done';
    }
    if (budget <= 1e-10) {
      syncTelemetry();
      return 'moving';
    }
    const step = Math.min(budget, maxSubstep, maxDelta);
    const ratio = step / maxDelta;
    const next = ratio >= 1 ? [...target] : prev.map((angle, i) => angle + deltas[i] * ratio);
    if (!setJoints(model, next)) return 'blocked';
    const hits = scene.detectCollisions();
    if (hits.length > 0) {
      setJoints(model, prev);
      syncTelemetry();
      scene.setCollisionHighlight(collectCollisionBodies(hits));
      setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
      return 'blocked';
    }
    scene.clearCollisionHighlight();
    syncTelemetry();
    status(null);
    recordSceneChange();
    budget -= step;
    if (ratio >= 1) {
      syncTelemetry();
      return 'done';
    }
  }
}

function resolvePresetTarget(kind: PresetMotionKind): number[] | undefined {
  if (!model || !scene || !sceneReady) return undefined;
  if (kind === 'home') return homeJoints(assembly.spec.dof);
  const origin = jointValues(model);
  const target = levelFlange(model, assembly.spec.eeLink);
  setJoints(model, origin);
  if (!target) {
    scene.clearCollisionHighlight();
    syncTelemetry();
    status('levelFailed', true);
    return undefined;
  }
  return target;
}

function executePresetStep(kind: PresetMotionKind) {
  const target = resolvePresetTarget(kind);
  if (!target) return;
  stepTowardsJointTarget(target, MathUtils.degToRad(DEFAULT_ANGULAR_STEP_DEG));
}

function startContinuousPreset(preset: ActivePresetJog) {
  if (!model || !scene || !sceneReady || activePresetJog !== preset) return;
  preset.continuous = true;
  const target = resolvePresetTarget(preset.kind);
  if (!target) {
    stopJog(false);
    return;
  }
  preset.target = target;
  preset.lastTime = performance.now();

  const advance = (dt: number): boolean => {
    if (!preset.target || dt <= 0) return true;
    const raw = numberValue($<HTMLInputElement>('#jog-speed'));
    const degPerSec = jointVelocity(Number.isFinite(raw) ? raw : DEFAULT_JOG_SPEED);
    return stepTowardsJointTarget(preset.target, MathUtils.degToRad(degPerSec * dt)) === 'moving';
  };

  if (stepTowardsJointTarget(target, 0) !== 'moving' || !advance(1 / 60)) {
    stopJog(false);
    return;
  }

  const tick = () => {
    if (activePresetJog !== preset) return;
    const now = performance.now();
    const dt = Math.min(Math.max((now - preset.lastTime) / 1000, 0), 0.25);
    preset.lastTime = now;
    if (!advance(dt)) {
      stopJog(false);
      return;
    }
    if (activePresetJog === preset) preset.rafId = requestAnimationFrame(tick);
  };
  preset.rafId = requestAnimationFrame(tick);
}

/** Apply at most one degree per collision check, retaining the last safe pose. */
function moveJoint(index: number, deltaDegrees: number): boolean {
  if (!model || !scene || !sceneReady) return false;
  const bounds = limits(model)[index];
  if (!bounds) return false;
  let remaining = MathUtils.degToRad(deltaDegrees);
  const maxStep = MathUtils.degToRad(1);
  while (Math.abs(remaining) > 1e-10) {
    const prev = jointValues(model);
    const requested = Math.sign(remaining) * Math.min(Math.abs(remaining), maxStep);
    const next = MathUtils.clamp(prev[index] + requested, bounds.min, bounds.max);
    if (Math.abs(next - prev[index]) < 1e-10) return false;
    const angles = [...prev];
    angles[index] = next;
    if (!setJoints(model, angles)) return false;
    const hits = scene.detectCollisions();
    if (hits.length) {
      setJoints(model, prev);
      syncTelemetry();
      scene.setCollisionHighlight(collectCollisionBodies(hits));
      setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
      return false;
    }
    scene.clearCollisionHighlight();
    syncTelemetry();
    status(null);
    recordSceneChange();
    remaining -= requested;
    if (next === bounds.min || next === bounds.max) return false;
  }
  return true;
}

function startContinuousJoint(jog: ActiveJointJog) {
  if (!model || activeJointJog !== jog) return;
  jog.continuous = true;
  jog.lastTime = performance.now();
  const tick = () => {
    if (activeJointJog !== jog) return;
    const now = performance.now();
    const dt = Math.min(Math.max((now - jog.lastTime) / 1000, 0), 0.25);
    jog.lastTime = now;
    const raw = numberValue($<HTMLInputElement>('#jog-speed'));
    if (dt > 0 && !moveJoint(jog.index, jog.dir * jointVelocity(Number.isFinite(raw) ? raw : DEFAULT_JOG_SPEED) * dt)) {
      stopJog(false);
      return;
    }
    if (activeJointJog === jog) jog.rafId = requestAnimationFrame(tick);
  };
  jog.rafId = requestAnimationFrame(tick);
}

function bindJointButton(button: HTMLButtonElement) {
  const index = Number(button.dataset.jointIndex);
  const dir = Number(button.dataset.jointDir) as 1 | -1;
  button.addEventListener('pointerdown', event => {
    if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    stopJog(false);
    button.focus({ preventScroll: true });
    try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    button.classList.add('is-jogging');
    const jog: ActiveJointJog = { button, pointerId: event.pointerId, index, dir, continuous: false, holdTimer: 0, rafId: 0, lastTime: 0 };
    activeJointJog = jog;
    jog.holdTimer = window.setTimeout(() => startContinuousJoint(jog), LONG_PRESS_MS);
  });
  button.addEventListener('pointerup', event => {
    if (activeJointJog?.button === button && activeJointJog.pointerId === event.pointerId) stopJog(true);
  });
  button.addEventListener('pointercancel', () => { if (activeJointJog?.button === button) stopJog(false); });
  button.addEventListener('lostpointercapture', () => { if (activeJointJog?.button === button) stopJog(false); });
  button.addEventListener('blur', () => { if (activeJointJog?.button === button) stopJog(false); });
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('click', event => {
    if (!button.disabled && event.detail === 0) { stopJog(false); moveJoint(index, dir); }
  });
  button.addEventListener('keydown', event => {
    if (button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (!event.repeat) { stopJog(false); moveJoint(index, dir); }
  });
}

/** Move on the 0.1 mm grid, checking for collisions at most 1 mm apart. */
function moveRailToward(targetMm: number): boolean {
  if (!scene || !sceneReady || !assembly.rail) return false;
  const target = MathUtils.clamp(targetMm, RAIL_SPEC.minMm, RAIL_SPEC.maxMm);
  const targetUnits = Math.round(target * 10);
  const originalUnits = Math.round(assembly.railMm * 10);
  let currentUnits = originalUnits;
  let hits: readonly CollisionPair[] = [];
  let failed = false;
  setFieldError('rail', false);

  while (currentUnits !== targetUnits) {
    const step = Math.sign(targetUnits - currentUnits) * Math.min(10, Math.abs(targetUnits - currentUnits));
    if (!scene.setRailPosition((currentUnits + step) / 10)) {
      failed = true;
      break;
    }
    hits = scene.detectCollisions();
    if (hits.length) {
      scene.setRailPosition(currentUnits / 10);
      break;
    }
    currentUnits += step;
  }

  if (currentUnits !== originalUnits) {
    assembly.railMm = currentUnits / 10;
    lastValidAssembly = snapshotAssembly();
    syncRailFields();
    writeUrl();
    recordSceneChange();
  }
  if (hits.length) {
    syncRailFields();
    scene.setCollisionHighlight(collectCollisionBodies(hits));
    setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
    return false;
  }
  if (failed) return false;
  if (currentUnits !== originalUnits) {
    scene.clearCollisionHighlight();
    status(null);
  }
  return target > RAIL_SPEC.minMm && target < RAIL_SPEC.maxMm;
}

function startContinuousRail(jog: ActiveRailJog) {
  if (!sceneReady || activeRailJog !== jog) return;
  jog.continuous = true;
  jog.lastTime = performance.now();
  const tick = () => {
    if (activeRailJog !== jog) return;
    const now = performance.now();
    const dt = Math.min(Math.max((now - jog.lastTime) / 1000, 0), 0.25);
    jog.lastTime = now;
    const raw = numberValue($<HTMLInputElement>('#jog-speed'));
    const speed = jogVelocity(Number.isFinite(raw) ? raw : DEFAULT_JOG_SPEED).linearMmPerSec;
    jog.targetMm = MathUtils.clamp(jog.targetMm + jog.dir * speed * dt, RAIL_SPEC.minMm, RAIL_SPEC.maxMm);
    if (dt > 0 && !moveRailToward(jog.targetMm)) {
      stopJog(false);
      return;
    }
    if (activeRailJog === jog) jog.rafId = requestAnimationFrame(tick);
  };
  jog.rafId = requestAnimationFrame(tick);
}

function bindRailButton(button: HTMLButtonElement) {
  const dir = Number(button.dataset.railDir) as 1 | -1;
  button.addEventListener('pointerdown', event => {
    if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    stopJog(false);
    button.focus({ preventScroll: true });
    try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    button.classList.add('is-jogging');
    const jog: ActiveRailJog = {
      button, pointerId: event.pointerId, dir, continuous: false, holdTimer: 0, rafId: 0,
      lastTime: 0, targetMm: assembly.railMm,
    };
    activeRailJog = jog;
    jog.holdTimer = window.setTimeout(() => startContinuousRail(jog), LONG_PRESS_MS);
  });
  button.addEventListener('pointerup', event => {
    if (activeRailJog?.button === button && activeRailJog.pointerId === event.pointerId) stopJog(true);
  });
  button.addEventListener('pointercancel', () => { if (activeRailJog?.button === button) stopJog(false); });
  button.addEventListener('lostpointercapture', () => { if (activeRailJog?.button === button) stopJog(false); });
  button.addEventListener('blur', () => { if (activeRailJog?.button === button) stopJog(false); });
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('click', event => {
    if (!button.disabled && event.detail === 0) { stopJog(false); moveRailToward(assembly.railMm + dir * DEFAULT_LINEAR_STEP_MM); }
  });
  button.addEventListener('keydown', event => {
    if (button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (!event.repeat) { stopJog(false); moveRailToward(assembly.railMm + dir * DEFAULT_LINEAR_STEP_MM); }
  });
}

function bindPresetButton(button: HTMLButtonElement, kind: PresetMotionKind) {
  button.addEventListener('pointerdown', event => {
    if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    stopJog(false);
    button.focus({ preventScroll: true });
    try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    button.classList.add('is-jogging');
    const preset: ActivePresetJog = {
      button,
      pointerId: event.pointerId,
      kind,
      continuous: false,
      holdTimer: 0,
      rafId: 0,
      lastTime: 0,
      target: undefined,
    };
    activePresetJog = preset;
    preset.holdTimer = window.setTimeout(() => startContinuousPreset(preset), LONG_PRESS_MS);
  });
  button.addEventListener('pointerup', event => {
    if (activePresetJog?.button === button && activePresetJog.pointerId === event.pointerId) stopJog(true);
  });
  button.addEventListener('pointercancel', () => { if (activePresetJog?.button === button) stopJog(false); });
  button.addEventListener('lostpointercapture', () => { if (activePresetJog?.button === button) stopJog(false); });
  button.addEventListener('blur', () => { if (activePresetJog?.button === button) stopJog(false); });
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('click', event => {
    if (!button.disabled && event.detail === 0) {
      stopJog(false);
      executePresetStep(kind);
    }
  });
  button.addEventListener('keydown', event => {
    if (button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (!event.repeat) {
      stopJog(false);
      executePresetStep(kind);
    }
  });
}

function bindJogButtons() {
  document.querySelectorAll<HTMLButtonElement>('.jog-btn').forEach(button => {
    const axis = button.dataset.jogAxis as CartesianAxis;
    const dir = Number(button.dataset.jogDir) as 1 | -1;

    button.addEventListener('pointerdown', event => {
      if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      stopJog(false);
      button.focus({ preventScroll: true });
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
        rpy: toRPY(current.quaternion, tcpRpy),
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
    button.addEventListener('blur', () => { if (activeJog?.button === button) stopJog(false); });
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.addEventListener('click', event => {
      if (!button.disabled && event.detail === 0) {
        stopJog(false);
        executeSingleStep(axis, dir);
      }
    });
    button.addEventListener('keydown', event => {
      if (button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      if (!event.repeat) {
        stopJog(false);
        executeSingleStep(axis, dir);
      }
    });
  });

  bindPresetButton($<HTMLButtonElement>('#pose-home'), 'home');
  bindPresetButton($<HTMLButtonElement>('#pose-level'), 'level');
  document.querySelectorAll<HTMLButtonElement>('.rail-jog-btn').forEach(bindRailButton);

  const stopAndFlush = () => { stopJog(false); sceneStorage.flush(); };
  window.addEventListener('blur', stopAndFlush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAndFlush(); });
  window.addEventListener('pagehide', stopAndFlush);
}

function applyControlAvailability(spec: RobotSpec, ready: boolean) {
  const disabledAxes = new Set(spec.disabledJogAxes ?? []);
  document.querySelectorAll<HTMLButtonElement>('#toggle-base-frame, #toggle-tcp-frame, #pose-home, #pose-level').forEach(button => {
    button.disabled = !ready;
  });
  document.querySelectorAll<HTMLButtonElement>('.joint-jog-btn').forEach(button => { button.disabled = !ready; });
  document.querySelectorAll<HTMLButtonElement>('.rail-jog-btn').forEach(button => { button.disabled = !ready || !assembly.rail; });
  $<HTMLInputElement>('#rail-number').disabled = !ready || !assembly.rail;
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
  jointList.innerHTML = limits(robot).map((bounds, i) => {
    const minDeg = formatLimitDeg(bounds.min);
    const maxDeg = formatLimitDeg(bounds.max);
    const zeroPct = jointProgressFraction(0, bounds).toFixed(3);
    const progressLabel = language === 'zh' ? `关节 ${i + 1} 位置` : `Joint ${i + 1} position`;
    const angleLabel = language === 'zh' ? `关节 ${i + 1} 角度` : `Joint ${i + 1} angle`;
    return `
    <div class="joint-row">
      <span class="joint-label">J${i + 1}</span>
      <button type="button" class="joint-jog-btn" data-joint-index="${i}" data-joint-dir="-1" disabled>−</button>
      <div class="joint-meter">
        <div class="joint-meter-head">
          <span class="joint-limit">${minDeg}°</span>
          <output id="joint-angle-${i}" class="joint-angle" aria-label="${angleLabel}">0.00°</output>
          <span class="joint-limit">${maxDeg}°</span>
        </div>
        <div id="joint-progress-${i}" class="joint-progress" role="progressbar" aria-label="${progressLabel}" aria-valuemin="${minDeg}" aria-valuemax="${maxDeg}" aria-valuenow="0.00" aria-valuetext="0.00°">
          <span class="joint-progress-zero" style="left: ${zeroPct}%" aria-hidden="true"></span>
          <span id="joint-fill-${i}" class="joint-progress-fill" style="left: ${zeroPct}%; width: 0%" aria-hidden="true"></span>
          <span id="joint-marker-${i}" class="joint-progress-marker" style="left: ${zeroPct}%" aria-hidden="true"></span>
        </div>
      </div>
      <button type="button" class="joint-jog-btn" data-joint-index="${i}" data-joint-dir="1" disabled>+</button>
    </div>`;
  }).join('');
  jointList.querySelectorAll<HTMLButtonElement>('.joint-jog-btn').forEach(bindJointButton);
  syncTelemetry();
}

function writeUrl() {
  const url = new URL(window.location.href);
  const { gripper, opening } = activeGripperState();
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
  if (gripper) url.searchParams.set('gripper', gripper.id);
  else url.searchParams.delete('gripper');
  if (gripper?.opening) url.searchParams.set('opening', opening.toFixed(1));
  else url.searchParams.delete('opening');
  window.history.replaceState(null, '', url);
  updatePageLinks();
}

function syncStageAttributes(stage: HTMLElement, spec: RobotSpec) {
  stage.dataset.robot = spec.id;
  if (assembly.gripper) stage.dataset.gripper = assembly.gripper.id;
  else delete stage.dataset.gripper;
  if (assembly.sensor) stage.dataset.sensor = SENSOR_SPEC.id;
  else delete stage.dataset.sensor;
  if (assembly.rail) stage.dataset.rail = RAIL_SPEC.id;
  else delete stage.dataset.rail;
}

function fallbackInitialScene(reason: 'invalid' | 'collision'): boolean {
  if (loadAttempt?.kind === 'saved') {
    protectInitialRecord = true;
    showSceneNotice(reason === 'collision' ? 'savedSceneCollision' : 'savedSceneInvalid');
    Object.assign(assembly, linkAssembly);
    loadAttempt = { kind: 'link' };
  } else if (loadAttempt?.kind === 'link') {
    protectInitialRecord = true;
    showSceneNotice('linkSceneCollision');
    Object.assign(assembly, {
      spec: getRobotSpec(DEFAULT_ROBOT_ID), rail: false, railMm: 0,
      sensor: false, gripper: undefined, opening: 0,
    });
    loadAttempt = { kind: 'default' };
  } else {
    return false;
  }
  writeUrl();
  void loadSelection(true);
  return true;
}

/** A new selection invalidates both pending loads and their error messages. */
async function loadSelection(reloadRobot: boolean) {
  const token = ++selectionToken;
  selectionAbort?.abort();
  const controller = new AbortController();
  selectionAbort = controller;
  scene?.hideReachRing();
  stopJog(false);
  sceneReady = false;
  setFieldError('opening', false);
  setFieldError('rail', false);
  const spec = assembly.spec;
  if (reloadRobot) {
    model = undefined;
    solver = undefined;
    resetTelemetryPlaceholders(spec.dof);
    $('#joint-list').innerHTML = '';
  }
  renderSceneCopy();
  applyControlAvailability(spec, false);

  const stage = $('#stage');
  delete stage.dataset.ready;
  syncStageAttributes(stage, spec);

  if (!scene) return;
  scene.clearCollisionHighlight();
  setLoadMessage('loading');
  status(null);
  const accessoryConfig = {
    rail: assembly.rail,
    railMm: assembly.railMm,
    sensor: assembly.sensor,
    gripper: assembly.gripper,
    opening: assembly.opening,
  };
  const preparedAccessories = scene.prepareAccessories(accessoryConfig, controller.signal);

  try {
    const attempt = loadAttempt;
    let blockedAccessoryState: CollisionStatusState | null = null;
    const freshRobot = reloadRobot || !model;
    if (freshRobot) {
      const loaded = await scene.load(spec, controller.signal);
      if (!loaded || token !== selectionToken) return;
      model = loaded;
      setJoints(model, homeJoints(spec.dof));
      // Construct the arm-only IK tree before attaching accessories.
      solver = new IKSolver(model, spec.eeLink);
      setupControls(model);
      applyControlAvailability(spec, false);
    }
    if (attempt?.joints && !setJoints(model!, attempt.joints)) {
      if (fallbackInitialScene('invalid')) return;
      throw new Error('Saved joint angles are outside the robot limits');
    }
    const configured = await scene.setAssemblyAccessories(accessoryConfig, spec, preparedAccessories);
    if (!configured || token !== selectionToken) return;

    const hits = scene.detectCollisions();
    if (hits.length > 0 && attempt && attempt.kind !== 'rollback') {
      if (fallbackInitialScene('collision')) return;
      throw new Error('Default scene has a collision');
    }
    if (hits.length > 0 && attempt?.kind === 'rollback') {
      throw new Error('Unable to restore the previous collision-free scene');
    }
    if (hits.length > 0 && !freshRobot && lastValidAssembly.spec.id === spec.id && lastValidScene) {
      const rejectedGripper = assembly.gripper ?? lastValidAssembly.gripper;
      Object.assign(assembly, lastValidAssembly);
      syncStageAttributes(stage, spec);
      writeUrl();
      renderSceneCopy();
      const restored = await scene.setAssemblyAccessories(
        {
          rail: assembly.rail,
          railMm: assembly.railMm,
          sensor: assembly.sensor,
          gripper: assembly.gripper,
          opening: assembly.opening,
        },
        spec,
      );
      if (!restored || token !== selectionToken) return;
      blockedAccessoryState = { kind: 'accessory', pairs: hits, gripper: rejectedGripper };
    } else if (hits.length > 0 && lastValidScene) {
      const previous = lastValidScene;
      const blocked: CollisionStatusState = { kind: 'accessory', pairs: hits, gripper: assembly.gripper };
      useSceneSnapshot(previous);
      loadAttempt = { kind: 'rollback', joints: previous.joints, tcpRpy: previous.tcpRpy, blocked };
      writeUrl();
      void loadSelection(true);
      return;
    } else if (hits.length > 0) {
      loadAttempt = { kind: 'link' };
      if (fallbackInitialScene('collision')) return;
      throw new Error('Scene has a collision');
    } else {
      lastValidAssembly = snapshotAssembly();
    }

    const offset = currentToolOffset();
    solver!.setToolOffset(offset);
    scene.setToolOffset(offset);
    scene.setReachRing(spec, assembly.sensor, assembly.gripper?.id);
    if (attempt || freshRobot) {
      const savedRpy = attempt?.tcpRpy;
      tcpRpy = savedRpy && fromRPY(...savedRpy).angleTo(currentForward().quaternion) <= 0.0001
        ? [...savedRpy] : undefined;
    }
    syncTelemetry();
    sceneReady = true;
    renderSceneCopy();
    applyControlAvailability(spec, true);
    $('#load-overlay').hidden = true;
    $('#load-message').hidden = true;
    blockedAccessoryState ??= attempt?.blocked ?? null;
    if (blockedAccessoryState) {
      scene.setCollisionHighlight(collectCollisionBodies(blockedAccessoryState.pairs));
      setCollisionStatus(blockedAccessoryState);
    } else {
      scene.clearCollisionHighlight();
      status(null);
    }
    if (attempt) {
      lastValidAssembly = snapshotAssembly();
      lastValidScene = currentSceneSnapshot();
      if (attempt.kind === 'link' && !protectInitialRecord && lastValidScene) sceneStorage.queue(lastValidScene);
      loadAttempt = undefined;
      writeUrl();
    } else if (!blockedAccessoryState) {
      recordSceneChange();
    }
    stage.dataset.ready = 'true';
  } catch (error) {
    if (token === selectionToken) {
      console.error(error);
      setLoadMessage('failed');
    }
  } finally {
    preparedAccessories.discard();
  }
}

$('#robot-select').addEventListener('change', event => {
  const nextSpec = getRobotSpec((event.target as HTMLSelectElement).value);
  if (nextSpec.id === assembly.spec.id && sceneReady) return;
  loadAttempt = undefined;
  assembly.spec = nextSpec;
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
  if (nextRail === assembly.rail && sceneReady) return;
  loadAttempt = undefined;
  if (nextRail !== assembly.rail) assembly.railMm = 0;
  assembly.rail = nextRail;
  writeUrl();
  void loadSelection(!model);
});

$('#tool-sensor-check').addEventListener('change', event => {
  const nextSensor = (event.target as HTMLInputElement).checked;
  if (nextSensor && !supportsSensor(assembly.spec.id)) {
    renderSceneCopy();
    return;
  }
  if (nextSensor === assembly.sensor && sceneReady) return;
  loadAttempt = undefined;
  assembly.sensor = nextSensor;
  writeUrl();
  void loadSelection(!model);
});

$('#tool-gripper-select').addEventListener('change', event => {
  const target = event.target as HTMLSelectElement;
  const next = getGripper(target.value);
  if ((target.value && !next) || (next && !supportsGripper(assembly.spec.id, next.id))) {
    renderSceneCopy();
    return;
  }
  if (next?.id === assembly.gripper?.id && sceneReady) return;
  loadAttempt = undefined;
  if (next?.id !== assembly.gripper?.id) assembly.opening = next?.opening?.max ?? 0;
  assembly.gripper = next;
  writeUrl();
  void loadSelection(!model);
});

function setOpening(value: number) {
  const active = activeGripperState();
  if (!active.gripper || !sceneReady || !scene) { syncOpeningFields(); return; }
  stopJog(false);
  const prevOpening = active.opening;
  if (activeCollision && validOpening(active.gripper, value) && Math.round(value * 10) === Math.round(prevOpening * 10)) {
    setFieldError('opening', false);
    return;
  }
  if (!validOpening(active.gripper, value) || !scene.setGripperOpening(value)) {
    syncOpeningFields();
    setFieldError('opening', true);
    return;
  }
  setFieldError('opening', false);
  {
    const hits = scene.detectCollisions();
    if (hits.length > 0) {
      scene.setGripperOpening(prevOpening);
      syncOpeningFields();
      scene.setCollisionHighlight(collectCollisionBodies(hits));
      setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
      return;
    }
    scene.clearCollisionHighlight();
  }
  const rounded = Math.round(value * 10) / 10;
  assembly.opening = rounded;
  lastValidAssembly = snapshotAssembly();
  syncOpeningFields();
  status(null);
  writeUrl();
  recordSceneChange();
}
$('#opening-range').addEventListener('input', event => setOpening(numberValue(event.target as HTMLInputElement)));
for (const event of ['pointerup', 'pointercancel', 'keyup', 'blur']) {
  $('#opening-range').addEventListener(event, () => sceneStorage.flush());
}
$('#opening-number').addEventListener('input', () => { if (fieldInvalid.opening) setFieldError('opening', false); });
$('#opening-number').addEventListener('change', event => setOpening(numberValue(event.target as HTMLInputElement)));
$('#opening-number').addEventListener('blur', () => sceneStorage.flush());
$('#opening-switch').addEventListener('change', event => {
  const opening = activeGripperState().gripper?.opening;
  if (opening?.mode !== 'binary') return;
  setOpening((event.target as HTMLInputElement).checked ? opening.max : opening.min);
});

function changeRailPosition(event: Event) {
  if (!assembly.rail || !sceneReady || !scene) return;
  stopJog(false);
  const value = numberValue(event.target as HTMLInputElement);
  const prevRailMm = assembly.railMm;
  if (activeCollision && validRailPosition(value) && Math.round(value * 10) === Math.round(prevRailMm * 10)) {
    setFieldError('rail', false);
    return;
  }
  if (!validRailPosition(value) || !scene.setRailPosition(value)) {
    syncRailFields();
    setFieldError('rail', true);
    return;
  }
  setFieldError('rail', false);
  const hits = scene.detectCollisions();
  if (hits.length > 0) {
    scene.setRailPosition(prevRailMm);
    syncRailFields();
    scene.setCollisionHighlight(collectCollisionBodies(hits));
    setCollisionStatus({ kind: 'motion', pairs: hits, gripper: assembly.gripper });
    return;
  }
  scene.clearCollisionHighlight();
  assembly.railMm = Math.round(value * 10) / 10;
  lastValidAssembly = snapshotAssembly();
  syncRailFields();
  status(null);
  writeUrl();
  recordSceneChange();
}
$('#rail-number').addEventListener('input', () => { if (fieldInvalid.rail) setFieldError('rail', false); });
$('#rail-number').addEventListener('change', changeRailPosition);
$('#rail-number').addEventListener('blur', () => sceneStorage.flush());

$('#language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; translate(); });
$('#joint-tab').addEventListener('click', () => setTab('joint'));
$('#cartesian-tab').addEventListener('click', () => setTab('cartesian'));
$('#motion-collapse').addEventListener('click', () => {
  stopJog(false);
  collapsedTabs[activeTab] = !collapsedTabs[activeTab];
  renderMotionPanel();
});
$('#jog-speed').addEventListener('input', saveJogSpeed);
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
$<HTMLInputElement>('#jog-speed').value = String(loadJogSpeed());
updateSpeedReadout();
translate();
setLoadMessage('loading');

function sceneCanvas(): HTMLCanvasElement { return $<HTMLCanvasElement>('#canvas-area canvas'); }

async function start() {
  try {
    scene = new RobotScene($('#canvas-area'));
    if (import.meta.env.DEV) {
      (window as Window & { __reachTest?: unknown }).__reachTest = {
        snapshot: () => scene?.reachRingState(),
        invalidate: () => scene?.setReachRing({ ...assembly.spec, eeLink: 'missing' }, assembly.sensor, assembly.gripper?.id),
      };
    }
    sceneCanvas().addEventListener('webglcontextlost', event => {
      event.preventDefault();
      ++selectionToken;
      selectionAbort?.abort();
      scene?.clear();
      scene = undefined;
      sceneReady = false;
      model = undefined;
      solver = undefined;
      stopJog(false);
      status(null);
      delete $('#stage').dataset.ready;
      applyControlAvailability(assembly.spec, false);
      setLoadMessage('webgl');
    });
  } catch (error) {
    console.error(error);
    setLoadMessage('webgl');
    return;
  }

  await loadSelection(true);
}
if (initialParams.has('example') && page === 'robot') {
  const url = new URL(window.location.href);
  url.searchParams.delete('example');
  window.history.replaceState(null, '', url);
}
setPage(page);
void start();
