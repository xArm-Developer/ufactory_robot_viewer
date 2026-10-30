"""Generate Lite 6 tool TCP fixtures from the unmodified combination URDFs."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
samples = json.loads((ROOT / 'tests/mujoco-fk.json').read_text())['robots']['lite6']['samples']
references = {
    'gripper': ('lite6_gripper_movable_visual.glb.urdf', '74595716b3c8f8eacc4ed6b70ba078f1e5d8fae85efcce25246c7cdd681bb02d'),
    'vacuum': ('lite6_with_vacuum_gripper.urdf', '1c3f8f7440208690f6831adb3eccd53b2d1e5a3076eab25205c7a18ec7472130'),
}
output = {}
for tool, (filename, expected_hash) in references.items():
    source = ROOT / 'tests/reference-urdfs' / filename
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
        raise ValueError(f'Reference SHA-256 mismatch: {source}')
    robot = ET.parse(source).getroot()
    for link in robot.findall('link'):
        for element in list(link):
            if element.tag in ('visual', 'collision'):
                link.remove(element)
    ET.SubElement(ET.SubElement(robot, 'mujoco'), 'compiler', fusestatic='false')
    model = mujoco.MjModel.from_xml_string(ET.tostring(robot, encoding='unicode'))
    data = mujoco.MjData(model)
    base = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'link_base')
    tcp = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'link_tcp')
    if base < 0 or tcp < 0:
        raise ValueError(f'Missing link_base or link_tcp: {source}')
    output[tool] = []
    for sample in samples:
        mujoco.mj_resetData(model, data)
        for index, value in enumerate(sample['joints'], 1):
            joint = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{index}')
            if joint < 0:
                raise ValueError(f'Missing joint{index}: {source}')
            data.qpos[model.jnt_qposadr[joint]] = value
        mujoco.mj_forward(model, data)
        base_rot = data.xmat[base].reshape(3, 3)
        position = base_rot.T @ (data.xpos[tcp] - data.xpos[base])
        rotation = base_rot.T @ data.xmat[tcp].reshape(3, 3)
        quat = np.empty(4)
        mujoco.mju_mat2Quat(quat, rotation.reshape(-1))
        output[tool].append({'joints': sample['joints'], 'position': position.tolist(),
                             'quaternion': [float(quat[1]), float(quat[2]), float(quat[3]), float(quat[0])]})
path = ROOT / 'tests/mujoco-lite6-tool-fk.json'
path.write_text(json.dumps({'mujocoVersion': mujoco.__version__,
                            'referenceCommit': '82e094e4e57deec51d76a9c86d7830905f2b3ecc',
                            'tools': output}, indent=2) + '\n')
print(f'Wrote {sum(map(len, output.values()))} TCP poses to {path}')
