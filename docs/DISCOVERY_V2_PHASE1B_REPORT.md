# Discovery V2 Phase 1B 本地交付报告

本阶段增加独立、有界的外部仓库候选发现实验。Standard、Graph Schema 2.0.0、生产 API、缓存与 V3.3 UI 未接入。候选不等于相似代码，更不等于派生关系。完整回归收据将在验收后追加。

## 1. 基线与最终 HEAD

开工实际 HEAD 为 `ae9acf0cd127a856836902b348c45e0f16f33cd0`，仅有原有未跟踪 `tools/`。该目录不修改、不暂存。95d6550 之后完整链为：

1. `8efc1d85ac317e2b88cc7610a4cc8b1142cc6384` Candidate Contract / Budget Ledger。
2. `dba4eaf8624f60d6e648c7ba86b350f20fe369dd` 固定快照、离线比较侧车。
3. `5016978324aa506535608450713f5f59f0c50730` 完整 Git 历史判定独立修复。
4. `2abdfa6d000f3922559871effdb0e225ed538c64` npm Registry URL 独立修复。
5. `ae9acf0cd127a856836902b348c45e0f16f33cd0` 上轮报告和验收收据。

核对 `2abdfa6d..ae9acf0c` 仅两文件：`docs/DISCOVERY_V2_PHASE1A_REPORT.md`、静态 `experiments/discovery-v2/phase1-validation.json`；没有生产/实验/测试可执行修改。旧收据 testedHead=2abdfa6d，覆盖当前基线的相同可执行内容，但不冒称旧命令实际运行在 ae9。Phase 1B 另跑全部验收并保存新的 testedHead；最终收据提交仅追加文档及静态结果。

## 2. Provider 结构与安全

`src/discovery/search-provider.ts` 的独立 Provider 接收可注入 Transport。只构造 HTTPS `GET https://api.github.com/search/repositories`，指定 Accept、2026-03-10 API Version、User-Agent、AbortSignal、manual redirect。任何重定向均拒绝，没有外部 Host 或代码执行入口。远端只接受必要的 ID/name/URL；描述、指令、错误文本均不进入侧车或运行逻辑。

可选 token 只能由调用者显式传入，不读取环境、不执行 gh、不持久化、不回退认证。当前实验入口只使用匿名请求。允许头部采用白名单，屏蔽显式 token 的反射。Provider 本身返回有界分页数据与请求收据，`search.ts` 将其转成 Discovery Candidate，完全不构造 Graph Observation。

## 3. Query Plan

`query.ts` 的版本为 repository-query-plan@1。顺序固定为名称、前三个去停用词的 description 词、topics、带来源的 keywords；language 限制所有查询。最多4条，长度<=200，per_page<=25，pages<=2。只接受保守 ASCII 词/限定 qualifiers，拒绝明显 token、敏感赋值、控制字符及注入。没有源代码、AI 查询或任意 Host。

固定 mock 示例：

```text
p-limit in:name language:javascript is:public fork:true
concurrency limiting utilities in:name,description language:javascript is:public fork:true
topic:concurrency language:javascript is:public fork:true
```

规则可重复，保留每条来源和原因。候选先保留每 query 的份额，再轮流填余量；不再按名称截断。预算小于来源数时仍会受固定来源顺序影响。短名称、非 ASCII 名称、同义词及没有关键词的副本属于明确遗漏风险。

## 4. ID、重命名与合同迁移

按 github numeric ID 去重，只接收安全正整数及匹配 GitHub HTML URL。同 ID 不同名称记录真实 observation 和 alias；多条 query 的所有 discovery reason 保留。同名不同 ID 不合并，双方标 incomplete/name_id_collision；已知 target ID 与不同 ID 同名也标冲突。metadata 与 search 的纯适配器冲突标 incomplete，metadata 名称优先；本阶段没有 metadata GET。缺字段/非法 ID 拒绝并保存 query/page/rank 的诊断位置，不按名字猜 ID。

最新 observation 名称只是本次可观察名称，不保证全局 metadata 已更新。新的 discovery-candidate@2 / discovery-search-sidecar@2 明确 revision unresolved/sha=null、verification=pending、lineageClaim=none、comparison=unexecuted。similarity、files、evidence IDs 均为空，无 relevance/similarity 分数。Phase 1A v1 与 fixture 不改，comparisonIdentity 明确拒绝 v2。成本和覆盖在包裹候选的侧车/query/page 收据中，不能脱离该上下文解释。

## 5. 请求前预算

复用原 BudgetLedger，不改变 Phase 1A 实现。NetworkLedger 同步检查并预留：worker slot、总 attempts、search attempts、整次 response cap；成功前即扣账，失败/重试/分页均不退款。实验上限 attempts40/search4/candidates16/wall120秒/concurrency2，调用者只能降低；实际 runner 串行。直接并发 provider 测试8次调用仅2次进入 transport，peakWorkers=2，退出 activeWorkers=0。

源文件 usage.totalBytes 保持原含义，本阶段=0；网络独立 reserved/received/retained/overflow。没有 CPU hard limit，不启动相似性 Worker，也没有无界 CPU 工作。

## 6. 流式字节与限制

