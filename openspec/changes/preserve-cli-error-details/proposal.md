## Why

`unify-cli-error-messages` 已改善唯一的人类可读失败 `message`，但 #223 仍要求稳定机器可读通道。程序若要获得被拒绝的 option/config key、来源、原因、期望值或安全回显值，目前仍只能解析 prose。

本 change 记录一次方向调整：保留已合并 message-only 实验中的 bounded actionable `message`，同时替换其对结构化诊断字段的禁令，改为可选、受 schema 约束的 `error.details` 数组。

## What Changes

- 引入新的产品行为：普通 CLI 失败可携带由 owning validator 生成的可选结构化诊断 details。
- 扩展公开 v2 failure envelope，新增 `error.details`，同时保留 success envelope、error code、exit code、traceId、recovery 和 protocol version。
- `message` 继续面向人类；`details` 是机器契约。
- 增加严格输出预算、terminal/bidi escaping 与 secret-safe received-value 规则。
- 增加一个 invocation producer 和一个 query-config producer 作为端到端证明；Backend/Embedding 配置覆盖及其 transport 接线仍由 #229 处理。

## Non-goals

- 不把每个普通命令都迁移到 structured details。
- 不移除或削弱 #237 的 actionable messages。
- 不暴露 raw Commander/Zod/YAML exception 或任意 diagnostic map。
- 不在本 change 中实现 #229 的 Backend/Embedding 配置诊断。
