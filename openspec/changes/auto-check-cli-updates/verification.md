# 自动更新发现验证记录

验证日期：2026-10-23。环境：macOS arm64、Bun 1.4.2；基线 commit 为 `5cd2bd3`，验证对象包含本 change 的未提交改动。这里只记录此次证据，不定义长期产品合同。

## 自动化检查

- `bun test packages/cli plugins/omp/lorelum scripts/skill-guidance`：785 pass，4 skip，0 fail。覆盖配置开关、两种冷却、版本规范化、版本分区、跨进程通知领取、坏库／未知 schema／锁竞争、迟到 reservation、关闭资源、JSON 不消费、keyword 完全排除、Hook gate、OMP 一次性提示及旧 CLI 有限回退。
- `bun run typecheck` 通过。
- `bun run lint` 退出 0；仓库仍有 `no-await-in-loop` 警告，不把退出成功表述为零警告。
- `bun run skills:generate`、`bun run skills:check` 通过；生成副本与共享源一致。
- `bun run --filter @lorelum/site test`：178 pass，0 fail。
- 各宿主 Plugin 配置测试：40 pass，0 fail；`claude plugin validate plugins/claude/lorelum --strict` 通过。
- `bun run build:cli-only` 成功生成本 worktree 的非 embedding 编译候选。此构建不证明 native embedding 可用；没有为本功能启动 Backend、应用更新或发布发行包。
- `openspec validate auto-check-cli-updates --strict` 与 diff 空白检查通过。

精简复核后，Skill 源、测试及生成副本与基线无 diff；更新指导只保留在实际运行时 prompt。移除了用户目录／权限审计、重复表名和行类型检查、worker 业务复验与单条去重 INSERT 外的显式事务，保留配置和远端输入检查、reservation 关联及条件提交。精简后的 CLI 类型检查、修改代码 lint／格式检查、上述测试和 source／compiled 进程验收均重跑通过；以下真实宿主记录来自前次验收，本次没有重跑宿主模型会话。

## 真实 CLI 子进程与慢网络

运行 `bun packages/cli/integration/auto-update.integration.ts`。测试入口复用生产 CLI、状态、launcher、worker 和 release-client，只将发行请求指向本地 HTTP fixture，并隔离用户目录及 Store。fixture 中的 `0.1.1`、`0.1.2` 是验收数据，不是公开最新版结论；生产代码没有新增发行地址配置。

本地 HTTP 每次延迟 2 秒。source 和 compiled 两条路径均在发行响应完成前返回父命令，之后由 detached worker 写入 ready 结果。后续调用验证：JSON 保留原 envelope 且不领取提示；文本提示一次；四个并发进程只有一个输出；同对话的新 target 可提示；升级到中间版本后可再次提示相同 target；旧版本进程不清除新分区。

最后一次运行的完整进程时间为 source 冷 93ms／热 82ms，compiled 冷 543ms／热 55ms。不同运行存在波动；这些数据只证明该本地 fixture 下父进程没有等待 2 秒发行响应，不是公开发行包的性能比较或延迟承诺。

## 正常宿主路径

使用用户既有 provider 配置，以进程局部 PATH 指向本 worktree 的 compiled 候选，只有 Lorelum 子进程的用户目录与 Store 被隔离。没有改全局 CLI、宿主注册表、安装缓存或用户配置。可见提示通过隔离状态中的受控 ready fixture 验证，不借助真实发版触发。

- Claude Code 2.1.284：以 session-local `--plugin-dir` 加载 checkout Plugin。真实 `SessionStart:startup` 带有效 ID，Hook 返回 Catalog 和更新提示，退出 0 且 stderr 为空。随后用户现有模型请求连续返回 503，因此停止此次验收；不能声称 Claude 的工具调用或最终模型总结已验证。
- OMP 18.11.1：正常 provider 完成 `lore pack list`，其文本取得提示；模型先输出任务完成标记，再顺带告知更新，没有调用 `lore update` 或安装。
- 为确保加载新版 OMP extension，使用 session-local `--no-extensions -e <checkout>/extensions/catalog.ts`。真实 Main 的 bridge 请求带实际 `sessionId` 与 `checkUpdates:true`；恢复已有会话时取得独立 `updateNotice`，模型完成任务后才提及。再次恢复相同版本对时 bridge 不再返回提示，模型只输出任务完成标记。Catalog／notice 的并发 context 与不重播由扩展行为测试补充覆盖。
- 同名已安装 OMP Plugin 与 `--plugin-dir` 并存的试跑返回旧形状 Catalog 请求，因此不把那次结果算作新版 extension 的加载证据；显式 extension 路径没有改变全局 Plugin 选择。

## 未验证的边界

- 真实宿主的 compact 生命周期没有在本次验收触发；相同 ID 的 compact/tree/branch 不重新检查更新由行为测试覆盖。
- Cursor、Codex、WorkBuddy、ZCode 的真实宿主可见性未验；Cursor 首轮仍仅是 best-effort，不承诺提醒已被人类看到。
- Windows 编译／shim／PowerShell 的实机路径未验，平台专属测试在 macOS 上跳过。
- 未执行真实安装、`--apply`、Release 发布、全局 CLI 替换或站点部署；手动更新兼容由现有命令测试覆盖。

设计与代码的独立 Sol 审查已完成；发现的 Hook poller 接线、单次配置快照和测试／类型问题已修复。主规格同步与归档沿项目 change 流程进行，本记录不将其他 active change 改写为 Accepted。
