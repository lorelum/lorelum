# 实施与验证记录

适用状态：`refactor/host-hook-adapters` 工作区，基线 `963963e`；Bun 1.4.2、macOS arm64。记录的是本次源码重构结果，不将旧基线或模拟扩展测试当作真实宿主证据。

## 实施结果

- `main.ts` 只有一个 Hook 分派入口，通过 `hook/command.ts` 一次解析并组装依赖，`runner.ts` 处理 JSON transport，日志统一在 finally 关闭。
- 六宿主协议、事件兼容范围、权限与降级在 `hook/hosts/`；Catalog、shell 关联及候选文本分别通过窄操作接口复用。
- 通用 Backend 工厂迁入 `backend/process-client.ts`，模型命令、runtime coordinator、registry 和提示调用者均迁移；LSP 核对新工厂 8 处声明/引用。
- 删除旧 host-hook、六个转发模块、catalog-store 和旧 shell-association 路径，更新 private package barrel；没有兼容 re-export 或第二套入口。
- 保留 omp 扩展及 Backend 状态所有权，生产插件配置与用户指南不变；更新开发文档的代码目录与调用链。
- Catalog 的依赖 getter 在操作发生时才解析，保留禁用 omp 子 Agent 目录完全不触碰 Store 依赖的行为。transport 显式提供原始 byteLength，保留 debug 日志信息。

## 检查结果

| 执行 | 观察 | 适用范围 |
| --- | --- | --- |
| `bun run --filter @lorelum/cli typecheck` | 退出 0 | CLI 与迁移后的包内调用、导出和类型 |
| `bun test packages/cli plugins/omp/lorelum packages/backend/src/modules/sessions packages/backend/src/modules/practice-hints` | 首轮 593 pass、4 skip；omp catalog 扩展测试因旧模块 import 加载失败 | 成功运行的 CLI、Backend、subprocess 测试；此整条命令首轮并非全通过 |
| 修正跨包旧 import 后，`bun test plugins/omp/lorelum` | 103 pass、0 fail | 含真实共享 CLI composition 的扩展集成、快照、嵌套身份、子目录开关，以及 subprocess 行为；仍为注入执行器/本地模块测试 |
| 删除新加的 forwarding-only 测试、保留算法边界覆盖后，`bun test packages/cli/src/hook/services/shell-association.test.ts` | 8 pass、0 fail | 最终保留的 quoting、命令边界、all-shell 测试；不靠复制转发断言增加数量 |
| 对受影响 TypeScript 文件执行 `oxlint` | 退出 0，无诊断 | 迁移后的源码与跨包测试 |
| 对受影响文件执行 `oxfmt --check`，修正唯一末尾格式后仅复查该文件 | 全部受检查文件格式通过 | 格式修改不改变已验证行为 |

首轮通过数量对应清理 forwarding-only 测试前的集合，不将它写成最终测试总数。删除的共享包装测试不承担独立验收，相关消费者边界仍由原有六宿主与 Backend 测试覆盖；没有为清理而削弱这些行为测试。

## 源码 CLI 与真实 shell

使用隔离 HOME、USERPROFILE 与 Store，通过当前 `bun packages/cli/src/main.ts` 执行 19 个场景：

- 六宿主各一个 Catalog 请求：原生 envelope、单行 JSON、退出 0 和目录内容正确。
- 六宿主各一个 shell 请求：额外 tool_input 属性保留；Codex 保留 allow，其他宿主不增加权限决定。
- 将六个返回的命令交给真实 `/bin/sh` 执行，观察到各自 host/session 身份及原始退出码 23。
- 六宿主各一个 malformed JSON：stderr 有诊断；五宿主 continue 降级、omp 空对象；退出 0。
- omp 禁用子目录：空对象、无诊断。

这些场景证明源码入口和 shell 行为，不证明其余宿主真实消费或 Windows PowerShell。

## 真实 omp

执行 `bun run build:cli-only` 得到本工作区 `dist/lore`。仅用于 Catalog 和 shell 等不需要 embedding 的验证，不将它当作完整语义检索发行目录。

使用 omp 18.11.1 的正常 provider 配置，通过受支持的显式 extension 加载运行本仓库 `plugins/omp/lorelum/extensions/catalog.ts`。临时 PATH 中的 `lore` 包装只启动上述构建，并将 CLI 的 HOME/Store 隔离到临时目录；不修改全局 lore、provider 配置或插件 registry。关闭工具、Skill、规则发现和 session 保存，发起一个实际模型请求。

