# Discovery V2 Phase 1D：公开 API 与固定源码快照验收

2026-10-09。结果：**真实公开探针成功**。三个仓库的 numeric ID、canonical owner/repo、完整 commit SHA、tree 和 `index.js` 对象完成读取及前后身份检查；原有 Phase 1A worker 完成两组比较。所有候选仍为 `pending`，`lineageClaim` 为 `none`。没有生产 Deep Search 或 Graph/UI 变更。

## 1. 基线与执行环境

真实起点 HEAD：`c9be90b5a9a81e9990362c8228f8dae4d4f965be`。其前两笔为 `77fc78237e731b2a78f78fda82b9449b33186cb6` 和 `d0df0923e5d99e09e6a009a9432b474872342195`。起点最后报告提交仅包含文档和静态记录，没有未测试可执行修改。开工仅有未跟踪 `tools/`，保留原状。

Git、Node、测试和浏览器测试服务器全部在 WSL2 Ubuntu-24.04；Node `v24.21.0`。完整读取 AGENTS、RFC、1C 报告、resolver/provider/collector/e2e/network、1C 测试和实验入口后实施。环境诊断只执行一次。未读取任何用户 Token、其他应用凭据、`.env` 或 Shell History。未 push、deploy 或修改 OCI/Caddy/TLS。

提交列表在报告末尾；最后报告提交仅追加文档和静态验证记录，不包含可执行修改。

## 2. 官方路由与兼容性

