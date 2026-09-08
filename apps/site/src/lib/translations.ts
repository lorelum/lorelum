/**
 * Lightweight string dictionaries for the landing page and shared UI.
 *
 * Fumadocs localizes its own built-in UI (search trigger, TOC, etc.) via
 * the language packs wired in `__root.tsx`. This module covers the strings
 * we author ourselves (landing hero, sections, terminal demo, 404, nav title).
 *
 * Keep the shape flat: one key per string, one object per locale. The
 * `translations.test.ts` guards that `en` and `zh` stay in lockstep.
 */

export interface LandingStrings {
  tagline: string;
  readDocs: string;
  navHome: string;
  navDocs: string;
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
  /** Human description of the `lore get` result's applies_when field. */
  getTitle: string;
  appliesWhen: string;
  antiPattern: string;
  /** Short label for how many Practices the install added. */
  installAddedCount: string;
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
  tagline: 'The right engineering Practice for the right AI coding task and moment.',
  readDocs: 'Read the docs',
  navHome: 'Home',
  navDocs: 'Docs',
  toggleTheme: 'Toggle theme',
  // Hero
  heroBadge: 'Engineering knowledge, injected on demand',
  heroTitleBefore: 'The right ',
  heroTitleGradient: 'Practice',
  heroTitleComma: ',',
  heroTitleAfter: 'at the right moment.',
  heroSub:
    'Lorelum retrieves your team\u2019s engineering Practices and injects them into AI context exactly when they\u2019re needed \u2014 so agents follow your rules, not drift from them.',
  heroTrust: 'Apache-2.0 · Local-first · No cloud required',
  heroTypewriter: [
    'Injected when the moment matters.',
    'Right Practice, right task.',
    'Your rules, actually followed.',
  ],
  ctaDocs: 'Read the docs',
  ctaGithub: 'Star on GitHub',
  // Terminal showcase
  terminalSectionTitle: 'See lore in action',
  terminalSectionSub:
    'A real CLI transcript — the actual `lore install` and `lore get` output, replayed as JSON envelopes.',
  terminalWindowTitle: 'lore — interactive',
  getTitle: 'Reuse Evidence Only When It Still Applies',
  appliesWhen: 'when earlier verification results may no longer describe the current work',
  antiPattern: 'Old result reused for changed work',
  installAddedCount: '30',
  // Problem
  problemEyebrow: 'The problem',
  problemHeading: "Rules that don't reach the agent don't exist.",
  problemSub:
    'Your AGENTS.md may be perfectly written \u2014 and still never make it into the context that matters.',
  problem1Title: 'Rules drift at scale',
  problem1Body:
    'Frontier models comply with only ~68% of a 500-rule ruleset \u2014 every rule you add makes every other rule less likely to be followed.',
  problem2Title: 'Compaction eats context',
  problem2Body:
    'Long sessions trigger context compaction, and your early AGENTS.md falls out of the window \u2014 along with the requirements and evidence it encoded.',
  problem3Title: 'No signal until it\u2019s wrong',
  problem3Body:
    'There\u2019s no warning when the agent drifts \u2014 you only find out at review time, after the damage is done.',
  // Features
  featuresEyebrow: 'Why Lorelum',
  featuresHeading: 'Built for the moment of truth',
  featuresSub:
    'Structured engineering knowledge, retrieved and injected at the instant it matters.',
  feature1Title: 'Practices, not prompts',
  feature1Body:
    'Structured, retrievable engineering guidelines \u2014 the rules your team already believes in, made machine-readable.',
  feature2Title: 'Injected on demand',
  feature2Body:
    'Practices reach the agent exactly when a relevant task is happening \u2014 not dumped once at session start.',
  feature3Title: 'Local-first MCP + CLI',
  feature3Body:
    'A local MCP server and the lore CLI keep your knowledge on your machine, available to any agent.',
  feature4Title: 'Open format & packs',
  feature4Body:
    'A public Practice/pack spec and shareable knowledge packs \u2014 Apache-2.0, no lock-in.',
  // Stats
  statsEyebrow: 'By the numbers',
  statsHeading: 'Lorelum at a glance',
  stats1Label: 'public spec',
  stats2Label: 'ways to use \u2014 CLI + MCP',
  stats3Label: 'open source (Apache-2.0)',
  // Ecosystem
  ecosystemEyebrow: 'Ecosystem',
  ecosystemHeading: 'Works where your agents live',
  ecosystemSub:
    'One source of truth for the rules your coding agents are already reading.',
  // FAQ
  faqEyebrow: 'FAQ',
  faqHeading: 'Questions teams ask before switching',
  faq1q: 'Is Lorelum free?',
  faq1a:
    'Yes — the core is Apache-2.0 open source, including the Practice/pack format, the CLI and the local MCP server.',
  faq2q: 'How is this different from writing better prompts?',
  faq2a:
    'Prompts tell an agent what to do once. Lorelum keeps your engineering Practices structured and retrievable, and injects the right one exactly when the task needs it.',
  faq3q: 'Does it work with my coding agent?',
  faq3a:
    'Any agent that reads AGENTS.md-style files works with Lorelum out of the box — via the CLI or the local MCP server.',
  faq4q: 'Where does my knowledge live?',
  faq4a:
    'On your machine. Lorelum is local-first: no cloud upload, no vendor lock-in.',
  // CTA + footer
  ctaHeading: 'Stop hoping your rules survive the session.',
  ctaSub: 'Give your agents the right Practice at the right moment.',
  footerDocs: 'Docs',
  footerGithub: 'GitHub',
  footerDiscussions: 'Discussions',
  footerLicense: 'Apache-2.0',
  notFoundTitle: 'Page Not Found',
  notFoundDescription:
    'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.',
  backHome: 'Back to Home',
  switchTo: 'Switch language to',
};

