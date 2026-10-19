## ADDED Requirements

### Requirement: Store target freshness uses committed identity

Store-only semantic query SHALL 从一致 canonical snapshot 建立内容寻址 target，并在结果返回前通过轻量、已对账的 Store 提交身份确认语料仍有效。系统 MUST 不仅为确认语料未变化再次读取并验证完整 Practice corpus。实际 effective corpus 改变时 MUST 沿用 current target 的重取、pending 或忙碌语义，MUST 不返回混合结果。generation 或来源变化但 effective corpus 未变时 SHALL 保留既有语义索引复用能力。

#### Scenario: Unchanged Store completes a semantic query

- **WHEN** 所选方法的 complete artifact 可用，且查询期间 Store effective corpus 未改变
- **THEN** 系统 SHALL 返回该方法的 complete 结果，收尾检查 MUST 不重新物化完整 corpus

#### Scenario: Store changes during query

- **WHEN** 查询期间 active Store 的 effectiveRevision 改变
- **THEN** 系统 MUST 不把旧 target 当成 current，且 SHALL 沿用重取 target 或可观察 pending/忙碌的既有行为

#### Scenario: Direct project edit is still detected

- **WHEN** ProjectContext 局部来源在查询期间被编辑器修改，但 Store revision 不变
- **THEN** 系统 MUST 继续发现项目来源变化，不得使用 Store-only 版本检查跳过项目重新解析或 winner 更新

### Requirement: Trusted internal query data is not revalidated at every forwarding step

查询 SHALL 在外部输入、native response 和索引发布边界验证所属契约；已验证的同进程数据在内部转发时 MUST 不重复进行完整 canonical 摘要或向量数值质量扫描。正常输出字段、coverage、所选 retrievalMethod、top-k 和排名语义 MUST 保持，keyword MUST 继续离线且不接入 Backend。

#### Scenario: Both semantic methods keep their results

- **WHEN** 同一已准备语料分别使用 single-vector 与 multi-view-vector 执行相同查询
- **THEN** 减少重复校验 MUST 不改变每种方法自身的 query views、评分规则、Profile 隔离、结果排序和 coverage 解释
