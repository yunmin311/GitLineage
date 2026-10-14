# Discovery V2 Phase 1C：固定快照与端到端比较

日期：2026-10-09。实际起点 `c6aaadf8fdbdbf359ddf95ccec58afe3ce3e0b16`；WSL2 Ubuntu-24.04，Linux Node v24.21.0。起点只有未跟踪的 `tools/`，本轮没有读取、修改或提交该目录。

## 结论与范围

固定 Mock 的 Search → 数字 ID metadata → 完整 commit → 指定 tree/blob → Phase 1A 比较 → 独立 Sidecar 已运行成功。三组候选完成，Unknown 的完全匹配仍为 verification pending / lineage claim none。已增加三个 Resolution 测试、27 个 E2E 测试及一个权限隔离 E2E 测试，原有断言和语料未被放宽或刷新。

真实公开探测为 **INCONCLUSIVE**：第一次 bootstrap 请求即返回 GitHub 403，匿名 core quota remaining=0。仅实际发送一次 HTTP，无成功 ID/SHA/源码/测量，不声称真实接口链路通过。数字 ID 的 commit/tree/blob 子路由兼容性因此尚未实证。这是进入下一阶段前必须解决的限制。

生产 Graph Schema 2.0.0、Policy、`/api/graph`、`/api/view`、AnalysisCache、Explorer 与移动端代码均无修改。没有 push、deploy 或启用生产 Deep Search。

## 实现与合同

| 文件 | 职责 |
| --- | --- |
| `src/discovery/resolution.ts` | 实验 profile；ID metadata 核对；观察过的 canonical name / aliases；一次 branch→完整 SHA；resolved/inconclusive 合同及无时钟导出校验 |
| `src/discovery/snapshot-provider.ts` | 固定 GitHub host/限定 endpoint；请求前预留预算；分块读取/取消；不跟随重定向、不自动重试；安全请求收据 |
| `src/discovery/source-collection.ts` | 明确路径及选择原因；沿固定 tree 逐层读取；Git tree/blob 哈希与 SHA-256；ID/revision/path/bytes/parser/filter 绑定 |
| `src/discovery/e2e.ts` | v2→resolved→v1 显式适配；共享 Ledger；复用 1A Worker；独立 Sidecar/receipt 与导出校验 |
| `src/discovery/network.ts`、`search.ts` | 允许同一 Ledger 继续用于非 Search 请求；既有独立 Search 的默认行为保持原样 |
| `src/discovery/worker.ts` | 可缩短的测试 wall deadline；修复 eval/stdin 启动标志被文件 Worker 继承的问题，保留文件权限限制与 Node 原生普通启动行为 |
| `test/discovery/resolution.test.ts`、`e2e.test.ts`、`boundary.test.ts` | 正常转换、失败 Sidecar、内容重放、导出绑定、权限与生产 import 边界 |
| `experiments/discovery-v2/phase1c-mock.ts`、`run-phase1c.ts`、`run-phase1c-live.ts` | 固定离线链路与单独显式公开探测 |

转换不是将 unresolved revision 强制断言成 v1。`comparableCandidate` 先验证原始 `discovery-candidate@2`、两端 `repository-snapshot@1`；再核对文件绑定、内容实际字节数、Git blob 与 SHA-256；最后交给原有 `validateCandidate`。公开手工选择 Probe 使用单独 provenance `explicit_public_probe`，不伪造 Search 观察。

target 使用 Search Plan 已固定 SHA 并要求返回一致；候选只解析一次 default branch，然后沿该返回 commit 的 tree/blob 内容寻址。后续改名或分支移动不会重读 HEAD。同 ID 的实际 Search/metadata 名称才成为 alias；同名称不同 ID 不合并。提交 parents 和 fork metadata 是观察记录，不是谱系验证器。

