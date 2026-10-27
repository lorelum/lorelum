## 1. 规格与公共恢复

- [x] 1.1 修订 proposal/product/design/spec，按已核实四宿主范围、矩阵图例、重复事件与 omp 后台提交语义定义交付；用户明确 Codex/omp 实机、其他 host 测试。验收：规划产物一致并通过严格校验。
- [x] 1.2 扩展 CatalogReader 可选预算，实现公共 Catalog/候选组合与中性 renderer 文案；回归测试覆盖总预算、完整条目、无候选和候选故障保留 Catalog。
- [x] 1.3 迁移 Claude Code、Codex、WorkBuddy 的有效 compact SessionStart；测试 startup/resume/clear/fork 不新增候选、身份正确、原更新通知和权限不变；ZCode/Cursor 不增加虚构恢复入口。

## 2. omp 生命周期

- [x] 2.1 实现 Main compact 后的实际会话候选目标，复用原 bridge、并行读取、快照、generation 与取消；保持子 Agent 的源头 Main 来源和配置独立性。
- [x] 2.2 回归测试前台/后台提交时序、旧读取晚到、连续并发 context、重复 compact、会话切换/关闭、startup/resume 不重复发送和其他真实消息保留。

## 3. 验证

- [x] 3.1 运行受影响 CLI Hook/候选、omp、Plugin 测试及相应类型检查；维护确定性的行为覆盖，不以固定文案/源码字符串断言代替行为。Claude Code/WorkBuddy 不要求实机 smoke。
- [x] 3.2 用目标 worktree CLI 与正常 Codex 配置走实际成功 get、compact、继续模型请求，观察候选恢复及 startup/resume 不额外恢复；记录版本、命令、结果和未覆盖项。
- [x] 3.3 用实际 omp 宿主走成功 get、compact、继续请求，覆盖后台提交与重复消息/晚到隔离；记录版本、观察结果，不以模拟回调冒充实机。

## 4. 文档与交付

- [x] 4.1 转置英中功能表为 host 列/功能行，标明 ✓/△/✗/-，覆盖现有真实功能；更新六个 host 英中指南、Plugin README 与相关维护者 Hook 文档，明确部分/缺失功能与恢复路径；root README 只保留导航与必要概述。
- [x] 4.2 检查实际站点表格的两种语言与窄屏阅读、变更链接和文档构建；同步受影响当前规格并严格校验 OpenSpec。记录有效验证，不自动 commit/push/发布。

验证命令、真实宿主观察、覆盖边界与环境恢复见 [verification.md](./verification.md)。
