# Relationship Map 工程验收记录（2026-10-22）

本轮沿用 PR #6 已接受的设计，只修复实测回归并补齐验收门槛。最终本地与远端检查结果见交付快照；测试数量不用于计算产品完成度。

## 基线与边界

- 开始时本地为 `codex/ui-hierarchy-first` / `868c488d6d5358b05899ad8e777e320ca0037c0e`。
- 重新读取 GitHub：PR #6 已合并，main 为 `898bdc83607d06d3bb8ccac3d2dbc8ee48f88460`；两者 tree 相同（`508c4491579454eac4444fc044be215436e71b76`）。原故障先在该未修改 tree 的生产构建中复现，再从 main 建立 `codex/design-milestone-acceptance`。
- 原 M2 运行：[39720738079](https://github.com/yunmin311/GitLineage/actions/runs/39720738079)，job `119633344389` 在 `component-motion-acceptance.ts:44` 失败；后续 Private Beta、TLS 和 Bundle 校验被跳过。新工作流把最终 Bundle 校验与证据上传改为 `always()`。
- WSL2 Ubuntu 24.04、Node 24.21.0、Linux x64、本地 Chromium，全部浏览器检查读取构建后的 `dist/web`。离线 UI fixture 用于稳定复现，不等同于真实仓库分析；联网套件单独记录。
- 未修改 Canonical Graph、Ontology、Discovery 语义、安全策略或生产配置；未部署、重启生产或合并。未跟踪的 `tools/` 与 `experiments/design-lab/` 保留。

## 实测缺陷与修复

| 宽度 | 原 Return 实际宽×高 | 修复后宽×高 | 成功／503 失败两种状态 |
| --- | --- | --- | --- |
| 1920 | 137.0625 × 38.796875 | 137.0625 × 44 | PASS |
| 1280 | 137.0625 × 38.796875 | 137.0625 × 44 | PASS |
| 430 | 120.21875 × 44 | 120.21875 × 44 | PASS |
| 390 | 120.21875 × 44 | 120.21875 × 44 | PASS |

1. 桌面端 `site.css` 最后生效的 38px 最小高度覆盖了既有触控要求。统一 Return／分支触发器为 44px，删除现在冗余的手机端高度覆盖。未降低旧测试阈值。
2. 手机端原 Return 虽达到 44px，却在 History 关闭时把已选 Canonical edge 当作 node 重新选择，丢失 URL／Evidence。桌面端重复选择同一对象还会重建 Inspector，折叠已打开的阅读内容。关闭时只在选择确实变化后恢复选择，并使用既有恢复模式；History 的打开、列表、分页、跳转逻辑保持不变。
3. 完整 M2 套件继续执行后发现首页两个项目示例链接也被 `site.css` 压为 38px。四宽度实际测量复现；统一为 44px，保留旧阈值，新增每个链接九点命中与键盘焦点检查。
4. 分析深度按钮同样被 site 层压为 32px，保留既有 44px 断言并恢复实际最小高度。
5. Analysis 的 260ms Web Animation 在运行中切换 Reduced Motion 时继续播放。现在媒体偏好变化会取消当前入口动画，后续阶段更新也先清理旧动画。静态阴影与已接受的视觉设计保持原样。

新增 Return 检查覆盖 8 个场景：每个按钮九点 `elementFromPoint` 命中、与标题／输入／分支触发器零交叠、真实底边点击；返回前后比较 URL、Selection、Evidence HTML 与展开状态、阅读滚动、SVG CTM、stage bounds、world focal point 和 viewBox。全部通过。原版手机状态恢复失败与桌面高度失败均保存于 before 证据。

## 验收门槛

- `npm run test:history-return`：独立运行上述 8 场景。
- `npm run test:site-continuity`：六页面连续性＋Return 专项。1920／1280／430／390px；保留截图与几何记录，首页内部滚动区域分段截图；检查焦点、展开、分支 Escape、URL／Camera 返回、Discovery 选择与 Reduced Motion、页面异常和文档横向溢出。
- Canonical token 原 golden tests 保留；自定义属性解析检查同时读取 `app.css` 和 `site.css`。浏览器还比较真实 fixture 中 site 层启用／禁用时的六个证据状态变量与 edge／status 的计算后绘制颜色，四宽度一致。
- Stable UI 与 M2 的原生 ARM64 PR 工作流均接入 Site Continuity，原套件继续执行。M2 保留完整 unification、Motion、History、Overview、routing、Private Beta 与 TLS。
- main／手动 `arm64-validate` 在单元测试之后重新构建生产 Bundle，安装 Chromium，并在原有 live、API 与 ARM64 镜像验证之前运行 Site Continuity＋unification。
- 所有浏览器套件在最后一次生产构建之后运行；前后 SHA-256 校验禁止测试期间静默重建。证据上传保留 14 天，发布前须另行归档。
- **仓库设置缺口**：只读 GitHub 审查返回 main `protected:false`、rulesets `[]`。工作流纳入并不等于强制合并门槛；发布须确认两个 PR 检查及对应发布 SHA 的 main／manual 检查成功，并另行确认 required checks 的管理设置。本轮未修改该设置。

旧断言只在有已合并设计与真实 DOM 证据时修订，触控阈值保持 44px：

| 旧假设 | 已接受设计及保留／新增检查 |
| --- | --- |
| 阶段之间必须有连线 | PR #6 已取消连线；检查五阶段顺序、不交叠、唯一当前阶段，保留轮询、绘制与动画检查 |
| Checkbox 图形必须宽 24px | 图形为 18px，完整 label 至少 44px；检查方形、文本空间、label 边缘点击和 Space |
| 手机 Analysis 的 computed Grid 必须一列 | 实际为 Flex 纵排；测量各模块占满内容宽度、上下阅读顺序和零交叠，包含 767px 边界 |
| Landing 必须有一次入口动画 | site 层明确取消旧 reading-enter；检查无嵌套入口、标题完全绘制，保留图谱真实运动检查 |
| 键盘选择后调用 DOM click 应有过渡 | 键盘模式立即反馈；真实指针点击转移输入归属后，检查确有不同绘制帧，再检查 Reduced Motion |
| History 详情必须完全没有动画 | PR #6 指针反馈只有整块详情的 220ms owner；检查 owner、时长、无子文本入口及键盘立即呈现 |
| Scope 标题固定 13.5px | 接受后的 site 角色为 14px；同步精确字号检查，保留范围、预算披露、焦点和相机检查 |

对应实测与截图在 `artifacts/milestone-acceptance/analysis-stack/`、`design-contract/` 及原失败日志中。

## 设计一致性与视觉审查

- `site.css` 在 `app.css` 之后加载。蓝／青／紫／陶土色用于任务、结构与观察上下文，不替代 VERIFIED／DECLARED／DETECTED 的证据意义。四宽度真实绘制比较通过，原 token golden tests 继续通过。
- 新设计的微量环境模糊阴影与旧“仅硬偏移”条文存在文字冲突。已在 UI／Motion 合同中明确：仅限 PR #6 已接受的 HTML 控件和卡片，禁止由此扩展到 Graph 模糊或动画模糊；未重做视觉。
- Chromium `CSS.supports` 对扫描到的 1599 条声明未发现拒绝项；CSSOM 记录 44 组同上下文重复选择器。它们包括累积细化与覆盖，不能据此判为全部废弃。只删除此次统一高度后能证明冗余的一条规则，其余留待有独立视觉对照的整理任务。
- 人工查看生产截图：首页输入与地图说明清晰；Analysis 五阶段可读；手机 Inspector 保持“关系→对象→解释／证据→技术披露”的阅读顺序；History 工具栏、列表、详情与返回操作无本轮已证实的遮挡。手机 Relations、Evidence 与 Overview 的实际交互由浏览器专项覆盖。
- Motion 快速反向、中断、键盘归属、相机保持与 Reduced Motion 以现有 motion-continuity／component-motion 专项结果为准。截图不能证明持续帧率。
- 本轮没有需要擅自重设计的审美修改。阴影强弱、页面留白等已接受决策继续保留，不当作工程缺陷重做。

## 本地测试记录

完整串行执行清单、起止时间、退出码：`artifacts/milestone-acceptance/final-v3/results.json`；每条命令独立 `.log`。最终汇总与联网结果见交付快照。

执行范围：Typecheck、Unit、Production Build、Canvas、Landing、Analysis（含 indicator）、Preflight、stale A→B（含 navigation-loading、history-state-closeout）、UI Contract、Responsive、Mobile、Site Continuity＋Return、Deep Search、Exploration＋throttle、unification 全部 12 专项、Spatial Routing、Private Beta、隔离 loopback TLS。另行执行 `test:live`。

单元套件共 625 项：622 PASS、0 FAIL、3 个联网集成入口默认 SKIP。`test:live` 用于实际执行这三个入口；不能把默认跳过算作已测。TLS 套件仅操作临时隔离环境，不读取或修改生产 Caddy／systemd。

## 证据索引

本地根目录：`/mnt/e/1project/GitLineage`；下列 artifacts 被 Git 忽略，保留在本机；Actions artifact 保存远端本次运行产生的证据，不包含本机 before 日志，不伪装为已提交源码。

| 内容 | 路径 |
| --- | --- |
| 原始生产构建／M2 本地复现日志 | `artifacts/milestone-acceptance/before/` |
| 原 Return 八场景截图与几何 | `artifacts/history-return/before/` |
| 修复后 Return 八场景截图、CTM／相机／状态 | `artifacts/history-return/after/geometry.json` 及同目录 PNG |
| 六页面四宽度、首页分段截图 | `artifacts/site-release/after/`（41 张 PNG，`checks.json`） |
| 旧断言发现、阅读状态失败与修复过程 | `artifacts/milestone-acceptance/after/` |
| 旧断言与当前布局／输入归属对照 | `artifacts/milestone-acceptance/analysis-stack/`、`design-contract/` |
| 深度按钮修复前后尺寸与命中 | `artifacts/milestone-acceptance/depth-target-before/`、`depth-target-after/` |
| CSS 重复选择器与声明扫描 | `artifacts/milestone-acceptance/final/css-audit.json` |
| 首轮全量日志与项目链接失败 | `artifacts/milestone-acceptance/final/` |
| 最终全量命令日志、结果与 Bundle 哈希 | `artifacts/milestone-acceptance/final-v3/` |
| 项目链接修复前后尺寸与九点命中 | `artifacts/milestone-acceptance/project-target-before/`、`project-target-after/` |
| 原生 ARM64 证据 | PR 检查的 Actions artifacts（14 天保留） |

现有 Motion／History／Overview 套件另外保存各自的截图、帧与几何；查看相应命令日志中的路径，不能把仓库内既有旧截图混算为本轮新证据。

## 未验证范围与进度判断

WebKit、实体设备、真实触摸／双指缩放、持续帧率未验证。Chromium 手机模拟与合成触摸不能替代这些验收；完整 <768 Mobile Explorer 的设备级验收仍未宣告完成。离线 fixture 不证明线上真实数据、缓存、限流或生产部署正常；生产本轮未操作。

产品完成度暂估 **70% → 71%（本轮约 +1 个百分点，剩余约 29%）**。依据是关闭 Return／项目链接与深度按钮触控／阅读状态／动态 Reduced Motion 的真实回归，并使已接受设计进入可重复的 CI 门槛；没有新增产品功能。设备、性能和正式生产验收仍有缺口；发布 SHA 的 ARM64/live/image 结果须查阅交付快照，因此不直接宣称达到 72%。下一阶段优先验证上述发布与设备边界，再在另行授权后制定可回滚部署计划。

## 交付快照

本轮源代码按运行时修复、验收门槛两阶段提交。确切 Commit／PR／本地退出码／ARM64 runs、jobs 与 artifact 清单记录于本机 `artifacts/milestone-acceptance/delivery.json`，最终汇总报告为同目录 `FINAL_REPORT.md`。远端 Actions 检查可由对应 PR 的 Checks 页面独立复核；这些结果文件与截图不属于提交源码。

实际修改范围：三个客户端文件（`app.js`、`site.css`、`lib/repository-explorer.mjs`），`package.json`，三个 ARM64 工作流，UI／Motion 合同，本验收记录，token 检查以及六个浏览器验收文件（包含新增 Return 专项）。完整文件与 Commit 清单以 `git diff --name-only 898bdc8...HEAD` 和交付快照为准。
