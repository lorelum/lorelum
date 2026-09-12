# Lorelum 站点按功能组织的架构设计

- 状态：阶段 1 已实施，待通过本 PR 合入；阶段 2 及后续待 Owner 审查
- 更新日期：2026-09-11
- 代码基线：`origin/main@a5a2aa7`（Bun 1.4.2 升级）
- 范围：`apps/site` 的源码归属、依赖边界与迁移顺序
- 不授权：首页视觉重做、公开路由合同变更、新增 SaaS 功能，或合并独立的共享 UI 分支

## 结论

站点应在重做官网首页之前采用**混合式 feature-based 架构**。目标不是把 `components/` 批量改名为 `features/`，而是让每份页面、行为、文案、样式与运行时逻辑都有唯一且可解释的归属：

- 框架入口和 URL 合同继续归 `routes/`；
- 当前已经存在的用户可见能力归 `features/`；
- 稳定的全站能力归 `shared/`；
- 拷贝入仓库、仍需保留上游来源的源码归 `vendor/`；
- 跨 Web 应用复用的 token 与 primitive，待明确整合后归 `@lorelum/ui`。

当前只创建两个真实 feature：`landing/` 与 `docs/`。不要预建 `auth/`、`billing/`、`dashboard/` 或笼统的 `marketing/`。未来某个 SaaS 能力只有同时满足以下条件，才值得获得自己的 feature 目录：

1. 已有明确的用户工作流或页面路由；
2. 它拥有独立的状态、文案、服务集成或领域规则；
3. 放入现有 feature 会造成真实的责任混淆。

本文区分已观察事实（Observed）、必须满足的要求（Required）、建议方案（Proposed）和暂缓事项（Deferred）。阶段 1 的目录迁移、品牌资产接入与相应 `apps/site/AGENTS.md` 已实施；i18n、GSAP 生命周期收敛和首页视觉重做仍是 Proposed 或 Deferred，本文不会自动取代现行规则。

样式采用 **Tailwind-first**。布局、排版、间距、颜色、响应式和常规交互状态优先使用 utility 与语义 token；CSS 用于复杂动效、伪元素、滤镜、材质、上游适配以及无法清楚表达的选择器关系。i18n 推荐 **i18next + react-i18next**，按 feature namespace 管理 catalog，替换手工大对象及其巨型类型接口。

## 已确认的现状（Observed）

以下内容来自当前 `apps/site` 源码，而不是目标架构假设。

1. Landing 已经有部分 feature 聚合。`src/components/landing/` 下已有 sections、ambient effects、GSAP helpers、能力 gates 与 motion-aware wrappers。`landing-page.tsx` 组合叙事区块；`landing-shell.tsx` 负责固定背景、平滑滚动、导航与开发探针。
2. Navigation 的责任混杂。`BrandLockup` 与 `ThemeToggle` 被 Fumadocs 使用；但 `LandingNavbar`、其 CSS、`useLandingNavbarMorph` 都只服务 Landing。该 hook 又导入 `landing/motion/gsap-client`，形成 `navigation -> landing` 的反向依赖。
3. Docs 没有形成一个完整 feature。`routes/$lang/docs/$.tsx` 同时承担 TanStack route、server function、Fumadocs 页面组合和 MDX 渲染；layout options、MDX map、Fumadocs source 与 Markdown URL helpers 又分散在 `components/` 和 `lib/`。
4. `lib/translations.ts` 将 Landing、导航和 404 文案塞入一个字典；`lib/meta.ts` 将全站 deploy origin 与 Landing metadata 混在一起；`lib/shared.ts` 混合了品牌名、Git 信息、docs URL 与 Markdown URL 编解码。
5. `styles/app.css` 同时导入 Tailwind/Fumadocs 全局样式、`vendor.css` 和 470 行的 `landing.css`。后者混合了背景、动画状态、CTA 覆盖和 logo wall 等多种责任。
6. `components/react-bits/` 是复制进仓库的上游源码，已有 `THIRD_PARTY_NOTICE.md`。其中 Aurora 等模块通过直接动态导入来保持懒加载分包；迁移不得因为统一 barrel 而破坏该边界。
7. `routes/api/search.ts` 从 docs source 创建 Fumadocs 搜索 handler。当前它是 Docs 能力的一部分，不构成独立的跨产品 Search feature。

候选的共享 UI 实现在 `codex/design-infrastructure@402bc86`，但当前 `origin/main` 并不包含它。因此它只能作为前置决策，不能在本设计中被当作已存在依赖。

## 目标与非目标

### 目标（Required）

- 在移动所有权时，保持 URL、双语内容、SSR/prerender、Fumadocs 搜索，以及既有 GSAP/懒加载行为不变。
- 让 Landing 的叙事、视觉语言应用、特效、动效、文案与 Landing 专属导航一起演进。
- 让 Docs 的内容适配、loader、layout、MDX、文档交互和 docs CSS 处在一个清晰边界内。
- 建立狭窄且可审查的复用路径：feature 可以消费 `shared` 与 `@lorelum/ui`，但二者不能沦为杂物箱。
- 让阅读者能在一个 feature 附近找到它的 screen、私有组件、文案、资源、测试、运行时逻辑与样式。

### 非目标

- 不为每一个 feature 强加一套固定子目录模板。
- 不为了整理目录而引入状态管理库、数据请求框架、micro-frontend、feature registry 或 import boundary linter。
- 不移动 TanStack 文件路由，也不编辑生成的 `routeTree.gen.ts`。
- 不把原始 MDX 从 `apps/site/content/docs` 中移走。
- 不把引入后的 shadcn primitive 视作 vendor。经过审查并接入 Lorelum token 的 shadcn 代码是 Lorelum 自有源码，属于 `@lorelum/ui`；上游衍生的动画源码才属于 `vendor`。

