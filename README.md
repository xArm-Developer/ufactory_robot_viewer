# UF Robots · UFACTORY Studio

基于 Three.js 的 UFACTORY 机械臂与配件交互展示，当前版本 **0.0.3**。支持五款机械臂（`xArm 5`、`xArm 6`、`xArm 7`、`850`、`Lite 6`）、直线滑轨（`AL0700`）、六维力矩传感器（`AI1500`）及四款末端工具（`Gripper G2`、`BIO Gripper G2`、`Gripper Lite`、`Vacuum Gripper Lite`）的三维查看、中英文界面、关节控制、笛卡尔点动、直线滑轨行程控制及固定 TCP 坐标系；末端配件可独立查看或按兼容关系组合装配（如 `xArm + 六维力矩传感器 + 夹爪 + 直线滑轨`）。`xArm 5/6/7` 使用 1305 版本。演示不连接真机，不包含抓取、碰撞检测或动力学仿真。

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
- `python scripts/generate-mujoco-fixtures.py`、`python scripts/generate-mujoco-gripper-fixtures.py` 和 `python scripts/generate-mujoco-lite6-tool-fixtures.py`：使用 MuJoCo 重新生成五款裸臂及十种夹爪组合的 FK 基准；当前开发环境为 `/opt/conda_envs/py314/bin/python`。

3D 机械臂舞台初始关节角与滑轨行程均为零；关节和滑轨可分别手动调整。右侧控制面板提供关节控制和笛卡尔点动/连续运动，点动步进为位置 `1 mm`、姿态 `1°`；连续运动速度为 `1%–100%`，默认 `20%`，分别映射线速度 `2.5–250 mm/s` 和角速度 `1–100°/s`。滑轨行程控制位于“直线滑轨”面板（`0–700 mm`，步长 `0.1 mm`）。五轴 `xArm 5` 的 `Roll±` 禁用。机械臂关节限位来自 URDF，求解失败时回退到上一次有效姿态。舞台可显示基坐标系和 TCP 坐标系，并在右上角悬浮面板实时显示 `link_base` 下 TCP 位姿、关节角及已装配滑轨的行程；位姿单位为毫米和角度，RPY 使用固定轴 `Rz(yaw) × Ry(pitch) × Rx(roll)`。视角支持鼠标拖动旋转、滚轮缩放、右键拖动平移；触屏使用单指旋转、双指缩放或平移，右下角按钮可复位视角。

页眉的机械臂下拉框可选择五款机械臂，默认 xArm 6、无滑轨、无末端工具；独立查看提示显示在页眉内。舞台右侧从上到下依次为运动控制、末端工具和直线滑轨，窄屏时排列在舞台下方。直线滑轨开关用于装配或移除滑轨，打开后展开行程控制，关闭后收起。操作右侧控件不会改变 3D 舞台大小，舞台仍会随窗口尺寸调整。直线滑轨仅适配 `xArm 5/6/7`，选择 `850` 或 `Lite 6` 时不显示滑轨面板。在 `xArm 5/6/7` 和 `850` 上可叠加勾选“六维力矩传感器”，并单选至多一款夹爪（`无夹爪` / `Gripper G2` / `BIO Gripper G2`）；`Lite 6` 可选择 `Gripper Lite` 或 `Vacuum Gripper Lite`，不支持六维力矩传感器。切换配件保留机械臂姿态，切换机械臂时自动保留新机型兼容的已选配件并清除不兼容项。

右侧“末端工具”可独立查看六维力矩传感器和四款夹爪；选择 Lite 6 时隐藏传感器的装配及独立查看入口，切换到兼容机型后重新显示。“返回装配”恢复进入前的机械臂与全套已装配配件（含滑轨行程与夹爪开口），并复位机械臂关节姿态。独立查看相同夹爪时沿用装配开口，查看其他夹爪时从全开开始；独立调整不会改变装配开口。独立查看时也可选择机械臂型号、打开兼容机型的滑轨开关或选择末端工具返回装配。Gripper G2 开口为 `0–84 mm`，BIO Gripper G2 为 `71–150 mm`，输入步长为 `0.1 mm`；气动 Gripper Lite 使用开关切换张开与闭合，Vacuum Gripper Lite 为静态模型。非法输入恢复上一次有效值。

未装配末端配件时 TCP 为法兰；装配六维力矩传感器叠加法兰 `+Z 58.6 mm`；装配夹爪叠加参考 URDF 固定偏移（Gripper G2 沿安装面 Z 轴 `173.5 mm`，BIO Gripper G2 在其基座坐标为 `(135, 0, 55) mm` 并考虑各机械臂安装变换；Gripper Lite 和 Vacuum Gripper Lite 分别为法兰 `+Z 83.6 mm` 和 `+Z 61 mm`），力矩传感器与夹爪同装时沿法兰轴向串联叠加。TCP 不随夹爪开口变化，且相对机械臂 `link_base` 不随滑轨平移变化；Gripper G2 指尖轴向位置会随开口变化，其开合模型为参考项目的标定估算值。

### 直达链接

- `?model=xarm5`、`xarm6`、`xarm7`、`uf850`、`lite6`：机械臂；省略 `model` 默认为 xArm 6。
- `?model=ai1500`、`?model=gripper-g2&opening=42`、`?model=bio-gripper-g2&opening=110`、`?model=lite6-gripper&opening=0` 或 `?model=lite6-vacuum-gripper`：独立查看六维力矩传感器或夹爪。
- `?model=xarm7&rail=al0700&railPos=280.5&sensor=ai1500&gripper=bio-gripper-g2&opening=110.0` 或 `?model=lite6&gripper=lite6-gripper&opening=100`：组合装配直达链接。`rail=al0700` 与 `railPos=0..700` 仅对 `xarm5/6/7` 生效；`sensor=ai1500` 对 `xarm5/6/7/uf850` 生效；`gripper` 须与机械臂兼容。Gripper Lite 的 `opening` 只接受 `0`（闭合）或 `100`（张开），其他值回退至张开并更新地址栏。省略或无效参数自动回退默认值，地址栏同步清理或更新。

直接打开独立配件链接时，“返回装配”进入无配件的默认 xArm 6 场景。

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
