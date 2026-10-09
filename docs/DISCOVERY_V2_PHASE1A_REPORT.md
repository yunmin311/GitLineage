# Discovery V2 Phase 1A

基线 `95d6550aa18d3cd98afba446c8b5903428ee386e`。本轮只实现可显式运行的离线基础设施。生产分析器、Graph Schema 2.0.0、缓存和 UI 不接入 Discovery。最终回归和两个独立基线修复的结果在本报告末尾记录。

## Candidate Contract

完整类型与独立运行时校验见 [contract.ts](../src/discovery/contract.ts)。`discovery-candidate@1` 是闭合合同：所有对象拒绝未知字段，不作类型强制转换。

- target / candidate：provider、numeric repositoryId 或 null、completeness、fullName、aliases、40 位 revision。公共 fixture 未保存 numeric ID，因此诚实标 name_only；无法据此保证跨改名身份归并。合成 fixture 的 provider=synthetic，revision 是真实独立根提交。
- discoveries：保留 source/version/reason/locator 数组，不只保留最强来源。当前只有固定候选池；没有相关性分数。
- files.target / files.candidate：path、SHA-256 digest、Git blob SHA-1、bytes、language、parserVersion、filterVersion、classification、reasons；参与比较与被过滤文件都保存。损坏/未读文件进入 coverage.pending 与 reasons。
- similarity：method/version/parserVersion/filterVersion、completion、score|null、两端 path/digest/token 数、shared/first/second shingles、双方 distinct-shingle coverage、半开 token ranges 与 UTF-16 character offsets、fingerprint、rangesTruncated、reasons。精确 blob 分数只允许 0/1；token 分数必须符合实际分子分母；证据必须绑定输入文件。Unavailable/unexecuted/partial measurement 禁止写 score=0。部分运行可保留此前 completed 的测量。
- checks 和 coverage：completed / partial / unavailable / unexecuted；expectedPairs、comparedPairs、pending、reasons。成功完成有限输入不意味着全网覆盖。
- verification：pending/checked/inconclusive/rejected；checks、canonicalEvidenceIds。checked 必须有 completed checks；本轮 canonicalEvidenceIds 必须为空。没有 Verification Adapter，输出一律 pending。
- lineageClaim 只允许 none；不支持 Graph status 或 relationship 字段。usage 是真实预留消耗，预算 profile 在独立 Sidecar 顶层。

## Budget Ledger

[budget.ts](../src/discovery/budget.ts) 同一主 isolate 内同步检查并扣减，异步并发调用无法交错超额。每次失败和重试仍保留 attempts；search 同时占总 attempts 和 searchAttempts。候选、每候选文件数、每文件字节数、总源文件字节数、并发和截止时间均在发起操作前预留；拒绝时没有部分扣减。重复 file 预留拒绝。取消/截止后不调度新工作。

源文件 stat 大小先预留再分块读，O_NOFOLLOW、严格 UTF-8、固定 digest 校验防止输入混用。固定描述文件有独立硬限额 512 KiB 总计 / 256 KiB 每文件；读取发生在运行输入准备阶段，单独报告 metadata.bytes。总源字节数不是网络字节计量；本轮无 HTTP provider，不虚称已实现下载硬限额。计数是保守预留，失败读取不退款。

Worker 在 deadline / abort 时 terminate，等待退出后才返回并释放 slot；已完成候选保留，后续候选有未执行原因。CPU 上限不受可靠硬约束，cpuMs 非 null 的 profile 直接拒绝；receipt 的 processCpuMs 仅为包含 Worker 的进程观测值。V8 128 MiB old-generation 限制不是 RSS/OS 隔离。生产启用前需要处理 Worker 打包、独立 CPU/内存调度和真实 HTTP provider。

## 固定输入与结果

输入为 Phase 0 四个公开固定 revision、10 个文件，以及 `synthetic-multifile@1` 的 13 个独立 Git 根样本。所有读入文件 SHA-256 校验，未刷新任何 upstream。公共 GitHub numeric IDs 不可得。合成 fixture 可离线重建，源码不执行。13 个比较任务的 positive=4、negative=5、unknown=4；后两项 unknown 分别是解析失败与没有有效源文件。

