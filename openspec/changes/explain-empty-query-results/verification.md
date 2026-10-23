# 验证记录

## 2026-10-23：基线与方案

隔离 Store 的原 CLI keyword 输出只有 `mode: keyword`、`results: []`；相关基线测试 94 项通过。方案精简为产品输出、事实来源、字段和必要验收，不再重验未修改的整个模型生命周期。

## 实施验证

- Engine：354 pass、1 skip；Backend：277 pass、2 skip；CLI：614 pass、4 skip。Backend 两处无关循环恢复原样后，client/controller 定向测试 41/41 通过；CLI 最后定向测试 59/59 通过。
- Plugin：142 pass；改动文档相对链接检查通过。
- Engine、Backend、CLI、site typecheck 通过；修改的 TypeScript 格式检查、`git diff --check`、OpenSpec 严格校验通过。`bun run lint` exit 0，保留既有的 `no-await-in-loop` warnings，未因本任务改写无关代码。
- Sol medium 独立只读 CR 未发现阻塞问题；核对事实来源、ready/pending 边界、schema/text 一致性和测试范围，未将审查代替测试执行。
- `bun packages/cli/integration/process.integration.ts` exit 0：实际编译并运行 CLI，覆盖 keyword miss、空 Store、default/verbose/JSON 和非空 query/get。
- `bun run build:native` 从匹配缓存生成 darwin-arm64 candidate；现有 native smoke runner 的 `empty-query` 场景通过。隔离 CLI、认证 HTTP Backend 和真实 Engine 对空 Store、忽略坏来源后的空 ProjectContext 均返回 `corpus-empty`；`nativeBatchSizes: []`、document batches 和 download requests 均为零。按空语料契约无需加载模型，不将此结果说成模型加载或推理验收。

## 默认 Backend 的验证边界

通过本 worktree 的源 CLI、隔离 Store/cache 和原用户配置执行 semantic query，返回 `backend.build-mismatch`。按其错误指引读取该次 trace，并运行 `backend stop --if-idle`，得到 `deferred / active-long-task`；未停止实例、未重启、未后台重试。因此默认用户 daemon 的该次 ready 输出未验证，上述隔离真实 HTTP 链路验证不替代这一边界说明。

## 新增检查审查

Sol medium 按 `agentic-coding.implementation.justify-added-checks` 独立审查，无阻塞发现。空 corpus 分类只读取查询边界已有的完整数组，沿用 snapshot/freshness 保证；warm Store 保持通用原因，不补扫全库。CLI 条件只选择说明内容，schema 只扩展本次字段，没有重复业务校验、新增拒绝路径或服务就绪门槛；既有认证、身份和一致性保护保持不变。无需为此次只读审查重跑全套测试。

## 撤回重复指导

下一步建议由空查询响应自身承载，撤回七份 Skill、对应指导 fixture 和 agent-integration delta 中的重复要求；七份 Skill 及 fixture 与变更前逐字一致，CLI 实现与测试不变。OpenSpec 严格校验和 diff 检查再次通过；Sol 定向只读复核无阻塞发现，不重跑未变的 runtime 测试。
