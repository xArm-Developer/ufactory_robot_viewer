# BIO Gripper G2 资产来源

- 来源：[xArm-Developer/ufactory_genesis](https://github.com/xArm-Developer/ufactory_genesis)，提交 `82e094e4e57deec51d76a9c86d7830905f2b3ecc`，路径 `assets/urdf/bio_gripper_g2/`。
- 复制三个 `meshes/visual/visual_glb/*.glb` 和 `bio_gripper_g2_movable_visual.urdf`，文件未修改；`SHA256SUMS` 记录校验值。项目只加载视觉 GLB，夹爪运动沿用 URDF 的关节和视觉偏移。
- xArm 5/6/7 与 850 的安装变换来自同一提交的对应可动组合 URDF；八个原始组合 URDF 及校验值保存于 `tests/reference-urdfs/`，用于独立 MuJoCo TCP 基准。
- 网格源自 xArm ROS 家族；具体归属和许可见同目录 `NOTICE`、`XARM_ROS_LICENSE` 与 `GENESIS_LICENSE`。
- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/bio_gripper_g2/meshes/collision/*_convex_*.stl` 提取凸包顶点并对齐可动手指局部坐标系生成，校验值见 `SHA256SUMS`。