## 顶层目录

~~~text
apps/site/src/
  app/                                # 全局运行时组合，不是 feature
    root-document.tsx                 # html/head/body/Scripts
    providers.tsx                     # Fumadocs、主题、locale provider
    root-head.ts                      # 全局 metadata、字体、favicon

  routes/                             # TanStack 文件路由与 HTTP 合同
    __root.tsx
    index.tsx
    $lang/
      index.tsx
      docs/
        $.tsx
        {$}.md.ts
    api/
      search.ts
    robots[.]txt.ts
    sitemap[.]xml.ts
    llms[.]txt.ts
    llms-full[.]txt.ts

  features/
    landing/                          # 官网首页
    docs/                             # 文档阅读与发现

  shared/                             # 稳定的全站能力
    brand/
    config/
    i18n/
    lib/
    ui/

  vendor/
    react-bits/                       # 保留上游来源的复制源码

  styles/
    app.css                           # Tailwind、token 入口、文档级默认样式

  router.tsx                          # 保留在惯用的框架入口位置
  start.ts
~~~

`app/` 故意保持很小。它只拥有 document/provider 等既不属于 feature、也不是共享 UI 的全局运行时责任。`router.tsx` 与 `start.ts` 继续放在 `src/` 根目录：仅为树形整齐而移动框架 bootstrap，没有真实的所有权收益。

## 依赖方向与规则

~~~text
routes  -> app, features, shared
app     -> shared, external packages, feature 的显式资源装配入口
features/landing -> shared, vendor, @lorelum/ui
features/docs    -> shared, external packages, @lorelum/ui
shared  -> @lorelum/ui, external packages
vendor  -> external packages only
@lorelum/ui -> 仅自身依赖，绝不反向依赖 apps/site
~~~

1. Route 拥有 URL 解析、`head`、`createFileRoute`、`createServerFn` 注册与 HTTP response 接线；不拥有 Landing sections、Fumadocs layout options 或页面 JSX。
2. Feature 可以导入 `shared`、`vendor`、`@lorelum/ui`，不得导入其他 feature 的私有文件。当前没有一个 feature 有正当理由直接依赖另一个 feature。
3. `shared/` 不能导入 `features/`。需要 Landing 文案、Hero 几何、Docs page tree 或产品专属 API 的组件归相应 feature；通用 GSAP 接入不因使用 ScrollTrigger 就自动成为 Landing 私有逻辑。
4. `vendor/` 永远不能导入 `features/` 或 `shared/`。复制源码要尽可能接近上游；Lorelum 专属 wrapper 放在消费它的 feature。
5. `@lorelum/ui` 不能导入 site routes、Fumadocs、站点文案或 Landing 动效。
6. `features/<name>/index.ts` 仅导出 browser-safe 的公共入口。server-only 源码只能经 `features/<name>/server/...` 显式导入，不能从 barrel 再导出。
7. 同一责任目录内使用相对导入正常；跨 feature 或跨层导入使用 `@/` alias，使边界在 review 中一眼可见。

当前仓库没有 import boundary checker。第一轮迁移通过 targeted `rg`、typecheck 和 production build 审查依赖方向。等目录真实稳定后，再决定是否用 Bun/TypeScript 实现静态检查；它不属于首轮前置条件。

## 功能模块的最小合同

Feature 是垂直的产品切片，不是一个缩小版框架。它从最小结构开始，只有在确实拥有一类独立工作时才增加子目录。

### 通用最小结构

~~~text
features/<feature>/
  index.ts                            # browser-safe 公共导出；仅 barrel
  <feature>-screen.tsx                # Route 层使用的页面组合
  components/                         # 仅 feature 内可复用的 UI，需要时才创建
  messages/                           # feature 自有文案，需要时才创建
~~~

私有组件的 hook、CSS、资源和测试与组件同目录：

~~~text
components/<component-name>/
  <component-name>.tsx
  <component-name>.css                # 只有 utilities/token 无法表达时才创建
  use-<component-name>.ts             # 只有 hook 本身有独立语义时才创建
  <component-name>.test.tsx
  assets/                             # 仅模块导入的视觉资源
~~~

`hooks/`、`utils/`、`types/`、`services/`、`api/`、`model/` 和 `tests/` 都是合法组织方式。按真实职责建立必要层次，不能以减少目录为由把请求编排、复杂状态转换或领域规则塞入 view。简单静态区块无需完整分层；有独立规则或状态的模块即使当前只有一个调用方，也应有清楚边界。模块资源就近放置，稳定公开 URL 资源继续归 `public/`。

### 静态页面与交互功能的分层尺度

MVVM 在这里表示职责分离，不要求类或特定状态库。View 展示状态并发出用户意图；view-model 组织展示状态、派生值和命令；model 拥有领域类型与纯规则。网络与持久化由 adapter 承担。没有职责的层可以省略，有职责的层不能为了扁平化而删除。

静态 Landing 的一个复杂区块可以采用：

~~~text
sections/hero/
  hero.tsx                         # Tailwind view
  hero-content.ts                  # 稳定内容 ID、消息引用和展示数据
  use-hero-presentation.ts         # 确实存在的展示状态与事件
  hero-choreography.ts             # 私有时间线和 DOM 目标
  hero-material.css               # 仅复杂材质或选择器关系
~~~

