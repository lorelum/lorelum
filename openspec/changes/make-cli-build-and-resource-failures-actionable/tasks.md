## 1. 构建入口

- [x] 1.1 将 `build:cli` 指向完整本地目录构建、将单文件构建命名为 `build:cli-only`，保留旧 staging 别名；用脚本映射测试和完整/单文件产物检查验证。
- [x] 1.2 更新 Agent、开发、Backend 与 benchmark 指南的命令和产物路径；核对活跃调用点以及 `git diff --check`，不改写历史验证记录。

## 2. 资源校验

- [x] 2.1 在 Backend 的 native 校验边界提供安全的文件/检查项/预期与实际信息和独立 native 错误码；用缺目录、manifest 不匹配、文件大小/hash 不匹配测试验证。
- [x] 2.2 在默认与显式模型文件校验中保留模型专用错误信息，不改变缓存重试策略；用现有及新增 `prepareModel` 测试验证。
- [x] 2.3 模型准备先验证 native 安装，再开始模型下载，启动前仍进行完整校验；以无下载调用的缺 native 负例和真实完整产物正例验证。

## 3. 错误传播和文档

- [x] 3.1 让 Backend failed status、HTTP 错误和 client 轮询保留受限 `resource`，覆盖显式 load 和 query；运行 Backend service/controller/client 测试。
- [x] 3.2 让 CLI text/JSON 的 model load、model status 和 semantic query 呈现同一根因、恢复动作与安全资源字段；运行 CLI model/query/output 测试并检查无绝对路径或凭据泄漏。
- [x] 3.3 更新 Backend/CLI 契约页与中英用户故障页，准确说明模型文件与 native 安装的不同处理；检查相对链接与 OpenSpec strict validation。

## 4. 验收与交付

- [x] 4.1 跑聚焦测试、lint、typecheck 和可适用的格式检查；用 `build:cli` 完整产物沿本机真实 Backend/Pack 路径执行模型加载和语义 smoke，记录环境与验证边界。
- [ ] 4.2 审查完整 diff、暂存列表及敏感信息，提交聚焦 commit，推送分支并创建与 #261 关联的 PR；核对远端 PR head 和检查状态。
