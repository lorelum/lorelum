# Native runtime 开发产物边界重构方案

状态：**已实施，本地变更，尚未提交。** 日期：2026-09-12。关联 #105 与 PR #108。

## 结论

当前不新增 workspace，也不新增 provider、配置项或自动构建机制。这里的“当前”不等于把 `darwin-arm64` 写死为永久结构：多平台 CPU artifact 是已确认的后续方向，目录和 release 编排必须从一份 target catalog 取值。

开发 native artifact 改放到 `packages/backend/.artifacts/native/embedding/<target>/`；`dist/` 只保留 release builder 的临时输出。backend 增加一个小型内部模块，维护受支持的 embedding artifact catalog，并根据其中的 artifact 计算开发、已安装和可信 manifest 的位置。native 构建脚本与 release builder 复用它，不再各自硬编码目录。

catalog 当前只有 `darwin-arm64` CPU 一项，但它是后续 macOS x64、Windows x64/arm64、Linux x64/arm64 CPU 支持的扩展点。它不包含 GPU 选择策略、交叉编译或远程下载机制。

这满足当前问题：backend 不再跨目录依赖仓库根 `dist`，同时只增加一个有真实运行时、native build 和 release build 调用方的具体模块。

## 实施前的现状与问题

当前只有执行源码版 `lore model load` 时需要 native artifact；Bun 直接运行 TypeScript，普通源码 CLI 不依赖 `dist`。但 `build-embedding.ts` 把 `llama-server`、candidate manifest 和许可证写进 `dist/native/<target>`，backend 源码又从深层目录回到仓库根读取它，release builder 也从同一目录复制产物。

```text
native build          -> dist/native/darwin-arm64
源码 backend model load -> 回到仓库根 dist/native/darwin-arm64
release builder       -> 重建并读取 dist/native/darwin-arm64
release package       -> dist/release/.../native/darwin-arm64
```

`dist` 因而同时充当开发构建缓存和发行输出。它可被清理或被 release 重建覆盖，却会改变源码 backend 实际启动的 native binary；这不是可靠的 package 边界。

已安装 CLI 通过 `realpath(process.execPath)` 定位实际 release 根目录是另一回事：`~/.local/bin/lore` 是符号链接，解析真实二进制路径后再寻找相邻 `native/<target>` 是正确且必须保留的发行规则。

## 建议的最小结构

```text
packages/backend/
  .artifacts/                        # gitignore，backend 私有开发产物根
    native/
      embedding/
        darwin-arm64/
          llama-server
          manifest.json
          LICENSE.*
          THIRD_PARTY_NOTICES.txt
  src/
    runtime/
      native/
        embedding/
          catalog.ts                  # embedding native artifact catalog 与路径
          darwin-arm64.json           # 受追踪的源码可信 manifest
```

`native/embedding/` 继续拥有 llama.cpp revision、patch、构建说明和 native 生命周期测试。它是 recipe 源码；不需要搬迁或抽成 package。

`packages/backend/.artifacts/` 是 backend 私有的本机开发产物根，不进入 git，也不进入最终 release 包。当前 native embedding 只是其中一个子树；未来属于 backend 的其他构建产物可按类型和能力继续放入其中，无需新增 `xxx-artifacts` 目录。候选 native 文件的摘要仍是本次 native build identity 的输入；受追踪的 manifest 才是源码构建时的信任锚。`dist/release` 仍由 `build:release` 每次重新生成。

## 内部模块合同

新增 `packages/backend/src/runtime/native/embedding/catalog.ts`。它是 workspace 内部的 build/runtime 交接，不是用户 config。`runtime/native/embedding` 与现有的 native 文件校验、进程启动和 llama 参数属于同一条运行时责任；`catalog.ts` 只声明该 runtime 支持哪些 artifact 及其位置，不冒充整个 native runtime 的所有者。catalog 每项绑定一个 artifact ID、运行平台/架构和受追踪 manifest；当前只有 `darwin-arm64` 这一项。对外只提供当前调用方实际需要的查找和目录函数：

```ts
export function resolveEmbeddingNativeArtifact(
  platform: NodeJS.Platform,
  arch: string,
): EmbeddingNativeArtifact | undefined;

export function developmentEmbeddingArtifactDirectory(artifact: EmbeddingNativeArtifact): string;

export function installedEmbeddingArtifactDirectory(
  releaseRoot: string,
  artifact: EmbeddingNativeArtifact,
): string;

export function trustedEmbeddingManifestPath(artifact: EmbeddingNativeArtifact): string;
```

这个模块位于 `packages/backend/src/runtime/native/embedding/`，只需在 package 内定位 `.artifacts/native/embedding`。backend runtime 先按 `process.platform` 和 `process.arch` 取得 artifact，再使用它提供的 expected manifest 与目录，不知道仓库根路径、`dist` 或 artifact 目录命名。找不到匹配 artifact 时仍返回现有 `embedding.resource-invalid`；运行时继续比较磁盘 manifest、native 文件和模型摘要。

`scripts/native` 与 `scripts/release` 是仓库级构建编排，直接引用 `catalog.ts` 复用同一规则；不为它们新增 workspace package export 或 resolver 配置。CLI compiler 用 `trustedEmbeddingManifestPath(artifact)` 覆盖同一项的静态 JSON import，确保每个 target 的 CLI 只信任随其 archive 打包的 manifest。catalog 没有用户命令、HTTP API 或 config 入口，也不导出 native executable 的可配置路径。

运行时信任校验仍属于 `embedding-resources.ts`：它比较编入的 manifest、磁盘 manifest、native 文件和模型摘要。`runtime/native/embedding/catalog.ts` 只提供受追踪 artifact 的身份与位置，不启动进程、不校验模型、不接受外部路径。

