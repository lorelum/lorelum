## ADDED Requirements

### Requirement: Terminal operation failures retain a stable public classification

daemon-owned semantic operation 进入 `failed` 终态时，Backend MUST 持久化并通过 `lore index operation <id>` 返回允许公开的稳定错误码。模型准备或 embedding 失败 MUST 保留原始 `embedding.*` code；Store busy/recovery failure MUST 保留既有 Store code；其他未分类失败 MUST 返回 `backend.failed`。终态 failure MUST 不被重新表示为 `waiting-for-source`、`queued`、`preparing` 或 `building`，不得泄露异常文本、绝对路径、模型下载来源、Practice 内容、凭据或 runtime identity。失败不得把未完成 artifact 标为 ready，且此前 ready artifact 的保留语义不变。

#### Scenario: Operation lookup exposes model preparation failure

- **WHEN** 一个已接受 operation 因 `embedding.resource-invalid` 进入 `failed`
- **THEN** `lore index operation <id>` MUST 返回该 operation 的 `failed` 状态与 `error: "embedding.resource-invalid"`，调用 CLI MUST 以 error envelope 和 exit code `2` 表示该终态

#### Scenario: Legacy failure record remains safely recoverable

- **WHEN** Backend 读取一个未记录公开错误码的既有 `failed` operation record
- **THEN** Backend MUST 将其作为 `backend.failed` 返回，而不得把它重新当作 pending work 或拒绝读取整个 journal
