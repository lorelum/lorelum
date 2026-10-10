## Why

产品 Issue [#268](https://github.com/lorelum/lorelum/issues/268) 需要对 Practice 生命周期事件的语义、证据等级、归属和动作边界形成可评审的产品侧提案。现行 `agent-integration` 只规范 CLI-first Skill 与 metadata-only Hook；宿主 `SessionStart` 等事实并不能证明用户任务语义。将 Benchmark 工作稿当作正式契约或从 Hook 名称推断自动动作均可能突破既有边界。

本 change **提出未来设计，不引入现行或新的运行时行为**。ADR 0017 和 v0.1 维护者文档保持 Proposed；在 owner 裁定开放问题及适用规范后，不得将其当作已接受的 capability spec。

## What Changes

- 提议产品仓库作为获接受后的唯一生命周期语义契约来源；Benchmark 工作稿仅保留 provenance、实验映射和证据边界。
- 提出宿主事实、候选信号、已确认事件和动作授权的分层，以及任务身份、缺失输入、恢复继承与版本处理的设计边界。
- 将显式 Skill targeted query（现行）与未来生命周期自动 A4 query 提交区分；拟议自动 A4、A5 候选元数据返回、A6 完整 Practice 注入各需独立授权和后续 active OpenSpec，事件本身不能授权。
- 保留宿主配置声明与行为实测、语义可判定之间的证据等级；P1 公开报告只作为固定脚本投放输入，不作为识别、收益或跨宿主结论。
- 请 owner 裁定事件命名、原始 P1 `scratch/` 审计是否为完成门槛、宿主实测责任以及授权与审计原则。

## Capabilities

### New Capabilities

- 无。本次只评审未来语义设计，不定义现行可观察的新 capability。

### Modified Capabilities

- 无。`agent-integration` 的现行 requirement/scenario 不变，因此不提交虚构的 current-behavior delta spec。

## Impact

- 文档：拟新增 ADR 0017、v0.1 维护者提案、research 迁移稿和两处导航；本 change 自身保留提案、设计与任务证据。
- 运行时与公开接口：无。Hook 仍 metadata-only，不能自动执行 `lore query` / `lore get`；不新增 Orchestrator、wire schema、CLI/API 或 MCP。
- 验证：strict OpenSpec、文档链接与示例逐项核对；宿主行为实测、离线评测、原始 `scratch/` 复核、代码测试均不在本 change 完成范围内。
