# xArm6 1305 资源来源

- 来源：[xArm-Developer/ufactory_genesis](https://github.com/xArm-Developer/ufactory_genesis)，提交 `4012a34b2af40a51365dbcd2d793a4b2c77971b1`，路径 `assets/urdf/xarm6/`。
- 本项目复制 `xarm6_1305_visual.glb.urdf`（保存为 `xarm6.urdf`）及七个 `visual_glb/*.glb`；URDF 原样保留关节、视觉和碰撞定义。网页只加载视觉网格，不加载 URDF 中的碰撞网格。
- 原始 URDF / 网格源自 [xArm ROS](https://github.com/xArm-Developer/xarm_ros2) 系列；具体归属见同目录 `NOTICE` 和 `XARM_ROS_LICENSE`。Genesis 项目的代码许可见 `GENESIS_LICENSE`，资产并非全部 MIT 代码。
- GLB 使用 Draco 压缩；`public/draco/` 的解码器由固定版本 Three.js 的 GLTF Draco 资源复制，许可证见 Three.js 的 npm 包。
- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/xarm6/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。
