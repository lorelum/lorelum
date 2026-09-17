# PR #191：CLI text 输出对比审阅与最终重构决策

- **状态：** 本地审阅材料，不属于已关闭 PR #191 的提交内容，也不单独构成产品合同。最终实现以 `general-cli-text-rendering` OpenSpec change 为准。
- **审阅提交：** `d0eaa2b1559e2788625e2700f9071dbd68782892`
- **审阅日期：** 2026-09-17
- **用途：** 记录 PR #191 实际实现过的五类 text 输出、它遗漏的数据，以及据此确定的新实现边界。

## 先看结论

PR #191 曾把以下五类调用改成**默认 text**：

| 调用 | 本 PR 的默认 stdout | 显式 JSON | 退出码与失败输出 |
| --- | --- | --- | --- |
| `lore get <practice-id>` | 仅输出完整 Practice `body`，逐字节保留 CRLF 和尾部换行 | `lore get <practice-id> --json` | ready 为 `0`；text 失败写 stderr；JSON 失败写 stdout envelope |
| `lore pack list [pack] [--details]` | 含 snapshot 的 Pack/Practice 可读目录与显式空状态 | 追加 `--json` | ready 为 `0`；text 失败写 stderr；JSON 失败写 stdout envelope |
| `lore pack install <pack>` | 安装回执、Store mutation、diagnostics、index sync 状态 | 追加 `--json` | ready 为 `0`；text 失败写 stderr；JSON 失败写 stdout envelope |
| `lore query <text>` | 有序 Practice 摘要，或 preparation/indexing 的可读状态 | 追加 `--json` | ready 为 `0`；`preparing`/`indexing` 为 `1`；text 失败写 stderr；JSON 失败写 stdout envelope |
| `lore --version` | `Lorelum <toolVersion> (protocol <protocolVersion>)` | `lore --version --json` | ready 为 `0`；使用 text 默认值的非法调用写 stderr |

其余已注册业务命令仍默认 JSON。根命令 `lore`、`lore describe`，以及当时实现中的 `--help` 也仍返回 JSON。

格式选择器只保留 `--json`：不依据 TTY 切换，也没有 `--format`、`--human`、`--agent`、ANSI 或颜色参数。`--` 之后的 `--json`，以及被另一个 option 当作 value 消费的 `--json`，不会触发 JSON 模式。

## 最终决定：不接受 PR #191 的字段投影，改为全命令通用 render

PR #191 已于 **2026 年 9 月 17 日**关闭；不会在该分支上继续修改。新分支从 `origin/main` 创建，采用以下已确认边界：

| 维度 | PR #191 | 新实现 |
| --- | --- | --- |
| 默认覆盖 | 仅 get/list/install/query/version 五类命令 | root、describe、Help、version 和全部普通 command |
| text 内容 | 每个 command 手写投影，部分字段被省略 | 同一次公开 `data` 的完整树形视觉表现，object field、array item、scalar、空值、多行内容全部可见 |
| JSON | 支持 `--json`，但同时改变既有裸调用 | `--json` 返回完整、原样 envelope；Agent/Skill 正常阅读 text，排查或实际 parser 才使用它 |
| 业务职责 | command-specific renderer 需要了解 query/list/install shape | handler 不感知 format；唯一 render 层不读 Store、不连 Backend、不等待或推导状态 |
| Help | 没有面向人类的 Help | 允许纯布局 custom renderer；仍必须保留完整 capability data |
| error | text 与 JSON 分流 | 默认 text error 在 stderr 完整显示 code/message/recovery；`--json` error 保持 stdout envelope |

因此，新默认 text 不会隐藏 `contentDigest`、`packRoot`、`profileId`、`operationId`、diagnostic 或 warning。若某公开 JSON data 字段未来确实没有 Agent/用户价值，应在独立 data-contract change 中移除，而不是只从 text 隐藏。

## 字段级对比

### 1. `lore get <practice-id>`

**默认 text**

```text
<完整 Practice body，且只有 body>
```

没有标题、Markdown code fence、JSON envelope、source 信息或 Store metadata。body 没有最终换行、使用 CRLF、或有多个尾部换行时，均原样保留。

**只能通过 `--json` 获得的内容**

| JSON 内容 | 为什么 text 调用方仍可能需要 |
| --- | --- |
| `practice` 中 `body` 之外的 metadata | 精确身份与结构化字段 |
| `contentDigest` | 机器身份和变化检测 |
| `sources[].packName`、`sourcePath`、`packRoot` | source provenance 与正确的 `resource:` 解析，尤其是一个 Practice 有多个 source 时 |

**审阅含义：** 这是 PR #191 的缺陷：它的 text 没有这些公开字段。当前通用 renderer 必须完整显示它们，因此 Agent/Skill 可以直接阅读默认 text；只有排查或实际机器 parser 才使用 `--json`。

### 2. `lore pack list [pack] [--details]`

**默认 text**

| 调用形态 | text 投影 |
| --- | --- |
| 无参数 | Store snapshot；每个 Pack 的 `name@version` 与 Practice count |
| `--details` | Store snapshot；`name@version`、可选 description、applicability 列表 |
| `<pack>` | Store snapshot；所选 Pack identity；有序 Practice ID、title 和 `applies_when` |
| 空 Store / 空 catalog | `No installed Packs.` 或 `No Practices.` |

**只能通过 `--json` 获得的内容**

所有 JSON list shape 保留公开的 `packRoot`，text 不会显示它；JSON 还保留了供 integration 稳定解析的字段名和结果 shape。

**审阅含义：** 对人类目录隐藏绝对本机 `packRoot` 是合理取舍，但默认输出无法再满足需要 Catalog 的 Agent/automation。

