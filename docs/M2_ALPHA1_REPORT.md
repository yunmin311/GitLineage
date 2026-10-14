# M2 Alpha.1：搜索来源与固定源码选择

2026-10-09。结果：**用户可以在已发现候选中预览固定文件树、修改目标及候选源码选择、执行比较，并下载可独立追溯搜索来源的 Sidecar**。四个固定入口不再限制浏览器流程。所有相似性仍是有限文件采样；Unknown 保持 pending，lineageClaim 为 none。

## 基线与变更范围

实际起点：`68f9b75f87216fbeb1f43a6ee65ea74dab80a489`，分支 `review/gitlineage-development`；起点工作树只有未跟踪 `tools/`。本轮没有修改 OCI、Caddy、TLS、远端 main 或生产部署。Git、Node、测试及浏览器服务器均在 WSL2 Ubuntu-24.04；Node v24.21.0。

- `f5d22e98`：搜索来源的版本化预览合同与传递修复。
- `43ba5bdf`：固定文件树选择、共享预算、目录缓存及后端测试。
- 最后一笔功能提交包含文件选择 UI、浏览器验收、本文及静态证据。完整 SHA 可从本报告所属提交的 Git 历史复核。

修改集中于 `experiments/discovery-v2/{preview,preview-contract,source-selection}.ts`、`src/discovery/{pinned-probe,source-collection}.ts`、独立 `deep-preview.mjs`、其专属 CSS 和测试。没有修改 Canonical Graph schema、Resolver/Policy 谱系规则、Graph 相机、Rail/Drawer 或移动端导航。`tools/` 未删除、暂存或提交。

## 来源丢失的根因与修复

旧 Preview 从搜索结果只取候选身份，随后调用手工 Probe，Probe 又生成 `explicit_public_probe`。原搜索 query、rank、page 和多个发现原因没有进入浏览器下载内容。

现在搜索候选完整保存在 `provenance.candidates[].searchCandidate`，包含原始 query、querySource、source、version、page、rank、reason、observedAt 和身份观察。另记录 searchTaskId、compareTaskId、原搜索结果 digest、target ID/SHA，以及每个候选 ID/固定 SHA。代码比较中的 discoveries 来自实际搜索记录； locator 明确携带 query/page/rank。Search Observation 与 Verification 仍分离。

`runPinnedProbe` 的新参数是可选的。手工 Phase 1D 没有该参数，继续使用原来的 `explicit_public_probe` 和原有内容合同。既有 Phase 1A–1D 结果文件没有被改写；固定入口及旧哈希断言通过。

版本迁移是显式的：

| 下载合同 | 内容与用途 |
|---|---|
| `discovery-pinned-probe@1` | 原手工 Probe；仍可单独验证，不注入搜索来源 |
| `discovery-preview-export@1` | 新增的搜索 provenance envelope + 未改语义的 Probe；保留旧程序调用路径 |
| `discovery-preview-export@2` | 新浏览器流程；在 @1 来源之外加入固定目录、选择范围、搜索请求收据、阶段成本与组合成本 |

消费者先按 schemaVersion 分流。Preview 使用 `validatePreviewExport`，先验证内部 Probe、身份/版本绑定、搜索发现映射、所选路径与资源账本，再验证 envelope SHA-256；@1 不被静默改成 @2。下载文件实际经 JSON 解析后重新验证；修改 ID、选择路径或内容摘要会被拒绝。searchContentDigest 是原搜索结果的关联摘要，完整搜索 Sidecar 仍属于搜索任务；比较导出自足保留被选候选的全部发现观察和搜索请求/覆盖收据。

## 可操作流程与固定对象链路

`输入公开仓库 → Search candidates → 勾选一至两个候选 → Source Files → 修改各仓库文件选择 → Confirm scope & compare → 阅读测量/来源/覆盖 → Download → Return to Graph`。

Source Files 显示目标与候选的 canonical name、numeric ID、完整固定 SHA；每个文件显示路径、JS/TS 类型、大小、复选框及过滤原因。默认只选第一个可用文件，用户可以修改，最多八个/仓库；没有有效输入时比较按钮不可用，并说明原因。范围确认同时显示剩余 HTTP 请求数和所选 blob 读取加最终身份核实的最低请求需求。

