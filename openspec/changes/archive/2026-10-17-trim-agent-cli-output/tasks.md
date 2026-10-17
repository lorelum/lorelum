## 1. CLI 输出视图

- [x] 1.1 为 list/query/get 加每次调用可选的 text renderer 与 `--verbose`，验证默认、verbose、JSON 的数据与退出码测试均通过。
- [x] 1.2 实现三种 `pack list` 的默认 text 投影，验证空列表、富元数据、具名 Pack root、`--details` 互斥和完整 verbose/JSON 的测试通过。
- [x] 1.3 实现 query 默认 text 投影，验证 ready/keyword/partial/degraded/preparing/indexing 的字段与状态、完整 verbose/JSON 的测试通过。
- [x] 1.4 实现 get 默认 text 投影，验证完整 body、anti-pattern、多来源 source/root 与 ProjectContext 逻辑来源、完整 verbose/JSON 的测试通过。

## 2. Hook 与宿主

- [x] 2.1 从有界 SessionStart Catalog 移除常驻版本与 root，验证所有宿主 Hook 的输出、截断提示和预算测试通过。
- [x] 2.2 更新四个宿主 Skill 的 root 使用说明，验证普通 query→get、显式 Pack 浏览及多来源资源指引与新可见输出一致。

## 3. 文档与端到端验证

- [x] 3.1 更新 CLI 合同和对应英文/中文站点页，验证 `--verbose`、`--json`、资源定位和 ProjectContext 边界没有互相矛盾的说明或失效链接。
- [x] 3.2 在隔离 Store 的源码路径验证真实 Store `resource:` 链接可从默认 get 对应 root 读取，比较变更前后代表性 Catalog/query/get 文本长度与额外调用数，并运行 focused tests、CLI 包测试、typecheck、lint、OpenSpec strict validation；记录实际通过项和未覆盖的 Agent 选择效果。
