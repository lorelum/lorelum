# Tasks: private-registry-git-auth

## 1. 测试基建先行

- [ ] 1.1 搭建本地 git fixture 工具（本地裸仓库 + file:// 传输、临时 HOME、注入式 git runner），供 descriptor git 读取与物化路径测试复用；不依赖真实网络与真实 SSH
- [ ] 1.2 建立 legacy 行为回归基线测试（slug / HTTPS URL 的成功与失败输出快照，错误消息逐字断言），先于实现落盘并保持绿

## 2. Locator 解析扩展

- [ ] 2.1 `resolveRegistryRepository` 接受 `git@github.com:owner/repo.git` 与 `ssh://git@github.com/owner/repo.git`：提取 slug、github.com-only 校验、沿用既有 slug 正则，`gitUrl` 取用户 URL 原样；`RegistryRepository` 增加传输判别（raw / git）
- [ ] 2.2 非法形态拒绝测试（非 github host、带 userinfo/port/query、坏 slug），与 design.md D1/D5 对照

## 3. 沙箱环境增补

- [ ] 3.1 `GIT_ENVIRONMENT` 增补 `SSH_AUTH_SOCK` 透传；统一注入 `GIT_SSH_COMMAND="ssh -oBatchMode=yes"`，descriptor 读取与物化一致
- [ ] 3.2 `HOME`/`USERPROFILE` 缺失对 ssh 定位 `~/.ssh` 的影响以测试锚定（覆盖 macOS/Linux/Windows 语义），必要时增补白名单并回写 design.md D6

## 4. descriptor git 化

- [ ] 4.1 git 传输 descriptor 读取：shallow fetch 后 `git show <rev>:.lorelum/registry.yaml`，复用沙箱环境与既有 git 超时；256KB 上限、schema 校验、错误分类与 raw 路径一致
- [ ] 4.2 `loadRegistry` 形态分流：legacy 输入保持现有 raw 路径（代码不共享），SSH 输入走 git 路径；fixture 端到端测试（install → list → get）覆盖 git 路径

## 5. 错误与非交互

- [ ] 5.1 git 传输访问失败返回 `registry.unavailable`，SSH 形态消息含 `ssh -T git@github.com` 指引；公开路径错误消息与 1.2 基线逐字一致
- [ ] 5.2 失败注入测试：无凭据、host key 未信任、仓库不可达三态均确定性快速失败不挂起；"仓库不存在"与"无权限"不可区分（同码同形）

## 6. 安全断言

- [ ] 6.1 断言 install/update 成功与失败的全部输出（JSON envelope、错误消息、store 记录）不含 userinfo 与 token
- [ ] 6.2 断言 spawn git 的环境不含凭据类变量、任何日志与错误输出无携带凭据的 URL

## 7. 文档

- [ ] 7.1 `docs/cli/packs.md` 增补 `--registry` SSH URL 用法示例与传输新鲜度语义说明（git 路径每次现拉；raw 路径受上游 CDN 窗口影响）

## 8. 全量验证与证据

- [ ] 8.1 全量验证序列原始输出留档：`bun test`、`bun run lint`、`bun run typecheck`、`bun run fmt:check`
- [ ] 8.2 真实 SSH 强证据：对 rehearsal 仓库执行 `--registry git@github.com:AzMilabo/lorelum-rehearsal.git` 端到端 install → list → get，终端记录留档
- [ ] 8.3 独立 CR：以零上下文对抗性 review 复现声明并审查 diff，findings 清零后本变更标记实现完成
