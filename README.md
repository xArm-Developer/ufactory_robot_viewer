# UF Robots · UFACTORY Studio

基于 Three.js 的 UFACTORY 机械臂与夹爪交互展示，当前版本 **0.0.2**。支持五款机械臂、Gripper G2 和 BIO Gripper G2 的三维查看、中英文界面、关节控制、笛卡尔点动及固定 TCP 坐标系；夹爪可独立查看或装配到兼容机械臂。`xArm 5/6/7` 使用 1305 版本。演示不连接真机，不包含抓取、碰撞检测或动力学仿真。

3D 体验区下方的资产清单列出场景中已加载的产品及其 UFACTORY 官方商城介绍页，链接在新标签页打开；加载中或加载失败时显示相应状态。配件条目以实际场景为准。

## 本地运行

需要 Node.js **24.13.0** 和 npm。固定依赖记录在 `package-lock.json`。

```sh
npm ci
npm run dev
```

浏览器打开终端输出的地址。手机在同一局域网时，可使用终端输出的网络地址。`npm run build` 输出 `dist/`；`npm run preview` 预览生产构建。

- `npm run typecheck`：TypeScript 类型检查。
- `npm test`：视觉开口几何、URDF、MuJoCo FK 基准和 IK 测试。
- `npm run test:browser`：Playwright 桌面和手机尺寸测试。首次使用需 `npx playwright install chromium`；也可设置 `CHROME_PATH` 使用本机 Chrome。
- `python scripts/generate-mujoco-fixtures.py` 和 `python scripts/generate-mujoco-gripper-fixtures.py`：使用 MuJoCo 重新生成机械臂及八种夹爪组合的 FK 基准；当前开发环境为 `/opt/conda_envs/py314/bin/python`。

3D 机械臂舞台初始及复位关节角均为零。右侧面板提供关节 FK、笛卡尔点动和连续运动；五轴 `xArm 5` 的 `Roll±` 禁用。机械臂关节限位来自 URDF，求解失败时回退到上一次有效姿态。舞台可显示基坐标系和 TCP 坐标系；位姿单位为毫米和角度，RPY 使用固定轴 `Rz(yaw) × Ry(pitch) × Rx(roll)`。

舞台上方通过“机械臂”和“末端工具”下拉框选择场景；默认 xArm 6、无夹爪。`xArm 5/6/7` 和 `850` 支持装配两款夹爪，选择“无”可卸下；`Lite 6` 暂不支持装配。切换夹爪保留机械臂姿态，切换兼容机械臂保留夹爪和开口，切换到 Lite 6 清除夹爪。

右侧“末端工具”可独立查看两款夹爪；“返回装配”恢复进入前的机械臂、夹爪和开口，并复位机械臂姿态。独立查看相同夹爪时沿用装配开口，查看其他夹爪时从全开开始；独立调整不会改变装配开口。独立查看时也可通过上方下拉框返回装配，Lite 6 仅能选择“无”。Gripper G2 开口为 `0–84 mm`，BIO Gripper G2 为 `71–150 mm`，输入步长为 `0.1 mm`；非法输入恢复上一次有效值。

不装夹爪时 TCP 为法兰；装配后 TCP 使用参考 URDF 固定值：Gripper G2 沿法兰 Z 轴 `173.5 mm`，BIO Gripper G2 在其基座坐标为 `(135, 0, 55) mm`，并考虑各机械臂的安装变换。TCP 不随开口变化；Gripper G2 指尖轴向位置会变化，其开合模型为参考项目的标定估算值。

### 直达链接

- `?model=xarm5`、`xarm6`、`xarm7`、`uf850`、`lite6`：机械臂；省略 `model` 默认为 xArm 6。
- `?model=gripper-g2&opening=42` 或 `?model=bio-gripper-g2&opening=110`：独立夹爪。
- `?model=xarm7&gripper=bio-gripper-g2&opening=110`：装配夹爪。开口参数省略或无效时使用全开；无效或不兼容的夹爪参数回退为无夹爪。

直接打开独立夹爪链接时，“返回装配”进入无夹爪的默认 xArm 6 场景。

## 部署

[Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)支持私有 GitHub 仓库和生产分支自动部署。项目参数：

- 仓库：`DanielWang123321/uf_robots`，生产分支：`main`。
- Pages 项目：`uf-robots`，地址：`https://uf-robots.pages.dev`。
- 构建命令：`npm run build`；构建输出：`dist`；根目录：仓库根目录。
- Node 版本：`24.13.0`，可通过 Pages 环境变量 `NODE_VERSION` 固定；仓库也提供 `.nvmrc`。

在 Pages 的 **Create application → Pages → Connect to Git** 中授权并选择仓库，填入上述参数，再执行首次部署。之后推送 `main` 会触发自动构建。公开网址、首次上线和后续推送的部署状态须在 Pages 验证，不能仅凭本地构建视为完成。

## 资料与许可

- [运动学研究与验证](docs/kinematics.md)。
- 模型与资产来源、版本、SHA-256 和许可证见 `public/models/` 各型号的 `SOURCE.md`、`NOTICE` 和夹爪目录的 `SHA256SUMS`；运动学基准的原始组合 URDF 及校验值见 `tests/reference-urdfs/`。
- UFACTORY 官方用户手册：[xArm 系列](https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf)、[850](https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf)、[Lite 6](https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf)。
