# web-design-system Specification

## Purpose
定义 Lorelum Web 的生产 token、共享组件和主题责任，使站点可以复用一致的视觉基础，而不将 routes、文案、数据或动画生命周期泄漏到 UI package。

## Requirements

### Requirement: UI ownership and scoped tokens
`@lorelum/ui` SHALL 拥有生产 design tokens 与可复用 Web primitives；消费应用 SHALL 拥有 route、locale 文案、数据、theme lifecycle 和页面级 motion。tokens MUST 通过 `.lorelum-ui` 作用域提供，且不得在未明确的全站迁移中扩展到 `:root`。

#### Scenario: A site surface adopts shared UI
- **WHEN** 站点将一个 surface 迁入共享 UI
- **THEN** 该 surface MUST 显式应用 `lorelum-ui` scope，并继续由 site 管理主题、路由和页面组合

### Requirement: Token and component discipline
生产 CSS 值 MUST 位于 UI token source，Tailwind mapping MUST 只映射语义 role 而不得重建 palette。新增 shadcn component MUST 有真实 consumer、明确的 Base UI-compatible ownership 与行为测试；系统 MUST 不批量安装组件、创建第二个 site-local UI tree 或以 call-site layout 覆盖语义色彩/排版。

#### Scenario: Adding a shared component
- **WHEN** 维护者需要新增 UI primitive
- **THEN** 其 MUST 证明真实 consumer，使用现有 token/variant，并添加对应测试而不得以 `add --all` 批量引入组件

### Requirement: Theme-safe visual verification
共享 token 与组件 MUST 支持现有 light/dark semantic roles 和 SSR 语义。变更 UI token 或 primitive 后，维护者 MUST 运行 package typecheck/tests 与 site production build，并在受影响 surface 验证主题和必要状态。

#### Scenario: Token role changes
- **WHEN** semantic token 或共享组件状态发生变化
- **THEN** 验证 MUST 覆盖 theme role、SSR 输出及实际 site consumer，而不得只检查 CSS 文件存在
