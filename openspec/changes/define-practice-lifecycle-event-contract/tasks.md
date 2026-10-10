## 1. 设计门禁与证据核对

- [x] 1.1 关联产品 Issue #268，建立提案并对照现行 `agent-integration` metadata-only 与显式 Skill 查询边界。
- [x] 1.2 划清 P1 公开报告、原始 `scratch/` 未复核以及五宿主配置声明／行为待验证的证据等级。

## 2. 拟议文档与状态

- [x] 2.1 形成 Proposed ADR 0017、v0.1 维护者提案及 research 迁移输入，并更新导航；标明开放 owner 决策与非现行行为。
- [x] 2.2 核对事件样例、缺失与版本降级、A1—A6 权限分层；确保不改变现行 Hook 契约。

## 3. 验证与评审

- [x] 3.1 以仓库固定 OpenSpec 1.7.0 完成 strict validation（active changes 26/26 通过，本 change 的 specs 显示 skipped）；检查拟提交文档的本地相对链接、编码、末尾换行、行尾空白及代码块闭合。Windows `bun install --frozen-lockfile` 的无关 `@fumadocs/base-ui` 链接失败和 CI 运行状态仍须在 PR 中披露。
- [ ] 3.2 请 owner 审议未决事项；获得明确决定后才能宣称提案已接受。本任务不以运行时实现或代码测试为完成条件。
