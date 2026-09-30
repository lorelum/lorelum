# Design: preserve-cli-error-details

## Context（观察证据）

#237 已合并 message-only 方向，其活跃 change 明确禁止 `error.details`；该 change 已归档为当前行为。#223 仍处于 open，因为程序仍需要稳定事实而不是解析 prose。当前 v2 failure schema、`CliError`、renderer 与 #237 tests 均只携带 `code`、bounded `message` 和可选 recovery；Backend errors 仍只携带公开 recovery。

归档后的当前规范有两处与 details 相关：第一处是 failure shape 的直接禁令；第二处是 “Validator knows an option range” 场景中的 `MUST 不输出第二条 details 通道`。只修改第一处会让主规范归档后自相矛盾，因此本 change 必须同时修改这两个 requirement。

## Goals / Non-Goals

**Goals：** 在保留 #237 bounded actionable message 的情况下增加一个小型可选结构化通道；证明一条 invocation 路径和一条 query-config 路径端到端可用；保持 protocol v2 与既有失败标识。

**Non-Goals：** 不做 #226 全量 invocation 迁移、#229 Backend/Embedding config diagnosis、raw dependency errors、任意 map、secret metadata infrastructure、新 protocol version 或多错误聚合。

## Decisions（迁移决策）

1. **message 面向人，details 面向机器。** #237 的 message 与 terminal-safe normalization 保留。只有 owning validator 构造 details 时才输出；text 将同一 facts 压缩为一行。
2. **一个封闭 shape，先由 CLI envelope 拥有。** CLI 拥有公开 detail schema 与 envelope 过滤边界。Backend mirror 类型和 Backend-to-CLI mapping 延后到 #229，待实际配置 producer 存在时一起验证。
3. **envelope 边界防御性过滤。** factory 约束多数 producer，但 `createFailureEnvelope` 独立接受 JSON-safe、enum-valid、location-valid、budget-compatible details。非法 entry 被丢弃而不是猜测成形；空数组保持省略。
4. **不提升 protocol version。** 这是 v2 的可选字段演进。文档和测试明确严格旧 schema consumer 必须更新 validator。
5. **仅保留最小 producers。** Query integer options 与 query YAML settings 提供 #223 的两个 fixtures。没有 producer 的 Backend transport 预留不进入本 change。
6. **source 与 expected 使用严格 discriminated schema。** 只有 environment-variable source 可携带 `name`；integer range 只要求 safe integers 且 `min <= max`，不预设未来范围必须非负。

## Deferred Work（延后工作）

- #229：shared YAML loader 诊断、YAML syntax/location、Backend environment/YAML/Embedding 配置 facts，以及随实际 producer 一起交付的 Backend mirror 类型和 mapping。
- #226：全量 invocation errors 迁移。
- 后续若多个 package 继续需要同一 runtime contract，可在 #229 中评估是否抽出 shared package；本 change 不添加无数据源的预留接口。

## Risks / Trade-offs

- **严格 consumer 可能拒绝可选新字段** → 文档写明迁移，而不是把事实藏进 `message`。
- **received values 可能含控制符或 secret** → 只有 owning validator 选择回显标量；所有 bounded strings 都被 escape；objects/arrays 不回显。
- **#229 增加 Backend mapping 时可能漂移** → 后续应同时交付 structural tests、无损 translation 测试和 allowlist downgrade 测试。
- **防御性过滤可能隐藏 producer bug** → tests 覆盖 rejection cases 与 valid details；丢弃 unsafe detail 优先于输出不安全内容。

## Migration Plan

先归档 `unify-cli-error-messages`，再通过本 active change supersede 其 no-details 限制与 invocation range 场景中的旧禁令。以 `error.code` 分支的 consumer 继续可用；严格校验旧 failure schema 的 consumer 必须允许 `error.details`。query option/config producer 的失败 payload 增加可选 details，但 code、exit、recovery 与 message 语义保持。
