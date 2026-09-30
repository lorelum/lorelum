## Why

普通 `lore` 失败已有 `error.message`，但许多可纠正的调用和配置错误仍只返回固定文案。未合并的 #237 曾尝试增加并行的 `error.details` 契约，却只接入 query 的两类校验；本变更将其原位替换为所有普通命令共用的 message-only 错误体验。

## What Changes

- **BREAKING (仅相对未合并的 #237):** 撤回 `error.details` 字段及其类型、schema、透传和文本压缩实现。正式协议仍为 v2 的 `error: { code, message, recovery? }`，没有新增字段。
- 已知且可纠正的参数、配置和命令自身错误由拥有规则的解析/校验边界生成可操作的 `message`；所有已注册普通命令的非法调用都通过同一响应路径得到原因或明确的命令级 Help 下一步。
- 未知异常和未在命令 allowlist 内的错误仍使用安全通用文案，不回显任意异常或秘密值。text stderr 与 JSON `error.message` 呈现同一条消息，并约束控制字符及过长输入。
- 维持 error code、exit code、`diagnostics.traceId`、Backend `recovery`、success envelope 和 Hook 专用 ABI 的现有语义。

## Capabilities

### New Capabilities

- `cli-error-messages`: 普通 CLI 失败消息的生成边界、全命令可纠正错误覆盖、双格式一致性与安全兜底。

### Modified Capabilities

无；`retrieval-query` 既有状态和退出码要求不变。

## Impact

- 更新 CLI 解析与各命令校验、Backend 配置映射和统一错误渲染；删除 #237 尚未合并的 detail 通道及其测试。
- 更新 CLI 协议测试、命令覆盖矩阵、维护者文档与站点双语页；不新增依赖、接口或 MCP surface。
