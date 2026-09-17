## Context

动机见 [proposal.md](./proposal.md)。当前代码中，`CommandDefinition.handler` 返回 `CommandResult { data, exitCode }`，`createProgram` 在 handler 后立即调用 JSON success writer，`main.run` 在 catch 中立即调用 JSON failure writer。`protocol.ts` 已是 JSON envelope 的唯一所有者。这个链路是合适的业务/协议分层；问题只是没有一个可在同一结果上选择人类 text 的单一 render 边界。

已观察到的约束：

- `registry.ts` 是所有普通 command、global option、Help/version static response、result schema 与 exit declaration 的来源；`lore hook codex` 在 `main.ts` 早期分流，不能纳入普通输出协商。
- JSON `data` 已包含 source locator、digest、profile、operation ID、diagnostic 等公开字段。根据本 change 的要求，text 必须展示而非选择性隐藏这些字段。
- Commander 在 action 前就可能报告 usage error，因此 format 必须在 parser 前由 argv 决定；又必须尊重 `--` 与 value option 边界，不能把 option value 误识别为 `--json`。
- `lore --help` 当前返回 command description JSON。它是唯一已确认需要较强人类排版的场景；Bun 风格的可浏览布局可改善阅读，但不能丢弃 discovery data。

## Goals / Non-Goals

**Goals:**

- 让一次 handler invocation 只生成一次 structured result，JSON 和 text 共享数据、排序、状态、exit code 与 error mapping。
- 以一个小的纯 render 层替换在 handler、registry 或各 command 内部分散的 format 分支。
- 使默认 text 对所有当前与未来普通 command 自动生效，无需逐命令声明 text capability；新 command 只要返回 JSON-safe data 即获得完整 text。
- 保留不泄露业务控制的 internal custom renderer 入口，使 Help/version 可改善布局而不复制 result 组装。

**Non-Goals:**

- 不变更任何 JSON `data` schema、Engine/Backend/Store 行为、查询排序、错误码、模型/index 生命周期或 Hook ABI。
- 不引入 TTY 检测、颜色、pager、spinner、模板 DSL、可配置 output format、公共 renderer plugin 或 local MCP。
- 不把 text 定义为 YAML/JSON 替代品或可稳定解析的 API；需要机器访问时使用 `--json`。
- 不在本 change 判断哪个已公开 data 字段“对 Agent 没价值”。这类删除必须以单独的 data-contract change 完成，不能只从 text 藏掉。

## Decisions

### 1. 一个纯 render 边界，handler 不感知 format

`main.run` 在 Commander 前解析 argv 得到 `text | json`；无 `--json` 固定选择 text。它把这个选择交给 `createProgram`。每个 action 仍只调用 handler 并取得现有 `CommandResult`，随后调用唯一的 render entrypoint：

```ts
type TextRenderer = (data: JsonValue, fallback: StructuredTextRenderer) => string;

renderResult({
  writer,
  format,             // "text" by default; "json" only after --json
  command,
  data,
  textRenderer?,      // pure layout override
});
```

entrypoint 在写入前验证 JSON-safe data。JSON 分支组装当前 envelope；text 分支调用 optional custom renderer 或通用 renderer。failure 也通过同一 entrypoint 选择 JSON envelope 或对 `{ error: { code, message, recovery? } }` 的 text。这样 stdout/stderr 是 caller 选择，而 JSON/text 语义只由 render 层拥有。

不选择把 `--json` 或 `--text` 传进每个 handler：这会让不相干的业务 command 获得展示分支，并让测试重复证明每个 command 的 format 行为。

### 2. 结构完整的通用 text renderer 是默认实现

renderer 保持 `Object.entries` 和 array 原顺序，并以低符号树形表达 JSON-safe value：

```text
practice:
  id: agentic-coding.review.validate-findings-before-action
  body: |
    第一行
    第二行
sources:
  - packName: agentic-coding
    packRoot: /Users/example/.lorelum/packs/current
diagnostics: []
recovery: null
```

scalar 直接可读；空 string、空 array、空 object 与 `null` 用无歧义的可见标记表达；多行 string 使用保留行内容的 block。这个 renderer 不按 command 类型做字段 allowlist、摘要、类型断言或业务解释，因此每个现有及未来 normal command 都自动覆盖。

文本不是 parse contract，键排序、缩进宽度、line framing 和 custom layout 可以演进；但本 change 的测试会把同一 fixture 的所有公开 field/value 映射到 text，防止遗漏实际数据。

### 3. custom renderer 只改善布局，不形成第二套语义

