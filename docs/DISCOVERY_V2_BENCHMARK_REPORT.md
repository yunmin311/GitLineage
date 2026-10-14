# Discovery V2 Phase 0 — Benchmark 结果报告

日期：2026-10-09；审计基线 `ab425b6807fc7fdfc3b8c61cf02849b0336c0d49`。结论：值得继续开发有预算、独立于 Graph 的候选比较实验；尚不能开启生产 Deep、校准谱系阈值或宣称全网召回率。

## 1. 数据、标签与可重复性

四个公开仓库使用固定完整 commit，许可证均为 MIT，来源 URL、SHA-256 与原许可证保存在 [manifest](../experiments/discovery-v2/fixtures/manifest.json) 和 fixtures 中。

| 仓库 | 固定 revision | 标签依据 |
|---|---|---|
| sindresorhus/p-limit | `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` | root |
| jucke/p-limit | `e293f0b92536447f72ca818fcf07be8d287f1c24` | positive：GitHub parent metadata + 相同 commit 在 upstream 可读 |
| sindresorhus/yocto-queue | `72a8fa96a9d389765cdf2bb9c6daba8302fc375d` | unknown：没有人审谱系标签 |
| sindresorhus/p-throttle | `a0d20bf8c1a5f0067b1dce529b1ff013878591d3` | unknown：没有人审谱系标签 |

闭集共有 9 个仓库/合成 snapshot，每个一个 JS 文件：root；一个真实已知 fork；两个真实 unknown；三个源自 root 的 positive（重新 init Git、格式+路径变化、标识符+格式+路径变化）；两个 negative（共享通用模板、独立反转函数）。候选池为 8，已知 positive 为 4。复制后 reinit 用真实本地 Git init/commit 验证：新 commit 无 parents、不同于 upstream，而 blob 相同。合成变体只证明实验中的复制来源，不声称真实项目的血缘。

两个 unknown 的 pinned README 用现有 attribution scanner 检查，recognized explicit derived/fork declarations 都为 0；p-throttle 仍有 p-limit Related 引用。它们不是“完全没有任何来源线索”的代表，更不是 positive/negative ground truth。检查只覆盖该 README 和既有解析规则，不能证明仓库各处没有声明。

机器结果：[results.json](../experiments/discovery-v2/results.json)。Corpus digest：`821d57a4b10f022a3c8694a143d86fabc4b8343277ab915e5740dd37bc247c41`；method `js-token-spike@1`；Node `v24.21.0`、TypeScript `5.9.3`、WSL Linux。所有 vendored 文件包括 README 和 license 都校验 hash；代码作为数据解析，不执行。

复现（从仓库根目录；已安装 lockfile 依赖）：

```sh
node --test experiments/discovery-v2/benchmark.test.mjs
node experiments/discovery-v2/benchmark.mjs /tmp/discovery-results.json
```

排序、摘要、标签和数学指标可重复；时间/CPU 随机器负载变化。`acquire.mjs --refresh` 是显式联网更新，会重新选择当前版本，不是固定 snapshot 重放；离线复现不需要 GitHub token。

## 2. 检索指标与覆盖

候选按单文件 score 降序，同分按 ID 排序；只将 score>0 且非 null 的结果算作返回。Recall@K=返回已知正例/4；Precision@K 使用固定 K 分母，未填满槽位不加分。unknown 分别视为非正例/可能正例，给出上下界。`precisionJudged` 的分母是返回且有标签的对象，不是固定 K；不能据此宣称 Precision@5=100%。

| 方法 | Recall@1 | Recall@3 | Recall@5 | 返回@5 | Precision@5 范围 |
|---|---:|---:|---:|---:|---:|
| exact_blob | 25% | 25% | 25% | 1 | 20%–20% |
| strict_jaccard | 25% | 75% | 100% | 5 | 80%–100% |
| normalized_jaccard | 25% | 75% | 100% | 5 | 80%–100% |
| minhash64 | 25% | 75% | 100% | 5 | 80%–100% |
| winnowing_jaccard | 25% | 75% | 100% | 5 | 80%–100% |

四个 fuzzy 方法 top5 均为 4 positive + 1 unknown。Winnowing 把 unknown p-throttle 排在已知老 fork 前；top4 recall 只有 75%，另三个 fuzzy top4 为 100%。旧 fork 对当前 root 的 strict Jaccard 仅约 0.055、normalized 0.141；若采用高相似阈值，它会被漏掉。这里没有实施生产阈值，仅测闭集排序。

coverage=9/9 已选源文件、100% 固定池，所有状态 complete。它不是完整仓库文件覆盖，不是 GitHub 检索覆盖。外部 Recall@K / corpus 外的 Precision 无法测量：缺少穷尽 gold pool 与人审 unknown 标签。仓库 Search 返回项仅是建议，未全量下载或自动贴标签。

## 3. 误报与解释

| 独立负面对照 | Exact | Strict Jaccard | Normalized | MinHash64 | Winnowing |
|---|---:|---:|---:|---:|---:|
| identical shared dependency/template | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| generic validators with renamed names | 0.000 | 0.257 | 1.000 | 1.000 | 1.000 |

共享模板/依赖对的 negative 指宿主之间不存在已知派生（按构造定义），并不否认该片段有共同第三方来源。generic guard 对是独立指定的短通用校验模式，用于暴露 all-Identifier 归一化的退化。100% 相似不能自动升级为 lineage；两对样本也不能估算真实误报率。

结果保存五个匹配 fingerprint 示例及 root index.js / renamed lib/renamed.js 的 token 位置、root offset。它证明解释可落在固定文件，尚不是完整证据 UI。未来应保留双方原始行段、全部匹配和模板过滤后的分母；当前只保存少量演示样本。

