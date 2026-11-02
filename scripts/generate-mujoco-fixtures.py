"""Generate independent FK fixtures with MuJoCo for all 5 vendored UFACTORY URDFs.

Run with python scripts/generate-mujoco-fixtures.py.
Visual/collision geometry is removed solely because FK does not need meshes.
"""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent.parent

ROBOT_CONFIGS = {
    'xarm5': {
        'urdf': 'public/models/xarm5/xarm5.urdf',
        'ee_link': 'link5',
        'samples': [
            [0, 0, 0, 0, 0],
            [0, -0.5, 0, 0.5, 0],
            [0.5, -0.7, -0.8, 1.5, -0.6],
            [-1.1, 0.6, -1.4, 0.8, 1.3],
            [2.0, -1.5, -2.4, 2.2, -2.0],
            [0.25, -0.25, -0.5, 0.0001, -0.3],
            [-2.8, 1.3, -0.2, -1.1, 2.8],
        ],
    },
    'xarm6': {
        'urdf': 'public/models/xarm6/xarm6.urdf',
        'ee_link': 'link_eef',
        'samples': [
            [0, 0, 0, 0, 0, 0],
            [0, -0.5, 0, 0, 0.5, 0],
            [0.5, -0.7, -0.8, 1.1, 0.7, -0.6],
            [-1.1, 0.6, -1.4, -0.8, 1.2, 1.3],
            [2.0, -1.5, -2.4, 2.2, -0.8, -2.0],
            [0.25, -0.25, -0.5, 0.3, 0.0001, -0.3],
            [-2.8, 1.3, -0.2, -2.0, 2.4, 2.8],
        ],
    },
    'xarm7': {
        'urdf': 'public/models/xarm7/xarm7.urdf',
        'ee_link': 'link7',
        'samples': [
            [0, 0, 0, 0, 0, 0, 0],
            [0, -0.5, 0, 0.5, 0, 0.5, 0],
            [0.5, -0.7, 0.4, 1.1, 0.9, 0.7, -0.6],
            [-1.1, 0.6, -0.8, 1.4, -0.8, 1.2, 1.3],
            [2.0, -1.5, 1.6, 2.4, 2.2, -0.8, -2.0],
            [0.25, -0.25, -0.2, 0.5, 0.3, 0.0001, -0.3],
            [-2.8, 1.3, -2.1, 0.4, -2.0, 2.4, 2.8],
        ],
    },
    'uf850': {
        'urdf': 'public/models/uf850/uf850.urdf',
        'ee_link': 'link6',
        'samples': [
            [0, 0, 0, 0, 0, 0],
            [0, -0.5, -0.5, 0, 0.5, 0],
            [0.5, -0.7, -0.9, 1.1, 0.7, -0.6],
            [-1.1, 0.6, -1.4, -0.8, 1.2, 1.3],
            [2.0, -1.5, -2.6, 2.2, -1.2, -2.0],
            [0.25, -0.25, -0.5, 0.3, 0.0001, -0.3],
            [-2.8, 1.4, -0.3, -2.0, 1.8, 2.8],
        ],
    },
    'lite6': {
        'urdf': 'public/models/lite6/lite6.urdf',
        'ee_link': 'link6',
        'samples': [
            [0, 0, 0, 0, 0, 0],
            [0, 0.4, 0.8, 0, 0.4, 0],
            [0.5, 0.7, 1.2, 1.1, 0.7, -0.6],
            [-1.1, -0.6, 1.6, -0.8, -1.2, 1.3],
            [2.0, 1.5, 2.8, 2.2, -1.5, -2.0],
            [0.25, 0.25, 0.6, 0.3, 0.0001, -0.3],
            [-2.8, -1.4, 3.8, -2.0, 1.8, 2.8],
        ],
    },
}

robots_out = {}
total_samples = 0

for robot_id, cfg in ROBOT_CONFIGS.items():
    source = ROOT / cfg['urdf']
    robot = ET.parse(source).getroot()
    for link in robot.findall('link'):
        for tag in ('visual', 'collision'):
            for node in link.findall(tag):
                link.remove(node)
    compiler = ET.SubElement(ET.SubElement(robot, 'mujoco'), 'compiler')
    compiler.set('fusestatic', 'false')
    model = mujoco.MjModel.from_xml_string(ET.tostring(robot, encoding='unicode'))
    data = mujoco.MjData(model)
    base = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'link_base')
    eef = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, cfg['ee_link'])
    assert base >= 0 and eef >= 0, f'Missing base or ee_link for {robot_id}'

    fixtures = []
    for angles in cfg['samples']:
        mujoco.mj_resetData(model, data)
        for i, value in enumerate(angles, 1):
            joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')
            assert joint_id >= 0, f'Missing joint{i} on {robot_id}'
            low, high = model.jnt_range[joint_id]
            assert low <= value <= high, f'{robot_id} joint{i}={value} outside [{low}, {high}]'
            data.qpos[model.jnt_qposadr[joint_id]] = value
        mujoco.mj_forward(model, data)
        base_rot = data.xmat[base].reshape(3, 3)
        position = base_rot.T @ (data.xpos[eef] - data.xpos[base])
        rotation = base_rot.T @ data.xmat[eef].reshape(3, 3)
        # MuJoCo quaternions are w,x,y,z; fixtures use Three.js x,y,z,w.
        quat = np.empty(4)
        mujoco.mju_mat2Quat(quat, rotation.reshape(-1))
        fixtures.append({
            'joints': angles,
            'position': position.tolist(),
            'quaternion': [float(quat[1]), float(quat[2]), float(quat[3]), float(quat[0])],
        })
    robots_out[robot_id] = {
        'eeLink': cfg['ee_link'],
        'dof': len(cfg['samples'][0]),
        'samples': fixtures,
    }
    total_samples += len(fixtures)

output = ROOT / 'tests/mujoco-fk.json'
output.write_text(json.dumps({
    'mujocoVersion': mujoco.__version__,
    'robots': robots_out,
}, indent=2) + '\n')
print(f'Wrote {total_samples} samples across {len(robots_out)} robots to {output}')
