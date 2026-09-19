/**
 * Transitional string dictionaries for the legacy landing page and shared UI.
 *
 * Fumadocs localizes its own built-in UI (search trigger, TOC, etc.) via
 * the language packs wired in `__root.tsx`. This module covers the strings
 * we author ourselves (landing hero, sections, terminal demo, 404, nav title).
 *
 * Keep the shape flat: one key per string, one object per locale. The
 * `legacy-translations.test.ts` guards that `en` and `zh` stay in lockstep.
 * A later i18n migration will split these strings by feature namespace.
 */

export interface LandingStrings {
  tagline: string;
  readDocs: string;
  navHome: string;
  navDocs: string;
  navBlog: string;
  // Blog
  blogIndexDescription: string;
  blogEmpty: string;
  blogOnThisPage: string;
  toggleTheme: string;
  // Hero
  heroBadge: string;
  heroTitleBefore: string;
  heroTitleGradient: string;
  heroTitleAfter: string;
  /** Trailing punctuation rendered after the gradient word, on line one. */
  heroTitleComma: string;
  heroSub: string;
  /** Loop of short phrases the hero typewriter cycles through. */
  heroTypewriter: string[];
  heroTrust: string;
  ctaDocs: string;
  ctaGithub: string;
  // Terminal showcase
  terminalSectionTitle: string;
  terminalSectionSub: string;
  terminalWindowTitle: string;
  /** Natural-language query and readable guidance used by the visual demo. */
  demoQuery: string;
  demoMatchLabel: string;
  demoReadNext: string;
  demoGuidanceLabel: string;
  demoGuidance: string[];
  getTitle: string;
  appliesWhen: string;
  // Problem
  problemEyebrow: string;
  problemHeading: string;
  problemSub: string;
  problem1Title: string;
  problem1Body: string;
  problem2Title: string;
  problem2Body: string;
  problem3Title: string;
  problem3Body: string;
  // Features
  featuresEyebrow: string;
  featuresHeading: string;
  featuresSub: string;
  feature1Title: string;
  feature1Body: string;
  feature2Title: string;
  feature2Body: string;
  feature3Title: string;
  feature3Body: string;
  feature4Title: string;
  feature4Body: string;
  // Stats
  statsEyebrow: string;
  statsHeading: string;
  stats1Label: string;
  stats2Label: string;
  stats3Label: string;
  // Ecosystem
  ecosystemEyebrow: string;
  ecosystemHeading: string;
  ecosystemSub: string;
  // FAQ
  faqEyebrow: string;
  faqHeading: string;
  faq1q: string;
  faq1a: string;
  faq2q: string;
  faq2a: string;
  faq3q: string;
  faq3a: string;
  faq4q: string;
  faq4a: string;
  // CTA + footer
  ctaHeading: string;
  ctaSub: string;
  footerDocs: string;
  footerGithub: string;
  footerDiscussions: string;
  footerLicense: string;
  notFoundTitle: string;
  notFoundDescription: string;
  backHome: string;
  switchTo: string;
}

