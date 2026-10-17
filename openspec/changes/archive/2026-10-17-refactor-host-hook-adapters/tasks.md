## 1. 共享能力与连接边界

- [x] 1.1 在包含主线 `963963e` 的实现分支迁移，保留现有六宿主行为测试；用 LSP references 确定待移动导出和仓库调用者，按 acceptance B1–B13 记录迁移范围，不把旧 worktree 缺失的 omp 当新增功能。
- [x] 1.2 将通用 Backend 客户端工厂迁入 `backend/process-client.ts`，更新全部调用者；验证 typecheck 和既有 Backend 不启动/身份校验行为，落实 A5。
- [x] 1.3 实现按调用绑定的 CatalogReader、ShellAssociator、ReadHintReader；复用已有 renderer、设置和可选请求策略；验证 Catalog 不连接 Backend、shell 不访问 Store、普通提示与 omp 错误策略有别，落实 A4–A5、B6–B7、B12。

## 2. 宿主协议所有权

- [x] 2.1 将 Codex/Claude 原生输入解释、响应与 fallback 移入真实 adapter，删除纯别名转发；验证 B1–B3、B7、B9，尤其 allow 仅保留在 Codex。
- [x] 2.2 将 Cursor/WorkBuddy/ZCode 协议逻辑移入各自 adapter；验证 B1、B4–B6、B8–B9，保留 session 优先级、额外输入属性、ZCode 失败响应及无子 Agent 通道边界。
- [x] 2.3 将 omp 三类 bridge 请求移入独立 adapter，显式注入 sub 设置读取和候选错误策略；验证 B10–B12，不改原生扩展的快照、handoff、user 消息或审批流程。

## 3. 统一入口与清理

- [x] 3.1 实现一次 Hook argv 识别和显式 endpoint factory 映射；以公共 runner 处理 stdin/JSON/stdout，以单一 finally 关闭日志；验证 B9、B13 和 A1–A4，不改变普通 CLI 输出路径。
- [x] 3.2 切换 main 后删除旧 host-hook 中央宿主分支、六套入口、无用别名和转发出口；用 LSP references 迁移 barrel 与全部调用者，typecheck 验证没有第二套路径，落实 A6–A7。

## 4. 最终行为验证与维护说明

- [x] 4.1 对最终代码运行受影响的 colocated 行为测试及包级 typecheck，完成 B1–B13 和 A1–A7；删除只测试文件名、文案或转发关系的断言，不削弱实际行为覆盖。记录准确命令和观察结果，不让独立 Agent重复已有效完成的检查。
- [x] 4.2 使用隔离 Store 运行六宿主源码 CLI smoke，核对 Catalog、shell、候选与失败响应；按受影响边界走真实宿主安装和消费路径验证，区分模拟、源码 CLI 与真实宿主证据，明确不可用环境而不伪称通过。
- [x] 4.3 在 smoke 证据成立后更新维护者文档的目录和调用链，移除迁移临时产物；核对用户行为未变，因此不复制或改写站点用户流程，不修改 stable specs、依赖、锁文件、CI 或发布配置。

## 5. 测试归属与公共覆盖

- [x] 5.1 将六宿主测试迁入 `hook/hosts/` 与实现配对，使用语言服务更新相对 import；保留宿主协议、权限、别名及降级覆盖。
- [x] 5.2 将参数解析与普通 CLI 回落覆盖集中到 `command.test.ts`，将公共读取/解析/异常出口覆盖放入 `runner.test.ts`；消除宿主文件中的公共场景和跨宿主断言，不削弱行为验收。
- [x] 5.3 运行调整后的 Hook 与跨包扩展测试、CLI typecheck、源码入口 smoke，更新开发文档及验证记录；确认只调整测试组织与覆盖，不改变运行时代码。

## 6. Codex 与 omp 真实宿主验收

- [x] 6.1 使用本工作区编译 CLI、隔离 Store 和真实 Codex 原生插件，验证启动 Catalog 的模型可见性、实际 shell get 以及宿主/session 身份注入。
- [x] 6.2 使用同一编译 CLI、独立 Store 和真实 omp 扩展，验证 Catalog 的模型可见性、实际 shell get 以及宿主/session 身份注入。
- [x] 6.3 记录宿主版本、加载与运行方式、实际请求和输出证据；处理验收暴露的问题，清理临时资源，不改用户 provider、认证或全局 CLI。
