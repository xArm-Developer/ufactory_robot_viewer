#!/usr/bin/env python3
"""Isolated MuJoCo drops using the actual generated floor and workpiece contacts."""
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'src/packing-config.json').read_text())
root = ET.parse(ROOT / 'public/examples/packing-01/scene.xml').getroot()
world = root.find('worldbody')
for element in list(world):
    if element.get('name') not in ('box_floor', 'block_0'):
        world.remove(element)
root.remove(root.find('actuator'))
root.remove(root.find('contact'))
model = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding='unicode'))
rest = config['box']['floorThickness'] + config['part']['size'] / 2

for height in (0.035, 0.150):
    data = mujoco.MjData(model)
    data.qpos[:3] = (*config['box']['center'], rest + height)
    data.qpos[3] = 1
    mujoco.mj_forward(model, data)
    minimum = float('inf')
    upward_speed = 0.0
    peak = 0.0
    previous_velocity = 0.0
    bounces = []
    contact_time = None
    max_penetration = 0.0
    acceleration = None
    stable = 0.0
    settled_at = None
    for step in range(2000):
        mujoco.mj_step(model, data)
        z, velocity = data.qpos[2], data.qvel[2]
        minimum = min(minimum, z)
        if step == 20:
            acceleration = velocity / data.time
        max_penetration = max(max_penetration, *(max(0.0, -contact.dist) for contact in data.contact), 0.0)
        if data.ncon and contact_time is None:
            contact_time = data.time
        if contact_time is not None:
            upward_speed = max(upward_speed, velocity)
            if velocity > 0:
                peak = max(peak, z - rest)
            if previous_velocity > 0 >= velocity and peak > .0001:
                bounces.append(peak)
                peak = 0
            speed = np.linalg.norm(data.qvel[:3])
            spin = np.linalg.norm(data.qvel[3:6])
            stable = stable + config['step'] if abs(z - rest) < .002 and speed < .03 and spin < 1 else 0
            if settled_at is None and stable >= config['placement']['stableTime']:
                settled_at = data.time
        previous_velocity = velocity
    assert abs(acceleration + config['gravity']) < 1e-6, acceleration
    assert contact_time is not None and upward_speed > 0.1, (contact_time, upward_speed)
    assert len(bounces) >= 2 and bounces[1] < bounces[0], bounces
    assert height != .150 or bounces[0] >= .005, bounces
    assert max(rest - minimum, max_penetration) < .002, (rest - minimum, max_penetration)
    assert settled_at is not None and settled_at < 2, settled_at
    print(f'{height * 1000:.0f} mm: acceleration {acceleration:.3f} m/s², upward {upward_speed:.3f} m/s, '
          f'bounces {[round(float(x) * 1000, 3) for x in bounces[:3]]} mm, '
          f'penetration {max(rest - minimum, max_penetration) * 1000:.3f} mm, stable {settled_at:.3f} s')