const zh: LandingStrings = {
  tagline: '在正确的任务与关键时刻，为 AI 编码智能体检索正确的工程 Practice。',
  readDocs: '阅读文档',
  navHome: '首页',
  navDocs: '文档',
  toggleTheme: '切换主题',
  // Hero
  heroBadge: '按需注入的工程知识',
  heroTitleBefore: '正确的 ',
  heroTitleGradient: 'Practice',
  heroTitleComma: '，',
  heroTitleAfter: '出现在正确的时刻。',
  heroSub:
    'Lorelum 在智能体最需要的时刻，把团队沉淀的工程 Practice 注入它的上下文——让 AI 遵循你的规则，而不是渐渐偏离。',
  heroTrust: 'Apache-2.0 · 本地优先 · 无需云端',
  heroTypewriter: [
    '在关键的时刻，注入正确的 Practice。',
    '正确的 Practice，给正确的任务。',
    '你的规则，被真正遵循。',
  ],
  ctaDocs: '阅读文档',
  ctaGithub: 'GitHub Star',
  // Terminal showcase
  terminalSectionTitle: '看看 lore 怎么工作',
  terminalSectionSub: '真实 CLI 记录回放 —— `lore install` 与 `lore get` 的实际 JSON 协议输出。',
  terminalWindowTitle: 'lore — 交互演示',
  getTitle: 'Reuse Evidence Only When It Still Applies',
  appliesWhen: '当先前的验证结果可能已不适用于当前改动时',
  antiPattern: '改动之后复用旧结果',
  installAddedCount: '30',
  // Problem
  problemEyebrow: '问题',
  problemHeading: '到不了智能体手里的规则，等于不存在。',
  problemSub: '你的 AGENTS.md 可能写得无可挑剔——却始终进不了真正重要的上下文。',
  problem1Title: '规则越多，越不被遵守',
  problem1Body:
    '前沿模型对 500 条规则集只有约 68% 的遵循率——每新增一条规则，都会降低其他规则被遵循的概率。',
  problem2Title: '上下文压缩吃掉规则',
  problem2Body:
    '长会话会触发上下文压缩，你早期的 AGENTS.md 连同其中的需求与证据一起被挤出窗口。',
  problem3Title: '等到发现时，已经错了',
  problem3Body: '智能体偏离时没有任何预警——等你审查代码时才发现，而伤害已经造成。',
  // Features
  featuresEyebrow: '为什么选择 Lorelum',
  featuresHeading: '为关键时刻而生',
  featuresSub: '结构化的工程知识，在最重要的瞬间被检索并注入。',
  feature1Title: '是 Practice，不是提示词',
  feature1Body: '结构化、可检索的工程准则——把你团队本来就在坚持的规则，变成机器可读的格式。',
  feature2Title: '按需注入',
  feature2Body: '在与任务相关的时刻精确注入，而不是在会话开始时就一次性倾倒。',
  feature3Title: '本地优先的 MCP + CLI',
  feature3Body: '本地 MCP 服务器与 lore CLI 让知识留在你的机器上，随时可供任意智能体使用。',
  feature4Title: '开放格式与知识包',
  feature4Body: '公开的 Practice/pack 规范与可共享的知识包——Apache-2.0，无锁定。',
  // Stats
  statsEyebrow: '数据一览',
  statsHeading: 'Lorelum 一览',
  stats1Label: '份公开规范',
  stats2Label: '种使用方式 —— CLI + MCP',
  stats3Label: '开源（Apache-2.0）',
  // Ecosystem
  ecosystemEyebrow: '生态',
  ecosystemHeading: '在你智能体所在之处工作',
  ecosystemSub: '为你的编码智能体正在阅读的规则，提供唯一的事实来源。',
  // FAQ
  faqEyebrow: '常见问题',
  faqHeading: '团队在切换前最常问的问题',
  faq1q: 'Lorelum 免费吗？',
  faq1a: '是的——核心完全 Apache-2.0 开源，包括 Practice/pack 格式、CLI 和本地 MCP 服务器。',
  faq2q: '这和写更好的提示词有什么区别？',
  faq2a:
    '提示词只告诉智能体一次该做什么。Lorelum 让你的工程 Practice 保持结构化、可检索，并在任务最需要时精确注入正确的那条。',
  faq3q: '能和我的编码智能体一起用吗？',
  faq3a:
    '任何读取 AGENTS.md 这类文件的智能体都可以直接使用——通过 CLI 或本地 MCP 服务器。',
  faq4q: '我的知识存在哪里？',
  faq4a: '在你的机器上。Lorelum 本地优先：不上传云端，无厂商锁定。',
  // CTA + footer
  ctaHeading: '别再把规则交给运气。',
  ctaSub: '在正确的时刻，把正确的 Practice 交给你的智能体。',
  footerDocs: '文档',
  footerGithub: 'GitHub',
  footerDiscussions: '讨论',
  footerLicense: 'Apache-2.0',
  notFoundTitle: '页面未找到',
  notFoundDescription: '您访问的页面可能已被移除、改名，或暂时不可用。',
  backHome: '返回首页',
  switchTo: '切换语言到',
};

const dictionaries: Record<string, LandingStrings> = { en, zh };

/** Resolve a locale to its dictionary, falling back to English. */
export function getStrings(locale: string): LandingStrings {
  return dictionaries[locale] ?? en;
}