`discovery-e2e-sidecar@1` 保存来源/query/rank、数字 ID、无时钟名称观察、解析、选中文件、摘要/绑定、三种测量、shared shingles、两端 token 量/方向覆盖、matching ranges、各版本、coverage、失败、预算和请求结果。源文本不写入输出。`discovery-e2e-receipt@1` 单独保存观察时间、真实耗时、过程 CPU 与 rate-limit headers；SHA-256 只计算 stableJSON(content)。

完整的非递归 tree 会重算 Git tree SHA-1，blob 会重算 Git blob SHA-1；commit→tree 对应关系仍来自 GitHub API，未独立验证签名或原始 commit 对象。截断 tree 的已返回路径可保留测量，但整体 partial、汇总 score=null，不能宣称已扫描全仓。

## 实际固定 Mock 结果

以下是自行构造的接口/代码 fixture，ID 1–4 不是真实 GitHub 身份。commit/tree/blob 哈希由 fixture 的真实 Git 对象内容生成；它们证明可重复的输入，不证明公开仓库关系。

| ID / 名称 | 固定完整 revision | 选中源码字节 | 标签 / 结果 |
| --- | --- | ---: | --- |
| 1 `root/example` | `cac1a6416a877d091954f52cae3f640c61a4e011` | 90 | 固定 target |
| 2 `fork/example` | `c7df49b85e4885242789c07867c56fba789e1929` | 90 | 构造共同历史正例；Search 的 `old/example` 留作实见 alias |
| 3 `other/example` | `828ee9fa75dfd9b925c19fc27eed09c087b8cdc3` | 29 | 构造负例，已完成比较 |
| 4 `unknown/example` | `23a35c48631619eefea680cd47964b5bd05a1741` | 90 | 未判定候选，不成为正例 |

两端都明确选择 `index.js`，文件及完整 digest/blob/binding 可在 `phase1c-mock-sidecar.json` 逐项复核。

| Candidate ID | Exact | Strict token5 | Normalized token5 | token 数 target/candidate | strict shared shingles | 方向覆盖 target/candidate |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| 2 | 1 | 1 | 1 | 26 / 26 | 22 | 1 / 1 |
| 3 | 0 | 0 | 0 | 26 / 6 | 0 | 0 / 0 |
| 4 | 1 | 1 | 1 | 26 / 26 | 22 | 1 / 1 |

覆盖率：本次 Search 返回的 3 个候选中 3 个完成、0 个 inconclusive；仅一条名称 query 和四个明确入口文件，没有全仓或全 GitHub 覆盖率结论。Unknown 的高分只说明所选文件相同。

确定性内容哈希：`a996cb856efd956807c8758432181bb9cb8dfce2477a8228505d0db8be594b84`。固定输入重放、变化运行时钟/rate-limit headers 重放均校验一致。原 Phase 1A 内容哈希仍为 `546af0c31bc3434abca4f64ff8691457373a2c3449363b641f30eb53d637167c`，13 个既有候选与 partial 语义保持原样。

## 预算与实测成本

实验取更严格的既有限制：总源码 **2 MiB**、总 wall-clock **30 秒**，没有使用建议的 4 MiB/120 秒扩大旧限制。候选 3、文件 8/仓库、128 KiB/文件、总 HTTP attempts 24、Search attempts 4、并发 2。CPU hard budget 继续 unsupported。

| 资源 | Mock 实测 | Live 实测 |
| --- | ---: | ---: |
| 实际 HTTP attempts | 17（模拟 transport） | 1 |
| Search attempts | 1 | 0（手工选择的 Probe） |
| 候选预算计数 | 3 | 0 |
| 文件数量 / source reserved / materialized | 4 / 299 B / 299 B | 0 / 0 / 0 |
| Network reserved | 557,056 B | 32,768 B |
| Network delivered / retained / overflow | 2,890 / 2,890 / 0 B | 0 / 0 / 0 B |
| 最大活跃槽 / 结束活跃槽 | 1 / 0 | 1 / 0 |
| Wall-clock（单次观察） | 1,018.175484 ms | 590.924407 ms |

