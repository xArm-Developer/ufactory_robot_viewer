# Vacuum Gripper Lite 模型来源

资源来自 [UFACTORY Genesis](https://github.com/xArm-Developer/ufactory_genesis) 提交 `82e094e4e57deec51d76a9c86d7830905f2b3ecc` 的 `assets/urdf/lite6_vacuum_gripper/meshes/visual/lite6_vacuum_gripper_visual_link6.glb`，复制为 `vacuum.glb`，内容未修改，校验值见 `SHA256SUMS`。

上游资产源自 xArm ROS，许可见 `XARM_ROS_LICENSE`，归属说明见 `NOTICE`，Genesis 许可见 `LICENSE`。
- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游 `vacuum_gripper_lite.stl` 按主体与吸盘分段提取紧凑凸包顶点生成，校验值见 `SHA256SUMS`。
