# OCI Private Beta 部署前只读评估

本轮通过既有 SSH 连接检查了 OCI 的资源、生产进程、存储和访问路径，没有部署或修改服务器配置。服务器具备运行小规模独立管理员服务的资源条件，但证书、身份、目录、配额和操作授权尚未准备完成。现在无需执行部署；需要用户单独批准下文的修改清单后，再进行真实 OCI 私有验收。

**结论：资源预检 Go；实际部署 No-Go。** 本结论允许进入受控部署准备审批，不代表 OCI Private Beta 已通过验收。

## 1. 基线、范围和证据

- 本地和远端审查分支：`review/gitlineage-development`，均为 `32d20bdba8d86890907ba5d89056a6839a11912d`。
- 远端 main 和生产 checkout 均为 `1c31c1ccbb4657c8c0773e29faeb0b87203f8e4d`。
- 检查窗口：2026-10-11 12:08:44–12:09:43 UTC，后续只读复核见本报告末尾。
- 本地工作树检查时仅有原有未跟踪 `tools/`；未访问、暂存或清理该目录。
- 使用已有 SSH 密钥与既有目标连接；正常主机密钥校验。未读取私钥、生产环境变量内容、管理员凭据或 Cookie。
- 远端命令限于 `date/uname/nproc/uptime/free/df/vmstat`、`systemctl show/is-active`、`ss`、`readlink/stat/du`、固定 checkout 的 `git rev-parse`、配置路由提取、Job 阶段计数、防火墙与 SSH 有效配置查询，以及 GET 健康检查。
- 未运行分析 POST、GitHub 配额探针、安装、构建、重启、写配置、创建账号或监听端口。健康 GET 会进入正常访问日志，不能将本轮描述成磁盘完全没有自然写入。

依据为当前服务器读数及当前源码，不将历史部署审计当作当前证明。已阅读 `deploy/RUNBOOK.md`、`deploy/gitlineage.service`、`docs/OCI_REVIEW_BRANCH_AUDIT.md`、Private Beta Deployment Contract / Operations / Staging Report，以及 `experiments/discovery-v2/serve-private-beta.ts` 和 `experiments/private-beta/gate.ts`。

## 2. 当前服务器与生产服务

| 项目 | 实际结果 | 含义 |
| --- | --- | --- |
| 架构 / CPU | aarch64，2 个可用逻辑 CPU | 需约束 Beta 与公共分析竞争 CPU |
| 负载 | 0.01 / 0.01 / 0.00 | 瞬时低负载，不是峰值容量证明 |
| 内存 | 总计 11,927 MiB；可用 11,251 MiB；无 swap | 有额外服务余量，不能依赖 swap 防止 OOM |
| 磁盘 | 48 GiB，总使用约 4 GiB，可用 44 GiB | 代码、独立状态和限量备份有余量 |
| inode | 使用 3%，剩余 6,235,676 | 当前未接近文件数量上限 |
| 两次短间隔 CPU 采样 | `vmstat 1 3` 后两条约 100% idle | 只证明该短窗口，不证明并发源码比较性能 |
| 时间同步 | systemd-timesyncd active，NTP synchronized=yes | 配额窗口、证书和会话时间基础正常 |
| Node / Caddy | v24.21.0 / v2.10.2 | 与现有 ARM64 / Node 24 路线匹配 |
| cgroup | v2 控制器目录存在 | 可设计服务级 CPU / 内存 / 任务限制；本轮未应用或压测 |

公共 `gitlineage.service` active/running，用户及组为 `gitlineage`，PID 129272，NRestarts=0。WorkingDirectory `/srv/gitlineage/app`，实际 Node 可执行文件为 `/usr/local/lib/nodejs/node-v24.21.0-linux-arm64/bin/node`；checkout 为 `/srv/gitlineage/app/repo`，`dist/web` 指向该 checkout 的构建目录。MemoryCurrent=73,691,136 bytes，TasksCurrent=11。

公共 `caddy.service` active/running，用户 `caddy`，PID 18255，NRestarts=0，MemoryCurrent=17,006,592 bytes，TasksCurrent=9。现有站点 `gitlineage.duckdns.org` 反向代理到 `127.0.0.1:8080`，公共访问日志位于 `/var/log/caddy/access.log`。公共 Caddy admin 位于 `127.0.0.1:2019`。

当前两服务 MemoryMax / CPUQuotaPerSecUSec 都为 infinity，TasksMax=14192。因此现有服务没有为 Beta 自动保留容量；不能据此承诺公共服务绝不受资源竞争影响。

