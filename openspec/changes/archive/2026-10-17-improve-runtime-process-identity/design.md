## Context

见 [proposal.md](./proposal.md)。当前 `createProcessBackendSupervisor` 在 compiled 模式重新启动当前 `process.execPath`，在 source 模式用 Bun 与 `main.ts` 启动 daemon；`supervisor.ts` 已使用 PID 和启动时间记录 child。embedding process 从 target manifest 的 `llama-server` 文件启动。release scripts、两套安装器及其 fixtures 均使用该 native 文件名。

## Goals / Non-Goals

**Goals:**

- 在支持 child display name 的宿主上让 Backend 显示为 `lore-backend`，并把当前 embedding 所使用的 native model runtime 命名为 `lore-model`。
- 为 Windows 主 `lore.exe` 提供现有品牌 icon 与产品元数据。
- 仅同步已经因 native 文件改名而受影响的 manifest、archive 和 installer 路径。

**Non-Goals:**

- 不新增 `lorelum-backend` companion executable、共享 build identity 或 release layout 角色 binary。
- 不为 native Windows executable 建立 CMake resource/patch 链，不承诺 macOS/Linux 桌面 icon，也不创建 `.app`、LaunchAgent 或 `.desktop`。
- 不改变 Backend 的认证、loopback、PID/启动时间/父子关系、stop/recovery，亦不按名称或图标管理进程。
- 不新增 CLI/HTTP/MCP 接口、用户配置项或发布 gate。

## Decisions

### D1: 用 argv0 改善 Backend 的可辨认性

Backend 仍由现有 CLI/Bun entrypoint 启动；只在 child spawn 处传递 `argv0: "lore-backend"`。本机 macOS/Bun probe 已证明该方式会改变 `ps` 的显示，但这不是 Windows image-name 的保证。若宿主不支持它，daemon 仍按现有行为运行，不通过新增 binary 补偿。

### D2: 在 native artifact 边界命名 model runtime

native build 继续构建 upstream `llama-server` target，再把输出复制为 `lore-model`/`.exe`，并更新 target manifest。source 和 release resolver 已以 manifest 为唯一 executable 来源，改名只需同步既有字段、archive 和 installer 检查，不需要新的 fallback 或 trust model。`lore-model` 表示该进程承载本地模型能力，不把当前 embedding 用途写成长期身份。

### D3: Windows icon 仅作用于主 CLI

使用已有 Lorelum 品牌图形生成/提交 `.ico` 输入，并把它、title 与 description 传入现有 Windows Bun compile 路径。native child icon 需要修改 pinned native CMake/patch/recipe，和“让进程名称可读”不是同一个必须交付的能力，故不在本 change 实现。

### D4: 复用已有 lifecycle safety

本 change 不触碰 runtime record、process identity 或 stop/recovery 代码。命名不参与授权，现有安全行为和其既有测试保持原样；只为实际改变的 spawn option 和文件名补 focused coverage。

## Risks / Trade-offs

- [部分宿主不显示 argv0] → 将其定义为 best effort；不改变 runtime 行为，也不新增第二个 binary。
- [native 文件改名遗漏既有 package 路径] → 更新 manifest、release archive 和 installer 的已有 assertions，并执行对应 focused tests。
- [Windows CLI icon 输入不兼容 Bun compile] → 以 release compiler 的 existing Windows path 做一次 focused compile 验证；失败时只阻塞 icon，不影响命名改动。

## Migration Plan

1. 在 Backend child spawn 中增加角色 argv0，并为 source/compiled command selection 补 focused test。
2. 将 native output、manifest、release archive 和 installer fixture 的 executable 名统一为 `lore-model`。
3. 为 Windows `lore.exe` 接入现有 Bun compile metadata/icon input，并运行对应 compiler test。
4. 执行受影响的 unit/release-installer tests 和一次可用宿主上的实际进程名观察；不需要模型下载、三平台 release 或新的 recovery 测试。

## Evidence Gates

- 合并前：受影响的 Backend spawn、native manifest、release compiler 与 installer tests 通过，且 `openspec validate --strict` 与 `git diff --check` 通过。
- 本地确认：在支持 argv0 的宿主观察 daemon 名称，并确认 `lore-model --version` 可运行；这不是跨平台发布验收声明。
- 后续阶段：只有用户明确要求 native Windows icon、Windows daemon image-name、macOS `.app` 或 Linux desktop integration 时，再为其单独设计实现与验证。
