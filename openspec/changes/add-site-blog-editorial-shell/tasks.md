## 1. 壳结构与断点

- [x] 1.1 外壳尺寸别名 + 冻结清单（清单 5 → 6，维护者同意）
- [x] 1.2 `components/blog-shell.tsx`（CSS grid：≥1280 三轨 / ≥1024 两轨 / 更窄单轨）
- [x] 1.3 索引与文章屏改用壳；**阅读列放宽到 76ch = 742px**（`--blog-measure`，第 2 轮按维护者要求）
- [x] 1.4 实测：1920 壳 1408 居中（正文两侧空 53px、目录距右边缘 248px）、1440 满宽（空 46px）、1024/768/375 无溢出；**六档宽度全部零溢出**

## 2. 左栏内容

- [x] 2.1 `components/blog-sidebar.tsx`（文章段 + 分类段，分类由 `offeredCategories` 派生）
- [x] 2.2 两个 route loader 计算一次 `listBlogPosts` 并同时供相邻文章与侧栏使用
- [x] 2.3 `model/sidebar-categories.test.ts` 4 条；侧栏在两语言下渲染正确、当前文章带 `aria-current`

## 3. 导航挂载态（仅博客路由）

- [x] 3.1 hook 接受可选的触发元素；hero 分支不变
- [x] 3.2 文章屏传 masthead（state，非 ref）；实测收缩 `w 1425→720`、`radius 0→999px`、`mt 0→12px`，回顶复原
- [x] 3.3 接线守卫 `navbar-collapse.test.ts`（3 条）：hook 解析 `hero ?? collapseTrigger ?? null`、不用 ref；navbar 透传、博客面供给（masthead 走 state）；docs 面**不**传。**这是源码形状测试**——站点无 DOM 环境，运行时行为靠浏览器读数（见 3.4），两者分工写在测试头部。
- [x] 3.4 读数完成：panel `w 1425→720`、`radius 0→999px`、`mt 0→12px`，回顶复原；**导航收缩后点目录链接，标题落在 112px、导航底边 68px（下方 44px）**，`--blog-sticky-offset: 7rem` 仍够，亮/暗一致。

## 4. 图版出栏（bounded）

- [x] 4.1 文章内 `figure/table` 占中间轨道；正文仍是 664px。实测：1920 表 `328..1577`（1249 = 轨道 1313 − 2×32）、1440 表 769 = 833 − 64，都居中于轨道；**偏移用百分比而不是 `--lore-reading-width`**，因为该别名是 `68ch`、`ch` 按元素自身字体解析（第一版因此把块推出了页面：375 下 78px 溢出）。
- [x] 4.2 六档宽度（375/768/1024/1280/1440/1920）× 三页（文章、中文索引、英文索引）横向溢出全为 0；52 格换行矩阵与 no-JS 读数已复跑（第 5 轮，含修复 §33 的 dek/卡片摘要两个选择器盲区，见证据 §34）

## 5. 验证与交付

- [x] 5.1 四道门禁全绿：226 pass / 0 fail / 34 文件、lint 0 error / 21 warning、typecheck 恰好 2 个既有错误、build exit 0
- [ ] 5.2 人工矩阵：两语言 × 亮暗 × 1024/1280/1440/1920，索引 n=1、`?category=`、文章页、404；键盘遍历与触屏可达。
- [ ] 5.3 独立 checker 评审至 PASS（gate v2 的严重度分级与有界残留表）；既有断言的改动须单独征得同意并记录理由。
- [ ] 5.4 证据：一份证据小节（本轮读数、矩阵、评审结论），探针即用即清。

## 6. 复核期采纳的四条细节（维护者看效果后提出）

- [x] 6.1 侧栏选中态左右不对称：行只有 `pe-2`，绿色底从字形开始向右延伸。改为 `px-2`（对称），理由写进组件文档注释。
- [x] 6.2 文章头部的返回博客链接：**删除**（此前在元数据行被 `ms-auto` 推到最右）。既有断言从「3 个指向索引的链接」改为 2，并新增一条「meta 里不再有指向索引的链接」；不变式未变。收尾块里的返回链接**保留**（计划要求收尾块始终渲染），如需一并删除请说明。
- [x] 6.3 中间正文两侧空 324px：**第 2 轮改为放宽正文到 742px + 壳加上限 88rem**（两侧空隙 53px）。图/表占满轨道的规则保留（见 4.1）——两者都对齐了「不要夹在中间」，但只有后者改变正文行长。
- [x] 6.4 「跳转先出现 error 页」：**不是产品缺陷**，是我给的服务器不对——`matrix-serve.mjs` 只发预渲染文件、不跑服务端函数，客户端跳转的 `/_serverFn/...` 请求 404（响应体 `not found`）。`vite preview` 下同一个点击正常。新增 `.tmp/preview-up.mjs` 预检（重启预览 + 校验 HTML 引用的每个资源 200），因为 `vite preview` 在构建后不重启会对新 chunk 返回 404（实测过一次，读数因此无效）。