监听：IPv4/IPv6 SSH 22、公共 80/443、loopback 应用 8080、loopback Caddy admin 2019、系统 DNS 53。8083 和 8443 在检查时未监听；部署前必须重新确认，不能视为永久预留。

## 3. 数据与健康状态

| 项目 | 当前结果 |
| --- | --- |
| Cache | `/srv/gitlineage/cache`，实际路径相同，gitlineage:gitlineage，0750，约 68 MiB |
| Jobs | `/srv/gitlineage/jobs`，实际路径相同，gitlineage:gitlineage，0750，约 360 KiB |
| Job 文件 | 87 份有效 JSON；按真实 `phase` 字段统计为 10 complete / 77 failed；没有非 terminal 文件 |
| 环境文件 | `/srv/gitlineage/gitlineage.env`，root 所有，0640；仅检查元数据，未读取内容 |
| 本机健康 / 合同 | `/healthz` 和 `/api/contract` 正常 JSON，schema 2.0.0，analyzer 0.2.0 |
| 公共 HTTPS 健康 | HTTP 200，curl TLS verification result=0 |
| 生产实验路由 | `/api/preview/status` 与 `/api/deep-search/capabilities` 均 HTTP 404 |

健康配置显示公共分析最大并发 2、队列 20、速率限制开启、trustedProxyHeader=x-forwarded-for、proxyPeerTrust=true。Beta 的专用代理配置不能用于公共站点，否则会破坏现有客户端 IP 识别。

Job 文件计数是磁盘快照，不是生产 Scheduler 的实时内存队列查询。未启动测试分析；正式部署前应重新检查活动任务，并在公共服务繁忙时推迟 Beta 启动或负载验收。

## 4. 网络与访问方案

当前 IPv4 INPUT 允许 80、443、SSH 22、已建立连接、loopback、ICMP，最后 REJECT；OUTPUT 默认 ACCEPT，链中存在 OCI InstanceServices 规则。IPv6 INPUT 当前默认 ACCEPT，未列出额外规则。UFW 未安装。

本轮没有 OCI 控制平面权限核查，未证明 Security List / NSG 的内容；也没有外部端口扫描。不能由主机规则推导完整云端防火墙状态。尤其不能把当前 IPv6 默认 ACCEPT 描述为端口保护。

**推荐待批准方案：SSH 隧道 + loopback TLS，无公网 Beta 监听。**

- 独立 Beta Node 仅监听 `127.0.0.1:8083`。
- 独立 Caddy 仅监听 `127.0.0.1:8443`，`admin off`；不占用生产 80/443/2019。
- 首版固定 Origin 建议沿用已测合同 `https://localhost:8443`，管理员通过现有 SSH 的本地端口转发访问。隧道客户端也只绑定 127.0.0.1；不得使用 `-g` / wildcard bind。
- `sshd -T` 当前显示 allowtcpforwarding=yes、disableforwarding=no、gatewayports=no、permitopen=any；具有隧道的配置基础，但本轮没有建立隧道或进行远端 Beta TLS 验收。客户端 8443 若被占用，需要在审批前选定另一个固定端口，并同步修改 Origin、证书与代理 Host，不可临时随意变更。
- 该方案不需要 DNS、公网域名、云端入站端口或修改现有公共 Caddy。入口地址不是密码；真正边界是 SSH 访问权限、受信任 TLS、Gate 管理员认证与独立代理标记。
- localhost 是跨应用共享主机名，Cookie 不按端口隔离。管理员应使用专用浏览器 profile，不在该 profile 中访问其他本地 HTTPS 服务；如要改用专用名字，需要先批准命名与正常解析方案并重新验收，不能把这一点隐藏。

TLS 必须提供包含实际固定主机名 SAN 的证书，并在管理员专用客户端信任库中正常验证完整链。优先离线签发、CA 私钥不驻留 OCI；OCI 只持有受限 leaf 私钥及证书。不得复用临时 Staging 私钥、复制生产 TLS 私钥或关闭验证。没有公网 ACME 自动续期承诺：指定证书责任人、到期告警（30/14/7 天）、轮换步骤和失败停止策略。只重启独立 Beta 代理，不 reload 公共 Caddy。

## 5. 独立进程、身份与目录合同（尚未创建）

当前 `gitlineage-beta` / `gitlineage-beta-proxy` 两个账号不存在，`/srv/gitlineage-beta` 不存在。以下都是建议，不是已落地配置。