Search、metadata、commit、tree、blob 与 Worker 共用 Ledger，不在阶段边界重置。每个 HTTP attempt 先保守预留响应上限，包括失败请求；被 stopped 拒绝、没有发送的记录 reserved=0，不计 attempt。source reserved 来自读取前声明大小，materialized 是实际 base64 解码字节数，失败时也记账。

默认每响应预留/保留上限 32 KiB，累积预留 1 MiB。既有 NetworkLedger ceiling 为 256 KiB/响应与 1 MiB 总预留。默认 JSON/base64 开销使实际源码可读上限比 128 KiB 更小，大 tree 也可能超限；结果为 partial，并不自动调高。Fetch reader 的 received/delivered 只统计应用观察到的 chunk；取消后底层网络仍可能收到字节，不能称为线路下载硬上限。Live 非 200 的响应体直接取消，0 delivered 不代表网络没有传输响应体。

## 失败测试与 Zero Graph Write

`test/discovery/e2e.test.ts` 的 27 个测试检查实际 content/receipt，而非只检查抛异常。用户要求的 16 项均有覆盖：

| 场景 | 实际状态断言 |
| --- | --- |
| ID 冲突 | identity=null；停止 commit 读取；inconclusive |
| 同 ID 改名/转移与过时 Search 名称 | canonical 来自 metadata；alias 仅实见旧名；pending/none |
| branch 漂移/解析后名称变化 | branch 请求一次；后续固定 tree/blob；原测量保留 |
| 错版本、Git blob/SHA-256 错误 | 无有效绑定或无测量，不填 0 |
| 无效 UTF-8、超大文件 | partial；超大文件在 blob 请求/解码前拒绝 |
| tree 截断 | 选中文件测量可保留；全局 partial；汇总 null |
| 总网络/attempt/source 预算耗尽 | 共享账本；未完成候选 inconclusive；计数不超限 |
| 请求进行中取消 | transport 被 abort；cancelled 收据；无活跃槽泄漏 |
| 真实 Worker 执行超时 | Worker 终止；summary=null；测量空；不填 0 |
| 没有有效文件/文件过滤 | unavailable / inconclusive；不能算 negative |
| 部分候选成功另一个 404 | 已完成两组保留；失败一组有理由与 null summary |
| Unknown 高相似 | pending/none、空 canonicalEvidenceIds、无关系集合 |
| 相同输入重放 | 同内容 SHA-256；真实时钟/配额字段分离 |

另有 parser error、tree hash、响应 chunk overflow、rate-limit/redirect 停止、预算 ceiling 扩大拒绝、v2/v1 不兼容、嵌套路径、导出 revision/alias/digest/schema 漂移测试。解析失败时可保留 exact blob 观察，但 token 方法 unavailable/score=null，候选 inconclusive。

隔离证据：AST 检查全部 Discovery import 仅限实验模块/批准的 Node 与 parser 能力；生产模块不 import Discovery；模块加载 fetch 计数 0。Node `--permission` 只允许写指定 Sidecar 目录的 E2E 实际完成三组比较；Graph/cache sentinel 前后逐字节相同。实验没有自动读取环境凭据，也没有第三方源码执行。

这项隔离测试暴露 Worker 继承 `--input-type=module -e` 的既有问题。修复后保留权限 flags；普通文件与 `node --test` 启动继续让 Node 原生处理 process-only flags。未通过清空权限或降低“完成三组”断言绕过失败。

## 真实公开 Probe 收据

命令 `node experiments/discovery-v2/run-phase1c-live.ts --live`，手工选取 Phase 0 的 `sindresorhus/p-limit`、`jucke/p-limit` 与未知对照 `sindresorhus/p-throttle`。不是 Search，未把 Phase 1B 未知项目标成正例。