不调用 response.json()。逐 chunk 计数，完整 UTF-8/JSON 才解析；首个超限 chunk 丢弃并立即 abort/cancel，半截 JSON 绝不成为候选。缺失或伪造 Content-Length 均不影响计数。单次保留/解析<=256KiB，默认总预留<=1MiB。

测试对每请求交付200字节、预算100字节：三个响应均取消，retained=0、received=600、reserved=300，状态 partial_budget。Fetch 在模块拿到 chunk 前已下载/解压它，故实际交付可超出 cap；overflow 明确记录，不能宣称线路传输量、RSS 或 CPU 有硬上限。这是保留和解析的硬限额及下载的及时取消，不是线路字节硬限额。

## 7. 限流、重试、分页

401/403/429 与3xx全局停止，不自动换认证或无限等待。remaining=0 的成功请求也阻止后续请求。仅网络失败/5xx最多一次立即重试且重新扣账；Retry-After>0时停止本轮后续请求以遵守等待，不用短延迟绕过。每 source 先第一页再下一轮，最多2页，不遍历1000结果。允许 headers：X-RateLimit-* 的数值/资源、Retry-After、实际 API Version；不保留 Authorization 或远端原文。超时/取消释放容量，已完成候选保留。

## 8. Coverage

顶层和 query 收据区分有限范围内完成、预算不足、provider/indexing部分、不可用、取消与未尝试。分别保存 query、requested/completed pages、returned items、unique observed、admitted/rejected candidates、身份拒绝位置、total_count、incomplete_results、1000窗口及窗口外数量、未获取/未完成页面、失败/重试与实际资源。

空结果仅写“在本次查询范围与预算下，未发现候选。”total_count 是元数据匹配数，不是关联真值。认证/网络失败不会冒充无关联。

## 9. Mock 测试

先执行失败行为测试，再完成实现。新增 provider 测试覆盖身份、HTTP、预算、限流/分页/覆盖/取消，以及字节和凭据边界；既有 Phase 1A 全部保留。当前针对性 Discovery 52项通过（原17、新provider32、新隔离3），0失败、0跳过；mock入口3次请求、4个候选、网络保留744字节、保守预留786432字节、源字节0。补查发现旧实验断言只禁止503的当前重试，却允许后续query；新失败测试证明继续请求会绕过服务等待。现收紧为Retry-After>0全局停止，原3次请求期望改为1次，不放宽任何门槛。mock费率头是测试夹具，不能当作真实 API 用量。

## 10. Live Probe

显式运行一次匿名 probe，2026-10-09T06:27:29Z（UTC）：固定 p-limit 名称 query、per_page5、page1、attempts/search1、wall15秒、request10秒、response/aggregate64KiB；无付费 API。HTTP200，947.751647ms，收到/保留26785字节，overflow0。返回5 items，排除 target1，4个独立 ID 候选：226565322、60833257、223577988、3633486；全部 pending/unresolved。

实际 headers：search limit10、remaining9、used1、selected version2026-03-10。total_count10745、incomplete_results=false，但仅取1页，1000可访问窗口仍缺199页，窗口外9745结果，coverage=partial_provider。该结果证明接口能调用，同时说明名称搜索可能宽泛；不能把这4项作为正例或测 Recall/Precision，更不能声称共同历史。完整原始安全收据见 phase1b-live-probe.json；不重复联网刷成绩。

## 11. Zero Graph Write / Cache Isolation

AST 检查 Discovery 只引用允许的内部/内置依赖，生产源码无 Discovery import。新 Node 子进程仅允许写实验侧车目录，成功搜索并导出，Graph/cache sentinel 字节不变；另一个进程验证模块加载和建计划触发0次 fetch。没有 resolver/Graph/cache HTTP Client 调用，不改变生产 API/schema/Standard 行为，不下载或执行搜索仓库代码。

这不是 OS 沙箱证明，可信 injected transport 仍须遵守 signal/manual redirect 合同。旧 Graph 缓存可能保留修复前的浅历史 derived 判定，未来发布前独立失效/再验证；本阶段不重写生产缓存。

## 12. 完整回归

待在实现提交上依序运行 Typecheck → Unit → Build → Phase0 → Discovery → 串行浏览器8套件，并在收据追加实际计数、时间和产物 hashes。不复用旧轮成绩，不覆盖历史实验结果。

## 13. 提交与文件

实现提交及最终文档/收据提交将在验收后记录；最终静态提交的自身 SHA 以交付消息/HEAD 为准，避免自引用 SHA。主要文件为 src/discovery/{query,network,search-contract,search-provider,search,search-output}.ts、test/discovery/search*.test.ts、boundary.test.ts、run-search.ts、PHASE1B_README.md、RFC补充和本报告。

## 14. Phase 1C 最小建议

只选少量明确 numeric ID 的候选；用独立有界 metadata/commit 请求核对身份并固定完整 SHA，预算逐次预留、保留冲突/未完成状态；显式读取少量固定文件，适配 Phase 1A v1 离线比较并输出独立侧车。先测同 ID 改名/转移、分支漂移、SHA不足、取消及缓存隔离，不自动对搜索全集比较、不接 Graph/Explorer。真实未知候选继续 unknown，需人工标签后才测发现 Recall/Precision。

完成后停止等待 Review；不 push、deploy、OCI/Caddy/TLS 或启用生产 Deep Search。
