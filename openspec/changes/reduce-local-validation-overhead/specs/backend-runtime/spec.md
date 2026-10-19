## MODIFIED Requirements

### Requirement: Authenticated local control boundary

Backend client MUST 在首次向一个 daemon instance 发送受保护业务请求前验证 nonce-bound instance identity、build identity 和内部协议兼容性；同一 client 后续业务请求 SHALL 沿用该接入身份而不重复发起 identity 挑战，并 MUST 继续携带 runtime credential。显式身份识别和新 client 接入 MUST 重新验证；允许跨 build 的 stop 接入不得使后续严格业务调用绕过 build 检查。Backend MUST 拒绝不符合 loopback authority、Host、Origin、body-size 与认证边界的请求，且 MUST 不向响应泄露 runtime secret、本机私有路径、native 私有端口或原始 Practice/query 输入。

#### Scenario: Untrusted local HTTP request

- **WHEN** HTTP 请求缺少有效认证、携带 Origin、使用错误 authority 或超过 body 限制
- **THEN** Backend MUST 拒绝该请求，且响应 MUST 不泄露 daemon runtime detail

#### Scenario: Repeated requests on one verified client

- **WHEN** 同一 client 已完成 daemon 接入验证并继续发出状态或业务请求
- **THEN** 后续请求 MUST 使用该实例的 credential 而不额外请求 identity；认证失败或实例退出 MUST 返回既有错误，不自动切换实例或重放业务

#### Scenario: Strict request follows cross-build stop access

- **WHEN** client 曾为允许跨 build 的 lifecycle 操作识别实例，随后提交要求当前 build 的业务
- **THEN** build 不匹配 MUST 继续返回 backend.build-mismatch，不得把已识别当作已兼容

## ADDED Requirements

### Requirement: Trusted local filesystem scope

本地 runtime SHALL 信任正常同用户环境中的路径组织，不得仅因可信祖先目录是 symlink 拒绝操作。凭据/runtime 私有叶节点的权限、文件类型和安全终止进程所需 PID/启动时间核对 MUST 保持有效；本要求不得引入远程监听、放宽浏览器请求边界或自动终止未拥有进程。

#### Scenario: Runtime below a normal symlinked parent

- **WHEN** runtime 私有目录位于正常可访问的 symlink 祖先之下，且私有叶节点属性符合既有规则
- **THEN** Backend SHALL 正常读取或创建自己的 runtime 数据，不因祖先链接本身返回 state-invalid
