#!/usr/bin/env python3
"""Build the packing demonstration's MJCF from the project's xArm collision hulls."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'src/packing-config.json').read_text())
part, belt, box, gripper = (config[key] for key in ('part', 'belt', 'box', 'gripper'))
robot = ET.parse(ROOT / 'public/models/xarm6/xarm6.urdf').getroot()
hulls = json.loads((ROOT / 'public/models/xarm6/collision.json').read_text())['hulls']
root = ET.Element('mujoco', model='packing_01')
ET.SubElement(root, 'compiler', angle='radian', autolimits='true')
# Suppress the soft-contact model's tangential creep while a part is held.
ET.SubElement(root, 'option', timestep=str(config['step']), gravity=f"0 0 -{config['gravity']}", integrator='implicitfast', iterations='60', noslip_iterations='3')
ET.SubElement(root, 'size', nconmax='600', njmax='3000')
asset = ET.SubElement(root, 'asset')
for index, hull in enumerate(hulls):
    ET.SubElement(asset, 'mesh', name=f'arm_hull_{index}', vertex=' '.join(map(str, hull['vertices'])))
world = ET.SubElement(root, 'worldbody')
ET.SubElement(world, 'geom', name='ground', type='plane', size='3 3 .1', friction='1 0.005 0.0001')
# Contact priorities keep the belt and pads' damping independent of landing.
ET.SubElement(world, 'geom', name='belt', type='box', pos=f"{belt['x']} .9 {belt['top'] - .015:.6g}", size='.09 1.5 .015', surfacevel=f"0 -{belt['speed']} 0 0 0 0", friction='1.2 .005 .0001', priority='1', solref='.008 1')
cx, cy = box['center']
half, wall, floor, height = box['innerSize'] / 2, box['wall'], box['floorThickness'], box['wallHeight']
landing = {'friction': '1 .005 .0001', 'priority': '1', 'solref': '.006 .3', 'solimp': '.99 .99 .001'}
def coords(*values): return ' '.join(f'{value:.6g}' for value in values)
ET.SubElement(world, 'geom', name='box_floor', type='box', pos=coords(cx, cy, floor/2), size=coords(half+wall, half+wall, floor/2), **landing)
for name, pos, size in [
    ('box_left', (cx-half-wall/2, cy, floor+height/2), (wall/2, half+wall, height/2)),
    ('box_right', (cx+half+wall/2, cy, floor+height/2), (wall/2, half+wall, height/2)),
    ('box_front', (cx, cy-half-wall/2, floor+height/2), (half, wall/2, height/2)),
    ('box_back', (cx, cy+half+wall/2, floor+height/2), (half, wall/2, height/2)),
]:
    ET.SubElement(world, 'geom', name=name, type='box', pos=coords(*pos), size=coords(*size), **landing)
body = ET.SubElement(world, 'body', name='link_base')
def add_arm_geoms(parent, name):
    for index, hull in enumerate(hulls):
        if hull['bodyKey'] == name:
            ET.SubElement(parent, 'geom', name=f'{name}_h{index}', type='mesh', mesh=f'arm_hull_{index}', density='0', friction='1 .005 .0001')
add_arm_geoms(body, 'link_base')
for index in range(1, 7):
    joint = robot.find(f"joint[@name='joint{index}']")
    link = robot.find(f"link[@name='link{index}']")
    assert joint is not None and link is not None
    origin = joint.find('origin'); limit = joint.find('limit'); inertial = link.find('inertial')
    assert origin is not None and limit is not None and inertial is not None
    body = ET.SubElement(body, 'body', name=f'link{index}', pos=origin.get('xyz', '0 0 0'), euler=origin.get('rpy', '0 0 0'), gravcomp='1')
    io = inertial.find('origin'); mass = inertial.find('mass'); inertia = inertial.find('inertia')
    assert io is not None and mass is not None and inertia is not None
    ET.SubElement(body, 'inertial', pos=io.get('xyz', '0 0 0'), mass=mass.get('value', '1'), fullinertia=' '.join(inertia.get(key, '0') for key in ('ixx','iyy','izz','ixy','ixz','iyz')))
    ET.SubElement(body, 'joint', name=f'joint{index}', type='hinge', axis='0 0 1', range=f"{limit.get('lower')} {limit.get('upper')}", damping='4', armature='.05')
    add_arm_geoms(body, f'link{index}')
# At a 30 mm opening the visual G2 fingertips are 176.28 mm from the flange.
# Centre the workpiece 15 mm above the tips, with its bottom level with them.
grasp_z = gripper['graspSite']
ET.SubElement(body, 'site', name='grasp', pos=f'0 0 {grasp_z}', size='.003')
# Two independent, actuated jaws approximate the G2 contact surfaces at this opening.
ET.SubElement(body, 'geom', name='gripper_base', type='box', pos='0 0 .045', size='.035 .042 .045', mass='.45', friction='1 .005 .0001')
for side, sign in [('left',1), ('right',-1)]:
    jaw = ET.SubElement(body, 'body', name=f'jaw_{side}', pos=f'0 {sign*.005} {grasp_z}', gravcomp='1')
    ET.SubElement(jaw, 'joint', name=f'jaw_{side}', type='slide', axis=f'0 {sign} 0', range='.004 .044', damping='2', armature='.01')
    ET.SubElement(jaw, 'geom', name=f'pad_{side}', type='box', size='.016 .005 .013', mass='.04', friction='3 .02 .002', priority='2', solref='.008 1')
for index in range(part['count']):
    block = ET.SubElement(world, 'body', name=f'block_{index}', pos=coords(belt['x'], part['initialY'] + index * part['spacing'], belt['top'] + part['size']/2 + .0001))
    ET.SubElement(block, 'freejoint', name=f'block_{index}')
    half_part = part['size'] / 2
    ET.SubElement(block, 'geom', name=f'block_{index}', type='box', size=coords(half_part, half_part, half_part), mass=str(part['mass']), friction='1.5 .01 .001', solref='.006 .3', solimp='.99 .99 .001')
contact = ET.SubElement(root, 'contact')
ET.SubElement(contact, 'exclude', body1='link_base', body2='link1')
act = ET.SubElement(root, 'actuator')
for index in range(1,7):
    effort = robot.find(f"joint[@name='joint{index}']/limit").get('effort')
    ET.SubElement(act, 'position', name=f'joint{index}', joint=f'joint{index}', kp='1500', kv='90', forcelimited='true', forcerange=f"-{effort} {effort}")
for side in ['left','right']:
    ET.SubElement(act, 'position', name=f'jaw_{side}', joint=f'jaw_{side}', kp='800', kv='8', forcelimited='true', forcerange='-8 8')
ET.indent(root)
(ROOT / 'public/examples/packing-01/scene.xml').write_text(ET.tostring(root, encoding='unicode')+'\n')
