## ADDED Requirements

### Requirement: Index and install share the multi-view default

未显式选择检索方法时，index status/build/rebuild 与 Pack 安装后的 indexSync SHALL 与普通 semantic query 一样使用 `multi-view-vector`。显式方法 MUST 继续按同一设置优先级生效；不同方法的 Profile、artifact、progress 与可复用向量 MUST 保持隔离，不得删除或冒用另一方法的既有产物。默认切换 MUST 不自动写用户配置或迁移 canonical Store。

#### Scenario: Install creates the default multi-view index
- **WHEN** 用户没有方法配置，安装一个有效非空 Pack
- **THEN** 安装 SHALL 先提交 canonical Pack，再提交该 Store 的 multi-view 索引；在首次 query 之前即可通过原 operation/status 路径观察到完成，派生索引失败 MUST 不回滚 Pack

#### Scenario: Status remains read-only after default migration
- **WHEN** 用户未配置方法，只有旧 single 索引，执行 index status
- **THEN** 命令 SHALL 只报告当前 multi target 的状态，MUST 不把 single ready 报告为默认 ready，也不得为状态查询启动模型或构建

#### Scenario: Switch back reuses compatible single work
- **WHEN** 用户显式改用 single-vector，且其兼容 artifact 或 progress 仍保留
- **THEN** index/query SHALL 使用该方法的既有工作，不重启 daemon；方法切换前接受的 operation ID SHALL 继续指向原目标
