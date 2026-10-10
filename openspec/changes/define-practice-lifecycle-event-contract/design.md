## Context / observed evidence

现行 [agent-integration](../../specs/agent-integration/spec.md) 允许符合契约的显式 Skill targeted query，但要求 Hook metadata-only，不自动运行 `lore query` / `lore get`。本 change 不迁移或修改现行 requirement；现行规范是行为真源。Benchmark PR #221 的公开报告仅涉及固定脚本节点的投放运行，原始 `scratch/` 尚未独立复核。五宿主目前仅核对配置声明，行为及语义能力待验证。

## 可核查的依据及其限制

| 判断 | 可核查依据 | 只能得出的结论 |
| --- | --- | --- |
| 现行 Hook 不自动 query/get；显式 Skill 在 material moment 执行 targeted query | [agent-integration current spec](../../specs/agent-integration/spec.md) 的 CLI-first 集成 requirement；对应 `packages/cli/src/hook/` 测试仅用于核对现行实现 | 当前集成边界；不代表未来自动 A4 已获授权 |
| 五宿主存在配置声明的 Hook 入口 | `plugins/{codex,claude,cursor,zcode,workbuddy}/lorelum/hooks/hooks.json` 中的配置声明；具体事件与 matcher 应以各文件实际内容为准（见产品提案矩阵） | 配置层声明，不代表真实宿主 payload、时序、可见性或语义识别实测 |
| P1 固定脚本节点在所报告条件下可运行 | [Benchmark PR #221](https://github.com/lorelum/lorelum-benchmark/pull/221) 的 `pilot-20260926-restart2` 公开报告 | 报告级设计输入；原始 `scratch/` 尚未独立逐槽审计；不能证明最佳时机、事件识别、Practice 因果收益或跨宿主推广 |
| 本 Issue 是设计交付且原始审计门槛尚待 owner 确认 | [产品 Issue #268](https://github.com/lorelum/lorelum/issues/268) 的目标、验收及待确认问题 | 不可将工作稿视作 owner 已接受的产品契约 |

已核对上述五个仓库配置文件存在；配置存在不等于宿主已执行或已验证某个 matcher 的实际行为。

## Design decisions under review

拟议 ADR 0017 和 [v0.1 维护者提案](../../../docs/development/practice-lifecycle-event-contract.md) 描述产品仓库唯一契约归属、事件成立与排除条件、来源等级、身份与继承、版本及缺失输入、A1—A6 分层动作和审计最小化。两者均为 Proposed，不代表已获 owner 接受，不覆盖 current spec。Benchmark 文档只保留 provenance 与实验映射。

现行显式 Skill 查询受 `agent-integration` 约束；生命周期自动 A4 query、A5 候选返回和 A6 完整注入均为未来独立 scope，默认 deny。任何自动行为、Orchestrator 消费路径或用户可见/关闭/降级边界改变，都须另起有可观察 requirement/scenario 的 active OpenSpec 评审，不能仅凭本设计实施。

## Open owner decisions

- 是否把已观察变化信号与已确认实质范围变化分成两个公开事件名。
- 是否将原始 P1 `scratch/` 逐槽审计设为本设计的接受门槛。
- 宿主行为实测与离线评测的责任、证据位置和后续单独 Issue。
- A1—A6 策略上限与审计保留、可见性和脱敏原则。

## Deferred and non-goals

不修改现行 spec、Hook、Skill、CLI、wire schema，不运行 Benchmark 或创建正式 record；不以配置声明推断真实宿主行为或语义识别质量。接受该设计也不自动批准自动 A4—A6，实现前须另行评审。