2026-10-09T11:10:21.210Z：`GET /repos/sindresorhus/p-limit` → 403；`x-ratelimit-resource=core`，limit=60、used=60、remaining=0、reset=1791545941。后两个 bootstrap 只有 stopped 拒绝收据，无实际 HTTP。没有 repository ID/full SHA/source，两个比较 inconclusive，共同 commit 可用性未检查。收据只观察到现有匿名配额耗尽，不能估计本次消耗了几次扣额。

提交的 `phase1c-live-sidecar.json` / `phase1c-live-receipt.json` 内容哈希 `24a94897eae53a64c07e2a76682623e870f3346d599ac3b0af96384711e6a176`。未重新运行以替换失败、未自动加凭据或绕过配额。成功的真实 lineage/Precision/Recall 均无本轮证据。

## 工程回归

完整执行记录见下表与 `experiments/discovery-v2/phase1c-validation.json`。日志保存在 ignored `artifacts/discovery-v2/phase1c-validation/`。所有 unit/build 完成后才运行浏览器，浏览器套件串行，不与构建竞争。

| 验收 | 实际结果 |
| --- | --- |
| Typecheck / 独立实验命令 Typecheck / Build | PASS，exit 0 |
| Unit | 530 项：527 PASS、3 个原有 live integration SKIP、0 FAIL |
| Discovery 1A/1B/1C | 83 PASS、0 FAIL；包括新增 31 项 |
| Phase 0 Benchmark | 6 PASS、0 FAIL |
| Phase 1A replay | 13 候选，旧内容哈希一致 |
| Canvas | 113/113 PASS |
| Landing | 40/40 PASS |
| Analysis | 16 状态/视口记录，exit 0、无 page errors |
| Preflight | 45/45 PASS |
| Stale A→B | 6 阶段，complete=true、observed=true、failed=false、errors=[] |
| UI Contract | 75/75 PASS |
| Responsive | 71/71 PASS |
| Mobile | Chromium CDP 133/133 PASS；实体设备与 Safari/WebKit 未验收 |
| Zero Graph Write / import 边界 | 权限 E2E 三组完成，Graph/cache sentinel 字节未变，生产依赖检查 PASS |
| 显式公开 Probe | INCONCLUSIVE，GitHub 403/core remaining=0；1 HTTP attempt |

Chromium 触控/CDP 模拟不等于实体手机或 Safari/WebKit 验收；本轮没有设备或 Safari 成功证据。

## 剩余限制与 Phase 2 条件

1. 首先取得成功的极小公开 Probe：数字 ID 核实、完整 SHA、选中文件与哈希、已有共同历史 control 和未判定 control 的真实测量。当前数字 ID git 子路由仍未成功验证，不能直接接入生产；若路由不支持，要单独 Review owner/name 请求前后 ID 核对方案。
2. 只有明确 JS/TS 选择路径，无自动入口识别/整仓扫描、Git clone、相似性索引或全网发现。缺失文件、默认 32 KiB 响应上限、大 tree 与语言范围会明显限制召回。
3. 现有比较器与 filter 的启发式继承 1A；通用小函数/模板仍可能产生高分。Normalized 只辅助观察，不能当作谱系证据。
4. CPU 只是观测，hard CPU deadline 未实现；固定 wall-clock、候选/文件/响应预算与可终止 Worker 是当前防线。并发实现当前串行，profile=2 是上限。
5. 仅内存实验状态与独立文件输出，没有生产缓存、账户、AI key、付费调用或自动验证器。
6. 下一最小切片应先补“成功的真实接口兼容与固定版本控制样本收据”，再讨论候选源文件选择规则；任何生产接入/Graph 证据升级需独立授权和 Review。

## 本地提交

`d0df0923e5d99e09e6a009a9432b474872342195` — `discovery: resolve pinned candidate snapshots`。

`77fc78237e731b2a78f78fda82b9449b33186cb6` — `discovery: connect bounded source comparison`；完整回归所测实现。

最终报告提交 SHA 由交付回复给出，避免报告自引用。完成后停止等待 Review。
