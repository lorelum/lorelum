# Proposal

## Why

Windows 上 omp 普通 Bash 工具使用类 POSIX 语法，现有 bridge 却按操作系统插入 PowerShell 赋值，导致会话身份未传递，成功 get 无法记录候选。omp 也可使用其他外部 shell，不能单凭平台准确判断所有调用。

## What Changes

- 引入用户可观察的 `agent.ompShell` 配置：默认 `bash`，可选 `powershell`，只决定 omp 会话身份前缀的语法。
- 保留现有注入策略、权限、原命令、非阻塞错误和其他宿主行为。
- 为默认与配置路径补充回归验证，并更新中英文用户配置指南。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：明确 omp 的 shell 语法默认值与用户显式选择。

## Impact

影响 omp shell bridge、配置解析、测试及对应文档；不改变 query/get 的结果、排序或 JSON，不读取或修改 omp 用户配置。