实际模型输出：

```text
Lorelum Installed Pack Catalog — No installed Knowledge Packs are currently available.
```

证明了原生 extension 加载、编译后的 omp bridge 和真实模型上下文可见性。未在此请求中测试语义 query/get、真实 task/eval 或完整 marketplace 安装；扩展文件和宿主分发方式没有因本次重构改变。

## 真实 Claude Code

使用 Claude Code 2.1.284 的正常配置，以 `--plugin-dir` 加载本仓库原生插件，临时 PATH 指向同一个隔离 CLI 包装；关闭工具和 session 保存，不改变用户模型或认证设置。

宿主调用产生了独立的 `hook.claude` / `hook.started`、`SessionStart` 日志，证明原生插件已启动本次编译 CLI。模型请求报告 `unrecognized_model`，120 秒后超时中断；因此不能确认模型端 Catalog 可见性，也不把此运行计为完整通过。没有为验证而修改用户模型配置或将该宿主环境问题写入产品代码。

## 验收映射与限制

- B1–B9：六宿主迁移的行为测试、共享算法测试与 19 个源码/shell 场景；真实 omp 提供额外消费证据。
- B10–B12：omp 103 个测试及现有 get、可选 Backend、sessions / practice-hints 测试，保留来源关联与错误策略。
- B13：迁移的 argv 行为测试与普通 main 测试；源码与编译 CLI 均运行成功。
- A1–A7：通过最终源码/类型检查确认 runner 不认识事件，services 不解释 payload，adapter 拥有协议，main 单一路径、依赖在组装边界创建，旧入口删除。删除路径的 import 检查没有残留。
- Windows 的真实 shell/宿主验收未执行，平台相关测试按既有条件 skip；不宣称新增平台支持。
- Cursor、WorkBuddy、ZCode 尚未在本次启动真实宿主；其源码协议测试不等于宿主实测。Codex 与 omp 的后续实机验收见下文。完整 embedding、模型与检索流程未因本次内部重构改变，也没有重跑。

## 测试归属优化复验

适用状态：本工作区的后续测试目录整理；不改变运行时代码，不新增真实宿主或平台验收结论。

- 六个宿主测试通过 LSP 文件迁移到 `hook/hosts/`，同时更新相对 import。公共参数解析及非法参数回落迁入 `command.test.ts`；原先夹在 Codex 文件中的多宿主别名和配置失败断言迁入 `hosts/native-protocol.test.ts`。
- `runner.test.ts` 补充多行文本的单行 JSON 序列化、stdin 失败、非法 JSON、Error 与非 Error 异常的诊断和降级覆盖。各宿主的原生 fallback 断言继续保留。
- 移除两个只通过注入服务回显 Store 路径的测试；六宿主的参数解析覆盖保留，另通过真实源码入口验证命令前后两种 Store 参数写法。公共 argv 错误测试还验证不会读取 Hook stdin。

| 执行 | 观察 |
| --- | --- |
| `bun test packages/cli plugins/omp/lorelum` | 664 pass、4 skip、1 fail；唯一失败为整理 import 时误删了 Codex 另一条配置测试使用的 `ConfigError` |
| 恢复 import 后，`bun test packages/cli/src/hook/hosts/codex.test.ts` | 24 pass、1 skip、0 fail |
| `bun run --filter @lorelum/cli typecheck` | 首次发现新公共测试的只读 argv 与 main 的可变参数类型不匹配；调用处显式复制后退出 0 |
| 最终 `bun test packages/cli/src/hook/command.test.ts` | 15 pass、0 fail |
| 九个调整后测试文件的 `oxlint` 与 `oxfmt --check` | 均退出 0 |
| 隔离 HOME/USERPROFILE/Store 的源码 CLI smoke | Codex 命令前 Store 参数、omp 命令后 Store 参数均返回正确 Catalog；Codex 非法 JSON 降级并退出 0；omp 非法参数走普通 CLI 并退出 2，共四个场景通过 |

联合检查的其他成功结果仍适用于未再修改的测试；两次修正分别只复验受影响的 Codex 和公共命令测试，不把联合首轮计数写成最终全量通过计数。临时 smoke Store 和 HOME 已删除，没有修改用户配置或全局 CLI。

## Codex 与 omp 真实宿主补验

适用状态：测试归位后的同一工作区，重新执行 `bun run build:cli-only` 构建 `dist/lore`。使用真实本地 Pack `host-hook-smoke`、Practice `host.smoke.guidance`，通过公开 CLI 的 `pack install --path` 安装到各宿主独立的临时 Store。Catalog 描述和 Practice 正文使用不同验收标记，均不写入模型 prompt；因此能区分启动上下文消费和实际 get 读取。

