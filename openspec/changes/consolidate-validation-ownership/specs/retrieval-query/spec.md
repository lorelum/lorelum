## ADDED Requirements

### Requirement: CLI query settings share an invocation document snapshot

单次 CLI 调用的 logging、query 控制项与所需的 semantic method 设置 SHALL 在需要读取配置时使用同一配置文档快照。不同消费者 MUST 仅验证自己使用的 section；显式参数优先级、无效输入在 Backend 连接前失败、keyword 离线及既有配置错误语义 MUST 保持。配置在该次读取之后发生的修改 SHALL 从下一次 CLI 调用生效，不得使一个调用混用两个配置版本。

#### Scenario: Query controls and method use the same file version

- **WHEN** semantic query 需要 query 控制项及配置中的 retrieval method，且文件在两者消费之间被修改
- **THEN** 本次调用 MUST 使用同一已读取文档中的值，下一次调用 SHALL 读取新文档；显式 option SHALL 继续覆盖本次设置

#### Scenario: Keyword ignores unrelated method errors

- **WHEN** 显式 keyword query 的所需控制项有效，而 semantic method section 非法
- **THEN** keyword SHALL 保持原离线行为，MUST 不因未使用的 method 配置失败，也不得连接 Backend 或加载模型

#### Scenario: Invalid CLI input keeps its error precedence

- **WHEN** query 文本或显式 option 非法，同时配置文件可能不可读或无效
- **THEN** 调用 MUST 保留既有 usage error，MUST 不为共享配置读取而提前连接 Backend 或改变无效输入的优先级