搜索已固定目标 revision；目录阶段以候选 numeric ID 重新核实 metadata，再固定 commit/tree。使用官方 owner/repo 路由；只读取固定 tree 对象，永不再次从移动 HEAD 获取源码。每仓库最多请求三个非递归 tree 对象，从 root 向下优先 src/lib/source/packages，目录深度有限；失败也占目录尝试次数。不 clone、不执行代码、不请求 recursive tree、不跟随 symlink/submodule 或外链。

非截断 Tree 完整重算 Git Tree SHA；截断树不能完整校验，因此本轮保守地隐藏其所有未校验条目。已经验证的 Tree 在同一任务会话内复用，再次校验后定位用户所选 blob。blob 仍执行 Git Blob SHA 与 SHA-256 校验，绑定固定 revision 和路径。目录结束与 blob 读取结束都再次检查 numeric ID；冲突时不可保留完整有效快照结论。

JS/TS 之外、vendor/third-party、generated、minified、lockfile、license/documentation、常见 scaffold、过小/过大文件、symlink/submodule、无效路径和无法访问目录均保留原因。内容型 generated/minified/scaffold 检查仍在 digest-checked blob 读取后执行。目录阶段对 >128 KiB 的文件过滤；由于原 32 KiB JSON 响应上限及 Base64 开销，另保守过滤 >24,000 bytes 的源码。本轮没有扩大响应上限；这会降低较大文件的召回，界面明确展示原因。

## 覆盖与预算收据

列出的文件/被过滤文件/未列目录在 selection.repositories 记录；selected 为用户范围；成功读取及摘要在 probe snapshots.source.bindings；读取失败/尚未读取路径在 source coverage.pending；成功比较的文件对与失败在 comparisons/summary。所有范围均标为 `selected files only; repository-wide coverage unknown`，不把所选文件完成描述成全仓扫描。

搜索、目录和比较共用一个 BudgetLedger、NetworkLedger、Resolver、AbortController。每个搜索会话只允许一次目录任务及一次比较，不能给阶段重新发 24 次额度；换候选或重扫需新搜索，并受原有进程级 cooldown/四次每分钟限制。同一进程只能有一个活动预览任务，worker 上限仍为 2。所有网络请求继续先预留，失败照计费；rate-limit、Abort、取消与剩余 deadline 沿用 Provider。

组合硬额度：最多三候选、24 HTTP attempts、8 文件/仓库、128 KiB/文件、2 MiB 源码、32 KiB/响应、1 MiB 累计网络预留。工作 deadline 为**三个阶段累计最多 30 秒活动工作**，人工选择与 cooldown 等待暂停工作时钟；收据同时报告 activeWallMs 与包含这些等待的 elapsedWallMs。整个交互从搜索开始到人工确认的自然耗时可能超过 30 秒，不能把 active 时间称为端到端自然 wall-clock 上限。调度/终止延迟也如实记录；CPU hard budget unsupported，真实线路字节绝对上限仍不能保证。

固定四宽度成功场景收据：搜索 4 次、目录 13 次、比较 6 次，总计 **23 HTTP attempts**；保守预留 753,664 bytes，received=retained=3,724，overflow=0。目标两个文件成功列出、只选择/读取其中一个；两候选各选择一个，总计读取 209 bytes。每仓库请求两个固定 Tree。其实际工作时间和总耗时保存在 [下载收据](experiments/m2-alpha1/390-mock-sidecar.json)，此成本属于固定 Mock，不冒充真实 GitHub线路成本。

另有读取 404 的 14 次请求失败收据校验、八文件/两候选触发 24 次上限的部分结果、树截断、无效路径、空树、过滤、取消、默认分支漂移及 post-ID 冲突测试。取消/验证失败不会生成零分替代不可用结果。

## 三个验收场景