| 资源 | 建议 | 权限 / 隔离 |
| --- | --- | --- |
| Node 服务 UID | gitlineage-beta，无交互 shell | 不加入 gitlineage / caddy 组，不读生产数据 |
| Caddy UID | gitlineage-beta-proxy，无交互 shell | 不共享公共 Caddy 用户或状态 |
| 固定代码 / 构建 | `/srv/gitlineage-beta/releases/<approved-sha>` | root 管理只读代码，固定 SHA + npm ci + build；不修改公共 checkout |
| Beta Store | `/srv/gitlineage-beta/state` | beta UID 所有，0700；state.json / instance.lock 0600 |
| Cache / Jobs / tmp | `/srv/gitlineage-beta/{cache,jobs,tmp}` | beta UID 所有，0700，物理路径独立，不能指向生产或 Store |
| Proxy 状态 / TLS | `/srv/gitlineage-beta/proxy` | proxy UID 所有，0700；leaf key 最小只读权限 |
| 管理员配置 | `/etc/gitlineage-beta/beta.env` | root:root 0600，systemd 读取；仅 salt/hash，非明文密码 |
| Proxy key 配置 | 单独 proxy.env，beta.env 内同一独立随机标记 | root:root 0600；两进程需要同一 key，不输出 adapted Caddy 配置 |
| 备份 | 独立受限备份位置，不在 checkout | 停私有服务后备份 Store/额度/版本及私有配置；不复制公共数据 |
| 日志 | 专用 unit journal 或独立受限目录 | 仅状态、时延、资源及拒绝原因；不记请求体、Cookie、认证头和代理标记 |

真实入口是 `node experiments/discovery-v2/serve-private-beta.ts`，普通生产入口不自动启用。必须显式设置 GITLINEAGE_PRIVATE_BETA=1、固定 HTTPS GITLINEAGE_BETA_ORIGIN、GITLINEAGE_BETA_UPSTREAM_PORT、独立 GITLINEAGE_BETA_ADMINISTRATORS / PROXY_KEY / STORE。

特别注意该入口读取 **GITLINEAGE_CACHE_DIR / GITLINEAGE_JOB_STORE_DIR** 并直接传给 serve；不能误用公共 config 的 GITLINEAGE_CACHE / GITLINEAGE_JOB_STORE 或依赖工作目录默认值。Gate 检查 Store 与 checkout/cache/jobs 物理重叠，但部署操作员仍须验证 Beta Cache/Jobs 与生产目录不同、无 symlink 别名，并用 UID 权限实际拒绝读取生产状态。

专用代理沿用已测模板：固定 Host；拒绝客户端 Forwarded、标准 X-Forwarded-*、代理标记；移除 Caddy 自加的标准转发头；注入独立标记。其他伪造 X-Forwarded-* 仍交 Gate 拒绝。所有 Beta 服务路由（包括公开 Graph 外壳与 health）都需受控代理标记，不能为了健康探测放开上游直连。监控通过独立 TLS 代理访问，或使用严格保密的本机标记客户端。

## 6. 容量和系统限制建议

现有低负载资源足以尝试单实例管理员 Beta，但未进行 OCI 压测。建议单独 systemd unit / cgroup，所有 Node 子进程及 Worker 都落在同一受限组；独立 proxy 使用另一组。

| 初始建议 | Node / Worker | 独立 Caddy |
| --- | --- | --- |
| CPUQuota | 100%（最多约 1 个 CPU 的时间） | 20% |
| CPUWeight | 25，低于公共默认权重 | 25 |
| MemoryHigh / MemoryMax | 1536M / 2G | 192M / 256M |
| TasksMax | 64 | 32 |
| 文件句柄上限 | 4096 | 4096 |

这些是待批准、待实测的保守起点，不是代码中现有的 CPU hard budget。CPUQuota 约束进程组 CPU 时间，不是每次比较的精确 CPU 预算；仍无绝对线路字节上限。MemoryMax 可能终止服务并留下实例锁，需人工恢复。不能承诺严格性能隔离或零公共服务影响。

只读 code，NoNewPrivileges、ProtectSystem=strict、ProtectHome、受控 ReadWritePaths、RestrictAddressFamilies；写入只放自己的数据目录。不得授予 root/capabilities、用 root 跑 npm 生命周期脚本或改公共 unit。独立 Cache 内的普通 Graph 分析也可能触发额外工作，应在 Beta 配置中使用已有 GITLINEAGE_MAX_CONCURRENT_ANALYSES=1 和小队列（建议 2），并监控整体进程组。

