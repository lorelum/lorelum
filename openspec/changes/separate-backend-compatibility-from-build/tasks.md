## 1. 构建信息与本 CLI 观测

- [x] 1.1 按 design 第 2 节增加唯一 BuildProvenance/BuildInfo 类型和本地采集，保留 source/compiled 精确 ID 算法；用 colocated 测试验证 entrypoint 定位、不依赖 cwd、Git 缺失为 null、dirty 不冒充 clean，以及无私有路径输出。
- [x] 1.2 在现有两条编译路径嵌入一次性 provenance，扩展 `scripts/release/compile-cli.test.ts`，实际运行两次编译及复制后的 executable，验证原始 ID 稳定、重建 ID 不同、完整 revision/dirty/版本可读，并保留 native manifest/source-map 检查。
- [x] 1.3 按 design 第 3 节迁移静态 version response，在执行分支延迟生成 version data，更新 registry schema、formatter 及对应测试；验证 version 的完整 text/JSON、两个协议分别命名，help/describe 不采集 Git/hash，非法参数仍先报 usage，compiled version 不依赖 Backend/Git。

## 2. 协议复用与远端观测

- [x] 2.1 扩展认证后的 v4 Backend status，daemon 捕获自己的启动 provenance 并冻结；更新 service/controller/schema 测试，确认修改 worktree 后远端 provenance 不变，identity bootstrap、HMAC 和 runtime record 结构不变，私有字段不进入响应。
- [x] 2.2 删除 client 当前 CLI build 相等门槛、stop 豁免开关和相应 createClient 参数，迁移 direct client 调用；替换原 build-mismatch 用例为跨 build 成功，并验证 proof、record instance/build/protocol、credential、缓存接入和错误不重放的回归测试仍成立。
- [x] 2.3 Backend 协议升 4、CLI envelope 保持 2；生成含双方已知身份的 protocol-mismatch message，缺失远端版本明示 unknown；用旧 v3 握手/status fixture 验证先正确识别协议、不解码旧业务 status，并覆盖 query/model/index/start/status 的相同指导、resource 和 diagnostics 保留。
- [x] 2.4 CLI Backend status/start 组合本地和远端信息，更新独立 result schema 与纯 text renderer；验证不同 build 的比较、同 build、stopped 无虚构字段、只读不启停及完整 JSON，并核对重复本地采集未增加无意义的 source 扫描。

## 3. 显式开发交接

- [x] 3.1 按 design 第 4 节在 supervisor 既有 startup 锁内实现 requireCurrentBuild overload，v4 通过现有 stop 的 ifIdle 模式由 daemon 原子判断请求 admission、后台操作及有效 lease；测试在途请求与错误结束释放、有效/过期 lease、同构建幂等、跨 build/协议交接、unknown deferred、stop/launch 失败与并发 start，不重复判断 idle、不持 activity lock 等待进程，旧协议保持原保证。
- [x] 3.2 仅为 backend start 注册 `--current-build`，对 deferred 返回 state/reason 与 exit 1，对 ready 返回 0、错误返回 2；命令测试覆盖 schema、help/describe、同构建模型 failed 不隐藏、status 不接受该选项，以及未切换不伪造 ready。

## 4. 实际路径与交付

- [x] 4.1 用真实完整构建 A/B 和已配置模型，在正常本机路径对隔离 Store 执行相同 semantic query；记录兼容复用前后 daemon/native PID、instanceId、模型状态与结果，证明 B 的普通调用未重启 A，`--current-build` 后实际运行 B，同构建重复调用不重载模型。模拟 fixture 不能代替这条验收。
- [x] 4.2 用真实已拥有的旧协议实例验证诊断和 guarded 交接，重试完全相同的原 query；用有效 lease 验证显式切换 deferred 时旧任务仍可继续。沿用用户配置，若共享 Backend 有任务则保留它，安排安全的本次拥有测试生命周期，不以强停或只跑 mock 结束验收。
- [x] 4.3 运行 Backend/CLI focused tests、`bun test packages/backend packages/cli` 和相关 typecheck/lint，区分源级、编译、真实进程/模型结果；结构审查确认协议规则、启动归属、交接和 provenance 责任唯一，静态 version 数据与旧 build 豁免已删除，无新热路径扫描或重复响应验证。
- [x] 4.4 实施结果与 product/specs/design 对齐后，更新 `docs/cli/backend.md`、`docs/api/backend.md`、`docs/development/README.md` 及站点 `cli`、`reference/backend`、必要 query 页面的中英文内容；核对文档链接和实际命令，记录真实验收 commit/环境，评审通过后同步本 change delta specs，不修改安装器 change、release workflow 或发布资产。
