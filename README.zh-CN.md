<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">AI Agent 时代的工程知识基础设施。</p>
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

- **规则被静默忽略。** 前沿模型对 500 条规则的合规率只有约 68%——*你每多写一条规则，其它规则被遵守的概率都在下降。*<sup>[\[1\]](#fn-1)</sup> 没有任何提示，Agent 就这么悄悄偏离了。
- **压缩（compaction）吞掉了规则。** 长会话触发上下文压缩 → 你会话开头写的 `AGENTS.md` 已经不在窗口里了。社区公认的唯一解法是重新 `@AGENTS.md`，把**全部**规则再灌一遍。
- **等发现时已经晚了。** Agent 是否已经偏离，你得不到任何信号——直到自己 review 代码时才发现违规。

这是 AI 编码的**知识层缺位**：你的规则存在，却没能在 Agent **需要的那一刻**抵达它。

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
        ├─▶ 压缩把规则丢掉        长会话触发上下文压缩，
        │                          规则被挤出窗口
        │
        └─▶ 偏离静默发生          没有任何信号，直到你 review
                                    代码才发现违规
```

常见做法（"把规则全量塞进上下文"）对抗的是物理限制：长会话中的注意力衰减、上下文窗口容量，以及"**规则越多，每条合规率越低**"这个事实。<sup>[\[2\]](#fn-2)</sup> 即便 1M token 的窗口，压缩之后早期指令的召回率也不可靠。**规则越多 ≠ 控制力越强。** 靠堆上下文解决不了根本问题。

## Lorelum 怎么解决

Lorelum 把团队工程经验切成**离散、可检索、带触发条件的 *Practice***——在 AI **需要的时候**才精准注入，而不是一开始全量灌。

```
   ┌─────────────┐   查询     ┌────────────────────┐   精准    ┌──────────────┐
   │   AI 工具   │ ────────▶ │      Lorelum       │ ────────▶ │  3 条相关的  │
   │ (Cursor /   │           │    检索引擎         │           │   Practice   │
   │  Claude /   │ ◀──────── │ （语义+元数据+图谱）│ ◀─────────│  + 反模式    │
   │  Codex)     │   注入    └────────────────────┘           └──────────────┘
   └─────────────┘
```

**Lorelum 不替代你的 `AGENTS.md`，而是让它保持鲜活。** 每次 Agent 需要其中的一块时，Lorelum 都把那一片精准切片重新注入。当 AI 开始实现认证模块时，Lorelum 只给它 auth 相关的 Practice，而不是把路由、测试、部署的规范也一起塞进来。

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
- api.direct-axios-in-component   （在组件里直接调 axios）
- api.local-storage-in-api-class  （在 API 类里持久化 token）
- api.dto-used-as-ui-model        （DTO 直接当 UI 模型用）
```

一个 **Knowledge Pack（知识包）** 把多条 Practice + 决策图谱（`decisions.yaml`）+ 模板 + 反模式打包，绑定到某个技术栈或团队标准。

## 端到端示例

同一个任务、同一个 Agent——一次没有 Lorelum，一次有。

### 场景

一个很长的会话。你的 `AGENTS.md` 写着*"API 要分层；绝不要在组件里直接调 axios"*。但那是 40 条消息之前的事了，上下文刚刚被压缩过。此时 Agent 被要求写一个登录页。

### 没有 Lorelum —— Agent 偏离了

```tsx
// LoginPage.tsx —— Agent 写出来的
function LoginPage() {
  const [email, setEmail] = useState("");
  async function handleLogin() {
    const res = await axios.post("/api/login", { email });  // ❌ 组件里直接调 axios
    localStorage.setItem("token", res.data.token);           // ❌ token 存进 localStorage
  }
}
```

它在组件里直接调了 `axios`，还把 token 塞进了 `localStorage`。你的规则明明禁止这么做。Agent 自己并不知道违规了。

### 有 Lorelum —— 触发式注入，不是全量灌

当 Agent 触碰 `src/features/auth/` 时，Lorelum 只检索出唯一相关的那条 Practice——`react.api.layered-design`——并只注入这一片切片：

```markdown
## 要避免的反模式
- api.direct-axios-in-component   （在组件里直接调 axios）
- api.local-storage-in-api-class  （在 API 类里持久化 token）
- api.dto-used-as-ui-model        （DTO 直接当 UI 模型用）
```

Agent 随即重写了自己的输出——*常新的、来自相关切片的，而非整套规则*：

```tsx
// LoginPage.tsx —— 注入后 Agent 自我修正
function LoginPage() {
  const { login } = useAuthApi();   // ✅ 走分层 API client
  async function handleLogin() {
    await login({ email });          // ✅ token 在 API 层内部处理
  }
}
```

### 闭环

```bash
lore check src/features/auth/LoginPage.tsx   # 确认无违规
lore learn "HTTP client 里的 single-flight refresh token"
```

这次修复从此成为全团队下次都能检索到的 Practice——不需要任何人重新粘贴 `AGENTS.md`。

## 5 分钟了解

*（CLI 处于 pre-alpha，以下命令展示的是设计中的交互形态。）*

```bash
# 安装一个社区知识包（本地模式，离线可用）
lore install react-fullstack

# 问：我当前的任务该遵循哪些 Practice？
lore query "带权限控制、表单、测试的设置页"

# 根据项目上下文，给出技术决策建议
lore decide "React SPA，中等复杂度客户端状态，RBAC 路由，组件测试"

# 检查代码是否违反了某条 Practice
lore check src/features/auth/LoginPage.tsx

# 把一次成功的修复沉淀成团队可复用的 Practice
lore learn "HTTP client 里的 single-flight refresh token"
```

或者通过 MCP 接入你的 AI 工具——Lorelum 提供 MCP Server，任何兼容 MCP 的工具（Cursor、Claude Code、Codex、Windsurf……）都能调用。

## 和现有方案有什么不同

| | `AGENTS.md` / `.cursorrules` | Skills / 斜杠命令 | **Lorelum** |
|---|---|---|---|
| **供给方式** | 静态、全量灌入 | 手动触发 | **按需检索** |
| **长会话衰减** | 会 | 不会（一次性） | 不会（每次查询都新鲜） |
| **压缩后重注入** | 手动：重新粘贴全部规则 | 手动 | ✅ 自动、按任务切片 |
| **支持上百条规则** | ❌ | 繁琐 | ✅ 为此而生 |
| **承载团队决策** | 否 | 否 | ✅ `decisions.yaml` |
| **工具中立** | 绑定单一工具 | 绑定单一工具 | ✅ MCP / CLI / Skill |
| **反模式检查** | 否 | 否 | ✅ `lore check` |

Lorelum 不是"更好的 .cursorrules"，而是位于你所用 AI 工具背后的**检索与决策层**。

## 架构（简述）

```
┌──────────────────────────────────────────────────────────┐
│        AI 工具层（Cursor / Claude Code / Codex / Windsurf）│
└────────────┬─────────────────────────────────┬───────────┘
             │ CLI                              │ MCP
             ▼                                  ▼
┌──────────────────────────────────────────────────────────┐
│                    Lorelum 引擎                          │
│     检索（语义 + 元数据 + 图谱）· decisions.yaml 决策     │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴─────────┐
   ▼                   ▼
本地知识包          端点（团队 / SaaS / 自托管）
（离线可用）        （实时、多用户）
```

两种模式共用同一套命令：
- **本地模式（默认）：** `lore install` 一个公开包，离线查询，零运维。像 npm 一样简单。
- **端点模式：** 把 CLI 指向团队 / SaaS / 自托管端点，享受实时同步与多人协作。

## 路线图

我们以里程碑方式公开推进：

- **P0–P2** — 核心引擎：Practice 格式、检索（语义 + 元数据）、`lore query` / `get` / `decide` / `check`。仅本地模式。
- **P3–P4** — 第一个公开包（`react-fullstack`）、MCP Server、`lore install` / `search`、公开 Registry MVP。
- **P5** — 端点服务内核（AGPL，可自托管）、团队知识包、决策图谱执行器。
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

| 组件 | License |
|---|---|
| 核心引擎（CLI、本地检索、MCP、格式规范） | **Apache 2.0** |
| 社区知识包内容 | **CC-BY-4.0** |
| 端点服务内核（可自托管） | **AGPL-3.0** *（独立仓库，后期）* |
| SaaS 平台与企业治理 | **专有** *（独立仓库，后期）* |

边界一句话：**能让开发者离线跑通完整流程的部分，永远开源。** 付费买的是托管运维、团队协作、企业合规，不是被阉割的功能。

本仓库适用 Apache 2.0，全文见 [LICENSE](./LICENSE)。

## 注释

<ol>
<li id="fn-1">约 68% 的合规率来自 <em>IFScale</em> 基准测试（<a href="https://arxiv.org/abs/2507.11538">Jaroslawicz et al., 2025</a>，NeurIPS 2025）：即便最好的前沿模型，在 500 条同时下发的关键词类指令中也只遵循了约 68%，且准确率随指令密度增加而持续下降。<a href="https://paddo.dev/blog/your-agents-md-is-a-liability/">《Your AGENTS.md is a Liability》</a>一文专门讨论了这对大型规则文件意味着什么。</li>
<li id="fn-2">召回率与位置相关，见 <em>Lost in the Middle</em>（<a href="https://arxiv.org/abs/2307.03172">Liu et al., TACL 2024</a>）：模型对长上下文开头和结尾的信息召回更好，中间位置明显变差——呈 U 型曲线，且在标称上下文窗口内依然成立。</li>
</ol>

## 致谢

Lorelum 站在 AI 编码与开发者工具社区众多先行者的肩膀上。名字取自 **Lore**（通过实践代代相传的非正式知识）+ **Lum**（源自 lumen，光）——把团队的工程经验，化作 AI 可以依循的光。
