## Why

发布准备 PR 合并后，维护者应只配置参数并手动触发官网部署与 CLI 发布两个 Action。现有 Release workflow 要求维护者事先创建 annotated tag，与这一发布分工冲突，也使 runbook 的正常路径不准确。本变更引入新的发布流程，而不是记录已存在的行为。

## What Changes

- `Deploy site` 仍由维护者从已验证的 `main` 手动触发，并先核对线上文档。
- `Release` 从手动触发时选定的 `main` commit 构建三个平台归档；开启 draft 选项时，验证版本和产物后，由 Action 创建 annotated tag 与 GitHub prerelease draft。
- 维护者核对 draft 的 commit、notes、资产与校验和后，才取消 draft 并验证公开安装器。
- 保留不创建 tag/Release 的 build-only 运行；已有 tag/Release 不覆盖、不移动。

## Capabilities

### Modified Capabilities

- `cli-distribution`: 明确手动发布的 tag 与 draft 归属，以及正式发布仍由维护者确认。

## Impact

- `.github/workflows/release.yml` 的输入、检验和 draft job；`docs/development/release.md` 的维护者操作步骤。
- 不改安装器、发布资产格式、`Deploy site` workflow、公开版本或 registry 发布。
