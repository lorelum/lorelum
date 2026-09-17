## ADDED Requirements

### Requirement: Registry locator transport
`lore pack install` 与 `lore pack update` 的 `--registry` locator SHALL 支持 GitHub slug、GitHub HTTPS URL 与 GitHub SSH URL 三种形态，并按形态选择 descriptor 读取传输。SSH URL 输入 MUST 仅接受 github.com host，MUST 接受 `git@github.com:owner/repo.git` 与 `ssh://git@github.com/owner/repo.git` 两种写法，MUST 从 URL 提取 slug 用于校验与展示，并 MUST 从用户提供的 URL 派生物化用 git URL 而不将其重写为其他传输。SSH URL 的 descriptor 读取 MUST 经同一 git 传输完成，且 256KB 大小上限、schema 校验与错误分类 MUST 与匿名 raw 路径一致。

#### Scenario: SSH locator installs from a private repository
- **WHEN** 调用方以 `--registry git@github.com:owner/private-repo.git` 执行 install，且当前环境 git 已能以 SSH 访问该仓库
- **THEN** CLI MUST 完成安装，install → list → get 行为与公开仓库一致

#### Scenario: ssh:// syntax is equivalent
- **WHEN** 调用方以 `--registry ssh://git@github.com/owner/repo.git` 指定与 `git@github.com:owner/repo.git` 相同的仓库
- **THEN** CLI MUST 解析出相同 slug 并走相同 git 传输

#### Scenario: Non-github host is rejected
- **WHEN** 调用方以 host 非 github.com 的 SSH URL 指定 registry
- **THEN** CLI MUST 返回 registry invalid error，且不发起网络访问

### Requirement: Legacy locator compatibility
`owner/repo` slug 与 `https://github.com/owner/repo(.git)` 输入的 Registry 解析行为 SHALL 保持不变：MUST 继续经既有匿名 raw 路径读取 descriptor，其成功与失败输出（含错误消息）MUST 与本要求生效前逐字一致。

#### Scenario: Slug input keeps anonymous raw path
- **WHEN** 调用方以 `--registry owner/repo` 或 `--registry https://github.com/owner/repo.git` install 公开仓库
- **THEN** CLI MUST 走匿名 raw 路径，所有输出与本要求生效前一致

#### Scenario: Legacy input never switches transport
- **WHEN** 任一 legacy 形态 locator 指向的仓库为私有或不可达
- **THEN** CLI MUST 沿用匿名 raw 路径的错误行为，MUST NOT 自动回退或重试 git 传输

### Requirement: Non-interactive SSH transport
git 传输 SHALL 全程非交互：SSH 首连 host key 确认、key passphrase 等交互提示 MUST 确定性快速失败，任何场景 MUST NOT 挂起等待交互输入。

#### Scenario: Untrusted host key fails fast with guidance
- **WHEN** SSH 首连遇到 known_hosts 无条目的 host
- **THEN** CLI MUST 快速失败返回 `registry.unavailable`，消息含先以 `ssh -T git@github.com` 验证访问的指引，且不得挂起

#### Scenario: Inaccessible repository is indistinguishable
- **WHEN** 当前环境对目标私有仓库无 SSH 访问权限，或该仓库不存在
- **THEN** CLI MUST 对两种情形返回相同的 `registry.unavailable` 分类，MUST NOT 区分"不存在"与"无权限"

### Requirement: Registry descriptor freshness
git 传输的 descriptor SHALL 每次 install/update 现拉，MUST NOT 引入本地缓存。

#### Scenario: Newly pushed release is immediately installable
- **WHEN** 调用方向 git 传输 registry 推送新 release tag 后立即执行 install
- **THEN** CLI MUST 解析到该新 release，无需任何缓存失效操作

### Requirement: Credential hygiene
任何命令输出、错误信息与 store 记录 MUST NOT 出现携带 userinfo 的 URL 或其他凭据内容。git 传输 MUST 复用既有物化沙箱环境语义（不读取用户全局 git 配置，credential helper 与 `insteadOf` 不生效），SSH agent 密钥经 `SSH_AUTH_SOCK` 环境透传保持可用。

#### Scenario: No credentials in output
- **WHEN** 以任一形态 locator 执行 install 并成功或失败
- **THEN** JSON envelope、错误消息与 store 记录 MUST NOT 包含 userinfo 或 token
