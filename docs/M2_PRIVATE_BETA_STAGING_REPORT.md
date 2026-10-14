# M2 Private Beta TLS / Proxy Staging

验收范围是 WSL2 Ubuntu 24.04 的独立 loopback TLS Staging。未访问或修改 OCI；未开放公网。基线为 `27f210ede95ac88038c0fd2eea31ff1e78a3b9e8`。

## 环境与实现

真实 Caddy 2.10.2、临时本地 CA、受信任 Chromium NSS profile、HTTPS 客户端和实际 Private Beta Gate / Discovery Engine。固定 Mock GitHub Transport 提供对象；这些结果不是 GitHub API 成绩。证书验证正常开启，未使用忽略证书错误的选项。测试结束清理自己的临时证书、私钥、管理员配置和 Store，不更改系统信任库。

默认 Caddy 添加转发头的行为已实测。专用 route 固定 Host，拒绝客户端转发头，移除 Caddy 的标准转发头，并注入独立随机代理标记。Gate 的原有 Host、Origin、JSON、CSRF 与转发头拒绝保留。专用 Private 服务所有路由都验证标记和转发头；直接访问上游 Graph 与 API 均拒绝。公共服务不启用此配置。

## 安全与恢复收据

`security-receipt.json` 保存实际 TLS 状态、请求状态及耗时、共享预算、文件权限、同步测量和进程恢复结果。两身份所有权隔离，单身份活动上限 1、全局上限 2；每次搜索预留 24 attempts，小时上限 96。重新登录、取消、超时及重启不退还预留。403 / 429 阻断其他身份后续搜索；非法请求和持久化失败均不启动 Provider。不同故障 fixture 使用独立测试 Store，不属于运行中绕过额度的操作方案。

正常关闭与重启、运行中 SIGKILL、残留实例锁拒绝第二实例、确认旧 PID 已退出后恢复均实测。恢复将旧活动任务标为 partial，并保留额度。目录 UID 与 0700、状态文件 0600 已核查。保存使用文件 fsync、rename、父目录 fsync；另有 20 次小状态同步测量。没有测试系统断电，不承诺断电级持久性。

会话轮换、退出失效、过期、精确 Origin、伪造 Host / 转发头、错误 TLS 主机名和不受信任 CA 拒绝均覆盖。会话到期使用受控时钟推进；不是等待真实 15 分钟。登录与 Explorer 的 CSP frame-ancestors 和 X-Frame-Options，以及跨源 iframe 拒绝保留。

## 浏览器与回归

390、430、1280、1920px 使用 Chromium 模拟。闭环包含登录、公开 Graph、选择关系、Deep Search、搜索、固定源码文件列表、修改选择、多文件比较、证据、下载、返回 Graph 和退出。校验 URL、选择、SVG CTM、viewBox、焦点、缓存摘要及导出合同；结果维持 verification=pending / lineageClaim=none。WebKit 和实体设备未验收。

本地 Typecheck、Build、Unit（590 个：587 pass、3 个既有 skip）、Discovery（134 pass）、Phase 0 Benchmark / 1A–1D、Production Preview Disabled、Canvas、Landing、Analysis、Preflight、Stale A→B、UI Contract、Responsive、Mobile、Deep Search 已通过。最终 Private Beta 与 TLS 收据见随附截图目录；正式构建文件 SHA-256 在浏览器测试前后核查。CI 需要分别核对两个工作流的最终提交，而非沿用基线成绩。

## 边界与上线条件

没有 CPU hard budget，也不能保证真实线路字节绝对上限。进程 RSS / CPU ticks 是观测，不是隔离保证。合法请求仍受原有响应保留、源码、任务 deadline、预算和并发约束。Canonical Graph / Cache 不写入实验结果；原工作区 tools 未操作。

本地 TLS Staging 是本轮唯一可能的通过级别。真实 OCI 私有部署与公开发布均未执行。未来上线必须先完成独立 HTTPS Origin、专用服务 UID、受限管理员和代理密钥、目录与权限、批准的反向代理配置、备份、锁恢复和固定版本回滚准备，并在真实环境重新验收。操作步骤见同目录 Deployment Contract 与 Operations。