## 7. 索引卡片化与 Filter & sort（维护者看效果后要求，参照 claude.com/blog）

- [x] 7.1 条目改为**卡片**：色调面（`--blog-quiet-surface`）+ `panel` 圆角 + 24px 内边距 + 分层排版；整卡可点但**只有标题是交互元素**（`after:absolute after:inset-0` 拉伸）。实测 1 条=1 卡、圆角 20px、表面 `srgb 0.941 0.945 0.949 / 0.62`、无横向溢出。
- [x] 7.2 **常驻筛选与排序栏**：分类为链接行（`aria-current` 标当前），排序为 GET 表单（`select` + 应用 + 复位）。两者都是 URL 状态并保留彼此：实测 `/zh/blog?category=benchmark&sort=title-desc` 的分类链接各自带同一排序值，排序控件回显选中档。
- [x] 7.3 **服务端生效 → 记录已按 10.3 处置①修正**：原读数「`?category=packs` → 服务端 HTML 0 张卡 + 空状态文案，无 JS 也成立」只在直连 SSR 服务器时成立；构建产物上查询串 URL 被预渲染静态索引字节级应答（curl 比对，证据 §34/§36），无 JS 读者拿到完整列表。spec 需求与场景、控件/服务模块注释、测试注释已改为如实披露（提交 `fcbb110`，行为零变化）。
- [x] 7.4 侧栏去掉分类段（只留「全部文章」+ 文章列表）——同一状态不留两个控件。
- [x] 7.5 两条既有断言按维护者同意**重指向到新行为**（不删、不降强度）：`renders no filter chrome until a filter is active` → `renders a standing filter and sort bar`；`separates index rows with the inline hairline` → `presents index entries as cards, separated by spacing rather than a line`。同时删掉那条已成死规则的 `.blog-entry-list` hairline。
- [x] 7.6 纯逻辑与测试：`model/sort-posts.ts`（4 档 + 未知值回落默认）+ 5 条测试；`offeredCategories` 的测试仍覆盖分类来源。
- [x] 7.7 卡片/筛选栏的键盘与触屏读数已补（第 5 轮 matrix-dom 复跑：键盘 ×4 无缺焦点环、触屏命中测试、44px 目标）；表宽与 52 格矩阵见 4.2。

## 8. 复核第 3 轮：控件移入左栏、卡片按资产仓库样式（维护者要求，参照 lorelum-assets）

- [x] 8.1 依据 `lorelum-assets`（本地克隆 `D:\Projectsgents\.scratch\lorelum-assets`）的 `design/components.md` / `patterns.md` / `effects-tokens.css` 定样式，不自行发明：Card = surface + 分组间距 + 可选 line；控制台场景**不继承**「每行品牌装饰」与「以巨大空白制造高级感」；Input/Search = 可见 label + control-border + focus ring。
- [x] 8.2 筛选与排序**移入左栏**（原先在内容上方成一条横条，维护者判「太难看」）。索引屏不再自己渲染控件；文章页不渲染（改了不影响该页的控件等于无控件）。
- [x] 8.3 下拉框不再难看：`appearance:none` + 自绘 chevron（平台箭头无法调样式与间距）+ 控件边界角色 `--input` + 44px 高 + 焦点环。实测：h=44、边框 `rgb(124,131,138)`、`appearance=none`、自绘箭头在场。
- [x] 8.4 「应用」不再独占一行的全宽按钮，与下拉框同一行（原先两段式读起来像两个不相干的控件）。
- [x] 8.5 卡片占满中间轨道（带边框的面板），分类改为 Badge 胶囊（与文章页元数据行同一组件 `CategoryChip`），右上角常驻品牌绿箭头作为进入提示。**箭头不用 hover 显现**：`blog-identity.test.ts` 禁止阅读面上的 `group-hover`（触屏够不到），所以它是常驻的，悬停反馈落在卡片自身的 border/shadow。
- [x] 8.6 卡片与左栏控件的键盘/触屏逐项读数已补（第 5 轮，同 7.7）；4.2 矩阵已复跑。

