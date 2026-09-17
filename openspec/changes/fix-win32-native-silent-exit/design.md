## Context

Issue #192 的根因已由本机对照实验证实（调查笔记：仓库外 `D:\Temp\lorelum-192-notes.md`，摘要如下）：

- 同一 `llama-server.exe`，唯一决定生死的变量是 stdin：stdin EOF/立即读失败时 10/10 秒退 exit 0 零输出；stdin 管道保持打开（含空管道）时正常运行，server 模式正常打日志。
- 根因代码是 `native/embedding/patches/0001-exit-on-parent-stdin-close.patch` 的 `start_parent_liveness_watcher()`：无条件启动 detached 线程读 stdin，`_read ≤ 0` 即 `std::_Exit(EXIT_SUCCESS)`，绕过全部清理。EOF 场景读取立即返回，与 main 线程的参数解析/日志初始化竞态几乎必败，故任何非 daemon 调用（`--version`、手工 server、PowerShell/cmd）全部静默死亡。
- 排除：SIMD 全关（issue 疑点解除，stdin 打开时正常初始化）、静态 MinGW CRT 读 Bun 管道（最小复现程序 `_read` 成功/正常阻塞）、Bun dev/编译型管道、detached+hidden 拉起、打包环节。
- 现状机制：`packages/backend/src/runtime/embedding-process.ts:68-76` 以 `stdio: ["pipe", ...]` 持有 stdin，stop() 主路径为 SIGTERM/SIGKILL，watcher 是 daemon 被硬杀时的安全网；`scripts/native/test-parent-liveness.ts` 以 startup/encoding/stalled-main 三 mode 验收该机制。
- 信任锚：`recipeIdentity = sha256({schemaVersion, source, patchSha256, cmakeFlags, model})`（`scripts/native/build-embedding.ts:282-289`）；source candidate 校验比对 `recipeIdentity`/`patchSha256` 等 identity 字段、不比对文件哈希（`packages/backend/src/runtime/native/embedding/manifest.ts:150-161`）；`build-embedding.ts` 启动即执行 `assertNativePatchDigest`，补丁文件与 `build-config.json` 摘要 MUST 一致。

## Goals / Non-Goals

**Goals:**

- 非 daemon 调用恢复标准 llama-server 行为：正常输出、正常退出码，不再基于 stdin 静默退出。
- daemon-owned runtime 的 owner-death 快速退出语义（绕过卡死清理）完整保留。
- 两层回归：native 层验收脚本断言"无 opt-in 不受 stdin EOF 影响"；backend bun:test 断言 spawn 携带 opt-in 且启动即退出被归类为稳定终态。
- 信任锚与配方保持一致：补丁摘要、三平台 manifest 的 identity 字段、win32-x64 文件哈希。

**Non-Goals:**

- 不改变模型准备、下载、重试策略、keyword fallback；不新增网络面、依赖或配置字段。
- 不改用父进程 PID 监视等新机制（Windows job object 方案留待后续）。
- 不在本变更中重建 darwin/linux 产物（无法在本机执行）；其文件哈希由各平台重建时按既有流程更新。
- 不修订 `semantic-index`/`retrieval-query`（失败面已由 `surface-semantic-operation-failures` 覆盖）。

## Decisions

- **D1 opt-in 门控而非改动退出行为**：候选方案有(a)环境变量门控、(b)改为监视父进程 PID、(c)退出时写 stderr、(d)删除 watcher。选 (a)：机制价值在于 daemon 被硬杀时绕过卡死清理，(b) 在 Windows 需要进程句柄生命周期管理，复杂度高；(c) 不解决误杀；(d) 丢失安全网。(a) 使默认行为回归标准服务器语义，daemon 显式声明需求，契约可被 spawn 侧测试直接观察。变量名沿用 server 进程既有 `LLAMA_` 命名空间（`LLAMA_API_KEY` 先例）：`LLAMA_PARENT_LIVENESS_STDIN=1`。
- **D2 daemon 侧传递点**：`embedding-process.ts` 的 spawn env 增加 `LLAMA_PARENT_LIVENESS_STDIN: "1"`（现有代码：`env: { ...platformEnvironment(), LLAMA_API_KEY: secret }`）。`supervisor.ts` 拉起的是 daemon 自身，无 watcher，不涉及。
- **D3 信任锚更新范围**：补丁变更使三平台 `recipeIdentity` 全部变化（`patchSha256` 参与计算）。win32-x64 在本机重建后完整更新（含文件哈希与 buildIdentity）；darwin/linux 仅更新 `patchSha256` 与 `recipeIdentity`（identity 字段由配方确定性推导，可本地计算），`files`/`buildIdentity` 保持各平台最近一次验证构建，待平台重建按 README 既有流程更新。此范围保证 darwin/linux source 开发者本地构建的 candidate 校验不被本变更破坏。
- **D4 回归分层与可证伪性**：native 层——`test-parent-liveness.ts` 新增无 opt-in 断言（修复前：进程死于 stdin EOF，断言失败；修复后：存活，通过）。可观察层——`embedding-process.test.ts` 按既有 stub 模式新增两条：spawn env 携带 opt-in（修复前失败/修复后通过）；启动即 exit 0 静默退出的子进程经有界重试返回 `embedding.failed` 终态（记录既有分类行为，防退化为 deadline 挂死）。
- **D5 终态分类记录既有行为**：`embedding-process.ts:124-129` 的有界重试 + `embedding.failed` 是现状，spec delta 将其作为显式契约记录，非新增行为。

## Risks / Trade-offs

- **环境变量命名碰撞**：`LLAMA_` 前缀理论上可能与 llama.cpp 未来原生变量冲突；取值仅 gate Lorelum 补丁行为，冲突后果有限，接受。
- **reporter daemon 侧残余风险**：本机四种组合（dev/编译型 × attached/detached）均无法复现其 daemon 失败；若其环境 daemon 管道确实 EOF，opt-in 后 watcher 在其 daemon 内仍会触发，该部分属独立后续调查；issue 主诉（直接调用静默死亡） definitively 修复。
- **darwin/linux 信任锚的中间态**：identity 字段与文件哈希短暂指向不同构建，与"平台重建时更新文件哈希"的既有流程一致；compiled release 的精确匹配门禁会在发布时拦截任何不一致。
- **一次性大下载**：本机首次 `build:native` 需下载 pinned CMake/WinLibs（已有 `.cache/native-build/tools` 缓存，实测可跳过）与模型文件；构建耗时由后台运行消化。
