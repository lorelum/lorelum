## 1. 查询事实与输出

- [x] 1.1 Engine/Backend 从已有完整 snapshot 传递 `corpus-empty`；colocated tests 覆盖冷/热 Store keyword、Project keyword、semantic Store/Project 以及原 pending，确认不增加扫描或 embedding。
- [x] 1.2 CLI 增加 `empty`、schema 和 default/verbose text，`finish-lookup` 只结束当前问题的检索，其他主题照常查询，可选实质改写最多一次且再空就停，空 corpus 不建议改写；tests 覆盖原因边界、keyword miss、partial 空结果、degraded warnings、A 空后 B 命中/get，以及非空/pending/error 和 JSON 回归。
- [x] 1.3 用现有 ProjectContext 文件 fixture 验证坏来源被忽略后的 empty explanation、原 warnings 和非空 query/get 不变。

## 2. 文档与交付

- [x] 2.1 更新 CLI 参考及英中文档，说明空结果字段与响应中的下一步建议；验证文档链接，不修改 Skill 或其指导 fixtures。
- [x] 2.2 扩展现有 CLI process fixture，真实验证 keyword 空结果的 text/verbose/JSON 与非空 query/get；走一次真实 semantic 空 corpus ready 路径，pending 使用现有非空 target regression，不重新验收整个模型生命周期。
- [x] 2.3 运行涉及 Engine/Backend/CLI 的测试、typecheck/lint、OpenSpec 严格校验及 diff 检查，记录真实结果和未覆盖边界。
