## Context

参见 [proposal.md](../proposal.md)。当前普通 CLI 调用在 `main.ts` 创建 trace 并传给 `renderResult`；JSON failure envelope 会保留 `diagnostics.traceId`，但 `render.ts` 的 text failure 只渲染 `error` 对象。因此原始 text failure 虽已写入本机日志，却没有可供用户或 Agent 复制的关联 ID。`apps/site/content/docs/agents.mdx` 当前建议异常后用 `--json` 重跑，`troubleshooting.mdx` 当前直接指向 GitHub Issue，二者都没有原始 trace 的日志路径。

现有 generic、Codex 与 ZCode Skill 已有“任务结束后、经用户同意才生成本地反馈草稿”的规则；Cursor 与 WorkBuddy Skill 尚未包含它。最新 WorkBuddy Hook 已通过与其他 Hook 相同的 `runHostHook` 边界接入本机日志，但其 stdout 仍是宿主 raw envelope。现有实现和测试分别位于 `packages/cli/src/output/render.ts`、`packages/cli/src/main.ts`、`packages/cli/src/hook/host-hook.ts` 及其相邻测试。

## Goals / Non-Goals

**Goals:**

- 让用户能从同一次 text failure 直接取得日志关联 ID，而不是要求重现。
- 将 Agent 的“可继续任务时延后反馈”和“任务被阻塞时的最小诊断”明确分开。
- 使 generic、Codex、ZCode、Cursor、WorkBuddy Skill 采用同一诊断与反馈边界。
- 提供面向用户的、双语且可执行的排障教程，不要求阅读 JSONL 或维护者文档。

**Non-Goals:**

- 不让 text 输出成为机器协议，也不改变 JSON envelope、退出码、error code 或 raw Host Hook ABI。
- 不新增 telemetry、网络上传、自动 Issue、自动重启 Backend/model、任意目录日志扫描或本地 MCP。
- 不追溯或合并两个不同调用的 trace；新的 debug 重现只能产生新的关联链。
- 不改变 logger 对本机内容和 credential 的既有处理策略。

## Decisions

### 1. 在 text failure 的既有结构旁显示 `diagnostics.traceId`

普通失败继续写到 stderr，渲染器在结构化 `error` 之外追加只含 `traceId` 的 `diagnostics` 区块。选择结构化字段名而不是一句自由文案，使人类能一眼识别其与 JSON envelope 的对应关系，同时仍不承诺 text 排版可由脚本解析。该 ID 直接来自当前 `main.ts` 调用传入的 diagnostics，不创建第二个 ID。

备选方案是要求 `--json` 重现，或让所有 text success 也显示 trace。前者不能关联原始现场，后者会让普通成功输出承载无关排障信息；两者均不采用。raw Host Hook 命令在普通渲染器之前返回，因此保持其 stdout 不变；Hook 自身日志仍只在本机可见。

### 2. 把 Agent 恢复分成“候选反馈”和“受限诊断”两条状态

Skill 将使用以下状态机：

```text
发现 Lorelum 异常或缺口
    ├─ 主任务可继续且未请求诊断 → 仅保留候选 → 完成任务 → 最多一次反馈询问
    └─ 任务被阻塞或用户要求诊断 → 当前 trace → lore logs --trace-id → 解释事实/缺口
                                                          └─ 需要重现且已授权 → 最小 --debug 调用 → 新 trace
```

“当前 trace”是严格边界：只使用触发问题的 text/JSON output 提供的 ID，不读取邻近调用或全局目录。日志先于 runtime/model/index/status 预检，避免把排障扩展为无关状态扫描。debug 重现只在用户明确请求，或原任务授权已明确包括安全最小重现时执行；其产生新 trace，不能反向证明旧调用。

备选方案是每次候选都自动收集日志，或完全禁止 Agent 读日志。前者会打断长任务并扩大收集范围；后者无法完成用户明确要求的本机排障。该设计只在阻塞/明确诊断时允许同 trace 读取。

### 3. 将反馈授权与诊断授权保持分离

读取当前 trace 是本地诊断步骤；生成 feedback draft 需要用户明确同意；把 `info`/`debug` detail 加进草稿还需要用户明确选择 `--include-logs`。草稿生成后仅展示返回的 artifact 路径、证据类别、`externalReview` 与 `missingEvidence`，不触发网络或公开提交。

这样既不把“请帮我排查”误解释为“请把现场提交到 GitHub”，也不因为默认草稿很窄而让 Agent 无法在用户选择后带上现有 detail。

### 4. 用共享分派规则和 recovery reference 同步五份 Skill，并保留宿主差异

generic Skill、Codex、ZCode、Cursor 和 WorkBuddy 都保留等价的诊断触发条件、trace 边界与非打断式反馈时机，但 Skill 只负责分派：决定是否读取原始 trace、执行 `lore logs --trace-id`，以及禁止跨 trace 扫描和 runtime 预检。详细的 `missingEvidence` 解读、受控 debug 重现、feedback consent 与同 trace detail 选择必须放在 `references/semantic-query-recovery.md`；该 reference 同时保留既有的 semantic model/Backend/Store 恢复和渐进式 index build/rebuild → operation 跟踪路径。Catalog 可见性、命令入口、宿主名称和 raw Hook event 仍保留各自既有段落。测试分别验证每份 Skill 的最小分派规则和对应 reference 的详细恢复规则，而不是要求任一 Skill 重复完整 SOP 或要求全文字节完全相同。

### 5. 用户教程放在站点 Troubleshooting，并从现有入口链接

新增中英文“本机日志与反馈”排障章节或页面，以 text failure、JSON failure、Hook degraded、证据不足、debug 重现和本地草稿为场景。CLI reference 说明命令合同；Troubleshooting 负责流程；Agent reference 说明 Agent 如何遵守相同边界。维护者文档只增加对站点教程的交叉链接，避免复制用户操作步骤。

## Risks / Trade-offs

- [用户把 trace 当成公开身份或凭证] → 文案明确它仅关联本机调用，文档保留“不上传且非 credential”的说明。
- [脚本依赖现有 text failure 的精确字节] → CLI 已规定 text 不可解析；JSON 协议与退出码保持不变，并用 regression test 固定 JSON 与 Hook 行为。
- [Agent 因排障扩大任务范围] → Skill 要求先读当前 trace，并把其他 trace、预检和未授权重现列为禁止项。
- [宿主 Skill 再次漂移] → 增加覆盖 generic 与四个官方宿主 Skill 的内容测试；WorkBuddy 更新后同样纳入。
- [用户教程与维护者文档重复] → 用户教程只给操作顺序与可见结果，开发者接入/文件格式/内部策略仍留在维护者文档。

## Migration Plan

1. 合并实现后，普通 text failure 会立即多出 diagnostics 区块；无需迁移已有日志或配置。
2. 已安装的 Plugin/Skill 必须按各宿主更新机制更新，并在新任务中加载，才会获得新的 Agent 行为；旧版本继续使用原来的非主动诊断规则。
3. 回滚时可回退 text diagnostics、Skill 和文档改动；已有 JSONL 和 feedback artifact 不需要转换或删除。