## 调用方式

```text
bun run build:native
  -> resolveEmbeddingNativeArtifact(当前构建机)
  -> native recipe 构建到 packages/backend/.artifacts/native/embedding/<artifact.id>

源码 lore model load
  -> resolveEmbeddingNativeArtifact(当前进程)
  -> developmentEmbeddingArtifactDirectory(artifact)
  -> 现有 manifest、文件、模型校验
  -> llama-server

bun run build:release
  -> resolveEmbeddingNativeArtifact(当前发布 target)
  -> build:native
  -> 读取并验证 developmentEmbeddingArtifactDirectory(artifact)
  -> 用 candidate manifest 覆盖 trustedEmbeddingManifestPath(artifact)
  -> 复制到 dist/release/<artifact.id>/native/<artifact.id>

已安装 lore model load
  -> realpath(process.execPath)
  -> resolveEmbeddingNativeArtifact(当前进程)
  -> installedEmbeddingArtifactDirectory(releaseRoot, artifact)
  -> 同一套运行时校验
```

开发者仍须先执行 `bun run build:native`。缺少 artifact 时不隐式下载 CMake、下载源码或编译 C++；这既保持 CLI 行为可预测，也避免把构建工具变成用户运行时依赖。

## 多平台的扩展边界

增加一个 CPU 平台时，只需要新增 catalog 项、其受追踪 manifest、对应 native build/CI runner 和目标 archive；runtime 的资源查找、完整性校验和安装包布局不需要复制分支。发布构建在当前阶段仍只构建“执行它的 runner 所支持的 target”；真正增加 Windows 或 Linux 时，再为该 target 增加可复现的 native recipe 与 CI job，不能假定 macOS 可以可靠交叉编译它们。

GPU runtime 不是单纯的“又一个平台”：同一个 `darwin-arm64` 可能同时存在 CPU、Metal 或其他后端，涉及硬件探测、依赖分发、fallback 和质量/性能基准。它需要单独的选择策略设计，不能现在用一个空 `provider` 或 config 开关占位。届时 catalog 可扩展 artifact ID，但在有真实 backend 和验收数据前，不让同平台出现多个默认 artifact。

## 为什么当前不拆 workspace

workspace 适合拥有独立源码 API、测试和版本/发布生命周期的模块。当前 native runtime 的真实所有者仍是 `@lorelum/backend`：它决定如何校验 native 文件、如何启动和监督 `llama-server`，并且只有 backend 会消费 artifact。`native/embedding/` 是其构建 recipe，不是供多个 TypeScript 包直接调用的库。

把它现在拆为 `@lorelum/native-runtime`，会增加 package manifest、workspace dependency、export surface、独立 typecheck/test 入口和跨包组装，但不会自动解决任何多平台难点：每个平台仍要有自己的 native recipe、可信 manifest、CI runner、编译 CLI 和 archive。target catalog 已经隔离了现在唯一会随平台变化的部分，成本远小于新 workspace。

出现以下任一事实时，再把 catalog 与 recipe 升为 workspace：

- 另一个生产 package 需要直接启动或校验 native runtime；
- native artifact 需要独立于 CLI 版本发布、下载或更新；
- 不同 native 产品（例如 embedding 与 reranker）开始共享同一套 target、manifest 和 build 生命周期。

## 不做的事情

- 不用环境变量或 `config.yaml` 选择 native 路径：native 来源必须由构建和安装包固定，不能成为用户运行时输入。
- 不让 `model load` 自动构建：它会引入网络、CMake、编译器和长耗时失败面。
- 不实现 GPU backend、交叉编译、第二个 CPU 平台或多 artifact 选择；这些分别需要真实 target 的构建与验收，而不是声明一个空接口。
- 不保留旧 `dist/native` 开发产物读取兼容：当前未发布，旧目录只是本机临时输出。

## 实施与验证

本次实施已完成以下验证：`bun run build:native`、三种 native 父进程退出场景、`bun run build:release`、真实模型 HTTP/daemon integration、通过符号链接启动 release staging 的 `--version` 与 `backend status`、全量 typecheck/lint/单元测试。完整 archive 的 model load 生命周期仍沿用 release foundation 的独立验收场景；本次没有通过用户默认配置下载或加载模型。

1. 添加 `runtime/native/embedding/catalog.ts`、`.artifacts` 忽略规则和根脚本 `build:native`。它含一个当前仅有一项的 catalog，以及按 artifact 查找目录和 manifest 的函数；仓库级 build scripts 直接复用该源码模块。
2. 修改 native build、原生生命周期测试和文档，使其从 catalog 取得当前 host artifact 并读写 backend 的开发 artifact 目录。
3. 修改 backend 源码分支和 release builder/compiler，让每次 release staging 贯穿同一个 artifact；删除所有 `dist/native` 开发读取；release 包内 `native/<artifact.id>` 布局不变。
4. 更新开发与发行文档，并删除旧目录说明。

验收标准：

- backend 源码中没有仓库根 `dist` 路径推导，也不依赖当前工作目录。
- `bun run build:native` 后，源码 `model load` 能使用与当前 host 匹配的 `.artifacts/native/embedding/<artifact.id>`；缺少产物不自动构建。
- `bun run build:release` 仍把本次 verified manifest 编入 CLI；替换包内 native 或 manifest 后 `model load` 失败。
- archive 解压后经符号链接调用 CLI，完成 `backend start -> model load -> ready -> unload -> stop`。
- catalog 当前只允许 `darwin-arm64`；新增不受支持平台的测试在没有相应 artifact 时明确失败，不会误读另一 target 的 native 文件。
- 全量 typecheck、lint、测试和现有 native 生命周期测试通过。
