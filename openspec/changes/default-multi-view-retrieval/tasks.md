## 1. 默认切换与行为覆盖

- [x] 1.1 将 Engine 唯一默认改为 multi-view-vector，更新 CLI/Backend 的配置缺失与显式覆盖行为测试、native query/install/ProjectContext 场景；通过相关单测、类型和 lint 检查。
- [x] 1.2 更新中英文用户文档和维护者 API/configuration，保留 single 配置恢复路径并说明首次索引；通过文档链接与 OpenSpec 验证后同步 current specs。

## 2. 实际使用路径与交付

- [x] 2.1 在隔离 HOME/Store/cache/Backend 中运行真实 native query、install、方法切换与增量索引场景，并对真实 Pack 完成无显式方法的安装和 query；记录方法、覆盖、索引复用与未覆盖环境。
- [ ] 2.2 检查待提交文件、完整 diff 与敏感内容，提交并推送到现有分支，更新 PR 的默认行为、兼容性和验证说明并读回确认；不宣称已发布或更新全局安装。
