## Why

基于 main `b9f172f` 的审计确认：日志重复规范化和记录、配置文档重复读取、同次合并重复 canonicalize、runtime record 重复序列化，以及构建和博客消费端重复验证。消除这些职责重叠，不靠新增校验缓存、有效性标记或后台机制换取表面性能。

## What Changes

- 落实根 AGENTS.md 的验证所有权规则；只实施已证明上游保证成立、可保持正常命令与恢复语义的简化。
- 日志仅在事件进入规范记录时转换；sink 消费规范记录，保留脱敏、大小限制、私有位置、队列和失败隔离。普通 CLI 生命周期不再由两套 API 重复记录；trace collection 单次读文件、保留两个独立有界窗口。
- 同一次 CLI 调用复用按需读取的配置文档，logging/query/method 各自验证其 section；保留错误映射、keyword 独立性和 debug 无需读取配置的路径。
- 合并函数内已验证的 source 不再在组装结果时重复 canonicalize；保留模型入口与 SQLite 提交/恢复检查。收敛配置复制/冻结及无效分支。
- runtime record 写入仅序列化一次；native release 消费构建生产者已验证的 manifest，不重复哈希同一 source；保留最终 staging/发行物审计。博客只投影已由 collection 验证的 frontmatter。
- 正常 CLI 参数、完整 JSON、text、排名、退出码与错误优先级不变。明确的可见变化是生命周期日志去重，以及配置在单次调用内采用同一读取快照。
- 待用户决定、不在本轮实施：HTTP 两端响应 schema 的责任迁移、CLI 全局 JSON 拒绝规则变化、client 预检和 keyword 错误时点变化、SQLite writer 取消入口审计、配置祖先链接规则、日志私有性/同步/留存策略。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `diagnostic-logging`：普通命令阶段只保留一份生命周期证据；trace 读取保持 direct/shared 的窗口、缺失与隔离语义。
- `retrieval-query`：同次 CLI 调用的 query 与方法配置使用同一文档快照，不改变 section 验证、优先级与 keyword 离线边界。

其余项目为既有契约内实现重构，不虚构新 capability。

## Impact

涉及 packages/log、config、cli、engine，Backend embedding/runtime 与 native release tooling，以及站点博客 source adapter。无依赖新增、CLI/config 字段或磁盘 schema 迁移，不修改发布 workflow。产品流程及兼容差异在 product.md，代码责任与完整待决清单在 design.md；任务与实际验证记录在 tasks.md。
