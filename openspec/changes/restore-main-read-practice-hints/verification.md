# 压缩恢复验证记录

## 验证对象与边界

2026-10-27，对提交前包含本变更的工作树源码进行验证；Bun 1.4.2，macOS arm64。

- CLI 使用本工作树 `bun packages/cli/src/main.ts`，通过进程级 PATH 包装提供给真实宿主，所有 Store 读取使用独立快照。
- Codex 0.162.0 使用正常用户配置中的 provider、已启用并信任的 Lorelum Plugin，经原生 app-server 协议执行会话、工具、压缩与恢复。
- omp 18.13.1 经原生 RPC 模式显式加载工作树 extension。沿用本机 provider/认证；使用临时观察扩展，仅计数 context/provider 中的 Catalog 和候选，不修改请求。压缩参数通过临时 overlay 设置为 soft、12000-token 阈值、后台摘要开启；未修改用户配置。
- 两个真实宿主均使用 GPT-6.1 Sol、medium。未委派实现子 Agent。
- 候选来自真实成功的 `lore get agentic-coding.implementation.preserve-responsibility-boundaries`，不是直接写入候选簿的模拟数据。

## 自动检查

| 检查 | 观察结果 |
| --- | --- |
| `bun test packages/cli/src/hook packages/cli/src/practice-hints plugins/omp/lorelum` | 378 pass、3 skip、0 fail；381 tests、18 files |
| 六宿主 Plugin 配置测试 | 41 pass、0 fail；11 files |
| 新原生恢复测试最终修改后单独运行 | 8 pass、0 fail；86 assertions |
| `bun run typecheck` | 退出 0 |
| 最终 CLI `tsc --noEmit -p packages/cli/tsconfig.json` | 退出 0 |
| omp extension 与测试对已安装宿主声明的临时配置类型检查 | 退出 0；宿主声明路径未加入仓库 |
| 修改代码的 oxlint | 最初只有新测试的四项 warning；修正后该文件无诊断，其他修改文件无诊断 |
| 站点 typecheck、最终生产 build | 均退出 0 |
| `openspec validate restore-main-read-practice-hints --strict` | valid |
| `openspec validate --specs` | 24 passed、0 failed；存在非阻塞的长 requirement 提示 |

回归覆盖原生身份/source 选择、候选服务故障保留 Catalog、大目录与完整候选预算，以及 omp 并发读取、重复 compact、旧结果晚到、会话切换/关闭和真实消息保留。并发/晚到竞态由确定性测试覆盖，不冒充实机随机复现。

## Codex 实机

通过 `codex app-server --stdio` 执行原生 `thread/start`、`turn/start`、`thread/compact/start`，关闭该进程后再用新进程 `thread/resume`。

1. 原生 PreToolUse 给实际 shell 命令加会话身份；成功 get 的工具退出码为 0，Backend 的该会话候选记录存在。
2. 真正 compact 后继续请求，持久会话记录中的注入 developer 消息含一份 Catalog、一份候选。模型无工具回答中的候选 ID 与成功读取的 ID 一致。
3. 连续请求仍回答一份候选，没有额外 query/get。
4. 新进程 resume 实际执行一次 SessionStart；新注入段只有一份 Catalog、零份候选，未额外恢复 Main 提示。旧历史保留与新增恢复分开判断。

## omp 实机

1. 原生 Bash 成功 get，候选记录属于实际 Main session。startup 与进程 resume 的实际 provider 请求均为一份 Catalog、零份候选。
2. 前台 soft compact 真正提交后，下一 context 与 provider 请求均为一份 Catalog、一份候选。
3. 后台路径先在宿主日志观察到 `Speculative compaction armed`，随后越过阈值观察到 `Applying armed speculative compaction`；提交后继续请求仍为一份 Catalog、一份候选。摘要准备阶段没有提前恢复候选。
4. 用实际 Bash 输出驱动工具循环越过阈值，宿主日志记录 `Mid-run compaction ran between provider calls`。该 mid-turn 路径使用 detached 提交通知；完整夹具下，继续 provider 请求为一份 Catalog、一份候选，任务正常完成。
5. 普通请求保持单份临时 metadata；`get_messages` 中没有持久化的 Catalog/候选 user 消息。
6. 新会话请求为一份 Catalog、零份候选；切回会话也不凭 startup/switch 额外恢复候选，后续实际 compact 再恢复。

## 文档实际呈现

真实 Chromium 检查英中功能矩阵、host 列表及支持详情入口。桌面呈现六个 host 列；390px 窄屏保留 256px 功能列、768px 表格并在局部容器横向滚动，页面自身不横向溢出，最右 omp 列可达。实际点击英中表头分别进入正确语言的 host 支持说明。生产构建成功。

## 验收准备中的故障

- 初始共享 Backend 是协议 3，本工作树为协议 4；按 `stop --if-idle` 成功停止后启动工作树版本，确认 ready。验收结束释放 lease、只在 idle 时停止验收版本，再恢复原默认 CLI 对应的 Backend；确认 ready 且 build identity 与验收前一致。
- 隔离快照最初未保留 current symlink，get 正确拒绝不一致 Store；重建链接后成功。后续临时快照出现 manifest 与 Pack 文件缺失，Catalog 正确降级而候选仍保持单份；没有将该次降级算作正常 Catalog 验收。重新复制完整快照并给复制文件使用新的时间戳后，正常和 mid-turn 恢复均再次观察到一份 Catalog、一份候选。文件缺失的外部原因未确认，不归因为产品缺陷。
- omp 的 handoff 不用于本次手动 compact；临时验收参数改用宿主支持的 soft 方法。

## 未覆盖与清理

按用户指定范围，Claude Code、WorkBuddy 只有对应测试和宿主合同依据，没有本次实机验收；Cursor、ZCode 不宣称支持 compact 后候选刷新。未验收 Windows、其他 omp 压缩方法或语义检索性能。

关闭验收 Codex/omp 进程和文档开发服务，删除临时包装、观察扩展、overlay、类型配置及 Store 快照；不把原始 provider payload、凭据、私人端点、会话或请求 ID 写入仓库。变更保持 active，不自动归档。