宿主沿用正常 HOME、provider、model 与认证。临时 PATH 中的包装器只为 Lorelum 子进程设置隔离 HOME/USERPROFILE/Store，记录原生请求和环境变量是否存在，再执行本工作区二进制；不制造 Hook 事件、不修改响应、不设置宿主/session 身份。没有修改用户配置、全局 CLI 或插件 registry。

### Codex 0.162.0

- 使用用户已安装且启用的原生 `lorelum@lorelum-plugins`；其 `hooks/hooks.json` 与本工作区文件逐字节相同。沿用已持久信任的 Hook，不绕过 Hook 信任。
- 使用 `codex --no-daemon exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json`，工作目录为临时空目录；通过本次调用的 config 覆盖显式传递临时 PATH，关闭其他插件及 memory，不改变原有 provider/model。宿主进程退出 0。
- 原生 `SessionStart` 确实调用当前编译 CLI 的 `lore hook codex`。模型在任何工具调用之前准确引述 `host-hook-smoke` 的描述 `Native host Catalog probe cedar-lantern-5826.`；prompt 中没有此描述，也未允许通过文件读取发现它。
- 原生 `PreToolUse` 的 `tool_name` 实测为 `Bash`。Hook 输入中的命令没有 exports；宿主执行的 `/bin/zsh -lc` 命令含 `LORELUM_HOST_KEY=codex` 和非空 session，CLI 包装器也观察到这两个变量。模型和包装器均未自行注入身份。
- 原生 shell 执行 `lore pack list --json` 与 `lore get host.smoke.guidance --json`，均退出 0。get 返回真实安装的正文 `The installed Practice body marker is river-stone-7391.`，模型准确复述。
- 本次证明原生插件加载、启动 Catalog 消费、工具输入改写和真实 Store get；没有验收 SubagentStart、read-hint、resume/compact 或 Windows。

本产物为 CLI-only 构建。fixture 安装退出 0，但带有非阻断 index sync 警告；后续 Catalog/list/get 均成功，不据此声称 embedding 或 semantic query 可用。

### omp 18.11.1

- 通过 `omp -p --no-session --no-extensions --extension "$EXT" --no-rules --no-skills --tools=bash --no-lsp --no-title --max-time=180 --mode=json --auto-approve` 显式加载仓库的 `catalog.ts`。宿主沿用原生配置，未传 model/provider 或 HOME 覆盖；实际响应来自其配置的模型。工作目录为空的临时目录。
- 空 Store 下，模型在工具调用前复述“没有已安装 Pack”；随后原生 bash 的 `lore pack list` 返回空列表、工具成功、宿主退出 0。
- 安装 fixture 后，真实 `catalog(main)` 请求进入当前编译 CLI。模型在任何工具调用前准确复述同一 Catalog 描述标记，prompt 不含该标记。
- 原生 `shell` bridge 请求的命令为 `lore get host.smoke.guidance --json`，没有 exports；扩展更新后的真实 bash 命令包含 `LORELUM_HOST_KEY=omp` 及非空 session，实际 get 进程也收到这些身份变量。get 返回 `ok:true` 及正文标记，模型准确复述。
- 补充真实 bash 调用，在 get 后保存 `$?`、打印 `LORELUM_SMOKE_EXIT` 并原样退出；输出明确为 `LORELUM_SMOKE_EXIT=0`，原生工具 `isError:false`，宿主退出 0。
- 额外以 `--tools=bash,task,wait` 验证原生 child 完成及等待；观察到 `catalog(sub)` 和 `read-hints` bridge 请求。子模型确认没有收到子 Catalog 或 read-hints：子 Catalog 默认关闭，隔离环境未启动 Backend，不将请求存在当作非空候选内容的证据。
- 一次 provider socket 错误由宿主自身自动重试恢复；本次未修改 Lorelum 重试逻辑、用户模型或认证。

两宿主均证明了真实模型上下文消费、原生 shell 身份改写和 Store get。此补验没有发现需要修改运行时代码的问题。未覆盖完整 embedding/semantic query、非空 Backend read-hints、Windows；不将这些基本实机结果扩大为全部能力或平台保证。

完成取证后，两个宿主的临时 Store、CLI HOME、包装器、原始会话日志及共享 Pack 源均已删除；仅保留脱敏验收记录和本工作区构建产物。
