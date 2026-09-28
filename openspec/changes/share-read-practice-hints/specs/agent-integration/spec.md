## ADDED Requirements

### Requirement: 跨宿主的会话已读 Practice 候选

Lorelum SHALL 由现有 Backend 持有成功读取的 Practice 候选状态，并按宿主与会话隔离；用户级 `~/.lorelum/sessions/<hostKey>/<宿主原始 sessionId>/` SHALL 作为可容纳不同会话数据的目录边界，Codex 会话 ID MUST 原样用作目录名，不再编码或加前缀；本功能只存 `practice-reads.jsonl`，CLI 和宿主 Plugin MUST NOT 另存候选清单。候选仅表示某次 `get` 已读取、可能仍相关，不表示主 Agent 采纳或证明有效；记录 MUST 不包含 Pack 来源列表、正文、shell 命令、用户 prompt 或查询内容。宿主 SHALL 只映射自己的事件字段，不单独拥有候选语义或存储。

#### Scenario: 宿主显式传递会话身份

- **WHEN** 支持安全改写的宿主在 shell tool 中传入宿主与会话 ID，直接命令、管道或脚本中的 `lore get` 成功读取 Practice，且 Backend 可接收报告
- **THEN** CLI MUST 将成功读取的 ID、digest、title、可选适用条件、实际执行目录及继承的会话身份报告给 Backend；Backend MUST 优先按显式身份记录，MUST NOT 用目录重叠推断另一会话，也不要求 `--json` 或解析命令及输出

#### Scenario: 没有显式身份但宿主提供活动窗口

- **WHEN** 一个受支持的宿主无法安全传递会话身份，却映射了 shell Pre/Post 活动窗口，且窗口内 `lore get` 成功
- **THEN** Backend MAY 用公共活动窗口关联会话；这套窗口 MUST 由跨功能共享的会话关联能力唯一维护，不得为每种候选或后续功能另建窗口

#### Scenario: 非 shell tool 或无法关联的读取

- **WHEN** Hook 收到非 shell tool，或成功读取既无有效显式身份、也无法关联到活动窗口
- **THEN** 路由 MUST 跳过该 tool 或该读取，且 MUST 不影响原调用

#### Scenario: 显式身份缺失或格式无效

- **WHEN** `lore get` 成功，但继承的宿主/会话环境变量缺一项或不是有效的 `SessionRef`
- **THEN** CLI MUST 将其视为没有显式身份；Backend MAY 使用当前宿主已启用的公共活动窗口后备，若仍无法关联则不记录，原 `get` MUST 不因身份错误而失败

#### Scenario: 长对话和 Backend 重启

- **WHEN** 同一会话经过多轮读取且 Backend 重启，或原工作区不再存在
- **THEN** 已记录的候选 MUST 仍可按宿主与会话读取；记录 MUST NOT 因会话文件达到固定阈值而静默停止

#### Scenario: Backend 不可达

- **WHEN** `lore get` 成功，但 Backend 不可达或无法确定宿主会话
- **THEN** 该次候选 MAY 漏记；CLI MUST NOT 为可选报告启动 Backend，`get` 的文本、JSON 结果和退出语义 MUST 保持不变，且 MUST NOT 向临时目录或工作区目录写入备用清单

#### Scenario: 失败读取

- **WHEN** `lore get` 未成功读取 Practice
- **THEN** 候选簿 MUST 不新增该 Practice，且原命令的错误语义 MUST 保持不变

### Requirement: Codex 会话身份传递不改变原命令权限

Codex 集成 SHALL 只对 Bash 的 `PreToolUse` 改写工具输入以传递宿主与会话 ID；MUST 保留原输入的其他字段，且 MUST NOT 改变命令原有的权限、沙箱与退出语义。无法安全改写或用户未信任 Hook 时 MUST 不假称显式绑定已生效。当前 Linux 与 Windows SHALL 保留已有 Pre/Post 窗口代码路径，分别完成真实宿主改写、继承与权限验证后才可另行切换；Windows 的现有 Hook 声明不算真实运行验证。

#### Scenario: Bash 中的本地子进程继承身份

- **WHEN** 可信任的 Codex Pre Hook 收到带会话 ID 的 Bash 调用，命令直接运行程序、运行本地脚本或启动管道
- **THEN** 各本地子进程 SHOULD 继承同一宿主与会话 ID；原工具输入的工作目录、超时等字段 MUST 保持不变，非 shell tool MUST 不被改写

#### Scenario: 权限档位或 Hook 不支持改写

- **WHEN** 改写未被信任、宿主不支持改写，或当前平台的改写路径尚未通过真实宿主验证
- **THEN** 集成 MUST 保持命令原行为；可以使用已支持的公共窗口后备或漏记，但 MUST NOT 把仅显示改写后的 Hook JSON 当作命令已实际执行的证据

### Requirement: Codex 子 Agent 获得可选候选提示

Codex 集成 SHALL 在 `SubagentStart` 有可关联候选时注入有界的元数据提示；空候选或读取故障 MUST 不阻塞子 Agent。提示 MUST 声明候选可能相关且不完整，仅在当前子任务需要时由子 Agent 自行 `lore get`；Hook MUST 不自动查询或读取完整正文。

#### Scenario: 子 Agent 启动且本会话已读候选

- **WHEN** Codex 的 `SubagentStart` 带有当前会话 ID 且候选簿有已读 Practice
- **THEN** 子 Agent MUST 收到按预算裁剪的 ID、title 和适用条件提示，但不收到 Pack 来源、正文或自动执行 `get`

#### Scenario: 无候选或暂时不可用

- **WHEN** 本会话没有候选，或 Backend 无法读取候选
- **THEN** Hook MUST 不注入候选并允许子 Agent 正常启动

#### Scenario: 同路径重叠会话

- **WHEN** 多个会话在同一路径同时使用 shell tool
- **THEN** 显式传递身份的读取 MUST 按其身份分别记录；仅走活动窗口后备的读取 MAY 漏记或误归属，用户文档 MUST 明示后备路径的限制；候选不得被用作权限、采纳或任务完成判定