const en: LandingStrings = {
  tagline: "The right engineering Practice for the right AI coding task and moment.",
  readDocs: "Read the docs",
  navHome: "Home",
  navDocs: "Docs",
  navBlog: "Blog",
  blogIndexDescription:
    "Engineering notes from the Lorelum team: benchmarks, measurement work, and Pack engineering.",
  blogEmpty: "No posts yet.",
  blogOnThisPage: "On this page",
  toggleTheme: "Toggle theme",
  heroBadge: "Engineering knowledge for Agent decisions",
  heroTitleBefore: "The right ",
  heroTitleGradient: "Practice",
  heroTitleComma: ",",
  heroTitleAfter: "at the right moment.",
  heroSub:
    "Turn engineering experience into Practices your agent can retrieve for the current task. Bring team standards and shared knowledge into planning, implementation, and verification.",
  heroTypewriter: [
    "Define the scope before planning.",
    "Read the guidance before applying it.",
    "Match completion claims to evidence.",
  ],
  heroTrust: "Public alpha · Local retrieval · Apache-2.0",
  ctaDocs: "Read the docs",
  ctaGithub: "View on GitHub",
  terminalSectionTitle: "Describe the task. Read the guidance.",
  terminalSectionSub:
    "Search for the decision in front of you, then read a relevant Practice before applying it.",
  terminalWindowTitle: "lore — example workflow",
  demoQuery: "The code changed after tests passed. Can I still use those results?",
  demoMatchLabel: "Relevant Practice",
  demoReadNext: "Next: read the full Practice to check how it applies.",
  demoGuidanceLabel: "Guidance",
  demoGuidance: [
    "Check whether the code, config, or data changed after verification.",
    "Repeat affected checks before relying on earlier results.",
    "Report what the evidence covers and what remains unverified.",
  ],
  getTitle: "Reuse Evidence Only When It Still Applies",
  appliesWhen: "When earlier test results may no longer describe the current work.",
  problemEyebrow: "The engineering judgment gap",
  problemHeading: "Available guidance still needs attention.",
  problemSub:
    "Skills and project instructions can be reinjected. As context grows, attention can still fade and relevant guidance can compete with unrelated information.",
  problem1Title: "More context, competing signals",
  problem1Body:
    "Requirements, rules, code, and exploration accumulate in a long task. A rule can remain in context while receiving too little attention at the decision that needs it.",
  problem2Title: "Correct advice, wrong scope",
  problem2Body:
    "A familiar best practice can add unnecessary work to a small change. The agent needs to judge which guidance fits this task, its risk, and its current moment.",
  problem3Title: "Experience you have yet to collect",
  problem3Body:
    "Writing project rules assumes you know what to include. Shared Knowledge Packs make engineering experience available before your team has learned every lesson itself.",
  featuresEyebrow: "How Lorelum helps",
  featuresHeading: "Retrieve guidance for the decision ahead.",
  featuresSub:
    "Describe the task and moment, select relevant Practices, and read their applicability conditions before using them.",
  feature1Title: "Guidance with applicability",
  feature1Body:
    "Each Practice explains what to do, when it applies, and which anti-patterns to avoid. Keep the context that makes engineering advice useful.",
  feature2Title: "Local semantic retrieval",
  feature2Body:
    "Query installed Packs in natural language. Read selected Practices in full and retrieve again when the decision changes.",
  feature3Title: "CLI, Skill, and Codex",
  feature3Body:
    "Use the CLI from a command-capable agent. The Skill guides retrieval, and the Codex Plugin supplies an installed-Pack catalog.",
  feature4Title: "Knowledge you can maintain",
  feature4Body:
    "Version and share team Practices in Packs, or start with official Packs. Review, validate, and update guidance as your work evolves.",
  statsEyebrow: "Public alpha",
  statsHeading: "A local foundation for shared knowledge",
  stats1Label: "local retrieval engine",
  stats2Label: "official Knowledge Packs",
  stats3Label: "open-source Core · Apache-2.0",
  ecosystemEyebrow: "Agent integrations",
  ecosystemHeading: "Bring the knowledge to your workflow.",
  ecosystemSub:
    "Agents that can execute commands can use lore. Install the Skill through your host's supported mechanism; Codex also has an official Plugin.",
  faqEyebrow: "Before you start",
  faqHeading: "Using Lorelum",
  faq1q: "What is available in the alpha?",
  faq1a:
    "Local semantic query, full Practice reads, Pack management, and CLI-based agent integration. Prebuilt releases support macOS on Apple Silicon, Linux x64, and Windows x64; macOS is the priority platform, while Linux and Windows are best-effort. Lorelum Core is Apache-2.0 open source.",
  faq2q: "How does Lorelum work with Skills and AGENTS.md?",
  faq2a:
    "Keep project instructions for repository rules and use Skills to guide agent behavior. Lorelum supplies versioned engineering knowledge they can retrieve for the current decision. Reinjection makes instructions available; it does not guarantee that a growing context receives equal attention.",
  faq3q: "Do I need to write my own Practices first?",
  faq3a:
    "Start with agentic-coding for planning, implementation, verification, recovery, and delivery guidance. Use pack-creator when you want to write and review your own Packs.",
  faq4q: "Where does retrieval run?",
  faq4a:
    "Packs and indexes live in your local Store, and semantic retrieval uses a local model. Initial setup downloads Pack and model files. Practices read by an agent enter that agent's context, subject to the host's own data handling.",
  ctaHeading: "Bring experience into the next decision.",
  ctaSub: "Install a Pack, describe the task, and read the guidance that applies.",
  footerDocs: "Docs",
  footerGithub: "GitHub",
  footerDiscussions: "Discussions",
  footerLicense: "Apache-2.0",
  notFoundTitle: "Page not found",
  notFoundDescription:
    "This page is unavailable. Return to the homepage or use the documentation to find what you need.",
  backHome: "Back to home",
  switchTo: "Switch language to",
};

