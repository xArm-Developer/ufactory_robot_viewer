"""Generate independent arm + TCP fixtures from the vendored reference combination URDFs.

Run with python scripts/generate-mujoco-gripper-fixtures.py.
Meshes are removed before MuJoCo compilation; the original joint transforms remain intact.
"""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
samples = json.loads((ROOT / 'tests/mujoco-fk.json').read_text())['robots']
output = {}
for robot_id in ('xarm5', 'xarm6', 'xarm7', 'uf850'):
    prefix = robot_id if robot_id == 'uf850' else f'{robot_id}_1305'
    output[robot_id] = {}
    for gripper, suffix, tcp in (
        ('gripper-g2', 'g2_movable_visual.urdf', 'link_tcp'),
        ('bio-gripper-g2', 'bio_gripper_g2_movable_visual.glb.urdf', 'bio_gripper_g2_tcp_link'),
    ):
        path = ROOT / 'tests/reference-urdfs' / f'{prefix}_{suffix}'
        robot = ET.parse(path).getroot()
        for link in robot.findall('link'):
            for element in list(link):
                if element.tag in ('visual', 'collision'):
                    link.remove(element)
        ET.SubElement(ET.SubElement(robot, 'mujoco'), 'compiler', fusestatic='false')
        model = mujoco.MjModel.from_xml_string(ET.tostring(robot, encoding='unicode'))
        data = mujoco.MjData(model)
        base = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'link_base')
        end = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, tcp)
        assert base >= 0 and end >= 0, (robot_id, gripper)
        entries = []
        for sample in samples[robot_id]['samples']:
            mujoco.mj_resetData(model, data)
            for i, value in enumerate(sample['joints'], 1):
                joint = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')
                assert joint >= 0, (robot_id, gripper, i)
                data.qpos[model.jnt_qposadr[joint]] = value
            mujoco.mj_forward(model, data)
            base_rotation = data.xmat[base].reshape(3, 3)
            position = base_rotation.T @ (data.xpos[end] - data.xpos[base])
            rotation = base_rotation.T @ data.xmat[end].reshape(3, 3)
            quat = np.empty(4)
            mujoco.mju_mat2Quat(quat, rotation.reshape(-1))
            entries.append({'joints': sample['joints'], 'position': position.tolist(),
                            'quaternion': [float(quat[1]), float(quat[2]), float(quat[3]), float(quat[0])]})
        output[robot_id][gripper] = entries
path = ROOT / 'tests/mujoco-gripper-fk.json'
path.write_text(json.dumps({'mujocoVersion': mujoco.__version__, 'robots': output}, indent=2) + '\n')
print(f'Wrote {sum(len(v) for robot in output.values() for v in robot.values())} poses to {path}')
