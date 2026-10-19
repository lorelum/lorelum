## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Preparation owns resource verification

模型准备 SHALL 在进程启动前完成必要 native/model 验证，并把同一次准备结果交给 runtime。模型 ready 后的正常业务编码 MUST 不巡检 executable、模型、许可证或 notices 的磁盘文件属性。系统 SHALL 通过真实 readiness、受控端点和进程生命周期观察模型是否可用；不承诺在每次编码时发现绕过产品修改本地文件的行为。

#### Scenario: Resident model encodes several texts

- **WHEN** 已 ready 的模型连续编码多个 query 或 document 文本
- **THEN** 编码 MUST 不对 native/model 文件执行前后完整性巡检，且 MUST 保持现有维度、错误、超时、取消和进程退出语义

#### Scenario: Preparation fails before runtime creation

- **WHEN** 模型准备被取消或固定大小/digest 校验失败
- **THEN** 系统 MUST 不启动依赖该失败结果的模型进程，且 MUST 保留既有进度、模型专用错误和 partial 保留规则
