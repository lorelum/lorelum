## Context

`Deploy site` 已是仅手动触发。原 `Release` workflow 在 build job checkout 输入 tag，并要求它事先存在且为 annotated tag；draft job 只创建 GitHub Release。runbook 因此指导维护者手动推 tag。

## Decisions

- 用 dispatch 的 `github.sha` 作为三个 build job 和 draft job 的唯一源码 commit。draft 模式只接受 `main`，输入 `tag` 必须等于该 commit 中 CLI 包版本的 `v` 前缀形式。
- 三平台归档经各自验证并汇总校验和后，draft job 先检查 tag/Release 不存在，再推 annotated tag，随后创建 prerelease draft。`contents: write` 只授予 draft job；build-only 不创建 tag。
- Tag 推送成功而 draft 创建失败时不重试正常路径，也不移动 tag；使用已验证的保留产物调查并恢复 draft。正式发布仍由人工核对后执行。
- runbook 把网站部署、CLI Action 参数、draft 审查及取消 draft 写成一个顺序流程。若两次手动运行之间 `main` 变化，先重新核对变更范围与线上站点。

## Verification

解析 workflow YAML，核对输入、权限和 job 顺序；运行 release tooling 的 focused tests、文档 diff/链接检查。真实 Action 与线上部署只能在准备 PR 合并后验证，本变更不触发它们。