数据增长需要容量告警（建议剩余磁盘 <10 GiB 或 Beta 数据 >1 GiB 告警）；当前没有每目录磁盘硬配额。告警后停止接纳新任务，不能清空 Store 释放额度。若需要文件系统硬配额，要另行批准，不能在本轮假设已存在。

## 7. 服务预算与 GitHub 前提

保持原有单任务硬上限：3 候选、每仓库 8 源码、128 KiB/文件、2 MiB 源码、24 HTTP attempts、并发 2、30 秒 deadline、32 KiB 默认保留响应、1 MiB 保守网络预留。received / retained / reserved / overflow 独立记录。

服务级全局 2 活动任务、身份级 1；96 reserved attempts/hour；每搜索先持久化预留 24；身份 2 搜索/hour、90 请求/min；全局 10 登录尝试/min。取消、重登、更换身份和重启不退还预留；403/429 等跨身份阻断。Store 保留同一服务额度，不能多建 Store 或多起实例绕过。

当前 Private Beta 显式入口没有配置 GitHub token 的接口；Provider 虽可接受显式 token，Gate 当前生产默认 transport 路径没有传入凭据。因此不能声称 Beta 已有独立 GitHub 认证配额，设置任意 token 环境变量也不等于接入。

OCI 的外部 API 剩余额度本轮没有探测；同出口匿名流量可能竞争配额。96 是服务自设预留上限，不是 GitHub 保障额度，首次 coreRemaining 未知时也不是外部额度已验证。未来批准部署后应单次核实可用窗口，余量不足就停止真实实验；不得借公共服务 Token、轮换身份或重复撞限。若要求独立认证额度，需要另行批准最小显式凭据接入，超出本轮只读范围。无可用配额时可以验收授权/TLS与失败状态，不能宣布真实 Discovery 闭环通过。

## 8. 停止、备份、锁恢复与回滚

1. 安装前记录批准 SHA、完整构建及依赖锁摘要；保存上一份可运行私有 build。首次安装没有旧 Beta，只能停止/撤销新私有服务，不切换公共版本。
2. 正常停止仅针对 Beta units：先停止接纳外部私有请求，再 SIGTERM 等 Gate 取消/保存任务并释放 lock；不停止公共 Caddy/Node。不要短于任务 30 秒期限，建议 TimeoutStopSec=60，OCI 实测关停时间后确认。
3. 首次运行建议 Restart=no，避免异常残留锁下反复重启。SIGKILL/OOM 后 instance.lock 保留是 fail-closed 行为，不能自动删除锁来维持启动。
4. 确认旧 PID/unit/exe 已停止、同 Store 无其他写者及监听，停掉自动拉起后备份，才允许一次人工移除**该独立 Store**实例锁。恢复旧 running 任务为 partial，保存既有预留，重新登录不恢复旧会话。
5. 持久化失败保持拒绝新任务，停止私有服务修复目录/磁盘；不删除 state.json、不恢复更旧额度、不伪造成功。
6. 回滚只切换私有固定 code/build，保留最新兼容 Store/额度；旧版本不能读取最新状态则保持停止，等待保守人工核对，不用旧备份重置计费窗口。
7. 备份包括私有 Store 与额度、配置版本、证书/凭据的受控备份和对应 build，保持权限；不将真实状态或私钥提交 Git。验证恢复在另一个隔离离线目录，不启动第二个联网实例。

源码已实现 state 文件 fsync → rename → 父目录 fsync。已测的正常重启/异常终止恢复只证明进程级行为；本轮没有 OCI 实际启动恢复演练，也没有系统断电测试。不能承诺断电级持久性。

## 9. 未来部署批准清单

| 必须批准的改动 | 风险 | 控制措施 |
| --- | --- | --- |
| 创建两个无登录 UID 和独立目录 | 中 | 不加入公共服务组；检查物理路径、owner、0700/0600 |
| 放置批准固定 SHA、锁定依赖及构建 | 中 | root 管理只读 release，非 root 构建，不触碰生产 checkout |
| 写入管理员 hash、代理标记与私有配置 | 高 | 明确管理员名单、独立秘密、root0600、不进入日志/仓库 |
| 独立可信 TLS 证书、客户端专用信任配置 | 中 | 离线 CA、leaf key 最小权限、到期告警；不修改公共证书 |
| 写两个独立 systemd units / 独立 Caddyfile | 中 | loopback、admin off、资源限制、无公共 reload，启动前配置校验 |
| 首次启动并执行 OCI 私有验收 | 中 | 新旧服务健康前后对比，公共错误/时延恶化即停 Beta |
| 单次真实 GitHub 额度及有限闭环 | 中 | 足额才运行，不重试绕限；partial 诚实记录 |
| 专用客户端 SSH 转发 | 低 | 127.0.0.1 only，固定 Origin/端口，正常 SSH/TLS 校验 |
| 备份、锁恢复、私有回滚演练 | 中 | 单写者确认，额度不回退，公共数据不读写 |