const zh: LandingStrings = {
  tagline: "在正确的任务、正确的时刻，为 Agent 提供正确的工程 Practice。",
  readDocs: "阅读文档",
  navHome: "首页",
  navDocs: "文档",
  navBlog: "博客",
  blogIndexDescription: "Lorelum 团队的工程笔记：benchmark、测量工作与 Pack 工程。",
  blogEmpty: "暂无文章。",
  blogOnThisPage: "本页目录",
  toggleTheme: "切换主题",
  heroBadge: "为 Agent 提供工程判断依据",
  heroTitleBefore: "正确的 ",
  heroTitleGradient: "Practice",
  heroTitleComma: "，",
  heroTitleAfter: "出现在正确的时刻。",
  heroSub:
    "将工程经验整理为可检索的 Practice，让 Agent 围绕当前任务获取指导。让团队标准与共享知识参与规划、实现和验证。",
  heroTypewriter: ["规划前，明确需求范围。", "应用前，读完相关指导。", "交付前，让结论对应证据。"],
  heroTrust: "Public alpha · 本地检索 · Apache-2.0",
  ctaDocs: "阅读文档",
  ctaGithub: "在 GitHub 查看",
  terminalSectionTitle: "描述任务，读取相关指导。",
  terminalSectionSub: "围绕眼前的判断发起查询，读完相关 Practice 后再应用。",
  terminalWindowTitle: "lore — 使用示例",
  demoQuery: "测试通过后代码又改了，之前的结果还能作为完成依据吗？",
  demoMatchLabel: "相关 Practice",
  demoReadNext: "下一步：读取完整 Practice，确认如何应用。",
  demoGuidanceLabel: "工程指导",
  demoGuidance: [
    "检查验证之后，代码、配置或数据是否发生变化。",
    "复用旧结果前，重新执行受这些变化影响的检查。",
    "说明证据覆盖的范围，以及仍未验证的部分。",
  ],
  getTitle: "仅在仍然适用时复用证据",
  appliesWhen: "适用于先前测试结果可能已不再代表当前改动的情况。",
  problemEyebrow: "工程判断的难题",
  problemHeading: "指导仍在，关注却可能减弱。",
  problemSub:
    "Skill 和项目指令可以重新注入。随着上下文变长，注意力仍可能衰减，相关指导也会与其他信息争夺关注。",
  problem1Title: "上下文越长，信号越多",
  problem1Body:
    "长任务不断积累需求、规则、代码和探索记录。规则仍在上下文里，却可能在需要它的那次判断中没有得到足够关注。",
  problem2Title: "建议正确，也要判断适用性",
  problem2Body:
    "熟悉的最佳实践也可能给局部改动增加多余工作。Agent 需要判断哪些指导适合当前任务、风险和时刻。",
  problem3Title: "有些经验，尚未积累",
  problem3Body:
    "编写项目规则的前提，是你知道该写什么。共享 Knowledge Pack 让团队可以获取尚未积累的工程经验。",
  featuresEyebrow: "Lorelum 如何介入",
  featuresHeading: "围绕下一次判断，检索相关指导。",
  featuresSub: "描述任务和时刻，选择相关 Practice，读完适用条件后再应用。",
  feature1Title: "带适用条件的指导",
  feature1Body:
    "每条 Practice 说明具体做法、适用条件和需要避免的反模式，让工程建议保留必要的上下文。",
  feature2Title: "本地 semantic retrieval",
  feature2Body:
    "用自然语言查询已安装 Pack，选择相关 Practice 并读取全文。需要做出的判断变化时，可以再次检索。",
  feature3Title: "CLI、Skill 与 Codex",
  feature3Body:
    "能执行命令的 Agent 可以调用 CLI。Skill 指导何时检索，Codex Plugin 提供已安装 Pack 的目录。",
  feature4Title: "可以持续维护的知识",
  feature4Body:
    "将团队 Practice 组织成可版本化、可分享的 Pack，也可以从官方 Pack 开始。随着工作演进，评审、验证并更新指导。",
  statsEyebrow: "Public alpha",
  statsHeading: "在本地使用可共享的工程知识",
  stats1Label: "个本地检索引擎",
  stats2Label: "个官方 Knowledge Pack",
  stats3Label: "Core 开源 · Apache-2.0",
  ecosystemEyebrow: "Agent 集成",
  ecosystemHeading: "让知识参与现有工作流。",
  ecosystemSub:
    "能执行命令的 Agent 可以调用 lore。按宿主支持的方式安装 Skill，Codex 还提供官方 Plugin。",
  faqEyebrow: "开始使用前",
  faqHeading: "了解 Lorelum 的使用方式",
  faq1q: "Alpha 提供哪些能力？",
  faq1a:
    "本地 semantic query、Practice 全文读取、Pack 管理，以及通过 CLI 接入 Agent。预编译发行包支持 macOS Apple Silicon、Linux x64 和 Windows x64；macOS 为优先适配平台，Linux 和 Windows 为尽力支持。Lorelum Core 采用 Apache-2.0 开源。",
  faq2q: "如何与 Skill、AGENTS.md 一起使用？",
  faq2a:
    "项目指令继续承载仓库规则，Skill 指导 Agent 行为。Lorelum 提供可版本化的工程知识，供它们围绕当前判断检索。重新注入让指令可用，但不保证变长的上下文中每条指令都获得同样的关注。",
  faq3q: "需要先编写自己的 Practice 吗？",
  faq3a:
    "可以从 agentic-coding 开始，获取规划、实现、验证、恢复和交付中的指导。需要编写和评审自己的 Pack 时，再使用 pack-creator。",
  faq4q: "检索在哪里运行？",
  faq4a:
    "Pack 和索引保存在本地 Store，semantic retrieval 使用本地模型。首次配置需要下载 Pack 和模型文件。Agent 读取的 Practice 会进入它的上下文，后续数据处理遵循对应宿主的规则。",
  ctaHeading: "让工程经验参与下一次判断。",
  ctaSub: "安装 Pack，描述任务，读完适用的指导。",
  footerDocs: "文档",
  footerGithub: "GitHub",
  footerDiscussions: "讨论",
  footerLicense: "Apache-2.0",
  notFoundTitle: "页面未找到",
  notFoundDescription: "此页面暂不可用。可以返回首页，或通过文档查找所需内容。",
  backHome: "返回首页",
  switchTo: "切换语言到",
};

const dictionaries: Record<string, LandingStrings> = { en, zh };

/** Resolve a locale to its dictionary, falling back to English. */
export function getStrings(locale: string): LandingStrings {
  return dictionaries[locale] ?? en;
}
