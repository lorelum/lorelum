## MODIFIED Requirements

### Requirement: Target-specific trusted native runtime
运行时 SHALL 仅从受支持 target catalog 选择 native artifact，并 MUST 验证 artifact manifest 与当前 CLI/runtime 的身份和完整性。每个 target manifest 的 executable MUST 是 Lorelum 的 `lore-model` 角色文件（Windows target 为 `lore-model.exe`）；该名称表达 native model runtime，而不绑定当前 embedding 用途。运行时 MUST 不从 PATH、任意环境变量、Store、模型 config 或其他 target 回退选择 native executable。

#### Scenario: Missing or incompatible native artifact
- **WHEN** 当前 target 没有受支持 artifact、其 manifest 与当前运行时不兼容，或 manifest 未锚定该 target 的 `lore-model` executable
- **THEN** semantic/native operation MUST 明确失败，而不得执行不同 target、未验证 executable 或上游名称的备用 executable

### Requirement: Source and release artifact separation
源码开发 MAY 使用 worktree-local 的开发 candidate；发布安装 MUST 使用紧邻 compiled CLI 的 target artifact。source candidate 的可信度 SHALL 由目标 recipe 与构建身份验证，release artifact MUST 与 embedded manifest 精确匹配；开发验证 MUST 不把 candidate 自动当作可发布产物。

#### Scenario: Compiled CLI starts embedding runtime
- **WHEN** 已安装的 compiled CLI 启动 embedding runtime
- **THEN** 它 MUST 解析其发布包内的 matching target `lore-model` artifact，并验证 manifest 后才启动
