# Design: unify-cli-error-messages

## Context

本 change 替换同一未合并 PR 内的 `add-cli-error-details`，不与它并列。当前 CLI 统一入口在 `packages/cli/src/main.ts` 捕获普通命令失败；`runtime/errors.ts` 将 Commander 错误和未声明错误映射为固定消息，`output/protocol.ts` 已要求 `code` 与 `message`。`create-program.ts` 与各命令的 validator 持有解析事实；query settings、Backend config 在自己的边界校验。现有测试 `main.test.ts`、`runtime/errors.test.ts` 与 `output/protocol.test.ts` 固定这些路径。Hook 入口在普通命令处理前分流，保持既有 ABI。

## Goals / Non-Goals

**Goals:** 所有普通命令的已知可纠正失败经过一条 message-only 响应路径；删除未合并的 detail 契约；既有错误标识、恢复语义与安全降级不变。

**Non-Goals:** 不把未知异常原文作为用户消息；不要求机器解析英文 message；不改变 Backend HTTP error body 或 Hook ABI；不新增配置、依赖或本地 MCP。

## Decisions

1. **一个失败消息，无第二诊断模型。** 撤回 `error-details.ts`、CLI/Backend 的 detail 类型、schema 字段与透传。`CliError` 持有已生成的消息，`main.ts` 按 allowlist 保留或安全降级，`renderResult` 让 JSON/text 使用同一规范化消息。机器仍按稳定 `error.code` 分支；message 只面向人。
2. **事实在 owner 处写成消息。** Commander 解析层对 registry 声明的枚举值直接指出选项或位置参数及允许值；选项很多时指出参数并引导到所选命令的 Help，不回显原始输入，也不在 renderer 解析异常 prose。命令 validator 在已知具体选项、配置 key、范围时写入消息。对于其余只知道“调用不合法”的路径，统一补上当前命令的 Help 操作。避免跨命令复制第二套选项表。
3. **一处输出安全边界。** 最终消息在双格式分流前作有界、单行的终端控制符转义；owner 不拼接 secret 值。allowlist 外和未知异常继续构造全新 `runtime.unexpected`，不传原异常消息。
4. **全命令验证由 registry 驱动。** 每个已注册普通命令至少一个非法调用 fixture 断言 code、message、exit、JSON/text；另外对 query 数值、query/Backend 配置、互斥与缺失参数、Pack specifier 等已知 owner 路径做具体回归。独立检查无 `error.details`、schema 保持 v2、Hook ABI 不变。

## Risks / Trade-offs

- **message 是 prose，不是机器字段** → 下游只按 `error.code` 分支；诊断体验只用于人，文档写清楚不承诺解析 message。
- **参数文本可能含控制符或私密值** → 只呈现 owner 确认非秘密的字段，统一规范化并限制消息长度；未知异常不回显。
- **原 PR 文档可能残留旧契约** → 在同一 diff 内替换活跃 change、代码、golden fixture 与中英用户文档，并用全文检索及 strict validation 检查。

## Migration Plan

本能力尚未合并或发布，无已发布 `error.details` consumer 需要迁移。保持 protocol v2 与既有 failure 字段；在 #237 中替换原 change 后验证最终 PR 文件树只有 `cli-error-messages` 活跃契约。若需回退，可 revert 本次提交，原提案仍在 Git 历史中。
