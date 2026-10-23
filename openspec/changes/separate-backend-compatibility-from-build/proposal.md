## Why

同一协议的本机 CLI 与 Backend 被精确 build ID 隔开，重新编译或切换测试构建会迫使用户重启昂贵的模型进程；只有不透明哈希又无法判断正在运行哪份代码。本 change 为 Issue #262 引入新的产品行为：把协议兼容、构建溯源和开发者主动切换运行代码分成三个明确职责，而不是把现有严格检查描述为偶发实现错误。

## What Changes

- 普通 query、model、index、Backend start/status 在认证和实例归属核验通过后，按 Backend 内部协议判断兼容；精确 build 不同不再构成错误，也不自动停止服务。
- 保留精确 `buildIdentity`，增加版本、Git revision、dirty 状态和 source/compiled 来源；`--version` 可比较当前 CLI，Backend status 同时展示双方，协议错误说明双方已知身份与协议。
- 增加 `lore backend start --current-build`：开发者明确要求运行本次构建；同构建复用，不同构建只在既有 guarded-idle 条件满足时交接。繁忙或活动未知则返回 deferred，不强停、不后台重试、不把旧构建当作已切换。
- **BREAKING**：为扩展的 status 合同升级 Backend 内部协议，保留一次性旧实例交接；CLI JSON envelope 协议不跟随 Backend 内部协议变更。身份握手、runtime record 和精确 ID 的字段含义不变。
- 产品交互见 [product.md](./product.md)。不在成功 query 中追加重复提示，不要求修改 shell、切换全局链接、维护 host 标签或额外配置。

## Capabilities

### New Capabilities

- `build-provenance`: 当前 CLI 与运行中 Backend 的可读、可比对构建信息，以及元数据缺失时的诚实展示。

### Modified Capabilities

- `backend-runtime`: 基于协议的跨构建复用、认证与精确归属分离、显式 current-build guarded handoff 和可操作错误。
- `retrieval-query`: 同协议跨 build 正常查询，真正不兼容时继续保留无隐式恢复的错误与手动重试路径。

## Impact

- Backend client 接入判断、status DTO、daemon 启动快照与 supervisor lifecycle；保留身份 proof/DTO、runtime record，不改变 Engine 检索与 Store/index 身份。
- CLI version 发现、Backend start/status 输出和对应 schema；保持既有 envelope、resource 与 diagnostics。
- 本地编译入口嵌入 provenance，但不改变发布 workflow、安装器、license、native manifest 或发布权限。
- 实施时同步 maintainer CLI/API/开发指南及对应中英文站点文档；提案阶段不把新行为写进已支持的用户指南。
- 与 `stop-backend-before-cli-upgrade` 的边界是开发调用与安装器升级分别拥有交接：不替换、不扩展该 change 的安装器行为。
- 不涉及模型校验失败的独立问题，不引入多 daemon、端口/profile 配置、协议范围协商、额外兼容 epoch 或本地 MCP。
