# UFACTORY Robot Viewer

基于 Three.js 的 UFACTORY 机械臂与配件交互展示，当前开发版本 **0.0.6**。支持五款机械臂（`xArm 5`、`xArm 6`、`xArm 7`、`850`、`Lite 6`）、直线滑轨（`AL0700`）、六维力矩传感器（`AI1500`）及四款末端工具（`Gripper G2`、`BIO Gripper G2`、`Gripper Lite`、`Vacuum Gripper Lite`）的三维查看、中英文界面、关节控制、笛卡尔点动、直线滑轨行程控制、固定 TCP 坐标系、基座 `z=0` 平面 TCP 理论可达圆环、浏览器本地场景持久化及实时三维几何碰撞检测（碰撞拦截回退与发生碰撞部件变红提示）；末端配件按兼容关系组合装配（如 `xArm + 六维力矩传感器 + 夹爪 + 直线滑轨`）。`xArm 5/6/7` 使用 1305 版本。机械臂查看页不连接真机；示例页另提供浏览器端动力学装箱演示。

3D 体验区下方的资产清单列出场景中已加载的产品及其 UFACTORY 官方商城介绍页，链接在新标签页打开；加载中或加载失败时显示相应状态。配件条目以实际场景为准。

页脚根据界面语言显示“关注我们”和对应社交链接。

## 本地运行

需要 Node.js **24.13.0** 和 npm。固定依赖记录在 `package-lock.json`。

```sh
npm ci
npm run dev
```

浏览器打开终端输出的地址。手机在同一局域网时，可使用终端输出的网络地址。`npm run build` 输出 `dist/`；`npm run preview` 预览生产构建。

- `npm run typecheck`：TypeScript 类型检查。
- `npm test`：视觉开口几何、URDF、MuJoCo FK/碰撞基准、IK、末端调平、基座 `z=0` 可达半径、本地场景存储、几何碰撞及装箱场景测试。
- `npm run test:browser`：Playwright 桌面和手机尺寸测试，包括装箱动力学、故障和页面状态。首次使用需 `npx playwright install chromium`；也可设置 `CHROME_PATH` 使用本机 Chrome。
- `node scripts/benchmark-model-loading.mjs`：启动生产预览后，以 100 ms 延迟和 10 Mbps 比较滑轨压缩资源与原始资源的三次冷加载；可通过 `MODEL_BENCH_URL` 和 `CHROME_PATH` 指定地址与浏览器。
- `python scripts/build-collision-hulls.py`：从官方碰撞网格及配件视觉网格离线提取紧凑凸包 `public/models/<id>/collision.json` 并同步 `SHA256SUMS`。
- `node scripts/reach-input.mjs` 与 `python scripts/generate-reach.py`：导出 27 种兼容装配组合的 TCP 变换，并使用多起点 SLSQP 与差分进化双方法离线计算基座 `z=0` 平面最大水平可达距离（写入 `src/reach-data.json`）。
- `python scripts/generate-mujoco-fixtures.py`、`python scripts/generate-mujoco-gripper-fixtures.py`、`python scripts/generate-mujoco-lite6-tool-fixtures.py`、`python scripts/generate-mujoco-collision-fixtures.py` 和 `python tests/packing-physics.py`：使用 MuJoCo 重新生成五款裸臂及夹爪组合的 FK 与几何碰撞真值基准，或运行装箱示例独立跌落物理核验。

离线 Python 脚本不参与网页构建。已验证的 `py314` 环境为 Python 3.14.6、MuJoCo 3.15.0、NumPy 2.5.2 和 SciPy 1.18.0；激活环境后可用 `python -m pip install mujoco==3.15.0 numpy scipy` 安装所需库。凸包与可达范围脚本需要 NumPy 和 SciPy；MuJoCo 基准、可达范围及装箱物理核验还需要 MuJoCo；`build-packing-model.py` 只使用 Python 标准库。可达范围脚本另外调用 Node.js。

