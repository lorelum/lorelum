<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">在正确的任务、正确的时刻，为 Agent 提供正确的工程 Practice。</p>
  <p align="center">
    <a href="./LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
    <a href="https://github.com/lorelum/lorelum/releases"><img alt="状态：public alpha" src="https://img.shields.io/badge/status-public%20alpha-orange"></a>
    <a href="./CONTRIBUTING.md"><img alt="欢迎贡献" src="https://img.shields.io/badge/contributions-welcome-brightgreen"></a>
  </p>
  <p align="center">
    <a href="https://lorelum.com/zh/docs">文档</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="https://github.com/lorelum/lorelum-packs">Knowledge Packs</a> ·
    <a href="./README.md">English</a>
  </p>
</p>

---

> **Public alpha · `0.1.0-alpha.1`。** 提供 macOS Apple Silicon、Linux x64 和 Windows x64 的预编译发行包。macOS 是 Lorelum 优先适配、验证更充分的发布平台；Linux 和 Windows 提供尽力支持，不保证在所有发行版、系统构建、硬件和本地安全策略下的兼容性与性能。CLI 合同、Pack 格式和索引可能随版本变化，暂不保证自动迁移。

> **将下面提示交给 Agent。**
>
> ```text
> 请根据 https://lorelum.com/zh/docs/agents.md 为当前项目配置 Lorelum v0.1.0-alpha.1。
> 安装 CLI 和 agentic-coding Pack，为当前宿主接入 Lorelum Skill；开始实际工作前，
> 完成一次自然语言检索和 Practice 全文读取来验证配置。
> ```

Lorelum 是工程知识的本地检索层。它把可复用的工程经验组织成 **Practice**：独立完整、带适用条件的指导。**Knowledge Pack（知识包）** 将 Practice 组织成可安装、可分享的版本化集合。

## 代码能运行，工程判断仍然需要有人负责

你让 Agent 实现一个登录页。页面正常渲染，表单可以提交，简单的浏览器检查也通过了。但组件同时承担了 HTTP 请求和 token 持久化。仅凭可见结果，很难判断实现是否遵守了应用的架构与安全边界。

如果你了解这些边界，可以在 review 时发现问题。如果你正是因为缺少相关经验，才借助 Agent 完成产品，你可能连应该追问什么都不知道。无论哪种情况，等到结果摆在面前时，工程选择已经做出了。

困境也发生在更小的判断中。一个设置卡片被加入额外交互和抽象，因为这些看起来像认真完成工作；一个长任务在组件测试通过后就被宣布完成，却还没有检查持久化或鉴权。写出代码、判断哪些工作属于需求、确认什么证据足以证明完成，是不同的工程判断。

这就是**知识与判断缺位**：能够改善决策的指导，可能尚未具备、没有被注意到，或被用在了不适合的条件下。

## 为什么继续增加指令还不够

`AGENTS.md`、`CLAUDE.md` 和 Skill 能为 Agent 提供有价值的指令。团队可以在其中记录约定，但随着内容增长，Agent 仍需判断哪条建议与眼前的工作有关。部署规则、UI 模式和数据库迁移清单都可能正确，却未必都适用于这次改动。

指导出现的时机也很重要。范围指导应在计划膨胀前发挥作用，验证指导应在宣布成功前进入判断。如果 compaction 后的摘要保留了通过的测试，却丢失了它对应的验收条件，继续加入通用规则并不能恢复那些事实。Agent 需要识别当前判断，再回到相关依据。

更何况，编写更大的规则库，前提是你已经知道应该写什么。小团队或 vibe coder 可能需要尚未积累的工程经验；有经验的团队则希望那些付出代价换来的教训，不只停留在撰写者的记忆里。

## 让相关 Practice 在决策时进入上下文

Lorelum 让工程经验可以在有帮助时被检索。Practice 写清具体做法、适用的任务或时刻，以及需要避免的反模式；Knowledge Pack 将这些指导组织成可以评审、版本化管理、跨 Agent 复用的集合。

选择登录页的实现方式前，Agent 可以描述认证改动，以及正在判断的责任边界；规划设置卡片前，可以寻找范围控制和适度验证的指导。Lorelum 根据描述检索已安装 Pack，Agent 从相关摘要中选择候选、读取完整 Practice，再结合仓库和用户要求判断如何应用。

