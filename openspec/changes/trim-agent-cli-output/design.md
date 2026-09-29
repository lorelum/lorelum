## Context

`packages/cli/src/output/render.ts` 对普通成功响应直接以 `renderStructuredText(data)` 渲染所有字段，JSON 则把同一 data 包入稳定 envelope。list/query/get 的 schema 分别在 `packages/cli/src/list/list-command.ts`、`query/result-schema.ts`、`get/result-schema.ts`；这些是现有完整 JSON 合同。`packages/cli/src/hook/pack-catalog.ts` 独立渲染有界 SessionStart Catalog，当前把每个 root 当作截断时必须保留的内容。

Store `get` 从 `getEffectivePracticeWithPackRoots()` 返回每个 source 的已验证当前 locator；`plugins/codex/lorelum/skills/lorelum/SKILL.md` 规定 `resource:` 目标相对于选中 source 的 root 解析。现有测试 `packages/cli/src/get/store.integration.test.ts` 覆盖多 source 和 root 变更后的资源读取。ProjectContext 的 `project-layer-N` 是逻辑 provenance，见 `packages/cli/src/get/get-command.ts`，不是可读路径。`docs/cli/{list,query,get}.md` 描述现行完整 text；`openspec/specs/retrieval-query/spec.md` 的“默认 JSON”一句与现行 renderer/CLI 文档不一致，本 change 的 delta 对齐该处，不改变查询执行语义。

## Goals / Non-Goals

**Goals:** 用可复用的纯 text 投影替代三个命令的默认全字段树，仍让 JSON 与 verbose text 完整；让资源定位只在选中 Pack 或已读取 Practice 时出现，不让所有 Pack 的绝对路径常驻每轮 Hook 上下文；不增加普通 query→get 的补查。

**Non-Goals:** 不改变 Engine/Backend、Pack 格式、canonical digest、JSON 字段、资源读写授权或 ProjectContext 的本地资源 locator 合同；不宣称尚未测出的 token/选择正确率收益，也不把 `--details` 重定义为通用展开参数。

## Decisions

### CLI 只投影 text，不改 result data

三个命令各自声明 `--verbose` 布尔 flag；它只选择 text 视图，`--json` 始终完整。命令 handler 仍返回原 data，另外可返回一次调用的纯 `textRenderer`。`create-program` 在成功响应处优先采用该 renderer；`--verbose` 则使用原 `renderStructuredText(data)`。共享 renderer 不更改其他命令。新增 `CommandResult.textRenderer?: TextRenderer` 是 CLI 内部选展示形态的最小交接点，不把展示规则放进 Engine 或 JSON schema。

形状示意（仅表明交接，省略错误处理）：

```ts
interface CommandResult<T extends JsonValue> {
  data: T;
  textRenderer?: TextRenderer;
}

// handler 保持真实完整数据；renderer 只负责默认 text 的投影。
return { data, ...(verbose ? {} : { textRenderer: renderQueryDecisionText }) };
```

各 renderer 复用结构化 text helper 格式化筛选后的普通对象，不复制协议序列化或字符串转义。list 按三个现有模式分别投影；query 区分 ready/partial/degraded/pending，severity 默认 `warn` 隐去；get 保留全文与反模式正文，省去仅供机器身份识别的元数据。错误仍由现有 renderer 处理，trace ID 和 recovery 不减。`--verbose` 与 `--json` 同时出现时 JSON 优先，verbose 不改变 JSON。

不选择“从 data 删除字段”：会破坏公开 JSON 与 read hint 的 digest。也不在共享 renderer 全局裁剪，因为其他命令需要完整 text，且字段意义取决于调用阶段。

### root 在按需读取阶段始终完整，不按正文内容猜测

SessionStart Hook 只渲染 Pack 名称、可选描述与非空 appliesTo；删版本/root 后的截断优先保留完整条目的名称，描述/范围放不下时可保留名称，并保留“还有 Pack 未展示”的提示。普通检索先 query 后 get；`get` 默认 text **逐 source 原样保留** `packName`、`sourcePath`、`packRoot`，即使没有 `resource:` 链接也不作条件省略。明确选择 `pack list <name>` 时仍显示可读 root。这样 Store 资源目标可在获取正文的同一次调用中解析，多来源不会默选第一条，Pack 作者也可以显式浏览；root 不需要每个会话为所有 Pack 预付 token。

不选择 `body.includes('resource:')` 决定是否显示 root：代码块和普通文本会误判，且在默认读取路径增加不必要的内容检测。也不选择完全隐藏 get root 再补一次 `pack list`：它增加资源调用并可能跨命令观察到另一个 Pack 当前版本。ProjectContext source 在 text 中标示其 root 为逻辑 provenance，避免把 `project-layer-N` 拼成文件路径；本变更不发明项目资源地址。

### 宿主 Skill 与可见结果一致

更新 Codex、ZCode、Cursor、WorkBuddy 的同构 Skill 描述：Catalog 不再承诺 root；已选 Practice 的 `resource:` 从 get 的对应 Store source root 解析；显式 Pack 浏览才调 `pack list <name>`；ProjectContext 逻辑层不是目录。Hook 继续 metadata-only，无自动 query/get。与 Hook 输出相关的快照和截断测试同时更新。

## Risks / Trade-offs

- [Hook 不再含 root，显式 Pack 浏览多一次 list] → 此场景主动选择 Pack，CLI 已有 `pack list <name>`；普通 query→get 不增加调用。对比基线测可发现是否有实际回归。
- [默认 text 是公开行为变更] → 完整 JSON 与 `--verbose` 保留原 data，更新中英文用户指导与 CLI 合同，回归空/partial/degraded/pending/error 与直接 get。
- [精简结果让 Agent 错过有用字段] → 以 Issue #231 的相似候选、截断 Catalog、资源多来源场景比较选择、补查、token；若某字段带来净损失，调整 text 投影，不改 canonical data。
- [ProjectContext resource 链接无法靠逻辑 root 打开] → 明示现有边界并测试不误认文件路径；需要本地项目资源读取时另定独立合同。

## Migration Plan

先加默认与 verbose/JSON 的对照测试和资源路径场景，再修改 CLI 与 Hook/Skill，更新 CLI 和对应英文/中文站点页。可通过 `--verbose` 临时获得完整旧 text；代码回退只需撤销 text 投影和 Hook 视图，不涉及 Store 迁移。OpenSpec delta 保留在 change 中，待实现与验证完成后按仓库流程评审/同步，不把方案当作已生效合同。
