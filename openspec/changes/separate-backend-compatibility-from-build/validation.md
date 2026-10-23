# Issue #262 验证记录

## 环境与产物

2026-10-23，macOS arm64，Bun 1.4.2；基于 `cc99a05f745c57de89495ebddc9d49ea8cad1292` 的本 change 未提交工作树。使用用户既有配置与已缓存的固定模型；Store、派生 cache 和完整 A/B 构建副本位于独立临时目录，没有改变默认 CLI 链接、用户配置或共享 Pack 数据。

两次 `bun run build:cli` 均包含匹配的 adjacent native runtime，不是 cli-only 产物：

- A：`ba129f55e905891c67e01fa6008caa1c81a8d4c5993ba9e01bece00e80225b70`
- B：`fe978914bd718cf83434953eb379f80d72cd39fa8212e8f399d227c6ddb26118`
- native build：`006f4227e8baf68c04bd83d4195fe252906f0731dfe52f5a96d0692aa4c5890c`

## 真实 CLI、Backend 与模型路径

1. 对原已安装协议 3 实例运行相同 semantic query、model status/load、index status/build/rebuild/operation、默认 backend start/status，共 9 个入口。均返回 `backend.protocol-mismatch`，完整 message 保留双方 build ID、协议 3/4、远端 unknown 和停止后启动、再重试原命令的指导；没有先调用旧 status 再报解码失败。
2. 对旧实例获取有效 lease，guarded stop 返回 active-long-task deferred，原 instance 保持。释放后 guarded stop 返回 stopped，再用 A 的 current-build start 启动。旧路径保留协议 3 原有保护，不宣称具有协议 4 的请求 admission 保证。
3. A 执行 model load，再在隔离 Store/cache 建索引；观察实际 operation 直到 ready。A/B 用完全相同的“如何分配校验职责”semantic query，均返回相同 5 条结果。B 的普通 query、status 和默认 start 保持 A 的 instance、daemon PID `5924`、native PID `5953` 不变；status 显示 sameBuild false、protocolCompatible true 及各自身份。
4. A 持有效 lease 时，B 的 current-build start 返回 deferred、exit 1；A 仍能执行原 semantic query，instance/两个 PID 不变。释放 lease 后，B 显式切换成功，daemon PID `8053`、native PID `8058`；相同原 query 结果保持一致。
5. 再次执行 B current-build start，instance、daemon/native PID 均保持不变。验收结束用 guarded stop 停止本次实例，再恢复原已安装构建，model load 返回 ready；没有把临时二进制留作默认服务或安装入口。

上述记录是行为验证，不代表性能 benchmark。没有声称跨进程切换可以保留模型内存。

## 自动化与结构验证

- Backend/CLI 包测试覆盖认证、精确 record 归属、缓存接入、不同 build 复用、同 build 幂等、有效/过期 lease、旧协议停止、启动失败、并发 start、在途 query/index status、请求成功/异常释放，以及永久 stop 不被 deferred 重开。
- 编译测试覆盖两个 compiler path、相同 executable 复制后身份不变、重建身份不同、离开 checkout 且无 Git 仍显示 provenance、native manifest 与 source-map。
- 独立 Sol high 跨模块 CR 找到并修正两个问题：异步 index status 被后缀豁免漏计请求；新 CLI lease 写入误清旧协议过期 lease。两项均有行为回归，窄复核通过。
- 按 `agentic-coding.implementation.justify-added-checks` 完成独立 Sol 审查：保留认证、输入解码、既有 instance/build 响应关联、进程/child 归属及 admission/activity 竞态保护；删除 status 协议号二次比较、新 controller 的旧协议能力拒绝分支、仅供测试的 knownIdentity 注入口和正式 compiler 不会触发的 provenance fallback。未使用的 BuildInfo schema 改为纯类型，重复测试与文档样板一并压缩。不增加 owner PID 扫描、额外 hash、重复业务 schema、timer、后台重试或兼容性 epoch。