## 9. 复核第 4 轮：下拉框根除 + 每张卡片配图（维护者要求，参照 openai/claude 官方博客）

- [x] 9.1 **下拉框彻底移除**（8.3 只修了合拢态，展开的选项弹层是平台原生部件，样式表够不到，两种主题下都显得格格不入——即维护者截图所指）。排序改为与分类同构的**链接**（4 档胶囊，`aria-current` 标当前，整组一行内换行），点击即导航，无需「应用」。既有断言按维护者要求重指向：`<form method="get">` → 「每个选项都是携带完整 search 状态的链接（分类点击保留排序、排序点击保留分类）」，`--input` 边界角色断言随 select 一并退役（控件从输入变成链接，链接取焦点环）。`blogApply` 键删除（无消费者）。
- [x] 9.2 **每张卡片配图**（参照两个官方博客：不出现纯文字卡）：frontmatter 新增可选 `image`（站点内公开路径，正则拒绝远程 URL/协议相对/尾斜杠/裸词），无图文章由 `BlogCover` 生成封面——`cover-pattern.ts` 按 slug 播种的 6×4 圆角格子场，单色（唯一品牌饱和通道，同分类胶囊的单色规则），1–3 格提升为高亮档保证每张封面有视觉锚点；同 slug 双语言共享同一封面。生成分支 `aria-hidden`、作者图 `alt=""`（frontmatter 无 alt 可言，标题就在旁边）。
- [x] 9.3 **卡片改横向布局**（Claude 列表行的形状）：左封面右文字，`sm` 以下上下堆叠（16:9 全宽封面）。右上角常驻箭头**移除**——有封面后它成为多余装饰（两处参照均无此元素），悬停反馈仍落在卡片自身 border/shadow；整卡可点不变。
- [x] 9.4 门禁：242 pass / 0 fail / 37 文件、lint 0 error / 21 warning、typecheck 恰好 2 个既有错误、build exit 0。新增 `cover-pattern.test.ts`（5 条：确定性、区分度、仅 slug 播种、网格恰好覆盖一遍且只用档位值、分布校验）与 frontmatter 的 `image` 正反例。
- [ ] 9.5 **部分**：胶囊与封面的亮/暗截图与读数已拍（第 5 轮 `.tmp/shot-*` / `.tmp/polish-*`）；「生成封面的两主题观感」属用户主观项，待用户看预览裁定。
- [x] 9.6 **预渲染碰撞（本轮探针抓到的隐性缺陷，早于本轮存在）**：爬虫把 `/zh/blog?category=benchmark` 当独立任务，但输出文件名会剥掉查询串，于是**晚写**的过滤视图覆盖了无参页面的 `index.html`——无参页上每个控件都带着一个看不见的分类过滤（n=1 且恰为 benchmark 文章，列表内容完全相同，此前不可见）。修复：`vite.config.ts` 的 `prerender.filter` 排除带查询串的路径（按需 SSR，与未知 `?category=` 的既有行为一致）；实测重建后无参页 pills 只带 `?sort=`，点击「标题（Z–A）」落在 `?sort=title-desc`（无 category）。
- [x] 9.7 **复位链接继承缺陷**：无 `search` 的 Link 继承当前 search，「重置」落在 `?sort=newest` 而非清空。改为显式 `search={{ category: undefined, sort: undefined }}`；实测点击后 category 被剥掉（剩余 `?sort=newest` 是 validateSearch 对默认值的规范序列化，即默认态本身，非残留过滤）。断言入 `blog.test.ts`。

## 10. 复核第 5 轮：矩阵复跑、移动端闭合、静态服务边界升级（接手会话）

