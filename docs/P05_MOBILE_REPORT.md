# P0.5 Commit B — Mobile Explorer 验收报告

手机端已具备 Graph / Relations / Evidence 三个视图，使用同一个真实 ViewGraph 和选择状态。四个手机尺寸的 Chromium 触摸模拟验收通过，桌面和平板回归通过。完成本地提交后停下，等待 review；没有推送或部署。

## 基线与变更

父提交：`85b18b84719d44f6ef4c2d8901b3de817d628c21`（已验收的响应式面板）。Commit B 提交标题：`web: add mobile explorer navigation`。本报告随 Commit B 提交，完整 SHA 见本地 `git log -1` 和 `artifacts/mobile/commit.json`，不 amend 父提交。原有未跟踪 `tools/` 保留。

修改文件：

- `docs/MOTION_CONTRACT.md`
- `docs/UI_CONTRACT.md`
- `docs/P05_MOBILE_REPORT.md`
- `docs/superpowers/plans/2026-10-09-mobile-explorer.md`
- `package.json`
- `src/web/client/app.css`
- `src/web/client/app.js`
- `src/web/client/index.html`
- `src/web/client/lib/mobile.mjs`
- `src/web/client/lib/mobile.d.mts`
- `test/mobile.test.ts`
- `test/web/fixture-server.ts`
- `test/web/mobile-acceptance.ts`
- `test/web/responsive-acceptance.ts`
- `test/web/ui-contract.ts`

## 三视图及状态

- Graph 保持既有世界布局、真实 composition、相机写入逻辑。触摸区域独占平移和缩放；阅读视图使用浏览器原生滚动。触摸取消后可重新点击；图中 tap 后拦截浏览器兼容 click，避免误选新出现的证据。
- Relations 直接索引每个真实 edge，按 canonical family、证据声明形式及声明位置分组。关系数和证据数分开显示。没有路径语义猜测、成员上限或第二个模型。
- Evidence 复用实际 Drawer 数据和渲染，手机完整展示模型提供的字符串及数组。固定返回/关闭栏，内容独立滚动；没有选中时显示真实空状态。
- 三视图 DOM 保留，图隐藏时仍保留原尺寸。切换保留相机、选择、列表展开和阅读位置。URL 保留仓库及 edge/node，记录 mobile view；浏览器 Back/Forward 恢复页面和快照，同仓库普通切换不请求或重新分析。depth 变化恢复目标视图并按数据变化加载。
- 手机策略是 coarse pointer 且宽度 <768，或宽度 ≤900、高度 ≤500 的短横屏。fine pointer 的原有桌面浏览器缩放行为保留。≥1600 双面板、1024–1599 互斥、768–1023 临时面板策略通过原回归。
- Fit 使用手机初始可读视角；搜索和 View in Graph 是显式定位，必要时缩小目标以避开 HUD。仅聚合显示的成员定位到其真实声明结构卡，并提示该成员在组内，可读其具体 Evidence。

## 浏览器证据

运行环境：WSL2 Ubuntu / Linux Node 与 Playwright Chromium，`hasTouch` + CDP 原生触摸事件模拟。截图不是设计稿。实际 stage、SVG CTM（世界到屏幕坐标变换）、世界焦点、节点屏幕矩形、选择、滚动和请求数见 `artifacts/mobile/after/results.json`。可直接打开 `artifacts/mobile/report.html` 看截图与每条检查。

| 手机尺寸 | 实际 Graph stage | 模型 | 全成员索引 | 结果 |
|---|---|---|---|---|
|390×844|0,88 / 390×703|Kuddev/pebrel|97/97|PASS|
|375×667|0,88 / 375×526|yunmin311/obsidian-config|14/14|PASS|
|430×932|0,88 / 430×791|grpc/grpc|42/42|PASS|
|844×390|0,49 / 844×288|Kuddev/pebrel|97/97|PASS|

三个生产缓存模型使用原始分析版本：pebrel `51514bd50094f6d3f417294c9204976e6a19a35a`，Obsidian `3982a219c1027a7128b2dc0d056d211e7f7e5b96`，grpc `724b3ccb608b8ac7e51482a15113edfd94bb28ba`。它们不是当前 GitHub 最新版本。

390px 三视图截图：

![390 Graph](../artifacts/mobile/after/390-graph.png)
![390 Relations](../artifacts/mobile/after/390-relations.png)
![390 Evidence](../artifacts/mobile/after/390-evidence.png)