## 检查结果

- 减法审查并同步 `main` 基线 `5cd2bd3` 后，`bun test packages/backend packages/cli scripts/release/compile-cli.test.ts`：924 pass、6 skip、0 fail，108 个测试文件。包含真实编译/复制及无 Git 运行测试，不以伪造 compiled entrypoint 代替正式编译。
- Backend/CLI typecheck 通过；变更代码的 oxfmt check 通过；`bun run lint` exit 0，保留 21 条既有 no-await-in-loop warning，没有为消除旧 warning 改动无关路径。
- 本 change 严格校验通过；同步后的 24 个主规格校验全部通过。
- Windows 专用进程与宿主用例在 macOS 上跳过，不把当前平台编译路径测试当作 Windows 实机验收。
- 真实 A/B native 路径记录先于上述减法审查；删减后重跑整包与正式编译测试，并由 Sol 窄复核确认未弱化身份和停止边界，没有宣称再次执行完整 native 演练。
- 同步上游后，迁移新增 preparation-debug integration 的 client 调用；`bun run build:native` 命中既有 native candidate，随后真实执行 `bun packages/cli/integration/backend-preparation-debug.integration.ts` 通过，覆盖 daemon、认证 HTTP、query/index 准备失败、日志与 feedback draft，且没有改变持久 logging 配置。

## AGENTS 与开发指南真实复跑

2026-10-23，以 `5a232ae` 的代码、既有用户配置和模型缓存，在正常本机环境执行；不是 mock，也不是只检查命令语法。

- 直接提取开发指南的 source 示例执行：native 构建 cache hit，`backend start --current-build` 成功切到 source，双方 ID 为 `d9b89defb9cb…`，在 worktree-local Store 安装 agentic-coding 成功。
- 该示例没有一次全绿：新隔离 cache 的首次 `responsibility boundary` query 返回 `embedding.busy` / exit 2。原 trace 显示该 query 启动了 35 条文档的后台索引，查询编码与索引编码竞争；观察该操作完成后，用完全相同的 query、Store、cache 和默认 semantic 模式重试，exit 0、multi-view-vector 返回 5 条。没有切 keyword、清缓存或重载模型来掩盖该失败；开发指南补充了这条条件恢复路径，没有扩修独立的调度问题。
- 同 source build 再次执行 current-build start，daemon/native PID 保持 `61861`/`61911`，model ready。
- 给一个不继承本对话历史的 Agent 验收目标、仓库路径和共享 Backend/lease 边界，由它自行读取模块 AGENTS 和开发指南、选择实际命令，而非提供预写执行脚本。它执行完整 `bun run build:cli`；首次 compiled current-build start 在有效 lease 下返回 exit 1 / active-long-task，它按任务边界及指南停止后续 model/query，没有停止实例、解除 lease 或后台重试；主线程确认 source 的两个 PID 均未改变。
- 主线程释放本次 lease 后，该 Agent 重试切换，exit 0，双方 compiled build 为 `7fd59ff2f181824983700e61b7accfe8bcb0e04c4bab1c12c7c38840ff34afb8`，revision `5a232ae`、dirty false。真实 model load 为 ready；相同 query 使用相同 worktree-local Store/cache，默认 semantic 返回 5 条、exit 0。主线程通过私有 runtime record 的安全字段另行确认 daemon/native PID 为 `65233`/`65250`。
- source 和 compiled 的成功查询均保留默认 ProjectContext 行为，并带有 `context.state: degraded` 及 config.invalid/pack.invalid 告警；结果不是空检索，没有用 no-project 隐去告警，也未扩展修复项目层问题。
- 收尾 guarded stop 返回 stopped；恢复原安装 build `1bce86050e6a…`，model load/status 为 ready。全局 CLI 链接未改变，本次测试没有写入共享 Pack Store。后续补充仅涉及开发说明和本验证记录，不改变已验收的生产代码或命令序列。