### 3. `lore pack install <pack>`

**默认 text**

```text
Installed|Already installed <name>@<version>.
Registry: <registry> (<repository>)
Source: git <ref>
Store snapshot: generation <n>, effective revision <n>
Practice changes: Added|Changed|Invalidated ...
Diagnostics: ...                         # 仅有 diagnostics 时
Cleanup: pending.                         # 仅适用时
Semantic index: pending|ready|failed ...
```

`indexSync.pending` 会显示 phase 和 operation ID；ready 可能显示 vector count；failed 显示公开 error code 和 message。

**只能通过 `--json` 获得的内容**

text 至少遗漏 `artifactDigest`、`packRoot` 和最终解析到的 Git commit。因此 automation 若要定位 Pack 资源或校验确切 artifact/source revision，仍必须使用 JSON。

### 4. `lore query <text>`

**默认 text：ready result**

```text
Query mode: semantic (coverage: complete|partial)
Matched Practices (<n>):
1. <practiceId> — <title>
   Stage: <stage>
   Severity: <severity>
   Tech stack: <items>|(none)
   Applies when: <summary>
```

keyword 模式显示 `Query mode: keyword`。空 ready result 明确显示 `No matching Practices.`。结果顺序保持 Engine 返回顺序。

**默认 text：non-ready result**

| JSON state | text 投影 | exit |
| --- | --- | --- |
| `preparing` | `Semantic query is preparing.` 加恢复 message | `1` |
| `indexing` | `Semantic query is indexing.`、progress message、`Indexed Practices: <n>/<total>` | `1` |

**只能通过 `--json` 获得的内容**

| 被省略的 JSON 信息 | text 行为 |
| --- | --- |
| `contentDigest`、semantic `profileId` | ready summary 中不显示 |
| `preparationId` | `preparing` text 中不显示 |
| `operationId` | `indexing` text 中不显示，但 JSON 中保留 |
| `data.state`、完整 coverage counters、recovery object、error code | 必须读取 JSON envelope；text 不是机器协议 |

**需要确认的设计选择：** query text 不展示 `indexing.operationId`，但 install receipt 会展示 pending index 的 operation ID。应明确这是有意隐藏还是遗漏，并用一致的方式说明下一步恢复操作。

### 5. `lore --version`

**默认 text**

```text
Lorelum 0.1.0-alpha.2 (protocol 1)
```

**JSON override**

```json
{"protocolVersion":1,"toolVersion":"0.1.0-alpha.2","command":"version","ok":true,"data":{"protocolVersion":1,"toolVersion":"0.1.0-alpha.2"}}
```

这是真正的默认值变化：现有 quick-start 中“裸 `lore --version` 返回 JSON”的说法将不再成立。

## 仍为 JSON-only 的命令

| 分类 | 命令 |
| --- | --- |
| Discovery / root | `lore`、`lore describe`、当前 `--help` 行为 |
| Pack / context / cache | `pack update`、`pack remove`、`init`、`context status`、`cache status`、`cache prune` |
| Backend / model / index | `backend start/status/stop`、backend lease 命令、`model load/status/unload`、`index status/build/rebuild/operation` |
| Authoring | `format`、`i18n sync`、`validate` |

这些命令无论默认还是追加 `--json`，成功与失败都仍以一行 JSON envelope 写 stdout。

## 与当前权威来源的对比

| 来源 | 当前内容 | 与 PR #191 的关系 |
| --- | --- | --- |
| `openspec/specs/retrieval-query/spec.md` | ready/preparing query 写 JSON envelope 到 stdout | 除非先经 OpenSpec 流程修改，否则与新的裸 `query` text 默认值冲突 |
| `openspec/specs/agent-integration/spec.md` | Host integration 通过 list/query/get 的公开 JSON 合同获取内容 | 需要让官方 Skill 与全部机器调用方迁移至 `--json` |
| `skills/lorelum/SKILL.md` | 调用裸 `lore query`/`lore get`，随后依赖 `sources[].packRoot` | 不改调用形式就会破坏 resource-aware 路径 |
| PR 中的 `docs/adr/0004-agent-first-cli-protocol.md` | 声明 text 默认值，并要求机器调用方传 `--json` | 描述目标设计，但不能自行取代仍未变更的 active OpenSpec |

## 已解决的设计结论

1. **权威来源：** 新 `general-cli-text-rendering` OpenSpec 明确默认 text、显式 JSON 和 Agent contract；旧方向相反的 draft 已移除。
2. **Agent 兼容：** 官方 Skill 与 Plugin 在正常检索时阅读默认 text；仅排查/协议核对使用 `--json`。tests、process/native smoke 与真实 JSON consumer 保留显式 `--json`。
3. **人类流程：** 不再接受 get/list/install/query 的字段省略；通用 renderer 自动覆盖所有既有和未来普通 command。
4. **异步恢复：** `operationId`、coverage、warning、recovery 与所有 data 内状态会完整显示，renderer 不编造下一步或后台状态。
5. **Help：** custom renderer 只能重排同一 capability data，不能形成第二套 Help schema 或丢弃 result schema/error/exit metadata。
6. **验证：** native smoke 的 JSON parser helper 显式使用 `--json`；source/process tests 同时覆盖默认 text 和 JSON。

## 证据范围

- 通过当前 worktree 的 `bun packages/cli/src/main.ts describe` 核对 registry。
- 在当前 worktree 分别核对 `--version` 与 `--version --json`。
- 阅读 `packages/cli/src/output/text-renderers.ts`，并运行 focused renderer/protocol tests。
- 本文的 PR #191 部分只记录历史 checkout；当前实现、spec 与验证证据在新分支 `codex/general-cli-text-rendering` 上维护。
