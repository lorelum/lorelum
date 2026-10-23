## Purpose

让用户和开发者能够识别当前 CLI 与运行中 Backend 的实际构建，区分协议兼容与精确代码一致性；保留机器可比较的原始身份，同时在没有 Git 或旧实例缺少元数据时诚实展示未知信息，不靠私有路径或构建目录名猜测来源。

## ADDED Requirements

### Requirement: CLI version exposes comparable local build information
`lore --version` SHALL 保留包版本并显示本 CLI 精确 buildIdentity、source/compiled 来源、Git revision 与 dirty 的已知状态，以及分别命名的 CLI envelope protocol 和 Backend 内部 protocol。`--version --json` MUST 沿用现有完整 envelope；data 中的 `protocolVersion` 保持 CLI 协议含义，新增 `backendProtocolVersion`，并提供完整 buildIdentity、toolVersion、revision、dirty 和 buildKind。revision/dirty 无法可靠确定时 MUST 为 null，文本 MUST 明示 unknown。version MUST 不连接 Backend、不打开 Store、不加载模型。

#### Scenario: A copied compiled executable reports its original build
- **WHEN** 编译 CLI 被复制到没有 Git checkout 的目录后运行 version
- **THEN** 它 MUST 显示编译时的构建信息和相同精确 buildIdentity，不从运行目录重新采集或猜测 revision

#### Scenario: Rebuilding one commit produces distinguishable builds
- **WHEN** 同一个 commit 被重新编译，用户比较两份 version JSON
- **THEN** 两份输出 SHALL 保留相同已知 revision 和各自的精确 buildIdentity，不以 commit 相同声称它们是同一 executable build

#### Scenario: Git provenance is unavailable
- **WHEN** source 或编译构建无法可靠取得 Git 元数据
- **THEN** version MUST 仍可显示包版本、精确 buildIdentity 和 buildKind，相关 Git 字段 MUST 为 null，不错误标记 clean

### Requirement: Backend status compares both sides without mutating runtime
运行中且内部协议兼容时，`lore backend status` SHALL 保留 state/model/instanceId/buildIdentity，并提供远端 `build` provenance、`backendProtocolVersion`、当前 `cli` 构建信息、`sameBuild` 与 `protocolCompatible`。默认文本 MUST 直接展示双方可读版本、revision/dirty 或 unknown、短 build ID 和协议对比，完整 JSON MUST 保留完整 ID/revision。不同 build 但同协议 MUST 正常返回。

无服务时 status MUST 返回 stopped/unloaded 与本 CLI 信息，不伪造远端身份或比较结果。不同协议时 MUST 使用 backend-runtime 定义的可操作错误，展示已认证远端信息；旧实例缺失 toolVersion/provenance 时 MUST 明示 unknown。status MUST 不启动、停止、加载或扫描模型，不读取变化后的 checkout 来推断远端代码。

#### Scenario: Compatible different builds remain observable
- **WHEN** CLI B 对兼容的 Backend A 执行 status
- **THEN** 命令 MUST 成功，sameBuild MUST 为 false、protocolCompatible MUST 为 true，并展示 A/B 各自身份；A 的 PID、instance 和模型状态 MUST 不因状态读取改变

#### Scenario: Backend is stopped
- **WHEN** status 确认无运行实例
- **THEN** 命令 MUST 保持只读并显示 stopped/unloaded 和 cli 信息，MUST 不提供虚构的远端 build、protocol 或 sameBuild

### Requirement: Backend provenance is an immutable authenticated startup observation
Backend 的可读构建信息 SHALL 表达其启动时所运行代码的快照，只经认证的兼容 status 提供；它 MUST 不随源码目录修改而改变，不反向使用调用方 CLI 版本作为自身版本。buildIdentity MUST 保持精确身份含义，provenance MUST 不替代运行时认证、release checksum 或 native 完整性校验。用户输出 MUST 不包含 checkout 绝对路径、runtime secret、私有服务地址、host 标签或 Git remote。

#### Scenario: Source changes after the daemon starts
- **WHEN** source Backend 启动后，其原 worktree 发生代码或 Git 状态变化
- **THEN** 运行中 Backend 的 provenance MUST 保持启动快照；新 CLI 可显示新身份，但 MUST 不把它覆盖到旧 Backend 上

#### Scenario: An older protocol has no provenance
- **WHEN** 新 CLI 能核验旧 Backend 身份与归属，但该协议不提供可读构建信息
- **THEN** 输出 MUST 保留实际远端协议和 buildIdentity，版本标为 unknown，不发送不兼容业务请求、不读取磁盘路径或猜测其 host/commit