**不需要、也不授权**：公共 Caddyfile/systemd/environment、DNS、公共 TLS、main、PR 合并、生产缓存/Jobs、云端安全组或新增公网入站规则的修改。若放弃隧道而改公网域名/监听，必须重新做访问及防火墙审批，本评估不能直接沿用。

## 10. OCI 验收入口与停止标准

未来执行前重新核实 CPU/内存/磁盘、端口、main SHA、公共健康、Job 非终态、保护配置摘要。记录公共 Cache/Jobs 摘要变化时区分正常公共任务写入，不能把运行中数据变化一律判定为 Beta 污染。

必须在 OCI 实测：正常可信 TLS、精确 Host/Origin/CSRF、Secure/HttpOnly/Strict Cookie、伪造转发头与直接上游拒绝、登录轮换/退出/过期、两身份结果隔离、全局/身份并发和额度不返还、有限多文件读取摘要与导出、Graph 状态隔离、取消/超时、正常停止、异常锁与安全恢复、持久化失败拒绝。先固定 Mock Transport 测 TLS/授权路径，再在足额时另行真实 GitHub 小实验，不能混淆两者。

生产回归至少包括公共 HTTPS health/contract、已缓存 Graph/Evidence、桌面/手机可访问、公共 Deep Search 路由仍关闭、公共服务 NRestarts 与错误日志。任何越界监听、凭据泄露、跨身份访问、额度回退、公共性能明显恶化或存储误指向都立即停止私有服务；不以修改公共系统来补救。

## 11. 当前缺少条件与验收级别

- [x] 已用既有 SSH 只读确认服务器可达、资源余量、公共服务版本与隔离部署可行性。
- [x] 代码内的独立入口、预算、持久化、安全检查已审查；本轮没有修改代码。
- [ ] 用户单独批准第 9 节的修改、管理员名单、固定 Origin/端口及证书信任方案。
- [ ] 实际创建独立 UID/目录/units、配置秘密、安装固定 release 和可信 leaf 证书。
- [ ] OCI 配额窗口足以支持真实闭环；或明确只进行 Mock TLS/授权验收而保持真实功能 partial。
- [ ] OCI 资源限制、公共负载竞争、日志、备份、异常恢复、回滚及监控实测。

| 验收级别 | 状态 |
| --- | --- |
| 本地可信 TLS / Caddy Staging | 之前已通过 Review；本轮未重跑，不冒称新测试结果 |
| 真实 OCI 私有部署 | 未执行，No-Go 直至上述条件和单独授权满足 |
| 公开发布 | 未执行，不在本轮范围 |

本轮只交付评估文档，不推送 main、不合并 PR、不部署，也不推送审查分支。无需用户手工复跑本轮只读检查；下一步仅是审查方案并决定是否另行授权受控部署。

## 12. 结束复核

2026-10-11 12:13:13 UTC 再次读取：生产仍为 `1c31c1ccbb4657c8c0773e29faeb0b87203f8e4d`；公共 Node / Caddy 的 PID 仍为 129272 / 18255，两服务 active、NRestarts=0；Cache / Jobs 大小仍约 68 MiB / 360 KiB；公共 HTTPS health HTTP 200，TLS verification result=0。

两次配置 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `/etc/caddy/Caddyfile` | `0a4ebe290f9c3b74ba9acbab335d7c8dc51490dc1a174dc4eff800d1f03fccdd` |
| `/etc/systemd/system/gitlineage.service` | `cabcf35dbc419b4f3a57da09ffa09d7489975e254535da07a57ab81565dc5e90` |

这证明已采样配置和服务状态未改变，不等同于对所有生产文件作完整摘要证明。环境文件只检查权限，未读取或输出内容。GitHub `gh pr view` 确认 PR #1 OPEN / isDraft=true、headRefOid=`32d20bdba8d86890907ba5d89056a6839a11912d`、base=main。

本轮仅 Markdown 文档，无可执行修改；执行文档差异检查，不重跑既已验收的 Unit / Discovery / 浏览器 / ARM64 CI，不将历史 CI 宣称为这份文档提交的新 CI。