GitHub 文档给出 [Commit](https://docs.github.com/en/rest/commits/commits#get-a-commit)、[Git Commit](https://docs.github.com/en/rest/git/commits#get-a-commit-object)、[Tree](https://docs.github.com/en/rest/git/trees#get-a-tree)、[Blob](https://docs.github.com/en/rest/git/blobs#get-a-blob) 的 owner/repo 路径。本轮采用 `/repos/{owner}/{repo}/commits/{fullSHA}`，从 `commit.tree.sha` 取得 Tree ID；Git Commit 路由未实际请求，不把文档存在当作探针已测试。

`/repositories/{id}` 仅用于 Metadata 身份锚定，真实三个 ID 均返回 200。Commit、Tree、Blob 使用 `/repos/{verified-name}/...`，真实共九个对象请求均成功。最后使用 [Repository Metadata](https://docs.github.com/en/rest/repos/repos#get-a-repository) 路由重新核实 ID。

数字 ID Git 子路由 **未被本轮实测证明**，不再作为默认网络依赖。默认 SnapshotProvider 在预留前拒绝它们；历史 1C Mock 显式启用 `historicalRoutes` 并注入 transport。这个模式为旧收据重放而保留，不作真实 API 兼容性承诺；注入 transport 本身也不是能证明其完全离线的安全沙箱。旧真实 1C 入口已转交 1D 入口。1A/1B 固定结果、1C 旧断言与内容摘要保留。

## 3. 身份与对象链路

真实入口显式列出三个名字，先 bootstrap 获取预期 ID，再单独执行 `/repositories/{id}` 校验。Search 没有执行，也没有凭空构造 Search observation。后续名称来自已经匹配 ID 的 Metadata。

每个仓库六次 GET：显式名字 bootstrap → ID Metadata → canonical 名称下 manifest 完整 SHA Commit → 固定 Tree → 固定 Blob → canonical 名称 Metadata。固定后不再读取移动分支。返回的 Tree SHA 与 Git tree 序列化重算一致；Blob SHA 与 `blob <bytes>\0<content>` 重算一致；文件 SHA-256 与 Phase 0 MIT manifest 一致。最后名称和 ID 必须都匹配。

所有路径仅允许 `api.github.com`，fetch 使用 manual redirect；301、跨 Host、重定向后响应都拒绝。读取前已转移的仓库使用 ID Metadata 的新名称；读取中改名、名字被另一个 ID 占用、404 或最终核实失败，状态为 inconclusive，清除 snapshot 和 bindings，不比较其源码。本轮选择直接停止该快照，**不自动重启**。已经发生的网络和源码成本仍保留。

| 仓库 | numeric ID | 完整固定 commit SHA | tree SHA |
| --- | ---: | --- | --- |
| sindresorhus/p-limit | 71542716 | `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` | `dcc7e576c722ad0f7d474128a704accb0ffc6abd` |
| jucke/p-limit | 72682439 | `e293f0b92536447f72ca818fcf07be8d287f1c24` | `2ba2ab5828da5f5a0a37a657903ed24cf17a868a` |
| sindresorhus/p-throttle | 71544230 | `a0d20bf8c1a5f0067b1dce529b1ff013878591d3` | `bd45d1c6634275599efd314d792a96e9e1b277a7` |

三个前后 ID 核实均为 matched。每个仅取 `index.js`：

| 仓库 | bytes | Git Blob SHA-1 | SHA-256 |
| --- | ---: | --- | --- |
| p-limit | 3868 | `c24de5782032605aa83636bcf455f700e3b2ada7` | `edde12a4a4dbdbe8d27161cdd0853db0bab435d5dc6c15f9f4dedc27ee9bca60` |
| jucke/p-limit | 640 | `6008403a98879d80c8cbff6f43e5634e3a5fd9ce` | `b89479e9f48bd6e7a90931a164cdec0b9ae203ea4e31ddb2329865cdf0b391f3` |
| p-throttle | 9716 | `5175416b80a246fb0cec7c2547906fd4c025cf18` | `5567e2731fa0393079ac096c10ebbedbec5a1cd7e687a8ba2021e96c44ef3fcf` |

源码以 repository ID、完整 revision、path、blob、digest、bytes 和 parser/filter version 绑定。比较器输入来自这次真实 API 返回的源码，不是读取旧源码 fixture 代替网络成功。manifest 只提供固定 revision 和独立预期 SHA-256。新静态收据不保存源码正文；原有 Phase 0 合法 MIT 样本和许可证仍保留。

commit→tree 绑定由 GitHub API 声明，本轮没有重建原始 commit 或验证其签名，不作完整密码学来源认证。

## 4. 原始代码测量与标签边界

目标 `p-limit/index.js` 为 633 tokens；Fork 为 162，未知对照为 1592。每组 expectedPairs=1、comparedPairs=1、exactPairs=0、failures=[]。沿用 Phase 1A 方法和版本，不新增阈值。

| 比较对象 | strict Jaccard | normalized Jaccard | strict shared / target / candidate shingles | normalized shared / target / candidate shingles |
| --- | ---: | ---: | --- | --- |
| jucke/p-limit | 0.05507246376811594 | 0.14147286821705427 | 38 / 576 / 152 | 73 / 450 / 139 |
| p-throttle | 0.01738672286617492 | 0.13479359730412804 | 33 / 576 / 1355 | 160 / 450 / 897 |

Fork strict coverage 为 0.06597222222222222 / 0.25，normalized 为 0.1622222222222222 / 0.5251798561151079。未知 strict 为 0.057291666666666664 / 0.024354243542435424，normalized 为 0.35555555555555557 / 0.17837235228539577。全部路径和摘要见原始 Sidecar 的 similarity measurements。

真实 Metadata 中 `jucke/p-limit` 的 fork=true、parentId=71542716，这是独立的已知公开 Fork 控制信息；不是这次代码比较产生的验证结果。本轮没有重新探测共同 commit 或运行 Verification Adapter。`p-throttle` 仍为 unknown/unjudged，fork=false 也不证明它与目标无谱系。

这些不同历史版本、单文件的数值只证明确定性测量链路运行成功。不能推出项目整体相似度、实际派生或抄袭；不能用两个控制对象计算发现 Recall@K/Precision@K。没有人工审查的真实候选未被当作正例。

## 5. 请求、额度和资源收据

旧 1C 真实 403 收据 reset=1791545941（2026-10-09 11:39:01 UTC）。执行前确认窗口已经过期，未重复撞限额。真实探针仅执行一次，开始于 `2026-10-09T11:44:05.176Z`，总时长 **10564.498809 ms**。

| 资源 | 实测 | 上限 |
| --- | ---: | ---: |
| HTTP attempts | 18，全部 200 | 24 |
| Search attempts | 0 | 本轮不搜索 |
| control 仓库 / comparison 候选 | 3 / 2 | 3 / 3 |
| source files | 每仓库 1，共 3 | 每仓库 8 |
| 最大源码文件 / 源码合计 | 9716 / 14224 B | 131072 / 2097152 B |
| worker peak / 结束 active | 1 / 0 | 2 / 0 |
| network reserved | 589824 B | 1048576 B |
| network received | 121345 B | 观察值 |
| network retained | 121345 B | 每响应 32768 B |
| network overflow | 0 B | 观察值 |
| wall | 10.5645 s | 30 s |
| process CPU | 877.706 ms | unsupported；非 hard budget |

所有实际请求前同步预留，失败不退款。实际传输 chunk 已到进程后才可统计及取消，不能保证真实线路字节、内部解压缓冲、CPU 或 RSS 的绝对上限。30 秒预算没有扩大。

18 个响应都记录 core limit=60、reset=1791549581、API version selected=2026-03-10。首响应 remaining=49/used=11，末响应 remaining=32/used=28，相邻 17 个间隔各下降 1。实际请求次数可由本地收据核实为 18；没有首请求之前的服务器配额头，不将余额差 17 当成完整消耗证明，共享匿名 IP 还有其他请求来源。[GitHub 匿名配额](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)按 IP 计算。

## 6. 成功与失败记录

真实静态原件：

- `experiments/discovery-v2/phase1d-live-sidecar.json`：确定性内容、路径摘要、逐仓身份核实、比较、coverage、四类网络计数。
- `experiments/discovery-v2/phase1d-live-receipt.json`：18 条真实 GET 的状态、allowlist 配额头、时间及 CPU 观察。
- contentDigest：`03f08f5d399e45d950705813c5eae90c09389a33d6875b59299173edad5b399e`。

两份副本与这次 `artifacts/discovery-v2/phase1d-live/` 输出字节一致。保存后使用最终 export validator 再次校验成功；时间/头不进入 contentDigest。

旧匿名限流真实失败保留为 `phase1c-live-sidecar.json` / `phase1c-live-receipt.json`，没有改写为成功。其余 ID 冲突、读取后 ID 冲突、301、403、404、文件不可用六组静态失败收据为 `phase1d-failure-receipts.json`，**全部标注 synthetic Mock，不是真实 GitHub 返回**。新增 Mock 测试另外覆盖转移、默认分支漂移、固定 SHA 有效、错误 commit/tree/blob SHA、读取中改名、取消、预算耗尽、完整/部分 Sidecar。失败不填零分，不保留虚假完整快照。

## 7. Zero Graph Write

生产源代码 AST 导入检查通过，生产路径没有导入 Discovery。Discovery 依赖检查禁止访问生产 Graph/cache 模块；本阶段入口只有公开 GET、内存源码处理、worker 和 Sidecar 输出能力。新官方路径 Mock 在 Node 文件权限限制下，仅允许 Sidecar 目录写入，Graph/cache sentinel 字节保持一致；旧 Phase 1A/1B/1C 相同权限测试继续通过。所有输出 `pending` / `none`，export 拒绝 canonical Graph 关系字段及 VERIFIED。

本阶段真实探针只写 `artifacts/discovery-v2/phase1d-live/` 两个收据；未调用 Graph/cache 写入接口。权限沙箱证明来自离线集成测试，真实探针本身没有在该沙箱内运行；没有保存真实运行前后整个生产 cache 的逐文件摘要，不把静态证据夸大为这样的文件系统审计。生产源码、schema、UI、Graph 规则与起点提交树保持一致，完整浏览器回归另行验证既有产品行为。

## 8. 全回归

详细命令、退出码、耗时及日志摘要记录于 `experiments/discovery-v2/phase1d-validation.json`。unit/build 完成后才开始浏览器套件；浏览器套件顺序执行，没有构建竞争。原有断言未删除或替换。

| 检查 | 结果 |
| --- | --- |
| Typecheck / Build | PASS / PASS |
| Unit | 545 tests：542 PASS、3 个原有 live skip、0 FAIL |
| Discovery（含 Phase 1A/1B/1C/1D） | 98 / 98 PASS；新增 15 项 |
| Phase 0 | 6 / 6 PASS |
| Phase 1A 离线重放 | PASS；旧 digest `546af0c31bc3434abca4f64ff8691457373a2c3449363b641f30eb53d637167c` 不变 |
| Phase 1B 离线重放 | PASS；3 attempts、4 candidates，固定原有测试全部通过 |
| Phase 1C 离线重放 | PASS；旧 digest `a996cb856efd956807c8758432181bb9cb8dfce2477a8228505d0db8be594b84` 不变 |
| Phase 1D 官方路径 Mock / 静态收据检查 | PASS / PASS |
| Canvas | 113 / 113 PASS |
| Landing | 40 / 40 PASS |
| Analysis | 16 条状态记录、0 contract violations、无 page errors |
| Preflight | 45 / 45 PASS |
| Stale A→B | 6 条记录；failed=false、complete=true、observed=true、errors=[] |
| UI Contract | 75 / 75 PASS |
| Responsive | 71 / 71 PASS |
| Mobile | 133 / 133 PASS，Chromium CDP touch simulation |

实验入口另行 strict TypeScript noEmit 通过。Mobile WebKit executable 不存在，实体手机未验证；不将 Chromium PASS 扩大为上述环境验收。全部结果文件和日志路径/摘要已记录；截图和几何保存在既有 ignored artifacts 目录。最终记录生产 `src/` 中除 Discovery 外所有已跟踪文件逐字节等于起点。

## 9. 下一阶段最小切片与局限

建议先建立固定 revision、合法许可的多文件真实项目评测集：已知 Fork/共同历史、复制并重初始化的人工控制、格式/标识符/路径修改控制、共享模板与依赖的负例，以及人工审查后仍可保持 unknown 的真实对照。使用本阶段身份链路获取快照，分别记录 metadata、确定性相似度和人工证据，不改变阈值或自动升级谱系。

先在相同预算下测文件选择覆盖和跨版本稳定性，再讨论是否需要改善发现召回。24 attempts 与 32 KiB 响应上限会排除较大 Metadata/Commit/Tree/Blob，深路径还消耗额外 Tree 请求；这些必须显示为未完成。此次三仓单文件成功不能证明大仓覆盖、未知关联发现、全 GitHub 检索能力或生产成本。暂无生产 Verification Adapter、CPU hard budget，实际触摸设备/WebKit 的移动验证也不在本轮新增承诺内。

完成后停止等待 Review；下一阶段评测集尚未启动。


## 10. 本地提交与停止

1. `5075371d694f9714560c46da2c27e2b3eee1dc13` — `discovery: use verified repository identity for pinned git objects`：已测试实现、官方路径 Mock、测试、重放入口和说明。
2. `b998e38b76c6a465c2af7cf2fbfe23ae9f303357` — `discovery: record successful public pinned snapshot probe`：真实成功原件与显式 Mock 失败收据，只包含静态 JSON。
3. 本报告、RFC 追加说明和 `phase1d-validation.json` 作为最后报告提交；其完整 SHA 由交付消息及 `git log -1` 提供，避免文档自引用摘要。最后提交无可执行修改。

保留未跟踪 `tools/`。未 push 或 deploy。Phase 1D 本地验收完成，停止等待 Review。
