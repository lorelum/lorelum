<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">在正确的任务、正确的时刻，为 Agent 提供正确的工程 Practice。</p>
  <p align="center">
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
    <a href="https://github.com/lorelum/lorelum"><img alt="Status" src="https://img.shields.io/badge/status-早期开发中-orange"></a>
    <a href="./CONTRIBUTING.md"><img alt="Contributing" src="https://img.shields.io/badge/欢迎贡献-brightgreen"></a>
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</p>

---

> ⚠️ **Lorelum 处于早期开发阶段。** CLI 尚未发布到 npm，我们在公开环境里搭建。欢迎 Star 关注，也欢迎到 [Discussions](https://github.com/lorelum/lorelum/discussions) 参与讨论。

## 你遇到过这些问题吗？

你写了 `AGENTS.md`（或 `CLAUDE.md`、`.cursorrules`）。然后这些事就发生了：

- **规则被静默忽略。** 前沿模型对 500 条规则的合规率只有约 68%——_你每多写一条规则，其它规则被遵守的概率都在下降。_<sup>[\[1\]](#fn-1)</sup> 没有任何提示，Agent 就这么悄悄偏离了。
- **简单任务被做成了复杂工程。** Agent 在规划一个范围明确的改动时，会自动加入用户没有要求的产品行为、抽象、fallback、测试、文档和门禁，因为这些内容更容易被评价为“完整”。每一项都像最佳实践，组合起来却是在优化看起来是否认真，而不是用户真正要的结果。
- **压缩（compaction）不仅会遗忘，还可能失真。** 长会话触发上下文压缩 → 会话开头的 `AGENTS.md`、原始需求、验收条件和证据边界可能被挤出窗口；与此同时，已否决方案、已证伪假设、legacy code、临时 workaround、偶然问题和原始日志却可能被摘要提升为“当前事实”。压缩后的上下文更短了，但也可能更不准确。
- **等发现时已经晚了。** Agent 是否已经偏离，你得不到任何信号——直到自己 review 代码时才发现违规。

这是 AI 编码的**知识与判断缺位**：你的工程经验存在，但正确的切片及其适用边界，没有在 Agent **规划或行动的那一刻**可靠抵达它。

## 为什么会这样

你的 `AGENTS.md` 今天是这样抵达 Agent 的：

```
  ┌─────────────────────────────────────────────────────────────┐
  │  AGENTS.md —— 会话开始时一次性灌进上下文                     │
  └─────────────────────────────────────────────────────────────┘
        │
        ├─▶ 规则多数不被遵守      500 条规则下合规率约 68%
        │                          （写得越多，每条越没用）
        │
        ├─▶ 代理指标压过真实目标  任务、测试和门禁越多，
        │                          看起来越完整，即使并不需要
        │
        ├─▶ 压缩丢失关键内容      持久需求、规则和证据
        │                          可能被挤出窗口
        │
        ├─▶ 探索噪声变成“事实”    已否决方案或旧代码
        │                          可能被摘要保留下来
        │
        └─▶ 偏离静默发生          没有任何信号，直到你 review
                                    代码才发现违规
```

常见做法（"把规则全量塞进上下文"）对抗的是物理限制：长会话中的注意力衰减、上下文窗口容量，以及"**规则越多，每条合规率越低**"这个事实。<sup>[\[2\]](#fn-2)</sup> 即便 1M token 的窗口，压缩之后早期指令的召回率也不可靠。它也无法告诉 Agent：哪些熟悉的最佳实践对这次局部修改其实没有必要。**规则越多 ≠ 控制力越强。** 靠堆上下文解决不了根本问题。

## Lorelum 怎么解决

Lorelum 把团队工程经验切成**离散、可检索、带触发条件的 *Practice***——在 AI **需要的时候**才精准注入，而不是一开始全量灌。

检索可以同时使用两类线索：

- **Agent 正在做什么：** 规划一个局部 UI 修改、实现认证流程、修改数据库 schema、编写组件测试。
- **Agent 正处于什么时刻：** 确定范围和验证计划、考虑增加需求之外的工作、compaction 后恢复任务、准备修改失败测试，或准备宣布完成。

调用方说明当前任务和时刻，Lorelum 负责检索并排序相关 Practice。任务描述可以包含目标、范围和风险：删除一行多余文案，与修改鉴权边界，不应该触发同等规模的工程动作。Practice 不只可以说明应该做什么，还可以说明适用条件和需要避免的反模式。

Skill 可以引导 Agent 在形成计划或做出其他语义判断前主动发起检索。对于简单任务，这可能只是一次很短的范围判断，而不是额外增加一份长计划文档或 workflow 仪式。Plugin/Hook 则可以观察受支持宿主暴露的 lifecycle event。围绕 compaction，前后两个时刻需要的指引并不相同：

- **压缩前：** 检索 Context Hygiene 类 Practice，帮助区分需要长期保留的事实和探索过程中产生的噪声。
- **压缩后：** 检索恢复类 Practice，提醒 Agent 重新对齐事实，并恢复证据、假设与结论之间的边界。

Lorelum Core 本身不管理任务、不读取完整 transcript，也不自行推断 lifecycle event。压缩前的指引能否真正进入宿主的 compaction instruction，取决于宿主集成能力，目前仍是 Research 问题。

```
   ┌─────────────┐   查询     ┌────────────────────┐   精准    ┌──────────────┐
   │   AI 工具   │ ────────▶ │      Lorelum       │ ────────▶ │  3 条相关的  │
   │ (Cursor /   │           │    检索引擎         │           │   Practice   │
   │  Claude /   │ ◀──────── │ （语义+元数据+图谱）│ ◀─────────│  + 反模式    │
   │  Codex)     │   注入    └────────────────────┘           └──────────────┘
   └─────────────┘
```

**Lorelum 不替代你的 `AGENTS.md`，而是让它保持鲜活。** 每次 Agent 需要其中的一块时，Lorelum 都把那一片精准切片重新注入。当 Agent 开始实现认证模块时，Lorelum 只给它 auth 相关的 Practice，而不是把路由、测试、部署的规范也一起塞进来。当它准备规划修改时，Lorelum 可以在多余工作进入计划前，提供范围和验证纪律。当它即将做出其他高风险判断时，Lorelum 也可以重新提醒当下最容易被忘记的执行纪律，但它不会因此变成 workflow engine。

### Practice 长什么样

```markdown
---
id: react.api.layered-design
stage: api-layer
tech_stack: [react, typescript]
applies_when: 在 React SPA 中构建 API 层
---

# 分层 API 设计

[具体指引：http client、base API、modules、DTO 边界。]

## 要避免的反模式

- api.direct-axios-in-component （在组件里直接调 axios）
- api.local-storage-in-api-class （在 API 类里持久化 token）
- api.dto-used-as-ui-model （DTO 直接当 UI 模型用）
```

一个 **Knowledge Pack（知识包）** 把多条 Practice + 模板 + 反模式打包，绑定到某个技术栈或团队标准。

例如，在 React 认证任务中，检索 `react.api.layered-design` 就足以让组件保持在正确边界：

```tsx
const { login } = useAuthApi(); // 走分层 API client
await login({ email }); // token 由 API 层处理
```

Agent 不需要同时接收无关的路由、部署和测试 Practice。

## 端到端案例：在写代码前，让简单任务保持简单

> **Research 方向：** [Issue #35](https://github.com/lorelum/lorelum/issues/35) 研究 Agent Coding 中的 Reward Hacking 与行为过拟合。这个案例展示的是期望的使用体验和责任边界，不代表该能力已经在所有 AI 工具中完成验证。

### 场景

Agent 被要求按照已有设计实现一个设置卡片。用户要的是标题、显示名称与时区字段，以及保存操作。设计没有增加新的产品文案、交互、通用抽象或工程门禁。

### 没有 Lorelum——范围在计划里开始膨胀

Agent 为了让结果看起来更完整，制订了这样的计划：

```text
1. 实现设置卡片和表单
2. 增加描述性文案和帮助信息，让功能更容易理解
3. 增加额外的成功状态和空状态
4. 抽象通用 SettingsSection，方便未来复用
5. 为新增内容补充快照和组件测试
6. 更新文档并增加回归保护
```

每一项单独看都可以解释，组合起来却把一个范围明确的 UI 任务变成了产品设计、抽象设计和长期维护工程。如果没有人及时发现，测试可以全部通过，Agent 也可以宣布完成——但它完成的是自己膨胀后的计划，不是用户最初提出的任务。

### 有 Lorelum——写代码前先对齐计划

在确定计划前，Agent 使用普通自然语言 query：

```bash
lore query "我要按照现有设计实现一个设置卡片，现在准备确定范围、实施步骤和验证方式。"
```

Lorelum 可以返回少量与这个时刻相关的 Practice，例如：

```text
planning.ground-plan-in-user-goal
planning.separate-required-optional-and-out-of-scope
planning.scale-work-to-risk
planning.plan-evidence-for-requirements
```

Agent 随后形成一份与任务相称的计划：

```text
目标：按照已有设计完成设置卡片

范围内：
- 标题
- 显示名称和时区字段
- 保存行为

范围外：
- 新增产品文案和交互
- 没有当前复用场景的通用抽象
- 没有风险依据的长期门禁

验证：
- 字段正确显示
- 保存行为工作
- 现有相关测试继续通过
```

### 结果

Agent 实现用户要求的设置卡片，复用现有布局和相关测试，然后停止。规划没有变成新的仪式：对于一个局部修改，同样的判断可能只是一次很短的范围检查，而不是需要提交到仓库的计划、Spec 或 ADR。

如果 Agent 已经偏离，用户要求删除擅自增加的文案，纠正仍然是一次有价值的检索时刻。但删除越界内容通常只是在恢复原始基线，并不自动形成“这段文本永远不得出现”的长期需求。负向测试或门禁需要稳定的产品契约或可证明的风险，而不能只记录 Agent 自己犯过的错误。

## 长任务案例：压缩前减少污染，压缩后重新对齐

> **Research 方向：** [Issue #32](https://github.com/lorelum/lorelum/issues/32) 研究压缩前的内容选择与污染控制；[Issue #28](https://github.com/lorelum/lorelum/issues/28) 研究压缩后的恢复，以及关键时刻的 Practice 注入。这个案例展示的是期望的使用体验和责任边界，不代表所有 AI 工具已经交付该能力。

### 场景

Agent 正在实现一个常见的账户设置功能。验收条件覆盖完整的用户能力：

- 页面可以修改显示名称和时区；
- API 会校验输入并检查权限；
- 修改能够持久化，重新加载后仍然可见；
- 允许修改和拒绝修改两条完整流程都符合预期。

压缩前，工作上下文里混合着性质完全不同的内容：

- 权威 Spec、当前目标和验收条件；
- 当前表单实现和定向组件测试结果；
- 一个只在客户端保存设置、绕过服务端权限校验的已否决捷径；
- 一个“现有接口已经能持久化时区”的已证伪假设；
- 一份绕过当前 API 链路的 legacy `LegacySettingsPanel`；
- 很长的测试日志、浏览器输出和临时调试笔记。

这些内容不应该以相同方式进入压缩结果：

| 内容                          | 压缩时应该如何处理                 |
| ----------------------------- | ---------------------------------- |
| 当前目标、权威 Spec、验收条件 | 必须保留                           |
| 已接受决策                    | 保留决策，以及理解它所需的必要理由 |
| 已否决方案、已证伪假设        | 保留结论，不保留完整探索过程       |
| 长日志、工具输出              | 只保留关键错误和证据               |
| 偶然问题、无关任务            | 不应继续影响主线                   |

经过一段很长的会话后，context 发生了 compaction。一个糟糕的摘要可能保留最近的表单重构和通过的定向测试，却丢掉完整验收范围；更糟的是，它还可能保留已否决的客户端捷径、已证伪的持久化假设或 legacy panel 的片段，却没有保留“这些内容已经不再权威”这个结论。

### 没有按关键时刻检索——局部证据变成整体结论

Agent 看到定向测试全部通过，于是报告：

```text
✅ 账户设置功能已经完成。测试全部通过，界面也已验证。
```

但这些证据只覆盖了表单组件，无法说明 API 权限、重新加载后的持久化结果、拒绝修改的路径，也无法说明完整用户流程。测试本身没有错，错在**完成声明超出了证据能够支持的范围**。

### 有 Lorelum——先减少污染，再恢复事实

在期望的链路中，受支持的 Plugin/Hook 先观察到 compaction 即将开始，再向 Lorelum 查询 Context Hygiene 类 Practice。如果宿主允许外部指引影响压缩，这些 Practice 可以告诉宿主的 compactor：哪些内容必须保留，哪些内容只需要保留“已否决”这一结论，哪些噪声可以舍弃。Lorelum 本身不会读取或重写 transcript；无法把这些指引传给 compactor 的集成，也只需继续执行正常压缩。

压缩完成后，集成再向 Lorelum 查询恢复类 Practice。注入的指引会提醒 Agent：摘要不是事实来源，继续之前必须重新阅读持久化的 Spec、验收条件、计划和证据。

Agent 重新建立对任务的理解后，发现目前只测试了 UI 切片。在报告完成之前，它使用普通的自然语言 query：

```bash
lore query "我正在实现账户设置。定向组件测试已通过，现在准备宣布整个功能完成。"
```

Lorelum 可以返回少量与当前时刻精准相关的 Practice，例如：

```text
recovery.re-ground-after-context-loss
verification.match-claims-to-evidence
delivery.separate-slice-from-capability
```

Agent 不再让事实迎合自己想要的结论，而是修正报告：

```text
已完成：账户设置表单及其组件测试。
尚未验证：API 权限、重新加载后的持久化结果、拒绝修改的路径，
以及端到端验收流程。目前还不能宣布整个功能已经完成。
```

### Lorelum 做了什么，没有做什么

Lorelum 没有保存 Spec、检查代码仓库、运行测试，也没有判断功能是否通过验收。集成层识别出了相关事件；Lorelum 检索出了这个时刻需要的执行纪律；Agent 再回到项目的真实事实来源进行核对。

这个模式也不只用于 compaction。当 Agent 准备修改失败测试、根据未确认假设继续实现、把任务移交给另一个 Agent，或准备把局部实现宣布为完整能力时，Skill 都可以提醒它发起查询。

### 压缩前后的完整链路

Compaction 后，如果立即根据可能不完整或已被污染的摘要猜测任务领域 Practice，反而可能让错误方案继续深入。期望的链路是：

```
宿主报告 compaction 即将开始
        │
        ▼
Plugin / Hook 查询压缩前指引
        │
        ▼
如果宿主支持，compactor 使用这些指引；
否则安全地继续正常压缩
        │
        ▼
宿主生成压缩摘要
        │
        ▼
压缩后的 Hook 查询恢复类 Practice
        │
        ▼
Agent 重新阅读持久化的 Spec、验收条件、假设和证据
        │
        ▼
Agent 带着重新建立的任务与时刻，执行普通 lore query
```

Plugin/Hook 只知道宿主暴露了哪个 lifecycle event，却不判断工作是否正确或已经完成。Lorelum 检索当前任务与时刻所需的指引，却不保存 Spec、不管理任务状态、不读取完整 transcript，也不实现 compactor。如果宿主不能接收压缩前指引，这一步会安全降级，不阻塞正常压缩；压缩后的恢复链路仍然可以使用。Agent 先重建对事实的正确理解，再请求与任务相关的指引。

这只是一个具体示例。更完整的方向是支持 Agentic Coding 全流程中的关键时刻——需求理解、规划、实现、测试、验证、交付、恢复和纠偏，而不是为 compaction 单独打一个补丁。

## 5 分钟了解

_（CLI 处于 pre-alpha，以下命令展示的是设计中的交互形态。）_

```bash
# 安装一个社区知识包（本地模式，离线可用）
lore install react-fullstack

# 问：我当前的任务该遵循哪些 Practice？
lore query "带权限控制、表单、测试的设置页"

# 在形成计划前，检索范围和验证相关指引
lore query "我要按照现有设计实现功能，现在准备确定范围、实施步骤和验证方式。"

# 同一个自然语言 query 也可以说明当前的关键时刻
lore query "定向测试已经通过，我准备宣布整个设置页能力已完成"

# 检查代码是否违反了某条 Practice
lore check src/features/auth/LoginPage.tsx

# 把一次成功的修复沉淀成团队可复用的 Practice
lore learn "HTTP client 里的 single-flight refresh token"
```

或者通过 MCP 接入你的 AI 工具——Lorelum 提供 MCP Server，任何兼容 MCP 的工具（Cursor、Claude Code、Codex、Windsurf……）都能调用。

## 和现有方案有什么不同

|                              | `AGENTS.md` / `.cursorrules` | Skills / 斜杠命令 | **Lorelum**                                                                                           |
| ---------------------------- | ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| **供给方式**                 | 静态、全量灌入               | 手动触发          | **按需检索**                                                                                          |
| **长会话衰减**               | 会                           | 不会（一次性）    | 不会（每次查询都新鲜）                                                                                |
| **压缩前后支持**             | 手动：重新粘贴全部规则       | 手动              | Research：受支持的集成可在压缩前提供内容选择指引、压缩后触发恢复；其他工具通过 Skill / CLI / MCP 调用 |
| **按范围和风险校准工程投入** | 否                           | 取决于具体流程    | Research：根据当前任务和时刻检索规划 Practice 与 anti-pattern                                         |
| **支持上百条规则**           | ❌                           | 繁琐              | ✅ 为此而生                                                                                           |
| **工具中立**                 | 绑定单一工具                 | 绑定单一工具      | ✅ MCP / CLI / Skill                                                                                  |
| **反模式检查**               | 否                           | 否                | ✅ `lore check`                                                                                       |

Lorelum 不是"更好的 .cursorrules"，而是位于你所用 AI 工具背后的 **Practice 检索层**。

## 架构（简述）

```
┌──────────────────────────────────────────────────────────┐
│        AI 工具层（Cursor / Claude Code / Codex / Windsurf）│
└─────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────┐
│ 集成层：Skill / Plugin / Hook / CLI / MCP               │
│ 发现或描述任务与时刻 · 调用 · 注入                     │
└───────────────────────────────────────────────────────────┘
                             │ 查询
                             ▼
┌──────────────────────────────────────────────────────────┐
│                    Lorelum 引擎                          │
│        检索与排序（语义 + 元数据 + 图谱）                  │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴─────────┐
   ▼                   ▼
本地知识包          端点（团队 / SaaS / 自托管）
（离线可用）        （实时、多用户）
```

集成层负责**何时调用**以及**如何注入**。Lifecycle event 来自 Skill、Plugin 或 Hook；Lorelum Core 只负责检索与调用方所描述的任务和时刻相关的 Practice，它不控制宿主的 compactor。`PreCompact` 返回的文本能否真正成为压缩指令，属于仍需验证的集成能力。这样可以把各个宿主工具特有的生命周期处理留在检索引擎之外。

两种模式共用同一套命令：

- **本地模式（默认）：** `lore install` 一个公开包，离线查询，零运维。像 npm 一样简单。
- **端点模式：** 把 CLI 指向团队 / SaaS / 自托管端点，享受实时同步与多人协作。

## 路线图

我们以里程碑方式公开推进：

- **P0–P2** — 核心引擎：Practice 格式、检索（语义 + 元数据）、`lore query` / `get` / `check`。仅本地模式。
- **P3–P4** — 第一个公开包（`react-fullstack`）、MCP Server、`lore install` / `search`、公开 Registry MVP。
- **P5** — 端点服务内核（AGPL，可自托管）、团队知识包。
- **P6** — 企业治理（SSO、审计、敏感信息扫描）。

当前进展见 [Discussions](https://github.com/lorelum/lorelum/discussions)。

## 项目状态

🟡 **早期开发中。** 没有稳定版，CLI 尚未发布，设计正在收尾。现在正是参与塑造方向的好时机——欢迎到 [Discussions](https://github.com/lorelum/lorelum/discussions) 来。

## 参与贡献

我们欢迎贡献者。Lorelum 是 **open-core** 项目（见 [License 架构](#license)）——核心引擎、格式规范、社区知识包永远开源。

- 📖 开发流程见 [**CONTRIBUTING.md**](./CONTRIBUTING.md)（规格驱动 + issue 驱动）
- 🤖 用 AI 编码工具参与？也请读一下 [**AGENTS.md**](./AGENTS.md)
- 💬 想法或建议，到 [Discussions](https://github.com/lorelum/lorelum/discussions) 聊聊
- 🐛 发现 bug？[提个 issue](https://github.com/lorelum/lorelum/issues/new/choose)

## License

Lorelum 采用 **open-core** 模式：

| 组件                                     | License                           |
| ---------------------------------------- | --------------------------------- |
| 核心引擎（CLI、本地检索、MCP、格式规范） | **Apache 2.0**                    |
| 社区知识包内容                           | **CC-BY-4.0**                     |
| 端点服务内核（可自托管）                 | **AGPL-3.0** _（独立仓库，后期）_ |
| SaaS 平台与企业治理                      | **专有** _（独立仓库，后期）_     |

边界一句话：**能让开发者离线跑通完整流程的部分，永远开源。** 付费买的是托管运维、团队协作、企业合规，不是被阉割的功能。

本仓库适用 Apache 2.0，全文见 [LICENSE](./LICENSE)。

## 注释

<ol>
<li id="fn-1">约 68% 的合规率来自 <em>IFScale</em> 基准测试（<a href="https://arxiv.org/abs/2507.11538">Jaroslawicz et al., 2025</a>，NeurIPS 2025）：即便最好的前沿模型，在 500 条同时下发的关键词类指令中也只遵循了约 68%，且准确率随指令密度增加而持续下降。<a href="https://paddo.dev/blog/your-agents-md-is-a-liability/">《Your AGENTS.md is a Liability》</a>一文专门讨论了这对大型规则文件意味着什么。</li>
<li id="fn-2">召回率与位置相关，见 <em>Lost in the Middle</em>（<a href="https://arxiv.org/abs/2307.03172">Liu et al., TACL 2024</a>）：模型对长上下文开头和结尾的信息召回更好，中间位置明显变差——呈 U 型曲线，且在标称上下文窗口内依然成立。</li>
</ol>

## 致谢

Lorelum 站在 AI 编码与开发者工具社区众多先行者的肩膀上。名字取自 **Lore**（通过实践代代相传的非正式知识）+ **Lum**（源自 lumen，光）——把团队的工程经验，化作 AI 可以依循的光。