专业团队可以把自己的标准整理成 Pack；vibe coder 和小团队也可以从共享 Pack 开始，不必先独自发现所有工程反模式。目标是在需要判断的时刻，让有用的知识和它的适用条件一起出现。Agent 仍需对决策负责，并用实际证据验证工作结果。

## 看看它如何使用

确定实现计划前，先描述当前任务和时刻：

```sh
lore query "我正在按现有设计实现设置卡片，准备确定改动范围、实现计划和验证方式。"
```

根据结果中的 `title` 和 `appliesWhen` 选择候选，再通过 `practiceId` 读取全文：

```sh
lore get <practice-id>
```

同一任务在不同阶段，可能需要不同的指导：

| 时刻             | Agent 可以寻找的指导                   |
| ---------------- | -------------------------------------- |
| 确定范围         | 哪些改动属于需求，哪些会引入额外工作？ |
| 选择实现         | 哪些既有合同和工程边界需要遵守？       |
| 上下文丢失后恢复 | 哪些需求、决策和证据需要重新核实？     |
| 准备宣布完成     | 验证是否覆盖了用户要求的完整结果？     |

Agent 判断何时查询、哪些 Practice 适用。Lorelum 提供检索到的知识，Agent 继续对工作负责。

## 当前可以使用什么

- **本地 semantic retrieval。** 用 `lore query` 围绕任务和时刻检索已安装 Practice，本地 Backend 在请求之间复用 embedding 模型。
- **Practice 全文读取。** 用 `lore get` 阅读完整指导和适用条件，再决定如何应用。
- **版本化 Knowledge Pack。** 安装、查看、更新和移除 Pack，通过 `--store-root` 管理独立知识集合。
- **Agent 集成。** 在能执行命令的 Agent 中使用 Lorelum Skill；Codex 可使用包含已安装 Pack 目录的官方 Plugin。
- **明确的离线路径。** 用 `lore query --mode keyword` 按关键词匹配，无需模型或 Backend。
- **Pack 编写工具。** 通过 CLI 验证源文件、格式化 Practice，并维护本地化状态。

自然语言查询使用固定的本地 embedding 模型和所选 Store 的索引。首次安装 Pack 和准备模型需要下载；准备完成后，检索在本地运行。Lorelum 检索已安装知识，不搜索互联网。

## 快速开始

### 1. 安装 CLI

请选择运行 `lore` 的宿主对应的安装器。

#### macOS Apple Silicon 和 Linux x64

```sh
curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version 0.1.0-alpha.1
```

#### Windows x64

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version 0.1.0-alpha.1
```

macOS/Linux 安装器会校验发行包，并创建 `~/.local/bin/lore`；Windows 安装器校验 ZIP，并创建 `$env:LOCALAPPDATA\Lorelum\bin\lore.cmd`。请保留完整发行目录，semantic retrieval 需要随可执行文件分发的原生库和运行时资源。Windows 不要运行 `install.sh`，也不要双击安装脚本；请在已打开的 PowerShell 中运行上面的命令，保留错误输出。

macOS 和 Linux 请确认 `~/.local/bin` 已加入 `PATH`。Windows 安装器会在需要时将 `$env:LOCALAPPDATA\Lorelum\bin` 加入用户级 `Path`；重新打开终端后检查：

```sh
lore --version
```

手动安装、源码构建和更新说明见[安装指南](https://lorelum.com/zh/docs/installation)。

### 2. 安装 Pack

```sh
lore pack install agentic-coding
```

安装保存 Pack，并启动所需的 semantic index 工作。响应中的 `data.indexSync` 表示索引已就绪、尚未完成或失败。索引失败不会撤销 Pack 安装。

### 3. 检索并阅读

```sh
lore query "我正在修改登录流程，准备确定编码前需要检查的既有 API 和安全边界。"
lore get <practice-id>
```

将 `<practice-id>` 替换为 `data.results` 中的 `practiceId`。读完正文，再检查它是否适用于当前任务。

首次使用时，模型下载或加载可能让 query 返回 `data.state: "preparing"`。运行 `lore model load` 等待，再重试。如果 query 报告索引缺失，运行 `lore index build`；若返回 operation ID，用 `lore index operation <operation-id>` 检查直到完成。恢复步骤见[故障排查](https://lorelum.com/zh/docs/troubleshooting)。

## 接入 Agent

Skill 指导 Agent 判断何时检索、如何描述任务和时刻，以及为什么应用前需要读取完整 Practice。

| 宿主                   | 接入方式                                  |
| ---------------------- | ----------------------------------------- |
| Codex                  | 官方 Plugin，包含 Skill 和 Pack 目录 Hook |
| Claude Code            | 项目级或个人级 Lorelum Skill              |
| Cursor                 | 项目级 Lorelum Skill                      |
| 其他能执行命令的 Agent | 宿主支持的 Skill 或项目指令               |

Codex 用户安装 CLI 和 Pack 后运行：

```sh
codex plugin marketplace add lorelum/lorelum
codex plugin add lorelum@lorelum
```

按提示审阅 Hook，再启动新任务。Hook 通过 `lore pack list --details` 读取已安装 Pack 的元数据，Skill 判断何时查询并读取 Practice。Plugin 不内置 CLI。

安装与验证步骤见[接入 Agent](https://lorelum.com/zh/docs/agent-setup)和 [Codex 配置](https://lorelum.com/zh/docs/codex)。

## 选择或创建 Knowledge Pack

| 官方 Pack        | 版本    | 重点                                     |
| ---------------- | ------- | ---------------------------------------- |
| `agentic-coding` | `0.3.1` | 规划、实现、验证、恢复和交付中的工程判断 |
| `pack-creator`   | `0.1.0` | Practice 与 Pack 的编写、评审和发布      |
| `react-web-craft` | `0.1.0` | React Web 应用设计与性能：组件状态、异步数据流、代码加载、渲染与组合 |

浏览已经安装的内容：

```sh
lore pack list --details
lore pack list agentic-coding
```

Practice 是带结构化元数据的 Markdown 文档，例如：

```markdown
---
id: delivery.verify-user-flow
title: 验证完整用户流程
stage: verification
tech_stack: [web]
applies_when: 准备报告用户可见改动已完成时。
severity: warn
---

