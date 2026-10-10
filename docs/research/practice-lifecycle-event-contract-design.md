# Practice 生命周期事件契约设计迁移稿

> 状态：2026-10-09 历史迁移输入，对应 [Issue #268](https://github.com/lorelum/lorelum/issues/268) 与 Benchmark 侧临时推进稿。本文仅保留迁移过程与背景；当前待评审设计见 [active OpenSpec proposal](../../openspec/changes/define-practice-lifecycle-event-contract/proposal.md) 与 [Practice lifecycle event contract](../development/practice-lifecycle-event-contract.md)，决策理由见 [ADR 0017](../adr/0017-practice-lifecycle-event-contract.md)。本文不是 canonical contract、accepted ADR 或 stable spec，尚未实现任何自动 query/get、候选元数据返回或完整 Practice 注入。

## 1. 决策输入

2026-10-09 的工作线程确认以下设计立场；本仓库已形成 ADR 0017（Proposed）与v0.1 maintainer proposal（maintainer proposal），仍需 owner 评审与接受：

1. 拟议产品仓库在契约接受后成为唯一 canonical source；此前 Benchmark 工作稿仍是迁移输入，接受后只保留版本引用、实验映射和证据边界。
2. Benchmark PR #221 的公开报告可作为设计输入；原始 `scratch/` 未复核，不阻塞设计，但不能支持效果结论。
3. 采用四事件族：`task_started`、`scope_changed`、`pre_completion_check`、`context_recovery/compaction`。
4. 先定义语义层最低契约，暂缓生产 JSON wire shape 与数值阈值。
5. 拟议自动动作默认 deny；A4 query 提交、A5 候选元数据返回、A6 完整 Practice 注入使用独立 scope。
6. 本地候选 query、实际外发 query 和审计记录分别限定字段。
7. 宿主能力证据分为配置声明、行为实测、语义可判定；当前仅有配置声明核对。
8. 样本与阈值冻结、受控 pilot、Orchestrator 接入均为后续独立工作。

## 2. 事件语义摘要

| 事件族 | 必要语义 | 排除项 |
| --- | --- | --- |
| `task_started` | 用户确实开始新任务，且可关联会话/任务边界。 | 仅 `SessionStart`、resume、clear、compact、fork 或宿主自动重启。 |
| `scope_changed` | 任务目标、约束、风险、验证或交付物发生实质变化；信号与确认分层。 | 普通追问、未关联任务的工具发现、Agent 猜测。 |
| `pre_completion_check` | 结果尚未发布且存在可拦截、可修正时点。 | 已发送完成声明、PR 已创建、每次 Stop、固定延迟、文件变化。 |
| `context_recovery` | 宿主上下文边界变化，按 compact/resume/clear/fork/unknown 记录原因和继承。 | 未确认任务身份时不继承旧任务领域判断。 |
| `post-hoc completion signal` | 完成声明已经发布后的事后信号。 | 不冒称完成前检查。 |

## 3. 最低输入与授权边界

可处理事件必须解释事件语义版本、宿主/适配器、原生来源、观察时点、可关联边界、判定状态、判定依据和来源等级。task ID、workspace ID、恢复原因、继承关系、去重键、置信度和脱敏证据引用是条件性信息。

缺失或 unknown 时的原则：

- 关键身份不可解释：仅记录/复核，不继承旧任务判断；
- 版本未知：记录或弃判，不按旧规则执行动作；
- 授权策略缺失：default deny；
- 去重不可保证：不执行自动动作；
- 任务身份不明：不执行任务相关 query、候选返回或完整 Practice 注入。

动作分级：

| 动作 | 边界 |
| --- | --- |
| A1 记录/审计 | 最小字段、短保留、可审计；本身不授权后续动作。 |
| A2 通用 Catalog/恢复提示 | 受现行宿主契约和用户清除语义约束。 |
| A3 本地候选 query | 只用允许字段，不提交检索组件。 |
| A4 提交 query | 独立 scope；必须由产品策略、用户设置、宿主能力共同允许。 |
| A5 返回候选元数据 | 独立 scope；与 A4 分开授权。 |
| A6 注入完整 Practice | 独立 scope；最高授权、频控、用户可见和关闭机制。 |

## 4. 与现行 agent-integration spec 的关系

现行规范要求 Hook 保持 metadata-only，不得自动执行 `lore query` 或 `lore get`。本文不改变该边界。本次 active OpenSpec 仅评审设计；若未来要允许自动 A4—A6、新增 Trigger Orchestrator 或改变用户可见/关闭/降级行为，必须另建包含可观察行为要求的 active OpenSpec change。

## 5. 后续工作

1. 按 Issue #268 完成宿主行为实测协议；
2. 阶段二冻结样本与阈值前，单独建立评测 Issue；
3. owner 同时评审本次 OpenSpec 设计提案、ADR 0017 与 v0.1 maintainer proposal，决定接受或修改；自动 A4—A6 等未来行为须另建有可观察 delta 的 active OpenSpec；
4. Benchmark 侧在正式契约版本化后收敛为引用和实验映射。

## 6. 证据边界

Benchmark PR #221 为 open PR。其公开报告称修复后的 `pilot-20260926-restart2` 九槽在固定条件下完成投放、同会话和 hard evaluator；Judge 未运行、无 no-card 对照、未创建 formal record，原始 `scratch/` 未独立复核。该报告只支持“固定脚本位置在该次条件下可运行”，不支持自动识别质量、最佳时机、Practice 因果收益或跨宿主安全性。