[保存结果](../experiments/discovery-v2/phase1-results.json) 和 [复现说明](../experiments/discovery-v2/PHASE1_README.md) 记录实际输入、过滤与测量。大 Sidecar 留在忽略目录，不自动提交。

| 两端 | 标签 | Exact 匹配文件对 | Strict 仓库 Jaccard | Normalized 仓库 Jaccard |
|---|---|---:|---:|---:|
| p-limit / copy-reinit | synthetic positive | 1 | 1 | 1 |
| p-limit / format-path | synthetic positive | 0 | 1 | 1 |
| p-limit / jucke fork | public known positive | 0 | 0.055072 | 0.141473 |
| p-limit / yocto-queue | unknown | 0 | 0.004932 | 0.039063 |
| p-limit / p-throttle | unknown | 0 | 0.017387 | 0.134794 |
| sum / binding-renamed sum | synthetic positive | 0 | 0.023256 | 1 |
| template-app-a / b | synthetic negative | 0 | 0 | 0.108108 |
| generic-a / b | synthetic negative | 0 | 0.137500 | 0.448276 |
| small-shared / large-shared | synthetic negative | 1 | 0.094697 | 0.117925 |
| large-shared / small-shared | synthetic negative | 1 | 0.094697 | 0.117925 |
| p-limit / filtered-mix | synthetic negative | 0 | 0 | 0.012959 |
| p-limit / broken | unknown | 0 | null | null |
| p-limit / small-only | unknown | 未执行 | null | null |

Exact 是文件对二值测量，表中计数不是“仓库血缘概率”。仓库 Jaccard 对全部有效文件的 distinct shingles 取 union，方向覆盖用对应端 union 作分母，不是逐 token 覆盖。通用 guard 文件 normalized=1；大项目共享文件对 exact=1，但归一化方向覆盖小端=1，大端=25/212=0.117925。未标记通用代码仍有误报，不能由相似度升级证据。

模板/同 LICENSE/README 案例两端各排除三文件；只比较不同应用代码。filtered-mix 排除 vendor、generated、minified、lockfile、license、documentation、template、too_small、unsupported 共九文件，保留应用源码。过滤器只认可解释规则，不保证识别所有模板。

本固定池不测外部发现 Recall；没有网络搜索，也不声称索引召回能力。Unknown 不作为已确认负例，precision helper 对 unknown 输出上下界并单列 judged precision；不用阈值选择粉饰误报。

本次实际运行：源文件预留 46214 bytes，metadata 36590 bytes，attempts=0 / search=0，peakWorkers=1，wall=3315.20 ms，process CPU=3077.47 ms。13 个任务中 11 completed、1 partial（解析失败）、1 unavailable（无有效源码）；整个 Sidecar 因解析失败标 partial。内容 SHA-256：`546af0c31bc3434abca4f64ff8691457373a2c3449363b641f30eb53d637167c`。相同输入的两次内容比较通过；运行收据的时间不参与内容哈希。

## 边界与下一阶段

模块仅允许内部 Discovery、文件/加密/路径/Worker 与 TypeScript 依赖；边界测试遍历实际 import AST 检查依赖能力。独立 Node write-permission 执行只允许侧车输出目录，Graph/cache sentinel 保持不变；该检查配合无生产依赖和完整 API 回归，不把 Node Worker permission 当 OS 安全沙箱。不存在 resolver 调用或缓存写入口，没有自动 derived_from/similar_to，没有改变生产 API 输出合同。

下一最小切片：显式 provider 的 bounded Repository Search adapter，先补稳定 numeric ID 与 rename aliases、请求失败/重试/分页逐次预留、流式响应字节限制、deadline/abort、rate-limit headers 收据、索引覆盖/不完整响应报告。将内容输入固定到单一 revision，扩展多文件真实人审标签后再评估排名。保持 relevance、similarity、verification 分离；不实现生产 UI、AI 或最终谱系裁决。

## 独立基线风险与最终验收

待完成两个独立风险修复及完整回归后补录实际结果。