1. 选择验证方式前，阅读已确认的验收条件。
2. 检查用户操作、可观察结果和相关失败路径。
3. 分别报告已验证的条件与尚未完成的部分。

验证规模应与实际改动和风险相称。仅修改文案时，无需重新验证无关的 API 或存储行为。
```

每条 Practice 都应能独立理解：Agent 可能只检索到其中一条，并没有阅读整个 Pack。[创建 Pack](https://lorelum.com/zh/docs/create-pack)提供完整、可验证的示例，也可以浏览[官方 Pack 仓库](https://github.com/lorelum/lorelum-packs)。

## 职责与边界

| 组成部分       | 职责                                                 |
| -------------- | ---------------------------------------------------- |
| Agent 与 Skill | 描述任务和时刻、请求指导、阅读全文，并判断适用性。   |
| Lorelum 检索   | 搜索已安装 Pack、排序候选，返回摘要或完整 Practice。 |
| 本地 Backend   | 承载模型运行时和持续执行的 semantic index 工作。     |
| Store          | 保存所选 root 下的已安装 Pack 和派生索引。           |

Lorelum Core 不管理任务、不读取完整 transcript，也不判断实现是否通过验收。检索到的 Practice 是指导，不能代替验证证据。

当前 Codex Hook 在受支持的会话事件中提供 Pack 目录。更完整的 compaction 前后指导取决于宿主能力，仍属于[研究方向](https://github.com/lorelum/lorelum/issues/32)。当前用户通过 CLI 和 Skill 接入。

## 文档与贡献

- [用户文档](https://lorelum.com/zh/docs)：使用指南、配置和故障排查。
- [CLI 参考](https://lorelum.com/zh/docs/cli)：命令、JSON 响应、错误与退出码。运行 `lore describe query` 可查看已安装版本的 schema。
- [开发指南](./docs/development/README.md)：源码构建、本地 CLI 和独立 Store。
- [贡献指南](./CONTRIBUTING.md)：Issue、设计对齐、测试和 Pull Request。
- [本仓库的 Agent 指令](./AGENTS.md)：AI 辅助贡献的工作约定。
- [Discussions](https://github.com/lorelum/lorelum/discussions) 与 [Issues](https://github.com/lorelum/lorelum/issues)：问题、建议和缺陷报告。
- [安全政策](./SECURITY.md)：私下报告安全漏洞。

## License

本仓库采用 [Apache 2.0](./LICENSE)。[官方 Knowledge Pack](https://github.com/lorelum/lorelum-packs) 使用 CC-BY-4.0；其他 Pack 遵循各自的许可证。

Lorelum 的名字来自 **Lore**（通过实践传承的知识）和 **Lum**（光）：让工程经验成为 AI Agent 可以依循的指引。