简单 FAQ 可以只保留一个组件；Terminal 演示若有独立状态转换，则使用 `terminal-scenario.ts` 和同名测试。内容结构不等于领域模型，翻译也不拥有动画时间线。

下面是未来交互型 SaaS feature 的模板，用于说明职责，不授权创建成员管理或后端能力：

~~~text
features/workspace-membership/
  index.ts
  membership-screen.tsx           # 入口数据与页面组合
  view/
    member-list.tsx
    invite-member-form.tsx
  view-model/
    use-membership.ts             # 查询/提交状态、派生值、用户命令
    use-membership.test.ts
  model/
    membership.ts                 # 领域类型、校验和状态规则
    membership.test.ts
  api/
    membership-client.ts          # 浏览器 transport adapter
    membership-contract.ts        # 输入、输出、错误码及边界校验
  server/
    membership-functions.ts       # server function 接入
    application/invite-member.ts  # 权限检查与完整用例
    adapters/membership-repository.ts
  messages/{en,zh}.json
  tests/membership-flow.test.ts    # 确有跨层流程时使用
~~~

| 层 | 唯一职责与允许依赖 | 禁止承担或依赖 |
| --- | --- | --- |
| view | 渲染、焦点和原生事件；消费 view-model、类型、翻译及 UI | 直接请求、持久化、复制领域权限规则。 |
| view-model | UI 状态、用户命令、结果派生；消费 model 和 api | server adapter、view 实现；将远端缓存复制成第二份事实。 |
| model | 纯领域类型、规则和状态转换；依赖必要纯函数/schema | React、i18n、路由、网络和数据库。 |
| api | 请求传输、解析及错误映射；消费合同与 model | UI、数据库实现、服务端凭据。 |
| server application | 权限检查与完整业务流程；消费 model 和 adapter 能力 | 浏览器状态和 view。 |
| server adapter | 外部 API/存储协议；消费 SDK 和领域合同 | UI；重复实现领域规则。 |

当前无需多个 adapter 时可以使用具体函数；测试隔离、事务或确定的替换需求才支持新增接口。`services` 与 `application` 选一个承担用例，不建立同义的重复层。单元测试就近，跨层集成测试可放 feature 的 `tests/`。

## Landing 功能模块

Landing 拥有完整官网首页：产品叙事、视觉语言落地、Hero 行为、性能 gates、滚动行为和 Landing 专属 chrome。它不是一个通用组件集合。

~~~text
features/landing/
  index.ts
  landing-screen.tsx                  # / 与 /$lang 路由消费的公共 screen
  landing-shell.tsx                   # 固定层、scroll ownership、probe
  metadata.ts                         # 按 locale 生成 Landing SEO/OG metadata

  navigation/
    landing-navbar.tsx
    landing-primary-navigation.tsx
    github-link.tsx                   # 当前静态 star 策略属于 Landing
    use-landing-navbar-morph.ts
    landing-navbar.css

  sections/
    hero/
      hero.tsx
      terminal-showcase.tsx
      terminal-demo.tsx
    problem/
      problem.tsx
    features/
      features.tsx
      tinted-icon.tsx
    proof/
      stats.tsx
      ecosystem.tsx
    faq/
      faq.tsx
    conversion/
      cta.tsx
      specular-cta-preset.ts
    footer/
      site-footer.tsx
    section-heading.tsx               # 多个 Landing section 的共同局部组件

  effects/
    page-background.tsx
    hero-aurora.tsx
    particle-field/
      particle-field.tsx
      poisson-disc.ts
      poisson-disc.test.ts
    antigravity.tsx

  motion/
    landing-motion-policy.ts          # Landing 节奏、能力开关和预算
    smooth-scroll.tsx
    reveal.tsx
    split-text-reveal.tsx
    scroll-parallax.tsx
    gsap-scale-up.tsx
    use-canvas-effects.ts
    use-viewport-anim.ts
    motion-aware/
      motion-aware-antigravity.tsx
      motion-aware-specular-button.tsx
      motion-aware-text-type.tsx

  runtime/
    fps-probe.tsx
    gates/
      aurora-gate.ts
      motion-gate.ts
      particle-budget.ts
      webgl-capability.ts
      webgl-renderer.ts
      *.test.ts

  messages/
    en.json
    zh.json
    loader.ts                         # 独立 catalog 加载入口
  landing.css                         # 可选；仅不能就近表达的复杂关系
~~~

### Landing 内部规则

- `LandingScreen` 取代 `/` 与 `/$lang/` 两个 route 中重复的 `LandingShell + LandingPage` JSX。
- `LandingShell` 保留现有重要不变量：fixed navigation 与 ambient layers 必须处于 ScrollSmoother 的 transformed content 外部。
- Landing navigation 留在 Landing，因为它的形态变化由 Hero 几何触发，并依赖 Landing 的 GSAP runtime。只有品牌标识与主题控制才移动到 `shared/ui`。
- `effects/`、`motion/` 和 `runtime/gates/` 分别拥有视觉渲染、feature 编排和能力/预算决策；平台 GSAP 接入归 shared，不能把页面编排整体提升为共享工具箱。
- 只有多文件 section 才建立子目录；简单 section 保持单文件。
- 现有 `specular-button` 上游基础样式移动到 `vendor/react-bits`；`.landing-specular-cta` 等 Lorelum 的视觉决策继续留在 Landing。

Landing 对 Route 暴露的 browser-safe 合同保持极小：

~~~ts
// features/landing/index.ts
export { LandingScreen } from './landing-screen';
export { getLandingHead } from './metadata';
~~~

