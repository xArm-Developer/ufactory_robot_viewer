import type { CartesianAxis } from './kinematics';

export type RobotId = 'xarm5' | 'xarm6' | 'xarm7' | 'uf850' | 'lite6';

export interface RobotSpec {
  id: RobotId;
  name: string;
  dof: 5 | 6 | 7;
  modelDir: string;
  urdfFile: string;
  eeLink: string;
  visualMeshCount: number;
  disabledJogAxes?: readonly CartesianAxis[];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  variantLabel: { zh: string; en: string };
  jointIntro: { zh: string; en: string };
  specDescription: { zh: string; en: string };
  specs: {
    reachMm: string;
    payload: { value: string; unit: string };
    repeatabilityMm: string;
    manualUrl: string;
    manualLabel: { zh: string; en: string };
  };
}

export const DEFAULT_ROBOT_ID: RobotId = 'xarm6';

export const ROBOTS: readonly RobotSpec[] = [
  {
    id: 'xarm5',
    name: 'xArm 5',
    dof: 5,
    modelDir: 'models/xarm5/',
    urdfFile: 'xarm5.urdf',
    eeLink: 'link5',
    visualMeshCount: 6,
    disabledJogAxes: ['roll'],
    cameraPosition: [0.93, -1.2, 0.95],
    cameraTarget: [0, 0, 0.36],
    variantLabel: { zh: '1305 版本 · 5 轴交互式模型', en: '1305 VARIANT · 5-AXIS INTERACTIVE MODEL' },
    jointIntro: {
      zh: '调整五个关节，实时更新 3D 模型与舞台位姿读数。',
      en: 'Adjust the five joints to update the 3D arm and live stage telemetry.',
    },
    specDescription: {
      zh: '五个自由度，高效胜任平面与垂直抓取搬运场景。',
      en: 'Five degrees of freedom built for streamlined pick-and-place automation.',
    },
    specs: {
      reachMm: '700',
      payload: { value: '3', unit: 'kg' },
      repeatabilityMm: '±0.1',
      manualUrl: 'https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf',
      manualLabel: { zh: '参数来源：UFACTORY xArm 用户手册', en: 'Source: UFACTORY xArm user manual' },
    },
  },
  {
    id: 'xarm6',
    name: 'xArm 6',
    dof: 6,
    modelDir: 'models/xarm6/',
    urdfFile: 'xarm6.urdf',
    eeLink: 'link_eef',
    visualMeshCount: 7,
    cameraPosition: [0.93, -1.2, 0.95],
    cameraTarget: [0, 0, 0.38],
    variantLabel: { zh: '1305 版本 · 6 轴交互式模型', en: '1305 VARIANT · 6-AXIS INTERACTIVE MODEL' },
    jointIntro: {
      zh: '调整六个关节，实时更新 3D 模型与舞台位姿读数。',
      en: 'Adjust the six joints to update the 3D arm and live stage telemetry.',
    },
    specDescription: {
      zh: '六个自由度，让运动的可能性延伸至三维空间。',
      en: 'Six degrees of freedom open up possibilities in three-dimensional space.',
    },
    specs: {
      reachMm: '700',
      payload: { value: '5', unit: 'kg' },
      repeatabilityMm: '±0.1',
      manualUrl: 'https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf',
      manualLabel: { zh: '参数来源：UFACTORY xArm 用户手册', en: 'Source: UFACTORY xArm user manual' },
    },
  },
  {
    id: 'xarm7',
    name: 'xArm 7',
    dof: 7,
    modelDir: 'models/xarm7/',
    urdfFile: 'xarm7.urdf',
    eeLink: 'link7',
    visualMeshCount: 8,
    cameraPosition: [0.95, -1.22, 0.96],
    cameraTarget: [0, 0, 0.38],
    variantLabel: { zh: '1305 版本 · 7 轴交互式模型', en: '1305 VARIANT · 7-AXIS INTERACTIVE MODEL' },
    jointIntro: {
      zh: '调整七个关节，实时更新 3D 模型与舞台位姿读数。',
      en: 'Adjust the seven joints to update the 3D arm and live stage telemetry.',
    },
    specDescription: {
      zh: '七个自由度冗余设计，兼具灵活姿态调节与空间适应性。',
      en: 'Seven redundant degrees of freedom deliver agile posture control in tight spaces.',
    },
    specs: {
      reachMm: '700',
      payload: { value: '3.5', unit: 'kg' },
      repeatabilityMm: '±0.1',
      manualUrl: 'https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf',
      manualLabel: { zh: '参数来源：UFACTORY xArm 用户手册', en: 'Source: UFACTORY xArm user manual' },
    },
  },
  {
    id: 'uf850',
    name: '850',
    dof: 6,
    modelDir: 'models/uf850/',
    urdfFile: 'uf850.urdf',
    eeLink: 'link6',
    visualMeshCount: 7,
    cameraPosition: [1.14, -1.48, 1.16],
    cameraTarget: [0, 0, 0.46],
    variantLabel: { zh: '6 轴长臂展 · 交互式模型', en: '6-AXIS EXTENDED REACH · INTERACTIVE MODEL' },
    jointIntro: {
      zh: '调整六个关节，实时更新 3D 模型与舞台位姿读数。',
      en: 'Adjust the six joints to update the 3D arm and live stage telemetry.',
    },
    specDescription: {
      zh: '850 mm 扩展工作半径与高重复定位精度，覆盖更广作业空间。',
      en: '850 mm extended reach paired with high repeatability for larger workspaces.',
    },
    specs: {
      reachMm: '850',
      payload: { value: '5', unit: 'kg' },
      repeatabilityMm: '±0.02',
      manualUrl: 'https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf',
      manualLabel: { zh: '参数来源：UFACTORY 850 用户手册', en: 'Source: UFACTORY 850 user manual' },
    },
  },
  {
    id: 'lite6',
    name: 'Lite 6',
    dof: 6,
    modelDir: 'models/lite6/',
    urdfFile: 'lite6.urdf',
    eeLink: 'link6',
    visualMeshCount: 7,
    cameraPosition: [0.76, -0.98, 0.78],
    cameraTarget: [0, 0, 0.28],
    variantLabel: { zh: '轻量桌面级 · 6 轴交互式模型', en: 'COMPACT DESKTOP · 6-AXIS INTERACTIVE MODEL' },
    jointIntro: {
      zh: '调整六个关节，实时更新 3D 模型与舞台位姿读数。',
      en: 'Adjust the six joints to update the 3D arm and live stage telemetry.',
    },
    specDescription: {
      zh: '紧凑轻量化六轴桌面设计，适合科研实验与精密桌面自动化。',
      en: 'Compact six-axis desktop design tailored for labs and light automation.',
    },
    specs: {
      reachMm: '440',
      payload: { value: '0.6', unit: 'kg' },
      repeatabilityMm: '±0.5',
      manualUrl: 'https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf',
      manualLabel: { zh: '参数来源：UFACTORY Lite 6 用户手册', en: 'Source: UFACTORY Lite 6 user manual' },
    },
  },
] as const;

export function getRobotSpec(id: string | null | undefined): RobotSpec {
  return ROBOTS.find(item => item.id === id) ?? ROBOTS.find(item => item.id === DEFAULT_ROBOT_ID)!;
}

