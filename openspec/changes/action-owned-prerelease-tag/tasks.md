## 1. Action 与 runbook

- [x] 1.1 Release build 固定使用 dispatch SHA，draft 模式校验 `main`、版本与新 tag；验证资产后由 Action 推 annotated tag 并创建 prerelease draft。
- [x] 1.2 更新维护者 runbook，包含 Deploy site、Release 输入、draft 核验、取消 draft 与已有 tag 的恢复边界。

## 2. 验证与交付

- [x] 2.1 解析 workflow YAML，检查 delta spec、文档链接与 diff，运行 focused release tests。
- [x] 2.2 更新准备 PR；合并、触发两个 Action 和公开发布不在本次交付范围内。
