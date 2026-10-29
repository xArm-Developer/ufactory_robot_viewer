"""Generate independent FK fixtures with MuJoCo from the vendored URDF.

Run with /opt/conda_envs/py314/bin/python scripts/generate-mujoco-fixtures.py.
Visual/collision geometry is removed solely because FK does not need meshes.
"""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'public/models/xarm6/xarm6.urdf'
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
eef = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'link_eef')
assert base >= 0 and eef >= 0
samples = [
    [0, -0.5, 0, 0, 0.5, 0],
    [0, 0, 0, 0, 0, 0],
    [0.5, -0.7, -0.8, 1.1, 0.7, -0.6],
    [-1.1, 0.6, -1.4, -0.8, 1.2, 1.3],
    [2.0, -1.5, -2.4, 2.2, -0.8, -2.0],
    [0.25, -0.25, -0.5, 0.3, 0.0001, -0.3],
    [-2.8, 1.3, -0.2, -2.0, 2.4, 2.8],
]
fixtures = []
for angles in samples:
    mujoco.mj_resetData(model, data)
    for i, value in enumerate(angles, 1):
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')
        assert joint_id >= 0
        data.qpos[model.jnt_qposadr[joint_id]] = value
    mujoco.mj_forward(model, data)
    base_rot = data.xmat[base].reshape(3, 3)
    position = base_rot.T @ (data.xpos[eef] - data.xpos[base])
    rotation = base_rot.T @ data.xmat[eef].reshape(3, 3)
    # MuJoCo quaternions are w,x,y,z; fixtures use Three.js x,y,z,w.
    quat = np.empty(4)
    mujoco.mju_mat2Quat(quat, rotation.reshape(-1))
    fixtures.append({'joints': angles, 'position': position.tolist(),
                     'quaternion': [float(quat[1]), float(quat[2]), float(quat[3]), float(quat[0])]})
output = ROOT / 'tests/mujoco-fk.json'
output.write_text(json.dumps({'mujocoVersion': mujoco.__version__, 'samples': fixtures}, indent=2) + '\n')
print(f'Wrote {len(fixtures)} samples to {output}')
