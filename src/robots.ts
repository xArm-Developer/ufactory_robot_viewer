import type { CartesianAxis } from './kinematics';

export type RobotId = 'xarm5' | 'xarm6' | 'xarm7' | 'uf850' | 'lite6';

export interface RobotSpec {
  id: RobotId;
  name: string;
  productUrl: string;
  dof: 5 | 6 | 7;
  modelDir: string;
  urdfFile: string;
  eeLink: string;
  visualMeshCount: number;
  disabledJogAxes?: readonly CartesianAxis[];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

export const DEFAULT_ROBOT_ID: RobotId = 'xarm6';

export const ROBOT_PRODUCT_URLS: Record<RobotId, string> = {
  xarm5: 'https://www.shop.ufactory.cc/products/xarm-5',
  xarm6: 'https://www.shop.ufactory.cc/products/xarm-6',
  xarm7: 'https://www.shop.ufactory.cc/products/xarm-7',
  uf850: 'https://www.shop.ufactory.cc/products/850',
  lite6: 'https://www.shop.ufactory.cc/products/lite-6',
};

export const ROBOTS: readonly RobotSpec[] = [
  {
    id: 'xarm5',
    name: 'xArm 5',
    productUrl: ROBOT_PRODUCT_URLS.xarm5,
    dof: 5,
    modelDir: 'models/xarm5/',
    urdfFile: 'xarm5.urdf',
    eeLink: 'link5',
    visualMeshCount: 6,
    disabledJogAxes: ['roll'],
    cameraPosition: [0.93, -1.2, 0.95],
    cameraTarget: [0, 0, 0.36],
  },
  {
    id: 'xarm6',
    name: 'xArm 6',
    productUrl: ROBOT_PRODUCT_URLS.xarm6,
    dof: 6,
    modelDir: 'models/xarm6/',
    urdfFile: 'xarm6.urdf',
    eeLink: 'link_eef',
    visualMeshCount: 7,
    cameraPosition: [0.93, -1.2, 0.95],
    cameraTarget: [0, 0, 0.38],
  },
  {
    id: 'xarm7',
    name: 'xArm 7',
    productUrl: ROBOT_PRODUCT_URLS.xarm7,
    dof: 7,
    modelDir: 'models/xarm7/',
    urdfFile: 'xarm7.urdf',
    eeLink: 'link7',
    visualMeshCount: 8,
    cameraPosition: [0.95, -1.22, 0.96],
    cameraTarget: [0, 0, 0.38],
  },
  {
    id: 'uf850',
    name: '850',
    productUrl: ROBOT_PRODUCT_URLS.uf850,
    dof: 6,
    modelDir: 'models/uf850/',
    urdfFile: 'uf850.urdf',
    eeLink: 'link6',
    visualMeshCount: 7,
    cameraPosition: [1.14, -1.48, 1.16],
    cameraTarget: [0, 0, 0.46],
  },
  {
    id: 'lite6',
    name: 'Lite 6',
    productUrl: ROBOT_PRODUCT_URLS.lite6,
    dof: 6,
    modelDir: 'models/lite6/',
    urdfFile: 'lite6.urdf',
    eeLink: 'link6',
    visualMeshCount: 7,
    cameraPosition: [0.76, -0.98, 0.78],
    cameraTarget: [0, 0, 0.28],
  },
] as const;

export function getRobotSpec(id: string | null | undefined): RobotSpec {
  return ROBOTS.find(item => item.id === id) ?? ROBOTS.find(item => item.id === DEFAULT_ROBOT_ID)!;
}
