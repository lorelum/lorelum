## Why

用户写错 query、Backend 或 logging 配置后，需要在发生问题的命令中知道修改哪里；终止错误与继续运行的 logging fallback 不能各自丢失来源、规则和实际生效状态。#229 与 #230 应一起解决这些事实的产生和呈现，但不应为相同信息新增默认 `error.details` 或 `diagnostics.notices` 协议。

## What Changes

- 引入新的可观察行为：已知配置失败在既有 `error.message` 中准确说明来源、设置、失败规则与修正方向；logging fallback 在 stderr 只提示一次，并写入真实的本机日志证据。
- 建立两种可复用行为：已有 validator 报告最小的内部 typed config failure；消费方选择继续传播为终止错误，或明确提供默认值，通过普通 fallback 函数取得实际采用值及原失败并发布降级事实。query、backend、embedding 和 logging 是消费适配与验收案例，不是通用逻辑中的特例。
- 只丰富已有校验边界的诊断，不新增 query 校验门槛、输出重校验、全 section 扫描或第二份规则表。最终 renderer 不解析异常文案推断事实。
- logging 配置非法或不可读时，CLI、Hook 与 daemon 使用同一解析规则；持续等级回退 `info`，单次 `--debug` 的实际等级仍为 `debug`。不阻断原本可继续的业务，不把 Backend 配置错误改成 fail-open。
- 明确修改原 Issue 的验收方案：#229 的结构化公共字段、#230 的机器 notice 改为既有 message、一次 stderr 提示和本机日志；机器调用方仍按 `error.code` 分支，不解析 prose。保留普通 envelope version 2 的完整形状、`error.resource`、trace、退出码及 Hook raw stdout ABI。
- 不自动重写用户配置，不新增 config doctor、诊断 flag、通用事件框架、公共 notice schema 或远程接口；不改其他配置 section、日志安全边界及 feedback evidence 词汇。

## Capabilities

### New Capabilities

- `config-diagnostics`：消费配置的可纠正错误、明确降级时真实采用值的说明，以及终止错误和 fallback 的呈现优先级。

### Modified Capabilities

- `diagnostic-logging`：logging 配置 fallback 的单次现场提示、有效等级解释与真实本机记录，覆盖 CLI、Hook 与 daemon。

## Impact

影响 `packages/config` 的文档错误与 logging 设置解析、CLI query loader/Backend 错误适配/进程日志组装、Backend config loader 与 daemon 日志初始化。复用 js-yaml、Zod 和 `@lorelum/log`，不新增依赖或持久化 schema，不改变 Backend wire protocol。行为落地后同步站点中英文配置/排障说明及维护者配置文档；本 change 的 `requirements.md`（含产品流程）、`design.md`、delta specs 与 `tasks.md` 共同定义实施边界。
