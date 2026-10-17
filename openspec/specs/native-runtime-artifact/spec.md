# native-runtime-artifact Specification

## Purpose
定义 embedding native runtime 的目标选择、可信 manifest 与 source/release 边界，使模型运行只使用可验证且与当前构建兼容的本地产物。
## Requirements

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

### Requirement: Explicit native build boundary
native candidate 的构建 MUST 是显式 build/release workflow 的结果。普通 `backend start/status/stop`、keyword query 和非 embedding CLI 操作 MUST 不隐式编译 native runtime。

#### Scenario: Keyword-only command
- **WHEN** 调用方执行 keyword query 或 Backend 控制命令
- **THEN** 命令 MUST 不触发 native artifact build

### Requirement: Opt-in parent liveness for the native runtime

embedding native runtime SHALL 仅在 spawn 环境显式提供 `LLAMA_PARENT_LIVENESS_STDIN=1` 时启用 parent-liveness 监视。启用时，该机制 MUST 在参数解析前生效，并在持有 stdin 管道写端的 owner 消失（EOF）时立即退出，以绕过无法推进的正常清理。未携带 opt-in 的调用 MUST 不基于 stdin 状态退出，其退出码与输出 MUST 反映该调用的真实结果。

#### Scenario: Direct invocation is unaffected by stdin

- **WHEN** 不携带 opt-in 环境变量直接调用 native runtime（如 `--version` 或启动 server），且 stdin 处于 EOF、无效句柄或打开管道任一状态
- **THEN** runtime MUST 正常执行该调用并产生相应输出或服务，MUST 不以 exit 0 静默退出

#### Scenario: Daemon-owned runtime exits on owner death

- **WHEN** daemon 以 opt-in 拉起 runtime 并持有 stdin 管道，owner 死亡导致 stdin EOF
- **THEN** runtime MUST 立即退出，MUST 不执行可能无法推进的正常清理

### Requirement: Missing or invalid native installation is actionable
编译版 CLI 需要模型时，系统 SHALL 在下载模型前验证相邻 target native 资源；若缺失、不完整或与编译 CLI 不匹配，MUST 返回 `embedding.native-resource-invalid`，包含受限的逻辑文件名、失败检查项和可取得时的预期/实际大小或 digest，并告知使用匹配的完整构建重新安装。MUST 不运行未验证 executable，不从 PATH、其他 target 或模型下载源补齐 native 资源。

#### Scenario: CLI executable without its native directory
- **WHEN** compiled CLI 目录只有 `lore` 而缺少 `native/<target>/manifest.json`
- **THEN** 模型加载 SHALL 在下载模型前失败，错误 SHALL 指明 native manifest 缺失并建议安装完整目录；现有模型缓存 MUST 不受影响

#### Scenario: Native file differs from trusted manifest
- **WHEN** native 文件的大小或 SHA-256 与匹配的 manifest 不符
- **THEN** 系统 SHALL 指明目标文件、检查项及可取得的预期和实际值并拒绝启动该文件
