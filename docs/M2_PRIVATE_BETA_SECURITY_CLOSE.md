# Private Beta Gate 安全收口

基线：`5b1fb0146d70a013e8b696870021cfd377ac663e`。本轮不增加功能、不部署。

请求体最大 4096 字节。独立计时器从开始读取起计时 5000ms，持续发送分块不能刷新时间；超时、超量、无效 Content-Length、连接关闭会终止读取并清理计时器和监听器。Origin、CSRF、身份检查仍在原位置。原始 TCP 测试连续每 200ms 发一块，验证约 5 秒断开；同时测试超大声明长度与主动断开，均不分配任务或 GitHub 预算。

显式安装 Private Beta handler 的独立服务统一设置 `Content-Security-Policy: frame-ancestors 'none'` 和 `X-Frame-Options: DENY`，覆盖登录页和 Explorer。普通生产服务不安装该 handler，响应行为不变。Chromium 在四种原有尺寸检查两个页面响应头，并从另一 Origin 尝试 iframe 嵌入，验证其中无法加载登录表单和画布。

状态保存采用临时文件写入 → 文件 fsync → 原子 rename → 父目录 fsync，每个现有保存点同步一次，不额外增加周期写入。任务开始前的额度预留必须同步成功；任一保存失败使当前实例停止接受新任务，锁保留。测试强制目标状态路径无法替换，验证没有启动网络工作和后续任务。异步任务完成保存失败被捕获，不产生未处理拒绝。

普通重启保留已确认额度，将未完成任务标记 partial，并撤销会话。非正常进程终止保留实例锁，重新启动需操作员确认旧进程停止；不能自动移除锁。系统断电方面，仅请求文件系统同步；未进行真实断电、磁盘控制器或 OCI 文件系统故障实验，不承诺断电级持久性。同步写入会阻塞单实例事件循环，成本随有限状态文件大小增加；未来运行监控仍需验收。

本地及最终 SHA 的两套 ARM64 CI 结果在交付报告提供。保持默认关闭、独立存储、verification=pending、lineageClaim=none。CPU hard budget、WebKit、实体设备和真实公网 iframe/TLS 配置仍未验收。

## 2026-10-10 本地验证

WSL2 Ubuntu / Linux Node 24：Typecheck、Build PASS；Unit 588 项（585 PASS、3 个既有 SKIP、0 FAIL）；Discovery 132/132 PASS，其中 Private Beta 安全 14/14 PASS。Phase 0、1A–1D 离线入口以及生产禁用测试 PASS。Canvas、Landing、Analysis、Preflight、Stale A→B、UI Contract、Responsive、Mobile、Deep Search、Private Beta 浏览器全部 PASS；浏览器执行前后 dist/web SHA-256 全部一致。Chromium 390、430、1280、1920px 保留完整授权操作闭环并新增登录页/Explorer 响应头与跨源嵌入检查。本轮不使用真实 GitHub API 配额。