`CommandDefinition` 和 static framework response 可选关联一个内部 `TextRenderer`。它只能接收已验证 data 和通用 fallback renderer，不能接收 invocation、Store、Backend client、logger 或 async capability，因此无法做第二次 I/O 或业务判断。

首个实现用于 root/command `--help`：根据已经返回的 command description 排出 Usage、Commands、Arguments、Options、contract/error details；未在舒适布局中出现的数据将使用 fallback renderer 继续输出，保证没有遗漏。version 可以使用短行布局，但必须展示 `data.toolVersion` 与 `data.protocolVersion`。其他 command 先使用通用 renderer；当真实阅读任务证明需要特殊布局时，再以同样的完整性测试增加 internal hook。

不选择恢复 PR #191 的 command-specific `renderGetText`/`renderQueryText` 等 renderer：它们需要逐个 decode `JsonValue`、定义哪些字段可省略，并已经导致 source、coverage 和 degraded 状态丢失。

### 4. parser 前 format selection 只识别真正的 global flag

新增 Commander-recognized global `--json` option，并在 parse 前用 registry option metadata 扫描 argv：扫描在 `--` 停止，跳过所有需要 value 的 global/selected command option，支持 `--flag=value`。它只回答“此 invocation 是否明确请求 JSON”，不验证业务参数、不执行 command、也不根据有没有 custom renderer 改变选择。

这保证 parser usage error 也进入正确 stdout/stderr 路径。`--json` 本身保持无值；若它出现在另一 option 的值位置，扫描必须跳过它并让 Commander 依照原参数规则处理。

### 5. Skill 直接阅读 text；JSON parser 显式表达机器意图

普通调用默认 text 后，官方 Skills 和 Plugin 在正常 discovery、query、get、资源定位与 lease 流程中直接阅读完整 text，不为取回业务信息而追加 `--json`。它们不得按缩进、行号或 key 排版解析 text；当排查异常、核对 protocol envelope 或检查精确机器字段时，才以 `--json` 复现对应调用。native smoke、integration helper、CI、documentation code block 和其他实际执行 JSON parse 的调用继续显式传入 `--json`，使真正的机器 parser 不受文案布局演进影响。Hook 继续不添加 `--json`，因为它有独立 ABI。

## Risks / Trade-offs

- **默认值是 breaking change** → `--json` 保留原 envelope，所有实际 JSON parser/test 调用在同一 change 显式迁移；Agent/Skill 的普通检索改为直接阅读完整 text，文档明确它不是可解析协议。
- **完整 data 可能令 text 冗长或暴露本机路径** → 这是现有 JSON public contract 的可视化，不是新的暴露；若某字段确实无公开价值，后续必须先改 JSON data contract。
- **generic layout 不如手写命令摘要精炼** → 以信息完整和小改造为当前优先级；只有 Help/version 有已确认的人类浏览需求，先使用受约束 custom layout。
- **raw argv scanner 与 Commander 规则漂移** → scanner 只复用 registry option metadata 并有 `--`、inline value、option-value、未知 command 和 usage-error tests；不复制业务 validation。
- **JSON integrations 漏迁移** → 搜索所有 JSON.parse/`data.` CLI callsite，修 native smoke 与官方 integration docs，并运行 process/native smoke。

## Migration Plan

1. 先完成本 change 的 delta specs 与 design，再实现 global `--json`、selection 和 render boundary；删除任何按命令投影 data 的 renderer。
2. 以 output unit tests 固定 generic renderer 对 scalar/nested/empty/multiline data 和 complete failure 的表现；以 registry/main tests 固定 default text、`--json`、`--` 和 option value 边界。
3. 为 root, `describe`, Help, version 以及每类 handler result 用相同 fixture 对照 JSON envelope/data 与 text；重点覆盖 query/index lifecycle、Pack derived index、source provenance 和 recovery。
4. 将所有官方机器 path 改为 `--json`，修正 native smoke helper，然后同步 CLI maintainer docs 与中英文 site guidance。
5. 完整通过 checks 后再创建新 Issue/PR；关闭的 #191 不恢复，旧 PR branch 的实现/文档不作为此次基础。

发布前若验证揭示 text 不能完整表示某类 JSON-safe data，停止发布并修 renderer/tests；不以 command-specific omission 作为临时绕过。源码改动尚未发布时可回退本 change；发布后 JSON `--json` contract 继续提供无损 machine migration path。

## Open Questions

无。当前只预留内部 custom layout callback，不承诺用户可注册 renderer；是否公开扩展点必须在出现真实宿主需求后另行设计。
