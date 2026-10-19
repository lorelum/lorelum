# local-model-runtime Specification

## Purpose
为 semantic retrieval 提供一个用户级、固定身份且可观察的本地模型 runtime，使模型下载、验证、加载和取消不会与 Store 数据边界混淆，也不会泄露 Practice 或 query 内容。

## Requirements

### Requirement: User-level fixed model runtime
模型配置、缓存、下载和 Backend runtime SHALL 属于用户级资源；不同 `--store-root` MUST 共享同一固定模型/runtime，而 Store 内容和 index MUST 保持隔离。semantic query、非空 Store 的 index build/rebuild 与 install-driven index MAY 按需启动 Backend 并开始或加入同一模型准备；keyword query、`lore index status`、`lore model status` 和 `lore backend start` MUST 不触发下载或构建。`lore model load` SHALL 保留显式等待和重试入口。

#### Scenario: Store override does not select a model
- **WHEN** 调用方使用两个不同的 `--store-root` 执行需要 embedding 的操作
- **THEN** 操作 MUST 使用同一用户级固定模型配置和 runtime，而每个 Store 的 index 仍独立

#### Scenario: Status is read-only
- **WHEN** 调用方执行 `lore model status`
- **THEN** 命令 SHALL 返回当前模型状态，且 MUST 不自行开始下载、加载或编码

### Requirement: Shared preparation and bounded observation
Backend MUST 合并同一 daemon 中并发的模型准备请求，并持有准备任务直到成功、失败或显式取消。query、index 或 install 的前台调用只可短暂观察该任务；调用方停止观察或断开 MUST 不取消已接受的共享准备。准备尚未完成时，调用方 MUST 获得可机读 pending/preparing 状态，而不得把模型报告为 ready。

#### Scenario: Concurrent callers share preparation
- **WHEN** 多个 semantic 操作在模型缺失时同时请求准备
- **THEN** Backend MUST 只执行一个共享准备任务，并向每个调用方返回该任务的可观察状态

#### Scenario: Observer cancellation leaves preparation alive
- **WHEN** CLI 在模型准备期间超时、取消或退出
- **THEN** 已接受的准备任务 MUST 继续由 daemon 持有，直到它完成、失败或收到显式 unload/stop

### Requirement: Fixed artifact integrity and explicit configuration
系统 MUST 只使用固定模型身份对应的本地 artifact。配置了绝对 modelPath 时，系统 MUST 验证该文件，且不得偷偷选择替代文件或下载。每次模型准备 SHALL 对所选缓存/显式模型执行一次预期大小和完整 digest 验证；下载 MUST 使用私有临时文件、支持保留中断的 partial 数据，并仅在验证通过后原子提升为 active artifact。加载 SHALL 消费本次已验证准备结果，不因原子改名重复扫描模型。禁用下载或没有配置下载来源时，模型准备 MUST 明确失败且不得创建无效缓存或发起网络传输。

#### Scenario: Interrupted download resumes safely
- **WHEN** 固定 artifact 的 partial 文件在上次传输后仍保留
- **THEN** 后续准备 SHALL 继续符合传输合同的 partial 数据，并 MUST 在 digest 验证成功后才将其提升为可用模型

#### Scenario: Disabled download is explicit
- **WHEN** 固定模型不在有效 modelPath 或有效缓存中，且 download 被禁用
- **THEN** 模型准备 MUST 返回配置错误，且 MUST 不访问网络

#### Scenario: Verified download proceeds directly to load
- **WHEN** partial 已通过固定大小和 digest 校验，并已原子提升为正式模型
- **THEN** 本次加载 MUST 使用该准备结果，MUST 不因路径改变执行第二次完整模型 digest 扫描

#### Scenario: Readable local model uses a link
- **WHEN** 显式模型或缓存模型通过正常 symlink/hardlink 提供，且可读普通文件内容符合固定模型大小和 digest
- **THEN** 准备 SHALL 接受该模型，不把公开模型按 runtime credential 的私有 mode、owner 或单 hardlink 限制拒绝

### Requirement: Preparation owns resource verification
模型准备 SHALL 在进程启动前完成必要 native/model 验证，并把同一次准备结果交给 runtime。模型 ready 后的正常业务编码 MUST 不巡检 executable、模型、许可证或 notices 的磁盘文件属性。系统 SHALL 通过真实 readiness、受控端点和进程生命周期观察模型是否可用；不承诺在每次编码时发现绕过产品修改本地文件的行为。

#### Scenario: Resident model encodes several texts
- **WHEN** 已 ready 的模型连续编码多个 query 或 document 文本
- **THEN** 编码 MUST 不对 native/model 文件执行前后完整性巡检，且 MUST 保持现有维度、错误、超时、取消和进程退出语义

#### Scenario: Preparation fails before runtime creation
- **WHEN** 模型准备被取消或固定大小/digest 校验失败
- **THEN** 系统 MUST 不启动依赖该失败结果的模型进程，且 MUST 保留既有进度、模型专用错误和 partial 保留规则

### Requirement: Cancellation and local-data privacy
`lore model unload` 和 Backend stop MUST 取消尚未完成的文件准备或 native startup，并在成功报告 unloaded 前等待已拥有的 runtime 和 in-flight encoding 实际退出；如果无法在 deadline 前回收资源，操作 MUST 失败而不得虚报 unloaded。模型下载 MUST 只请求固定 artifact；系统 MUST 不向远端发送 Practice 正文、query 文本、Store 数据或 index 内容。

#### Scenario: Unload races with an encoding request
- **WHEN** unload 在 native encoding 尚未结束时到达
- **THEN** unload MUST 等待请求和 runtime 回收；若超过回收 deadline，MUST 返回失败而不得报告 unloaded

#### Scenario: Semantic operation prepares locally
- **WHEN** semantic operation 因缺少固定模型而触发准备
- **THEN** 远端请求 MUST 仅包含固定 artifact 的下载数据，不得包含该 operation 的 Practice 或 query 内容

### Requirement: Resource verification failures remain distinguishable across clients
模型文件大小或 digest 校验失败 SHALL 继续返回 `embedding.resource-invalid`，native 安装资源失败 SHALL 返回 `embedding.native-resource-invalid`。Backend 的 failed 状态、显式 `model load`、语义 query 及其 CLI 错误 SHALL 保留同一受限资源信息（资源类型、逻辑文件名、检查项，适用时的预期/实际值）及相应的实际恢复动作；该信息 MUST 不含绝对路径、下载 URL、凭据或私有端口。模型文件与 native 的完整性检查 MUST 保持有效；本要求 MUST 不引入自动删除或重新下载模型缓存。

#### Scenario: Fixed model file digest mismatch
- **WHEN** 固定缓存文件或显式 `modelPath` 文件的 digest 不符合固定模型身份
- **THEN** 状态与 CLI 错误 SHALL 指明模型来源、逻辑文件、期望与实际 digest，并要求修正对应模型来源而非重装 native

#### Scenario: Native failure reaches semantic query
- **WHEN** 语义 query 因 native 安装资源缺失而无法加载模型
- **THEN** CLI 错误 SHALL 保留 native 专用 code、失败资源信息和重新安装完整构建的指引，MUST 不表现为模型缓存损坏或静默 keyword 结果
