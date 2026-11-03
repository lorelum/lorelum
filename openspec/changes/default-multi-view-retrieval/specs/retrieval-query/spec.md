## ADDED Requirements

### Requirement: Multi-view semantic method is the default

未通过用户配置或本次请求显式选择检索方法时，semantic query SHALL 使用 `multi-view-vector`。空配置、空 query section 或省略 `retrievalMethod` SHALL 选择同一默认。显式 `query.retrievalMethod: single-vector` 和请求选择 MUST 保持有效；CLI 的单次方法 mode MUST 只覆盖该次 query，不写回配置或改变后续 index/install。Backend HTTP 请求省略方法时 SHALL 使用多视图默认，不读取 CLI YAML。keyword SHALL 保持离线并忽略未使用的 semantic 方法设置。

#### Scenario: Ordinary query without configuration
- **WHEN** 用户没有设置检索方法，执行有效普通 semantic query
- **THEN** query SHALL 使用已有 multi-view 文档与 query 投影及评分规则；CLI semantic JSON/verbose data MUST 报告 `retrievalMethod: multi-view-vector`

#### Scenario: Explicit single-vector remains selected
- **WHEN** 用户配置为 single-vector，或对一次 query 显式选择 single-vector
- **THEN** query SHALL 使用既有 single 方法；临时覆盖 MUST 不改变配置，下一次普通 query SHALL 恢复配置或默认的方法

#### Scenario: Omitted HTTP method
- **WHEN** HTTP semantic query 省略 retrievalMethod
- **THEN** Backend SHALL 按 multi-view-vector 的 Profile 选择 target，MUST 不使用 daemon 外部的 CLI 配置选择方法

#### Scenario: Existing single artifact does not masquerade as the default
- **WHEN** 未显式配置方法的用户只有兼容 single artifact，尚无当前 corpus 的 multi artifact
- **THEN** 默认 query SHALL 按原有规则准备或构建 multi target，并可返回 preparing/indexing；MUST 不删除 canonical Pack、旧 single artifact，或把旧 single 向量当作 multi ready

#### Scenario: Existing multi artifact stays reusable
- **WHEN** 当前 corpus 已有兼容 multi artifact，且调用方省略方法
- **THEN** 默认 query SHALL 复用该 artifact，不因默认切换改变 Profile 身份或重新编码文档

#### Scenario: Method visibility follows the default
- **WHEN** CLI 渲染 semantic query 的 ready 或 pending 结果
- **THEN** 精简 text SHALL 省略默认 multi 方法名并显示非默认 single 方法，verbose/JSON SHALL 保留实际方法字段，既有 coverage、pending 和错误语义 MUST 不变