## 4. 单仓库成本与延迟

| snapshot | 源字节 | tokens | 指纹 wall ms | process CPU ms | API |
|---|---:|---:|---:|---:|---:|
| sindresorhus/p-limit | 3868 | 633 | 33.08 | 49.09 | 0 |
| jucke/p-limit | 640 | 162 | 9.39 | 11.20 | 0 |
| sindresorhus/yocto-queue | 1587 | 268 | 16.84 | 24.09 | 0 |
| sindresorhus/p-throttle | 9716 | 1592 | 46.74 | 63.76 | 0 |
| synthetic/reinitialized | 3868 | 633 | 22.93 | 26.56 | 0 |
| synthetic/format-path | 2893 | 633 | 20.29 | 25.66 | 0 |
| synthetic/renamed-format-path | 2931 | 633 | 27.42 | 50.35 | 0 |
| synthetic/template-only | 129 | 31 | 1.78 | 2.26 | 0 |
| synthetic/independent-app | 71 | 23 | 0.90 | 1.02 | 0 |

本次完整离线运行 wall **349.09 ms**、Node process CPU **343.32 ms**，API=0、GitHub rate-limit=0、paid calls=0。Wall 包括临时 Git 验证；CPU 是主 Node 进程，不含 Git 子进程，可能因线程而高于 wall。不是多轮性能分布或生产大仓库估算。

results.costs.phaseMs 分列解析/归一化、shingles、winnowing、MinHash。复现优先的 seeded SHA-256 MinHash64 在大文件项中占主要时间，没有比 exact-set Jaccard 提高本闭集 Recall@5；这支持暂不引入 sketch/LSH 索引。Winnowing 的选择过程廉价，但依赖已算好的 shingle hashes，不能把它的 phase 时间误当全部算法成本。

预算：256 KiB/file、20000 tokens、k=5,w=4、64 sketch components；超过上限 / parse failure 标不可用，不当作 0 相似。当前可执行检查覆盖解析、token/byte状态、右侧最小值、unknown/underfilled metrics、固定 corpus、真实 Git reinit、变体召回、反例与离线 API=0。

## 5. 联网获取及 API 实测成本

45 次 GET 为数据获取/接口研究，**不是离线算法成本**。初次运行 21；第二次 24，补充两个 README 与 upstream 可读取 fork SHA 的检查。均无 retry、无连续分页；每次运行有请求上限。未执行付费调用。

| 运行 | GET attempts | core 响应 | search 响应 | code_search 响应 | raw 无 rate header | 收取字节 | 请求延迟合计 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| initial | 21 | 10 | 2 | 1 | 8 | 138894 | 11865.34 |
| final | 24 | 11 | 2 | 1 | 10 | 151424 | 12017.45 |

两次 core 计数各包含一次匿名 code GET（401）。共 19 个认证 core、2 个匿名 core、4 search、2 code_search、18 raw。响应 headers 认证 core limit=5000，search=30，code_search=10；search 两次 query used 1→2，code used=1。认证 core remaining 非单调，受共享凭据/窗口等影响；没有可归因的精确 task primary 扣额差值。只能报告请求分类和原始收据，不能编造“总共消耗了 N 点”的精确账。

第二次两个 Repository Search：name query total_count=1570，取 5（约 0.32% 已报告匹配项）；description query total_count=118，取 5（约 4.24%）。incomplete_results=false 只代表这次响应未报 timeout，**不代表索引覆盖完整**；total_count 也不是全网相关对象总数。名称结果中有 limitPNG / limit-order-protocol 等混入。

认证 Code Search：限定已知 p-limit 的 activeCount，200、total_count=2；匿名 Code Search=401。只能确认接口能力，未验证未知副本召回。首屏结果与 headers 保存在 [初次收据](../experiments/discovery-v2/api-probes-initial.json) 和 [最终收据](../experiments/discovery-v2/api-probes.json)，不保存 token。

## 6. 基线回归与交付边界

先完成 typecheck → unit → build，再顺序运行浏览器测试，避免 unit/build 重写 dist/web 影响浏览器。生产源码、Graph Schema、UI 与依赖未改。

- typecheck PASS；unit 444（441 PASS、3 SKIP、0 FAIL）；build PASS。
- 独立实验：6 PASS、0 FAIL。
- Canvas / Landing / Analysis / Preflight / stale A→B / UI Contract / Responsive / Mobile：全部 exit 0。
- 浏览器结果、截图和几何沿用各 suite 的本地产物；没有更新断言或 baseline。新增本轮摘要见 [validation.json](../experiments/discovery-v2/validation.json)。
- 本地可检查的几何：[Responsive results](../artifacts/responsive/after/results.json)、[Mobile results](../artifacts/mobile/after/results.json)；截图：[1920 Evidence](../artifacts/responsive/after/1920-evidence.png)、[1280 Evidence](../artifacts/responsive/after/1280-evidence.png)、[390 Graph](../artifacts/mobile/after/390-graph.png)。这些是测试生成的本地产物，未加入本次提交；validation 保存对应摘要与 hash。
- Mobile suite 是自动化浏览器验收；本轮没有新增实体手机或真实双指 pinch 测试，不作该声明。

本轮结论只支持下一切片：独立 candidate validator / budget ledger / 固定 revision adapter + 解释性 token 比较，保持默认关闭和零 Graph 写入；先补充多文件/模板与真实人审标签，再接有限搜索。未实现生产 Deep、AI Key、收费、账号、Explorer UI；没有 push/deploy，等待 Review。