~~~tsx
// routes/$lang/index.tsx，仅说明组合方式
export const Route = createFileRoute('/$lang/')({
  head: ({ params }) => getLandingHead(params.lang),
  component: () => <LandingScreen lang={Route.useParams().lang} />,
});
~~~

## Docs 功能模块

Docs 拥有文档阅读与发现。原始 MDX 继续放在 `content/docs`；但对它的所有运行时解释都属于 Docs feature。

~~~text
features/docs/
  index.ts                            # 仅导出 browser-safe 的 DocsScreen
  docs-screen.tsx                     # DocsLayout 与页面展示

  content/
    client.ts                         # browser-safe compiled MDX import map 与预载
    markdown-url.ts                   # docs 专属 URL 编解码
    mdx-components.tsx                # MDX 组件映射

  layout/
    base-options.tsx                  # Fumadocs layout options 与 Docs chrome
    docs-page-actions.tsx             # Copy/edit/view controls，需要时提取

  server/
    source.ts                         # Fumadocs source、page tree、LLM text
    load-doc-page.ts                  # page/path/tree/Markdown URL 组装
  contracts/
    docs-page-data.ts                 # 序列化 loader 合同，仅类型引用 server
  view/
    docs-content.tsx                  # MDX、标题、TOC 和正文
  view-model/
    use-docs-page-actions.ts          # 自有复杂交互状态需要时建立

  search/
    server.ts                         # Fumadocs search adapter

  styles/
    docs.css                          # Fumadocs adapter 与 Docs refinements
    docs.test.ts                      # 保留的 style/token contract test
~~~

### Docs 内部规则

- 首轮保留 Route 内 `createServerFn` 注册，handler 委托 `server/load-doc-page.ts`。后续可按框架编译约定移入明确的 server function 接入文件，不将注册位置提升为普遍架构禁令。
- `DocsScreen` 接收 loader 结果，拥有 `DocsLayout`、页面 JSX、MDX 渲染和 docs actions；它不导入 TanStack Route object。
- `routes/api/search.ts` 继续是 HTTP endpoint，只委托给 `features/docs/search/server.ts`。在出现第二个独立搜索工作流前，不创建 `features/search`。
- `content/docs` 保持现有位置。Feature 拥有 runtime adapter，而不是强行拥有内容目录的物理路径。
- browser loader 直接消费由 Vite/Fumadocs 编译的 MDX 模块，不能从客户端导入 macro registry；registry 仍只服务 server-side source index，避免将文件系统 runtime 带入浏览器产物。
- Fumadocs adapter CSS 由 docs screen 或 layout module 导入，不能放在 `styles/app.css`。

Loader 的交接合同要显式，而不是把多个职责藏进 route JSX：

~~~ts
// features/docs/server/load-doc-page.ts，仅说明接口
export interface LoadDocsPageInput {
  readonly slugs: string[];
  readonly lang?: string;
}

export interface DocsPageData {
  readonly path: string;
  readonly markdownUrl: string;
  // 实现时从 Fumadocs 推导精确类型，不在这里发明重复类型。
  readonly pageTree: unknown;
}

export async function loadDocsPage(input: LoadDocsPageInput): Promise<DocsPageData>;
~~~

上面的 `unknown` 仅为示意。实施合同应使用 `Awaited<ReturnType<typeof source.serializePageTree>>` 推导准确类型，并以纯类型引用避免把 source 带入客户端。screen 通过 `useFumadocsLoader` 恢复展示数据后交给 layout。拆分 `defineDocs` 和 source 时保留当前宏编译约定；若版本需要单一生成入口，可保留专门桥接文件，不能复制两份内容定义。

## 共享能力与第三方源码的责任

~~~text
shared/
  brand/
    site-identity.ts                  # 品牌名与稳定的品牌配置
  config/
    site-url.ts                       # deploy origin 与通用 URL helper
    git.ts                            # docs link 所需的仓库身份
  i18n/
    locales.ts                        # 唯一 locale 合同，供 Fumadocs 与应用消费
    create-site-i18n.ts               # 接收 locale/resources，不导入 feature
    messages/{en,zh}.json              # 仅全站控件文案
  motion/
    gsap-client.ts                    # 集中导入与幂等插件注册
    motion-tokens.ts                  # 稳定 duration/ease 基础值
  lib/
    cn.ts
  ui/
    brand-lockup/
      brand-lockup.tsx
    theme-toggle/
      theme-toggle.tsx
      theme-toggle.css

vendor/
  react-bits/
    index.ts
    aurora.tsx
    count-up.tsx
    ...
    specular-button.css               # 必要时保留兼容上游的基础样式
~~~

`shared/ui` 不能替代 `@lorelum/ui`：

- `@lorelum/ui` 拥有 semantic token，以及 Button、Badge、Separator 这类经过审查、可跨 Lorelum Web 应用复用的 primitive。
- `shared/ui` 拥有由 primitive 或 site runtime 组成的站点能力，例如实际的主题生命周期控制、品牌 lockup 和语言切换。
- Landing navbar 与 Fumadocs layout 即使都显示品牌标识，也不会因此成为 shared UI；它们各自使用更小的共享能力。

等批准的 logo assets 接入后，`BrandLockup` 应消费唯一的 shared brand asset/component，不能让不同 feature 复制 inline SVG。

`vendor/react-bits` 保留上游衍生实现与来源信息。Feature 可以对 vendor component 加 wrapper，以应用 Lorelum 行为或 token；vendor 代码绝不反向认识 feature。为 code splitting 而存在的 direct dynamic import 必须原样保留。