- [x] 10.1 **codex 三提交的复核与补全**：`908dad2`（移动端 <1024px 控件移到卡片上方，`lg:hidden`）与 `13f8c7b`（过滤态下侧栏保持完整文章列表与全部分类，loader 返回全量 + `filteredPostSlugs`）均为对 §33 唯一 BLOCKING（移动端控件不可达）的修复，checker 独立复测闭合：375/1440 双向恰好一组控件、h=44、侧栏副本不进键盘序。`b6c28a0` spec 对齐（见 10.3 保留意见）。未提交的 prerender 过滤抽取经简化（无后缀导入，撤销 `allowImportingTsExtensions`）后提交为 `d7ab753`。
- [x] 10.2 **4.2/7.7/8.6/9.5（读数部分）完成**：52 格换行矩阵 + 34 格 DOM 矩阵（no-JS ×10、键盘 ×4、触屏、缩放、TOC 开合、主题切换）复跑，全绿；并修复 §33 的两个选择器盲区（dek、卡片摘要在卡片布局下未被测到），本轮捕获敌意 dek 129 字符 / 摘要 410 字符仍全 0 溢出。读数与命令在证据 §34。
- [x] 10.3 **F1 升级维护者裁决（BLOCKING）→ 已裁定处置①（如实披露），提交 `fcbb110` 收口**：查询串 URL（`?category=`/`?sort=`）被静态 `index.html` 字节级相同地应答——过滤/排序只在水合后客户端生效；无 JS 读者/爬虫拿到未过滤列表；`wrangler.json` 无 `run_worker_first`，生产同行为。用户选定处置①：spec 与注释如实描述（查询 URL = 静态索引应答，过滤列表仅在有脚本时呈现），无行为变化；5.3 checker 的 REJECT 依据（声明契约与实现不符）随之消除。未采用②`run_worker_first`（每次博客命中都跑 worker）与③移出预渲染改按需 SSR；9.6 未回退。
- [x] 10.4 封面观感与审美方向：用户查看 `http://localhost:9710/zh/blog/` 后裁定执行批判报告 1/2/3a/5（经 10.5）与 1/2/4 裁定（经 10.6），已全部收口。
- [x] 10.5 **用户裁定后的审美修复轮（提交 `01bea45`）**：用户批准执行批判报告中的 1/2/3a/5 四项。执行中修正批判问题 1 的事实：`.blog-scope :is(h1..h4)` 早已绑定 `--lore-font-display`（en 页实测 Bricolage 30px/600），zh 走 `:lang(zh)` 文档化 CJK 回退（Bricolage 无中文字形）——「全站无品牌字体」不成立，残余为卡片标题字重（500→600，title 角色）。已落地：封面四档 opacity 亮/暗分标（0.14/0.22/0.36/0.62 与 0.28/0.42/0.58/0.78，data-tier 钩子，模型数值与确定性不动）、侧栏排序 pills `lg:grid lg:grid-cols-2`（实测 117px×2 两行、孤行消失）、卡片元数据行降 caption 12px。门禁：site 248/0（含 2 个新测试）、lint 0e/21w、typecheck 恰 2 既有、build 0；roles 矩阵 52 格 0 溢出、DOM 矩阵 38 格全绿；`mutation-lock.test.ts` 隔离与干净树双重复跑确证为 engine 既有 flaky（与本轮无关）。视觉核对：暗色封面「读作有意的艺术而非渲染错误」。另：`bun run fmt`（oxfmt）会重排全仓 973 文件，已整体回滚，本轮 diff 保持语义干净——fmt 与仓库现状不匹配，避免在此 worktree 全仓执行。
- [x] 10.6 **审美遗留已逐项裁定（提交 `37abd09`）**：① masthead 编辑栏化——headline 尺度（实测 1440=48px/600、375=36px）、dek 限宽 65ch、panel→block 节奏（mb-8/md:mb-10，视觉复核后由 48 收至 40px）；② zh 显示语音——**用户裁定不引入**子集化 CJK webfont，维持文档化 `:lang(zh)` 回退（字重补偿已在 10.5 落地）；③ 640px 封面比例突变——已加 sm 16:10 过渡档（实测 640=176×110、768 起=176×176、375=286×161 竖排）。门禁：site 248/0、lint 0e/21w、typecheck 恰 2 既有、build 0；roles 矩阵 52 格 0 溢出、DOM 矩阵 38 格全绿。
- [x] 10.7 **dek 移除（用户红框指认，第 8 轮）**：用户在页面上圈定 masthead 副题「benchmark、评测方法与 Pack 工程。每篇说明测量口径、样本规模与证据来源。」为不必要文本。已删其在索引页的可见渲染（zh/en 同时生效）；`blogIndexDescription` 字符串保留，仅供 `blog-head.ts` 的 `<meta name="description">`/`og:description`（测试钉住的不可见 SEO 用途）。门禁全绿（site 248/0、lint 0e/21w、typecheck 恰 2 既有、build 0）；dist 与 9710 live 验证：正文 0 残留、meta 在位、资产 24/24。读数与命令在证据 §39。