重新生成碰撞凸包或 MuJoCo 碰撞基准时，还需只读的 [UFACTORY Genesis](https://github.com/xArm-Developer/ufactory_genesis) `assets/urdf` 目录（含各机械臂、BIO Gripper G2、Gripper Lite 和 Vacuum Gripper Lite 的碰撞或视觉 STL）。默认读取 `../ufactory_genesis/assets/urdf`，也可用 `UFACTORY_GENESIS_URDF_DIR` 指定；复现时应核对各 `public/models/*/SOURCE.md` 所列的上游版本。夹爪 FK 基准使用项目内 `tests/reference-urdfs/` 的原始组合 URDF。其他输入来自项目内模型和配置；生成脚本会覆盖相应生成文件。

3D 机械臂舞台初始关节角与滑轨行程均为零。控制面板左侧为笛卡尔控制、右侧为关节控制，默认选中并展开笛卡尔控制；两种面板均支持通过右上角折线箭头收起（展开显示向上 `^`，收起显示向下箭头）并分别保留展开状态，收起时同步隐藏共享速度与预设按钮并停止进行中的运动。关节面板每行提供左减右增按钮及只读进度条（显示 URDF 关节限位、`0°` 零点刻度、当前关节角度与实时位置指针）；关节按钮短按步进 `1°`，鼠标或触屏长按超过 `220 ms` 后连续运动，键盘按 Enter 或空格单步；连续运动在释放、取消、切换标签或场景、收起面板及失焦时停止。关节、笛卡尔与直线滑轨共用 `1%–100%` 速度（默认 `50%`，调整后保存在当前浏览器并在刷新后恢复；关节速度线性映射为 `1–45°/s`，笛卡尔与滑轨线速度映射为 `2.5–250 mm/s`，笛卡尔姿态角速度线性映射为 `1–40°/s`），速度下方提供两面板共用的“初始位置”（将当前机械臂全部关节移向 `0°`，保留滑轨行程与末端工具配置）与“末端调平”（只调整最后三个关节，在关节限位内取关节角变化平方和最小的解使法兰局部 `+Z` 与基坐标系 `−Z` 夹角不超过 `0.1°`，不可达时保留当前姿态并提示）：两按钮与其他控制按钮交互一致，短按或键盘 Enter/空格沿目标同步步进最多 `1°`，鼠标或触屏长按超过 `220 ms` 后按共享关节速度连续插值（每次碰撞检测间任意关节移动不超过 `1°`），在释放、取消、配件或滑轨调整、切换标签或场景、收起面板及失焦时停止。笛卡尔短按步进为位置 `1 mm`、姿态 `1°`。滑轨行程位于“直线滑轨”面板（`0–700 mm`，提供 `0.1 mm` 步长数值输入、只读进度条及左减右增按钮；按钮短按步进 `1 mm`，长按超过 `220 ms` 按共享线速度连续运动并以不超过 `1 mm` 间隔检查碰撞）。五轴 `xArm 5` 的 `Roll±` 禁用。

机械臂关节与滑轨运动逐步检查限位和碰撞，碰撞时回退至上一次有效姿态并停止。笛卡尔点动逆解未收敛时保留原姿态，若试算得到超出关节限位的解则显示 C23 关节编号和角度提示；检测到机械臂自碰撞、机械臂与已装配配件（含 `AL0700` 动态拖链）几何碰撞时自动拦截回退，仅将产生碰撞的部件局部变红并在 3D 舞台中上方弹出提示具体碰撞部件对，下次有效运动或切换场景时恢复原材质（地面不参与碰撞检测）；末端调平不可达、数值输入越界、场景恢复回退及模型加载异常也统一在 3D 舞台中上方提示。舞台地面显示当前机械臂与配件组合的 TCP 在基坐标系 `z=0` 平面上的理论最大水平可达距离圆环（受 URDF 关节限位约束、末端姿态自由且不考虑碰撞；装配滑轨时随机械臂基座移动，关节运动与夹爪开合不改变半径，装箱示例不显示）。舞台右下角提供带基座与法兰标记的三轴图标按钮，分别开关基坐标系和 TCP 坐标系三维坐标轴显示，并在右上角悬浮面板实时显示 `link_base` 下 TCP 位姿、关节角及已装配滑轨的行程；位姿单位为毫米和角度，RPY 使用固定轴 `Rz(yaw) × Ry(pitch) × Rx(roll)`。视角支持鼠标拖动旋转至机械臂下方、滚轮缩放、右键拖动平移；触屏使用单指旋转、双指缩放或平移，右下角按钮可复位视角。

3D 舞台左上角的机械臂下拉框可选择五款机械臂，默认 xArm 6、无滑轨、无末端工具。机械臂型号、关节姿态及兼容配件状态自动保存在当前浏览器（连续运动与拖动按 `200 ms` 节流并在停止、失焦或离开页面时立即写入）；刷新或重新打开首页时优先恢复本地保存的场景并同步更新地址栏，无有效记录时使用直达链接，恢复场景无效或发生碰撞时自动回退至链接场景（若链接场景也碰撞则回退至 xArm 6 无配件零位）并弹出可关闭提示。舞台右侧从上到下依次为运动控制、末端工具和直线滑轨，桌面端舞台与右侧控制区随页面同步滚动，窄屏时控制区排列在舞台下方。直线滑轨开关用于装配或移除滑轨，打开后展开行程控制，关闭后收起。操作右侧控件不会改变 3D 舞台大小，舞台仍会随窗口尺寸调整。直线滑轨仅适配 `xArm 5/6/7`，选择 `850` 或 `Lite 6` 时不显示滑轨面板。在 `xArm 5/6/7` 和 `850` 上可叠加勾选“六维力矩传感器”，并通过“末端执行器”下拉框选择 `无夹爪`、`Gripper G2` 或 `BIO Gripper G2`；`Lite 6` 的下拉框提供 `无夹爪`、`Gripper Lite` 和 `Vacuum Gripper Lite`，不支持六维力矩传感器。切换配件保留机械臂姿态，切换机械臂时自动保留新机型兼容的已选配件并清除不兼容项。

“末端工具”中，Gripper G2 开口为 `0–84 mm`，BIO Gripper G2 为 `71–150 mm`，输入步长为 `0.1 mm`；气动 Gripper Lite 使用开关切换张开与闭合，Vacuum Gripper Lite 为静态模型。非法输入恢复上一次有效值。

未装配末端配件时 TCP 为法兰；装配六维力矩传感器叠加法兰 `+Z 58.6 mm`；装配夹爪叠加参考 URDF 固定偏移（Gripper G2 沿安装面 Z 轴 `173.5 mm`，BIO Gripper G2 在其基座坐标为 `(135, 0, 55) mm` 并考虑各机械臂安装变换；Gripper Lite 和 Vacuum Gripper Lite 分别为法兰 `+Z 83.6 mm` 和 `+Z 61 mm`），力矩传感器与夹爪同装时沿法兰轴向串联叠加。TCP 不随夹爪开口变化，且相对机械臂 `link_base` 不随滑轨平移变化；Gripper G2 指尖轴向位置会随开口变化，其开合模型为参考项目的标定估算值。

### 示例 01：装箱

页眉可在“机械臂”和“示例”之间切换。示例使用独立的 xArm 6 + Gripper G2 场景与状态：传送带以 `40 mm/s` 运行，机械臂跟踪移动工件并依次低位释放放入敞口箱；实时显示装箱进度、仿真耗时与平均节拍，九件稳定落箱后自动停止。支持暂停、继续、重置和完成后重播。离开示例时暂停，返回时恢复离开前的播放状态；机械臂页的型号、配件、姿态和控制状态保留。手机可查看，建议使用桌面浏览器体验。

示例使用官方 [MuJoCo 3.15.0 单线程 WebAssembly 引擎](https://github.com/google-deepmind/mujoco/blob/3.15.0/wasm/README.md)。九个 30 mm、17 g 工件始终是自由刚体，从进料罩后的传送带队列逐件进入视野；传送带的[表面速度](https://mujoco.readthedocs.io/en/3.13.0/XMLreference.html#body-geom-surfacevel)通过接触摩擦搬运工件。机械臂六个关节及夹爪两侧接触面使用驱动器控制，抓取与释放依靠接触、摩擦和重力，不用固定约束或直接移动工件。G2 物理夹持面采用与视觉开口对应的简化滑动接触体，机械臂采用项目已有凸包，驱动及摩擦参数为展示设定，并非实体设备标定。抓空、掉落、未稳定落箱和非预期碰撞会停止并在示例 3D 界面中上方提示，发生碰撞的机械臂部件会变红；正常夹持及工件与传送带、箱体接触不报警。该示例不连接真机，也不能作为真实设备的安全验证。

`python scripts/build-packing-model.py` 从项目内 xArm 6 URDF、`src/packing-config.json` 和碰撞凸包重新生成示例 MJCF。引擎在进入示例时按需加载，生产构建包含 WASM 文件。

### 直达链接

- `?example=packing-01`：直接打开装箱示例；浏览器前进和后退可切换页面。
- `?model=xarm5`、`xarm6`、`xarm7`、`uf850`、`lite6`：机械臂；省略 `model` 默认为 xArm 6（若当前浏览器已有本地保存的有效机械臂场景，首次打开优先恢复本地场景并更新地址栏）。
- 旧配件链接 `?model=ai1500`、`?model=gripper-g2&opening=42`、`?model=bio-gripper-g2&opening=110` 转换为 xArm 6 装配；`?model=lite6-gripper&opening=0` 和 `?model=lite6-vacuum-gripper` 转换为 Lite 6 装配。有效开口和锚点保留，旧模式下不生效的滑轨、传感器及夹爪参数清除。
- `?model=xarm7&rail=al0700&railPos=280.5&sensor=ai1500&gripper=bio-gripper-g2&opening=110.0` 或 `?model=lite6&gripper=lite6-gripper&opening=100`：组合装配直达链接。`rail=al0700` 与 `railPos=0..700` 仅对 `xarm5/6/7` 生效；`sensor=ai1500` 对 `xarm5/6/7/uf850` 生效；`gripper` 须与机械臂兼容。Gripper Lite 的 `opening` 只接受 `0`（闭合）或 `100`（张开），其他值回退至张开并更新地址栏。省略或无效参数自动回退默认值，地址栏同步清理或更新。


## 部署

[Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)支持私有 GitHub 仓库和生产分支自动部署。项目参数：

- 官方源码：`xArm-Developer/ufactory_robot_viewer`（私有）；部署来源：`DanielWang123321/ufactory_robot_viewer`（私有 Fork），生产分支：`main`。
- Pages 项目：`ufactory-robot-viewer`，地址：`https://ufactory-robot-viewer.pages.dev`；原站点 `https://uf-robots.pages.dev` 暂时保留。
- 构建命令：`npm run build`；构建输出：`dist`；根目录：仓库根目录。
- Node 版本：`24.13.0`，可通过 Pages 环境变量 `NODE_VERSION` 固定；仓库也提供 `.nvmrc`。

构建从 URDF 生成并校验视觉网格清单，为大于 128 KiB 且压缩后缩小至少 20% 的 GLB 生成无损 gzip 副本；副本以原始内容 SHA-256 命名并以 `.bin` 结尾，须作为原始二进制返回。生成的 `_headers` 只为这些带指纹的资源设置长期浏览器缓存。机械臂和已选配件并行准备，场景按解码后的网格与纹理大小限制缓存为 64 MiB（正在使用的资源保留）；不支持解压 API 时使用原文件。

新站点已从个人 Fork 的 `main` 自动构建并部署。官方仓库的更新须通过 GitHub 的 **Sync fork** 或推送同步到 Fork 的 `main`，才会触发新项目的自动部署。新旧站点域名不同，旧地址的浏览器本地场景不会自动迁移。

## 资料与许可

- 项目代码使用 [BSD-3-Clause](LICENSE)；第三方资源沿用各自的来源和许可。页脚官网品牌资源及字体说明见 `public/branding/SOURCE.md`。
- 模型与资产来源、版本、SHA-256 和许可证见 `public/models/` 各型号的 `SOURCE.md`、`NOTICE`、`SHA256SUMS` 及 `public/examples/packing-01/`；运动学基准的原始组合 URDF 及校验值见 `tests/reference-urdfs/`。
- UFACTORY 官方用户手册：[xArm 系列](https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf)、[850](https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf)、[Lite 6](https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf)。
