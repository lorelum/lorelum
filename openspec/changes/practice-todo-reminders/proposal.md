# Proposal

## Why

Agent 读过 Practice 后可能在后续任务节点忽略适用指导。固定提示与单次行为观察不能证明遵循率提升；本变更提供宿主原生任务计划中的具体提醒，验证其可行性。

## What Changes

- 已有任务计划中，将已完整读取且适用于后续工作的 Practice 标识和具体检查事项关联到相关节点；不能注释时追加简短检查项，不覆盖原任务。
- 无计划或无任务工具时保持现有 query/get 流程；不为 Lorelum 单独建立计划，不改变宿主权限。
- 这是新的宿主 Skill 指导，不改变 CLI、JSON、Pack、检索或 Hook 合同。行为效果需要对照验证。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：以宿主原生任务计划携带已读 Practice 的节点提醒。

## Impact

共享 Skill 模板、生成的 portable 和宿主 Skill、双语用户文档及行为评估。