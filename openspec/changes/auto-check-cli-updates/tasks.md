## 1. 核心状态与异步检查

- [x] 1.1 实现 updates.autoCheck 设置读取，默认 true，false 或配置无效时不启动／投递；覆盖显式命令不受影响。
- [x] 1.2 实现用户级 SQLite 两表、schema 初始化、busy_timeout=0、版本分区检查占位与通知版本对原子领取；覆盖成功 1h、失败 15min、build 规范化、损坏／未知版本／竞争及资源关闭。
- [x] 1.3 实现 createAutoUpdateService(...).poll(deliver) 的本地编排：ready 结果重算版本，文本预检查后 claim；deliver=false 不消费，未 ready 不等待，所有自动故障静默。
- [x] 1.4 实现短生命 worker、source/compiled 内部 dispatch、detached/stdio ignore/unref；共享 30s 查询 signal，成功／失败仅更新自己的 reservation，退出或启动失败保留冷却，验证父调用不等网络。
- [x] 1.5 复用并扩展 release-client 的末尾可选 signal，保留旧四参数测试 seam、完整分页／资产／SemVer 检查与显式每页超时；覆盖取消和不发布部分结果。

## 2. 调用入口与输出

- [x] 2.1 在成功 semantic query/get/list/pack.list 的公共响应边界接入既有 host/session gate；keyword query 完全不 poll、不启动／领取，验证既有离线合同；文本可追加固定 prompt，JSON 仅 poll(false)，管理／错误／无绑定路径不参与，不改变 envelope 或业务状态。
- [x] 2.2 原生 Hook 按设计的 ID/source gate 调用 poll，保留 compact/工具/SubagentStart 原路径；覆盖 Catalog4000+分隔2+notice400、侧路故障不丢 Catalog 与各 envelope。
- [x] 2.3 扩展 omp catalog 请求和独立 updateNotice 响应，保留旧请求、sub、shell/read-hints；实现精确有效空对象时仅一次 legacy 回退并覆盖不回退错误。
- [x] 2.4 omp extension 用实际 Main session ID，只在合格 lifecycle 提供资格；将 notice 与 Catalog 快照分离、一次消费、generation 失效清除，覆盖并发 context、不重放及真实同文用户消息保留。
- [x] 2.5 更新指导只由运行时 prompt 自包含提供；移除共享 Skill 与生成 artifacts 中的重复指导，运行 skills:generate 与 skills:check，确认 Skill 相关文件相对基线无改动。

## 3. 验证与合同交付

- [x] 3.1 隔离用户目录和 Store 运行真实 CLI 进程：慢网络父调用立即返回、worker 写 ready、后续文本消费、JSON不消费、重复版本对安静、新 target 同对话可提、升级后同 target 可提；用受控网络 fixture 并记录冷／热进程延迟，不宣称公开发行性能。
- [ ] 3.2 在本机实际可用的正常宿主和已安装 CLI 路径验收启动／后续工具、恢复、compact 与可见提示，特别核对 Cursor best-effort 和 omp 一次性注入；记录不可用宿主／Windows 未验边界，不把全部宿主可用设为本轮实施门槛。
- [x] 3.3 更新站点中英集成／安装／配置说明及内部 Hook 合同，核对既有显式 update、--apply、--version 与管理命令边界；协调规格同步，不修改旧 active change、release workflow 或发布。
- [x] 3.4 运行聚焦更新／响应／Hook／omp 测试、CLI 类型检查与必要包级回归；审查唯一状态和版本规则所有者、无网络跨事务、worker短生命及旧分支清理，执行 openspec validate auto-check-cli-updates --strict，按实际结果报告通过、失败及未运行项。

此次已完成 13/14 项。3.2 的真实 startup／工具／resume／可见提示已取得证据，真实 compact、Cursor 等宿主与 Windows 的实机验证仍保留未勾选。具体结果和限制见 [验证记录](./verification.md)；不以单测冒充实机验收，也不因此扩大为发布或全局安装任务。