## 现有文件迁移表

以下 source path 均相对 `apps/site/src/`。

| 当前归属 | 目标归属 | 迁移说明 |
| --- | --- | --- |
| `routes/index.tsx`、`routes/$lang/index.tsx` | 保持 `routes/` | 用 `LandingScreen` 替换重复 JSX；保留路径和 head 行为。 |
| `routes/$lang/docs/$.tsx` | Route + `features/docs/{server,docs-screen}` | 保留 route/server registration；拆出加载与展示。 |
| `routes/api/search.ts` | Route + `features/docs/search/server.ts` | 保留 HTTP 合同；只移动 docs search construction。 |
| `components/landing/**` | `features/landing/**` | 按既有责任拆为 sections、effects、motion、runtime gates。 |
| `components/navigation/landing-*`、morph hook、navbar CSS | `features/landing/navigation/` | 消除 navigation -> landing 反向依赖。 |
| `components/navigation/github-link.tsx` | 初期归 `features/landing/navigation/` | 静态 star count 目前是 Landing 策略；只有真实复用后才提升。 |
| `components/navigation/brand-lockup.tsx` | `shared/ui/brand-lockup/` | 只有 logo asset work 已获批准才替换旧 inline mark。 |
| `components/navigation/theme-toggle.*` | `shared/ui/theme-toggle/` | 保留 View Transition fallback 与 SSR-safe mount 行为。 |
| `components/language-switch.tsx` | 删除 | 当前没有消费者；不要把死代码包装成 shared capability。 |
| `components/docs-layout-options.tsx` | `features/docs/layout/base-options.tsx` | Fumadocs adapter。 |
| `components/mdx.tsx` | `features/docs/content/mdx-components.tsx` | 保留现有 Fumadocs type workaround。 |
| `components/not-found.tsx` | root extraction 后归 `app/not-found.tsx` | 它依赖 Fumadocs HomeLayout，不属于 Landing。 |
| `components/react-bits/**` | `vendor/react-bits/**` | 保留 barrel 前先审计 direct lazy import。 |
| `lib/source.ts` | `features/docs/content/client.ts` + `features/docs/server/source.ts` | 验证宏编译和客户端产物后拆分，不泄露服务端索引。 |
| `lib/shared.ts` 中 Markdown helpers | `features/docs/content/markdown-url.ts` | 它们只建模 Docs path。 |
| `lib/poisson-disc.ts` 与 test | 暂缓 | Landing 将整体重做；本阶段保留旧 Landing 模子，不迁移未被新 screen 使用的粒子 helper。 |
| `lib/translations.ts` | 各 feature、shared 与 app 的 messages | 按 namespace 迁移，最终删除手工接口与旧适配器。 |
| `lib/meta.ts` | `shared/config/site-url.ts` + `features/landing/metadata.ts` | 分离 deploy origin 和 Landing SEO。 |
| `lib/i18n.ts` | `shared/i18n/locales.ts` | Fumadocs locale source of truth。 |
| `lib/cn.ts` | `shared/lib/cn.ts`，或 UI package 接入后删除 | 不保留两份 class merge 实现。 |
| `styles/landing.css` | `features/landing/landing.css` + colocated CSS | 分离 vendor base style 与 Landing override。 |
| `styles/vendor.css` | 审计后移至 `vendor/react-bits/` 或 feature styles | 每条规则移动到真实 owner，不保留全局杂物桶。 |
| `styles/app.css` | 保持 `styles/app.css` | 只保留 Tailwind、token 入口与 document defaults。 |
| `apps/site/content/docs/**` | 不移动 | 保持稳定的 authored-content root，语义上仍归 Docs。 |

## 样式、文案与测试规则

### 样式

1. `styles/app.css` 只包含 Tailwind 初始化、已接入的 design-token entry、document defaults，以及 screen mount 前必须存在的 Fumadocs baseline。阶段 1 保留 `landing.css` 的唯一 legacy import，直至 Landing 重做；不得为新功能继续向其中添加样式。
2. Feature-wide CSS 仅用于跨多个 feature component 的关系：例如 Landing 背景层、section-to-section 几何关系或 Docs adapter override。组件私有 selector 必须跟随组件。
3. 布局、排版、间距、颜色、响应式、hover/focus/disabled 与普通过渡直接使用 utility；有限 variant 用明确 class 映射，不拼接扫描器无法识别的动态类名，也不默认用 `@apply` 再包一层 CSS。复杂材质、伪元素、滤镜、遮罩和上游关系选择器才进入就近 CSS。
4. `@lorelum/ui` 接入后，feature 必须消费 semantic token，禁止再并行维护另一套品牌色板。

不要预设每个组件或页面都有 CSS 文件。目录迁移先保持已有层叠顺序，再独立把普通规则转换成 utility；CSS 行数不是验收指标。GSAP 与 CSS 不同时驱动同一动画属性；前者拥有时间线，后者或 utility 拥有静态状态。生产构建须检查 feature CSS 没有因 `sideEffects: false` 丢失，路由加载顺序也不会产生闪烁。

### 测试与视觉验证

- 既有 pure logic test 与 source 一起移动，不能为整齐而创建 central feature test folder。
- 只有 loader、head 或 response 行为改变时，才新增 route-level test；单纯目录迁移不能凭空增加 snapshot test。
- 迁移期的视觉 gate：英文与中文、亮暗主题、桌面与窄屏移动端、Landing 导航 top/detached state、Docs search/TOC/Markdown actions，以及 Landing 动效改动时的 `?probe=1`。

## i18n 选型与运行时（Proposed）

