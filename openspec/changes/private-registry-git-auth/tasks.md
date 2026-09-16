# Tasks: private-registry-git-auth

## 1. 测试基建先行

- [x] 1.1 搭建本地 git fixture 工具（本地裸仓库 + file:// 传输、临时 HOME、注入式 git runner），供 descriptor git 读取与物化路径测试复用；不依赖真实网络与真实 SSH
- [x] 1.2 建立 legacy 行为回归基线测试（slug / HTTPS URL 的成功与失败输出快照，错误消息逐字断言），先于实现落盘并保持绿

## 2. Locator 解析扩展

- [x] 2.1 `resolveRegistryRepository` 接受 `git@github.com:owner/repo.git` 与 `ssh://git@github.com:owner/repo.git`：提取 slug、github.com-only 校验、沿用既有 slug 正则，`gitUrl` 取用户 URL 原样；`RegistryRepository` 增加传输判别（raw / git）
- [x] 2.2 非法形态拒绝测试（非 github host、带 userinfo/port/query、坏 slug），与 design.md D1/D5 对照

## 3. 沙箱环境增补

- [x] 3.1 `GIT_ENVIRONMENT` 增补 `SSH_AUTH_SOCK` 透传；统一注入 `GIT_SSH_COMMAND="ssh -oBatchMode=yes"`，descriptor 读取与物化一致
- [x] 3.2 `HOME`/`USERPROFILE` 缺失对 ssh 定位 `~/.ssh` 的影响以测试锚定（覆盖 macOS/Linux/Windows 语义），必要时增补白名单并回写 design.md D6

## 4. descriptor git 化

- [x] 4.1 git 传输 descriptor 读取：shallow fetch 后 `git show <rev>:.lorelum/registry.yaml`，复用沙箱环境与既有 git 超时；256KB 上限、schema 校验、错误分类与 raw 路径一致
- [x] 4.2 `loadRegistry` 形态分流：legacy 输入保持现有 raw 路径（代码不共享），SSH 输入走 git 路径；fixture 覆盖 descriptor git 读取与 install 命令的 gitUrl 传递，install → list → get 全回路归 8.2 真实证据

## 5. 错误与非交互

- [x] 5.1 git 传输访问失败返回 `registry.unavailable`，SSH 形态消息含 `ssh -T git@github.com` 指引；公开路径错误消息与 1.2 基线逐字一致
- [ ] 5.2 失败注入测试：仓库不可达 + "不存在/无权限不可区分"已自动化；无凭据、host key 未信任两个真实 SSH 态并入 8.2 手动证据（本机已实测无凭据快速失败，待密钥上传后随 8.2 一并勾选）

## 6. 安全断言

- [x] 6.1 断言 install/update 成功与失败的全部输出（JSON envelope、错误消息、store 记录）不含 userinfo 与 token
- [x] 6.2 断言 spawn git 的环境不含凭据类变量、任何日志与错误输出无携带凭据的 URL

## 7. 文档

- [x] 7.1 `docs/cli/packs.md` 增补 `--registry` SSH URL 用法示例与传输新鲜度语义说明（git 路径每次现拉；raw 路径受上游 CDN 窗口影响）

## 8. 全量验证与证据

- [x] 8.1 全量验证序列原始输出留档：`bun test`、`bun run lint`、`bun run typecheck`、`bun run fmt:check`
- [ ] 8.2 真实 SSH 强证据：host key 已核验信任、专用密钥已生成；待公钥上传 GitHub（需 admin:public_key scope 或网页）后执行 install → list → get 正向回路，与 5.2 两个真实态一并留档
- [x] 8.3 独立 CR：以零上下文对抗性 review 复现声明并审查 diff，findings 清零后本变更标记实现完成
  （2026-09-16 L2 CR verdict READY，无 blocker/major；4 个 minor 已修复：mkdtemp 失败映射、ssh:// dot-segment 归一、scp host 大小写派发、legacy 不回退测试锚定；2 个 nit 评估为安全失败行为并记录于 PR）
