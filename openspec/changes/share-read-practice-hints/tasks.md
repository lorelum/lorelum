## 1. 通用候选记录

- [x] 1.1 在 CLI 侧实现 shell-tool 路由和活动窗口，验证非 shell 跳过、Pre/Post 与工作目录匹配的单元测试。
- [x] 1.2 在成功 `get` 路径记录有界候选元数据，验证失败、重复、多来源和脚本内调用的测试，且默认文本与 JSON 输出不变。

## 2. Codex 集成

- [x] 2.1 将 Codex PreToolUse、PostToolUse、SubagentStart 适配到通用候选逻辑，验证 Hook payload、空状态、预算和原有 SessionStart Catalog 的测试。
- [x] 2.2 配置 Codex Plugin 的三个新 Hook，验证配置及 CLI 的真实 Hook 命令 smoke；如可行，核对实际 Codex 子 Agent 可见性。（实际 Codex 模型请求 401，未到达 Hook；PR 必须披露此未覆盖项。）

## 3. 文档与交付

- [x] 3.1 更新英文和中文用户指南，说明候选是可选提示及同路径重叠局限，并验证双语内容对应。
- [x] 3.2 运行相关 CLI 测试、类型/格式/Plugin 验证，审阅完整 diff 并记录未完成的真实宿主验证。（真实 Codex 候选写入已验证；子 Agent 模型可见性因两次宿主试跑均未形成完整链路，PR 中单独披露。）