当前 `lib/i18n.ts` 只定义 Fumadocs 的 `en/zh`，根 provider 使用 `uiTranslations()` 与 `zhCN()`；手工 `LandingStrings` 则承载首页、共享控件和 404。这不是只拆文件可以解决的问题，还需要成熟的插值、复数、类型和翻译维护流程。

| 真实候选 | 能力与代价 | 判断 |
| --- | --- | --- |
| i18next + react-i18next | namespace、资源按需加载、React provider、插值/复数、类型约束及逐请求实例；需要显式装配 SSR 资源，但无需改变 React 编译步骤。 | 推荐。namespace 能直接映射 feature，适合从现有 key 渐进迁移。 |
| Lingui | 官方提供提取、catalog 编译、React 富文本与 Vite 集成。需要验证 catalog 编译和所选 macro 转换链与当前 Vite/React 插件组合。 | 有力备选；当前优先减少构建链与 SSR 同时变化的范围。 |
| Paraglide JS | 编译生成类型化消息函数，提供 locale 策略与框架集成。 | 生成运行时和 URL 集成需要与现有 TanStack/Fumadocs 合同共同验证；当前不为文案拆分增加第二套路由策略。 |
| 手工拆 JSON | 改动小，但仍自行维护 key、复数、插值、富文本及 SSR 约定。 | 只可作为迁移中间态，不是最终方案。 |

这些能力按官方文档核实，尚未实际安装验证与本仓库精确版本组合的兼容性。运行时引入 `i18next` 和 `react-i18next`；开发期优先采用官方推荐的 CLI 做提取、同步和类型生成。锁定支持所选 key 调用语法的版本，并在实施前检查许可证、传递依赖和 Vite/Cloudflare 构建，不自研通用翻译编译器。