375、430、844 横屏也各保存三张截图。97/14/42 条索引的 ID 与真实模型逐项一致且唯一，所有成员均有 Evidence 与 View in Graph 按钮。真实节点及关系命中、代表关系选择、状态、全部提供的 locator/observedText、证据卡数量已实际验证；没有声称逐一打开 97 个 Evidence。pebrel 的 serde 关系 8/8 张证据卡、grpc 最多证据的关系 2/2 张已完整显示。长字符串压力测试单独标注为显示测试数据，未当作真实出处。

### 双指事件和坐标

390px：第一对触点 `(150,439.5)`、`(240,439.5)`，中点 `(195,439.5)`。逐步外扩到 `(115,439.5)`、`(275,439.5)`。缩放由 1 到 1.7777777778；真实 CTM 为 `[1.77777778,0,0,1.77777778,-676.11111111,-609.38888889]`。中点对应世界点 `(490,590)`，缩放后仍映射到 `(195,439.5000000000001)`，误差小于 1 CSS px；选择为空，无误点击。原始事件序列和其他三尺寸坐标存入 results.json 的 events 和 checks。

继续验证两指→释放一指→单指平移、三指取消→新节点 tap、普通空白 tap 清除选择、阅读原生滚动不移动图、列表恢复精确滚动、Evidence 恢复精确滚动、Escape/Back、实际目标位于 HUD 上方、主要 HTML 控件有效命中约44px、无横向溢出和减少动画偏好。软键盘测试通过把 viewport 高度减少至500px模拟搜索可见区域，并验证输入焦点和结果可达。

## 回归结果

| 检查 | 结果 |
|---|---|
|Build / Typecheck|PASS|
|Unit|441 PASS / 3 SKIP / 0 FAIL（444 总数）|
|Mobile|133/133|
|Canvas|113/113|
|UI Contract|75/75|
|Responsive|71/71|
|Landing|40/40|
|Analysis|16 状态 / 0 违反约定|
|Preflight|45/45|
|Stale A→B|failed=false, complete=true, observed=true, errors=[]|

768×1024、820×1180、1024×768、1280×800、1920×1080 已由原响应式/画布套件覆盖。unit/build 先完成，之后运行浏览器验收，未让构建覆盖正在验收的 dist。类型检查和最终 diff 检查通过。独立只读审查提出的问题已修复，最终审查未发现新的可确认缺陷。

原 640px coarse 和 844px 横屏中“旧 Rail/Drawer 仍是手机主界面”的断言已过时：手机改为三个独立视图。替换这些手机断言，保持套件数量和桌面、平板及 fine-pointer 200% 缩放检查；UI/Motion 合约记录原因。没有更新视觉基线掩盖缺陷。

Landing 最终并发回归曾为39/40：无效仓库的 GitHub TLS 请求超时，失败状态到达等待窗口边缘。保留 `p05b-landing-first.log`，未改测试期望；原样独立重跑40/40。最终日志都在 `artifacts/mobile/logs/`。断点焦点丢失的红测保存在 `p05b-mobile-focus-red.log` 与 `mobile-link-focus-red.log`，已补上隐藏控件和重建证据链接的可见焦点恢复，四条检查通过。深度返回检查曾在加载期间读取旧视图标记（`p05b-mobile-history-race.log`）；改为等待目标 depth 响应和实际可见的 Relations 后133/133通过，没有放宽断言。初始红测保存在 `mobile-red.log`：390px 无手机导航，实际 stage 0,80 / 390×764。

## 已知限制与验证边界

- Chromium 是触摸模拟。WebKit 可执行文件缺失；Safari / WebKit 和物理设备均未验收，真实设备双指、软键盘与系统 safe-area 还未验证。
- 固定世界图的右侧内容初始可在手机屏外；保留此布局并提供平移、缩放、搜索、Relations 和显式定位。密集 SVG 关系行沿用既有尺寸，可能小于44px；完整 Relations 操作入口具有44px命中区域。
- 聚合成员没有独立图节点时定位其真实结构卡，没有伪造孤立节点。图布局及 canonical 模型未重做。
- ViewGraph 原有证据提供上限及截断标记仍由模型决定，UI 展示模型实际提供的全部卡，不补造记录、行号或出处。缓存资料不是最新联网分析。
- 当前无本地功能阻塞；真机和 Safari 验收仍未完成，不能据此宣称跨设备发布验收通过。

等待用户 review，不需要用户执行功能回归。本轮没有推送、部署或修改生产。
