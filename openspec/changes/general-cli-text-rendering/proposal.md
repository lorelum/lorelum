## Why

Lorelum 的 JSON envelope 同时承载机器协议外壳和业务结果。把它直接作为默认终端输出会让人类阅读被大量引号、括号和协议字段干扰；但删减字段的专用 text renderer 又会把同一次业务结果分裂成两套不一致的语义。

本 change 将默认输出改为完整、可读的 text，并把 `--json` 固定为完整且原样的机器 envelope：人类与 Agent 从同一份公开业务数据获得不同的视觉表现，而不是不同的结果。

## What Changes

- **BREAKING**：除 `lore hook codex` 这个专用 ABI 外，所有普通 CLI 调用在未传格式参数时改为在 stdout 输出 text。`--json` 显式返回现有完整 JSON protocol envelope；不使用 TTY、管道或环境变量自动选择格式。
- 引入一个唯一的输出 render 边界。handler 继续只产生当前的结构化 `data` 或已映射的 error；render 层决定将同一数据写为 JSON envelope 或完整 text。它不得读取 Store、连接 Backend、等待 operation、排序结果或推导新状态。
- text MUST 呈现公开 `data` 的全部字段和值，包括 identity、状态、source、ID、进度、metadata、`null`、空集合和多行内容。只有 JSON envelope 外壳的 `protocolVersion`、顶层 `toolVersion`、`command`、`ok` 可不重复；若这些值位于 `data` 内，仍必须展示。
- 默认使用通用树形 text renderer。为 Help、version 等天然需要更舒适排版的命令预留仅布局用途的内部 custom renderer；它仍必须消费同一数据、保留全部公开信息，且不成为新的命令语义、外部插件接口或第二个数据模型。
- text failure 将现有 `error.code`、`message` 和完整 `recovery` 写入 stderr，并保持原 exit code；`--json` failure 继续在 stdout 写完整 envelope。`lore hook codex` 不参与普通 format 协商。
- 让 Agent/Skill 在普通检索时直接阅读默认完整 text，而不把它当作可解析协议；只有排查异常、核对 protocol envelope 或显式交给机器 parser 时才使用 `--json`。native smoke、CLI 测试、CI 与其他实际解析 JSON 的调用仍显式传入 `--json`，并为默认 text 和显式 JSON 建立同一 fixture 的完整性/进程测试。

## Capabilities

### New Capabilities

- `cli-output-presentation`: 定义普通 CLI 的默认 text、显式 JSON、单一 render 边界、完整信息保留、custom 布局限制，以及 stdout/stderr/exit 行为。

### Modified Capabilities

- `agent-integration`: 将 Agent/Skill 的普通 CLI 使用明确为阅读默认完整 text，`--json` 仅作为诊断或机器解析的显式入口；Hook 保持其专用 ABI。
- `retrieval-query`: 将 query 的业务结果/exit 语义与输出格式拆开；`--json` 保持现有 envelope，默认 text 可完整展示同一 ready、partial、preparing、indexing 与 degraded data。

## Impact

- 影响 `packages/cli` 的全局 option、输出选择、result/error rendering、registry metadata、source/process/native smoke tests；所有普通 command 的 handler 与 result schema 保持业务上不变。
- 影响 `packages/cli/AGENTS.md`、`docs/cli`、官方 Lorelum Skill/Plugin、双语 site 文档和任何 JSON 解析的测试或自动化示例。
- 不影响 Engine、Backend、LocalStore、查询排序、model/index lifecycle、JSON `data` schema、Hook ABI、MCP 边界或发布流程。