官方依据：[i18next namespace](https://www.i18next.com/principles/namespaces)、[类型支持](https://www.i18next.com/overview/typescript)、[工具目录](https://www.i18next.com/overview/plugins-and-utils)、[react-i18next SSR](https://react.i18next.com/latest/ssr)、[Lingui React](https://lingui.dev/tutorials/react)、[Lingui Vite](https://lingui.dev/ref/vite-plugin)、[Paraglide JS](https://paraglidejs.com/)。

### Catalog 和装配所有权

起步 namespace 为 `landing`、`docs`、`common`、`app`。前两者在 feature 的 `messages`；全站控件在 `shared/i18n/messages`；根级 404 等在 `app/messages`。只有出现独立维护或懒加载需求才进一步拆 namespace，不按组件数量机械拆。

`en.json` 是 key 结构基准，`zh.json` 提供译文；类型推导或生成，不再手写巨型接口。采用可静态提取的固定 key 和显式 namespace，禁止运行时拼接未知 key。字符串 key 或 selector API 在锁定依赖时统一，确保提取工具支持。完整标题使用 `Trans` 插槽控制强调，让译文决定语序，不继续拼接 `Before/Gradient/After/Comma`。数字用 count/plural 与插值；MDX 正文保持现有文件流程。

~~~ts
// 接口示意；Resource 和 i18n 使用 i18next 官方类型。
type Locale = 'en' | 'zh';
type TranslationSnapshot = { locale: Locale; resources: Resource };
type CreateSiteI18n = (snapshot: TranslationSnapshot) => Promise<i18n>;
~~~

shared 工厂只接收资源，不认识 feature。`app/i18n-resources.ts` 显式组合 feature 的 `messages/loader.ts`，这是应用装配允许依赖 feature 的狭窄例外；加载映射使用有限动态 import。完整 namespace 类型汇总放 `app/i18next.d.ts`，避免 shared 为类型方便反向导入 feature。catalog 入口不能通过页面 barrel 导入，以免顺带加载页面或动画。

### 请求、hydration 和语言切换

1. Route 按现有 URL 解析 locale；`/` 默认英文，`/zh` 中文。本阶段不添加浏览器语言探测、cookie 重定向或新 URL 策略；非法 locale 保持原行为，变更需单独对齐。
2. 路由加载阶段预载 `common + app + 当前 feature` 的目标资源，为每次 SSR 创建独立 i18next 实例并 await 初始化。可缓存只读 catalog，不能在模块 singleton 上切换请求语言。
3. provider 注入实例，head 使用同一 locale/消息；通过 TanStack 可序列化数据传递 `TranslationSnapshot`，不序列化实例或函数。客户端 hydration 前用同一 snapshot 初始化，不能先显示英文再用 effect 修正。
4. 客户端导航先加载目标资源，再在路由提交边界激活语言。旧导航的异步完成不能覆盖新导航，用提交身份判定结果有效性。Fumadocs provider 与 `<html lang>` 同步消费已提交 locale。
5. prerender 中每种语言同样隔离实例；Cloudflare 服务端使用打包资源，不依赖本地文件系统 backend。资源加载失败进入路由错误边界并允许重试，不让每次 `t()` 调用自行联网。

现有根节点 Landing title effect 不应成为翻译正确性的保障；是否删除及如何保留 Docs title，须在该批迁移中验证。`suppressHydrationWarning` 不能掩盖文案 mismatch。首阶段可加载当前页面完整 namespace，是否携带两种语言由产物测量决定，不虚构体积收益。

### Fumadocs 共存、失败语义与渐进迁移

`shared/i18n/locales.ts` 拥有唯一语言列表与默认值，Fumadocs 从它构造 `defineI18n`。`app/providers` 保留现有 `uiTranslations()`、`zhCN()` 和 `i18nProvider`；搜索框、TOC 等内建翻译不复制进应用 catalog。Lorelum 自有布局标题和控件使用 i18next。MDX 内容仍由 Fumadocs 管理，两套消息只有一个 locale 来源。

生产可显式回退英文以支持渐进发布，但 CI 对正式支持语言的缺失 key、空值、插值参数不一致和非法复数资源报错。fallback 不是漏翻译的验收借口；翻译文本通过 React/受控 `Trans` 插槽渲染，不作为任意 HTML 执行。

先按归属移动 key，提供读取新 namespace 的临时旧 API 适配器，不保留第二份文本。按共享控件、404、Landing 区块、Docs 自有文案迁移调用点；旧调用清零后删除 `LandingStrings`、`getStrings` 和适配器。完整标题改为富文本时单独检查双语排版。

验证覆盖：中英文并发 SSR 不串语言；prerender 的 head、`html lang` 和正文一致；hydration 无 mismatch；快速切换不被旧加载覆盖；资源加载失败可恢复；插值、复数、富文本正确；Fumadocs 搜索/TOC 仍使用目标语言。记录首屏 JS 和 catalog 请求数量前后差异，检查是否错误打包所有 feature。

## GSAP 基础设施与 feature 编排（Proposed）

站点级 `shared/motion/gsap-client.ts` 拥有导入和幂等插件注册，`motion-tokens.ts` 只拥有稳定 duration/ease 等基础值并明确秒单位。Landing 的 motion policy 拥有设备预算、能力开关和页面节奏；Hero/nav choreography 拥有 DOM 目标、trigger 区间、stagger 顺序和时间线标签。不是所有数字都需要变成全站 token。

### SSR 与插件注册

保留单一静态导入/导出入口，注册函数只在浏览器 effect 或事件创建动画前调用。模块布尔值只保证当前模块实例幂等，不能声称跨 HMR、请求和独立 bundle 全局只执行一次。注册模块不能创建全局 timeline、smoother 或 DOM 监听。

当前代码静态导入 GSAP 及三个插件，但注释不是 SSR 兼容性证据；须验证 production build、服务端 render 和 Cloudflare 目标。若静态 import 失败，再改为客户端动态导入，并处理 Promise 完成前组件已卸载的取消路径。初始化前保留可阅读静态内容。

### Context 与清理合同

创建动画的组件用根 ref 限定 `gsap.context` selector 范围，卸载和依赖变化时 `ctx.revert()`。事件、timer 和异步回调中晚创建的动画必须加入 context；普通监听器、observer 和 timer 单独释放，context 不负责非 GSAP 资源。

~~~ts
// Hero 私有合同示意，调用者在自己的 context 内调用。
type HeroTargets = { root: HTMLElement; title: HTMLElement };
type BuildHeroTimeline = (targets: HeroTargets) => gsap.core.Timeline;
~~~

只在拥有共同生命周期语义时抽 hook，不创建仅转发 `gsap.to` 的 `animate()`。官方 `@gsap/react` 可作为后续生命周期封装选项；现有 context 足够完成首轮迁移，不同时自研等价框架，也不预建 AnimationManager、registry 或 JSON 时间线 DSL。

### ScrollTrigger 和 ScrollSmoother

Landing shell 是 smoother 唯一所有者。创建后通过明确 ready 状态或注册入口让子级建立依赖 scroller 的 trigger，不把父子 effect 偶然顺序当长期合同。离开页面先释放本 feature 的 triggers/context，再销毁 smoother，不能用全局 `killAll()` 误杀其他消费者。

DOM 提交且布局稳定后测量。图片加载、字体完成、SplitText 重排、异步区块出现等真实几何变化由 feature 通知一次合并后的 `ScrollTrigger.refresh()`；用可取消的帧调度合并同批请求，不在每个 render、滚动帧或 observer 回调无条件刷新。ScrollSmoother 下的 viewport 行为继续使用 ScrollTrigger。

SplitText 重建前 revert 原始 DOM，避免旧拆分与新译文叠加。测试初次测量、route 离开、locale 换行、尺寸变化、Strict Mode 重复挂载及异步加载后卸载；重复进入离开不能增加 trigger、smoother 或监听器数量。

固定导航与唯一 ambient layer 继续在 transformed content 外；设备 gates 与粒子预算属于 Landing。现行 AGENTS 明确不使用 `prefers-reduced-motion`，本文不暗中改变该产品决定；Owner 后续调整时再统一 policy 和验收。

官方依据：[GSAP React](https://gsap.com/resources/React/)、[context](https://gsap.com/docs/v3/GSAP/gsap.context()/)、[ScrollTrigger refresh](https://gsap.com/docs/v3/Plugins/ScrollTrigger/refresh()/)。

## 分阶段实施

每个阶段单独对应一个 Issue/PR。目录迁移、视觉重做和设计系统接入的失败方式不同，必须能独立 review 与回滚。

### 阶段 0：确定基线

1. 从当前 `origin/main` 创建分支，不能从历史 manual-deploy branch 继续堆叠。
2. 独立安排 `@lorelum/ui` 的审查、重做或暂缓；当前主线不能假定它存在，但暂缓不阻塞使用当前 token 的职责迁移。
3. 确认批准的 logo asset source，再修改 `BrandLockup`。禁止把又一次 logo redesign 混入结构 PR。

退出证据：基线与范围明确，记录共享 UI 状态；实施 PR 同步 site AGENTS 的新目录、文案和 GSAP 规则。结构工作不要求先替换 logo。

### 阶段 1：仅移动所有权

1. 只在有文件迁入时建立 `app/`、`features/landing`、`features/docs`、`shared` 与 `vendor/react-bits`。
2. 按迁移表移动 Landing、Docs、稳定 shared controls、vendor source 与 pure helpers。
3. 使用 `LandingScreen` 消除 Landing route 的重复组合，但不改变 route path 与 metadata。
4. 把 Docs page-data assembly 从 route JSX 拆出，但不改变 loader result、content source 或 endpoint 行为。
5. 按真实 owner 移动 CSS，并明确维护 CSS order；本阶段没有任何预期视觉重做。

退出证据：typecheck、site tests、lint、production build、静态 route 集合不变，并完成与迁移前的 route/theme/viewport 人工对照。

### 阶段 2：替换 i18n，再收敛样式和动效生命周期

先以独立批次接入 i18next、请求实例、catalog 装配与 provider，按 namespace 逐步替换调用，完成上述 SSR/hydration/导航验证并删除旧 API。再将普通 CSS 转为 utility、系统化 GSAP ready/cleanup/refresh；两类调整保留可独立审查的 diff，不混入视觉重做。记录 catalog 加载、客户端产物和 `?probe=1` 的同设备前后对照。

退出证据：双语请求隔离且无 hydration mismatch；旧字典与适配器清零；反复进入离开 Landing 无资源增长，既有视觉与滚动表现兼容。每批可单独回滚，不长期维护两份文案。

### 后续独立工作：用新架构承载真实页面需求

1. 在 `features/landing` 内重做 Landing，不能重新引入全局 landing stylesheet 或顶层 components bucket。
2. 只有在具体 feature 需要、且设计合同批准 API/variant 时，才把审查后的 shadcn primitive 加到 `@lorelum/ui`。
3. Docs 的后续 refinement，包括可能出现的 docs-search 展示，继续留在 `features/docs`。

退出证据：一个 Landing 或 Docs 改动可从单个 feature 目录及其显式 shared/vendor 依赖完成 review，且没有新的 reverse import。

### 阶段 3：产品范围明确后再建立产品功能模块

某个 SaaS/PaaS 工作流获批后，为**用户能力**建立一个目录，例如 `workspace-membership`，而不是先建立猜测性的 `api/` 或 `services/`。该 feature 的设计必须写清楚：

- 其 route；
- client/server 边界；
- 状态 owner；
- 文案 owner；
- 它消费还是扩展 `@lorelum/ui` 的哪个稳定 primitive。

认证、计费、workspace、dashboard、客户端状态库与 backend-for-frontend 架构均暂缓。当前站点没有这些能力的获批合同。

## 备选方案与取舍

| 方案 | 不推荐的原因 |
| --- | --- |
| 继续使用 `components/`、`lib/`、`styles/` 大桶 | Navigation、Docs、文案和 CSS 中的跨责任问题已是事实；Landing 重做只会加深它。 |
| 只将 `components/landing` 改名为 `features/landing` | Docs、vendor source、route 重复、navigation 反向依赖仍未解决。 |
| 采用严格 Feature-Sliced Design 的 entities/widgets/pages/processes 词汇 | 当前站点没有经证实的 entity model 或复杂产品工作流；词汇会先于产品变复杂。 |
| 现在建立 `marketing/landing` 双层目录 | 只有一个 marketing feature；多一层路径没有保护任何新的责任边界。 |
| 所有被复用的文件一律放 `shared` | 复用不等于归属；这会误把 motion、Fumadocs adapter 与 vendor effect 泛化。 |
| 把 React Bits 与 shadcn 一起放 `vendor` | 所有权不同：React Bits 保持 upstream-derived，shadcn primitive 是接入 token 后由 Lorelum 负责的源码。 |
| 在同一 PR 同时做目录迁移与 Landing 重做 | Review 无法区分结构/style regression 与预期视觉变化，回滚成本高。 |

## 验收标准

架构迁移完成时，应能观察到：

1. `routes/` 只包含框架合同与薄的 screen/server 接线，不包含 Landing section 或 Fumadocs 页面组合。
2. `features/landing` 拥有 Landing 专属导航形态、motion、effects、copy、sections 与 feature-wide styles；外部 navigation 模块不再导入 Landing runtime。
3. `features/docs` 拥有 docs source adapter、MDX map、docs layout/screen behavior、search construction 与 docs-specific CSS；原始 MDX 留在 `content/docs`。
4. `shared/` 不导入 `features/`；`vendor/` 不导入 `features/` 或 `shared/`；`@lorelum/ui` 不导入 `apps/site`。
5. React Bits 的 provenance 与 dynamic lazy-import 行为保持完整。
6. Public routes、SSR/prerender、locale、docs search、Markdown URL、sitemap/robots/LLM endpoint 与主题切换保持兼容。
7. 迁移 PR 通过 typecheck、tests、lint、build、完整 diff review 与视觉验证矩阵。

## 暂缓决策（Deferred）

Owner 当前需要决定是否批准本结构和 i18next 推荐进入实施；共享 UI 的采用、重做或暂缓独立安排。精确库版本与加载 API 在兼容性验证后由实施落定，不要求 Owner 逐项选择内部函数。

- `@lorelum/ui` 是合并现有 proposal、重做，还是在新 Issue/PR 中重建。
- brand、theme、locale control 之外的 shared UI inventory。只有出现真实跨 feature 复用和稳定 semantic API 后才提升。
- static import-boundary checker。先让第一轮迁移证明边界，再决定是否固化。
- 任何 SaaS/PaaS taxonomy 或 backend architecture。每一个都需要独立的产品合同与技术设计。