| 场景 | 数据来源 | 实际结果 |
|---|---|---|
| A：没有四个固定入口 | 确定性、合法自造 Git 对象 Mock：`src/main.ts` 与 `lib/core.ts` | 四宽度浏览器可列出、修改选择、读取真实 fixture 字节并经 worker 比较；下载 @2 校验通过 |
| B：已知真实 Fork 的低分控制 | 原有许可与固定 revision 的公开 p-limit/jucke 离线源码样本 | Strict .05507246376811594、Normalized .14147286821705427；没有基于低分排除 Fork；pending/none |
| C：Unknown 高相似 | 相同源码、不同路径的构造 Unknown | Strict/Normalized 100%，依旧 pending/none；不产生自动谱系结论 |

B 是原真实公开源码的离线重放，不是本轮新 API 请求。浏览器还保留 divergent Fork=0 与 identical Unknown=1 的构造控制。没有新增联网测试或真实 API 成绩；真实公开 API 兼容性的既有 Phase 1D/M2 收据保留原状。13 个固定控制 pool 内容 digest 仍为 `546af0c31bc3434abca4f64ff8691457373a2c3449363b641f30eb53d637167c`。

## 回归与浏览器证据

| 检查 | 结果 |
|---|---|
| Typecheck / Build | PASS |
| Unit | 559 PASS / 3 个原有 live SKIP / 0 FAIL，共 562 |
| Discovery（含 Phase 1A–1D、Preview、来源、9 个选择测试） | 115/115 |
| Phase 0 | 6/6 |
| Phase 1A / 1B / 1C / 1D 固定入口 | 全部 PASS，旧固定结果与哈希不变 |
| Canvas / Landing / Analysis | 113/113；40/40；16 states、0 violation |
| Preflight / Stale A→B | 45/45；complete=true、failed=false、无 page error |
| UI Contract / Responsive / Mobile | 75/75；71/71；133/133 |
| 新 Deep Search 浏览器 | 390/430/1280/1920 + 多来源下载 + 403/cancel，共 7 场景 PASS |

先增加失败的浏览器 Source Files 检查，确认旧 UI 缺入口，再实现。旧下载断言中“固定四入口必须有 selected path unavailable”不适用于新的用户选择范围；改为断言 selected-path scope，独立 404/不可用测试继续保留，未把失败改成零分或降低门槛。所有其他旧断言保留。

四宽度证明搜索、目录预览、实际修改复选框、范围确认、真实 worker 比较、展开摘要/匹配范围/来源、浏览器下载和重新验证可操作。多来源 HTTP Mock 把同一 candidate ID 放在排名 1/2，下载仍含两个发现观察，正确绑定 ID/SHA/task/query。截图及几何由实际 Chromium 生成，手机触摸滚动仍由 Deep Search dialog 拥有。关闭后 Graph 的 viewBox、实际 SVG CTM、selection、URL 和 focus 保留；临时 cache 逐文件 proof 相同、page errors 为空。单位测试与 build 完成后才执行浏览器检查，没有并发重建。

证据：[回归收据](experiments/m2-alpha1/regression.json)、[浏览器收据](experiments/m2-alpha1/validation.json)、[多来源导出](experiments/m2-alpha1/multiple-search-observations-sidecar.json)、[控制池](experiments/m2-alpha1/controls.json)、[四宽度截图图册](screenshots/m2-alpha1/index.html)。这是 WSL Chromium 模拟验收；WebKit、Safari、实体手机未执行。

## 启动与剩余能力

本地显式运行 `GITLINEAGE_DEEP_PREVIEW=1 npm run preview:deep`，使用控制台给出的短期本地 access URL。授权 cookie 保持 HttpOnly/SameSite=Strict；没有授权的普通页面无入口，跨 Origin/forwarded/非 loopback 请求仍拒绝。生产 npm start 默认关闭 Deep Search。

尚无全仓扫描、完整文件浏览器、大文件分块、AST 扩展、更多语言、Verification Adapter、公开多用户访问控制、AI/BYOK 或生产 Deep Search。有限目录及 24 次额度仍可能漏掉有效源码；截断树本轮只报告不可核实，不尝试无限分页。用户可以下载完整的部分结果并复核过滤/未完成原因。

审查分支：`review/gitlineage-development`；[Compare](https://github.com/yunmin311/GitLineage/compare/main...review/gitlineage-development)，[Draft PR #1](https://github.com/yunmin311/GitLineage/pull/1)。本轮仅同步审查分支，不合并、不部署，完成后等待 Review。
