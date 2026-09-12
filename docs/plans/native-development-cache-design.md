# Native 开发缓存与信任边界方案

状态：**Implemented，已本地验证，尚未提交。** 日期：2026-09-12。关联 #105、PR #108 与 native artifact 边界重构。

## 结论

不应该让每个 Git worktree 都重新编译一次 `llama-server`。当前一次完整 macOS arm64 C++ 构建约需一分钟，而候选 runtime 约 13 MB；后者复制到 worktree 的成本远小于重编译。

`build:native` 改为先查找按 native recipe、target 和工具链指纹分区的**用户级开发 cache**。cache 命中时，验证 cache entry 后复制到当前 worktree 的 `packages/backend/.artifacts/native/embedding/<target>/`；cache 未命中时，只允许一个进程构建并原子发布，其他 worktree 等待后复用。

同时区分源码开发和编译发行版的信任规则：源码运行可接受经过完整校验、且与当前 recipe 一致的本地 candidate；编译发行版仍必须要求磁盘 manifest 与编入 CLI 的 manifest 完全相等。`build:release` 不是日常开发命令。

不新增 workspace、YAML 配置项、远程 build cache、自动清理服务或多平台 native build。本阶段仍只构建 macOS arm64 CPU runtime。

## 现状与问题

当前 `scripts/native/build-embedding.ts` 只有 worktree 内的 `.cache/native-build/`。它会复用已下载的 llama.cpp archive 和 CMake archive，但每次执行都会删除 `source/` 与 `build-darwin-arm64/`，重新解压、打 patch、配置并编译。因此两个内容相同的 worktree 不会共享最终 binary。

当前 artifact 边界已经将运行时 candidate 放在 worktree 私有的 `.artifacts/native/embedding/<target>/`，并把 release 输出限制为 `dist/release/`。这个边界应保留：源码 backend 不应反向依赖某个全局 cache 路径，也不应直接把用户 cache 当作发行输入。

另一个已观察到的问题是：通用 `build:cli` 编入受追踪 manifest，却不会把刚编译的 candidate manifest 绑定进 binary。若本机工具链生成不同 native 字节，`./dist/lore` 会拒绝候选 runtime。这是发行构建与源码开发混用，不是模型或缓存问题。

## Cache 位置与归属

开发 cache 不属于 `~/.lorelum/`：后者保存用户配置、模型和运行状态；也不属于 repository `.cache/`，否则每个 worktree 仍然各有一份；更不写入 Git common directory，避免把构建状态混进 VCS 内部目录。

使用当前操作系统的用户 cache 目录，根路径固定为 `Lorelum/native/v1`：

| 平台    | cache 根目录                                                               |
| ------- | -------------------------------------------------------------------------- |
| macOS   | `~/Library/Caches/Lorelum/native/v1`                                       |
| Linux   | `$XDG_CACHE_HOME/lorelum/native/v1`；未设置时 `~/.cache/lorelum/native/v1` |
| Windows | `%LOCALAPPDATA%\\Lorelum\\Cache\\native\\v1`                               |

路径由 `scripts/native` 的纯函数解析，不读取 `config.yaml`，也不允许用户通过 Lorelum 配置重定向。Linux 的 `XDG_CACHE_HOME` 和 Windows 的 `LOCALAPPDATA` 是操作系统 cache 约定，不是 Lorelum 运行配置。

cache entry 结构如下：

```text
<cache-root>/
  darwin-arm64/
    <cache-key>/
      manifest.json
      llama-server
      LICENSE.*
      THIRD_PARTY_NOTICES.txt
```

`<cache-key>` 是 SHA-256，不包含绝对 worktree 路径或用户目录。其输入为：

- target；
- 当前 native recipe identity（llama.cpp archive、patch、CMake flags、固定模型身份）；
- CMake distribution version 与 archive SHA-256；
- 当前编译器第一行版本信息与 SDK version；
- cache schema version。

这意味着同一机器上、native 输入与工具链相同的不同 worktree 命中同一 entry；修改 patch、native build config、CMake 或 Xcode 后自动 cache miss。最终 manifest 和每个文件摘要仍是命中可用的必要条件，cache key 不是完整性证明。

本阶段不做 LRU 或自动删除。单个 macOS artifact 约 13 MB，按输入变化保存多个版本的成本可接受；用户可直接删除上述系统 cache 根目录，下次 `build:native` 会重建。

## 构建与物化流程

```text
当前 worktree 执行 build:native
  -> 计算 target 与 cache key
  -> 获取用户级 native cache lock
  -> 验证 cache entry
      -> 命中：复制到当前 worktree .artifacts
      -> 未命中：在 cache 临时目录构建、验证、原子发布，再复制
  -> 验证 worktree .artifacts candidate
```

cache entry 一旦验证成功即视为不可变。构建在同一 cache 根下的随机临时目录完成，只有 manifest、每个声明文件摘要和允许的动态依赖都验证通过后才能 rename 到 `<cache-key>`。已有有效 entry 永不原地覆盖；损坏 entry 在持锁后删除并重新构建。

worktree candidate 保持当前路径和普通文件形式，不创建目录 symlink，也不让 runtime 解析全局 cache。命中后直接复制 cache entry 到临时 `.artifacts` 目录、保留可执行权限、再次验证后原子替换目标目录。复制 13 MB 比编译快得多，也保持现有 `O_NOFOLLOW`、文件替换检测和 worktree 隔离语义。

构建日志必须明确输出以下之一：

```text
native: cache hit darwin-arm64 <short-key>; materializing candidate
native: cache miss darwin-arm64 <short-key>; building runtime
native: waiting for shared build darwin-arm64 <short-key>
```

本阶段只共享完成且验证过的 runtime。llama.cpp archive、CMake archive 和 CMake 中间目录继续留在调用 worktree 的 `.cache/native-build/`，仅在 cache miss 时使用；把下载和中间对象也迁入用户 cache 不会减少已解决的重复编译，反而增加失效和清理复杂度。

## 并发与失败恢复

当前所有 native cache 操作共用一个 SQLite writer lock。实现复用 Bun 内置 `bun:sqlite` 的 `BEGIN IMMEDIATE` 语义：持有者崩溃时操作系统释放锁，其他 worktree 不需要猜测 PID 是否复用。它同时串行化 cache entry 发布和同一 worktree 的 candidate 替换，避免命中复制与损坏 entry 重建竞争。当前只有一个 target，保留一把用户级锁比 per-key 锁更简单且足够；锁文件和 entry 都属于用户 cache，目录权限为仅当前用户可读写。

不直接复用 backend 的 `withStartupLock`：它拥有 daemon 的 `control.sqlite` 命名、运行状态错误语义和私有 runtime 目录约束。native build 复用同一种 SQLite 锁机制，但在 `scripts/native` 内以 native cache 的等待、输出和失败语义实现，避免让发行脚本依赖 backend daemon 生命周期。

等待者在有限时间内轮询锁；持有者成功发布后等待者重新验证 entry 并命中。持有者失败、被取消或 cache 目录无写权限时，不发布半成品，保留当前 worktree 已有 candidate，不静默回退到不受验证的文件。

## Source 与 release 的信任边界

native manifest 的结构、文件摘要和动态依赖校验应从 `scripts/release/native-manifest.ts` 移到 `packages/backend/src/runtime/native/embedding/manifest.ts`。这是 artifact 合同的唯一所有者；release scripts 和 source runtime 都调用它，不复制 JSON schema 或 macOS dependency allowlist。

| 场景 | 接受条件 |
| --- | --- |
| 源码 backend | candidate manifest 结构有效；target、固定模型、source、patch、CMake flags 和 `recipeIdentity` 与当前源码信任锚一致；声明文件、模式和动态依赖通过验证。允许 `buildIdentity`、文件摘要和工具链字段与受追踪 release manifest 不同。 |
| 编译 release CLI | candidate 先通过同一验证；compiler 将它的 manifest 编入 CLI；启动时要求包内 manifest 与编入值完全相等，并验证全部 native 文件和模型摘要。 |

源码模式允许本机 Xcode 更新后生成不同 binary；它不会接受来自其他 recipe、不同 target、错误模型、损坏文件或意外动态链接库的 candidate。若 native recipe 本身变化，`recipeIdentity` 变化，开发者仍需显式审查并更新受追踪 manifest；这保留 recipe 变更的代码审查边界。

`build:cli` 继续是无 native sidecar 的通用 CLI 编译命令，适用于不使用 embedding 的开发和 benchmark。需要本地运行一个 compiled embedding candidate 时使用 `build:release-staging`；需要可安装的最终 archive 时才使用 `build:release`。开发态 embedding 继续使用 source CLI 加 `build:native`，不要求先做 release build。

## 代码组织

只增加与真实责任对应的文件：

```text
scripts/native/
  cache-paths.ts       # 系统 cache 路径与 cache key
  cache-store.ts       # lock、验证命中、原子 publish、复制到 worktree
  build-embedding.ts   # native recipe 编排；cache miss 时才调用编译

packages/backend/src/runtime/native/embedding/
  catalog.ts           # target、受追踪 manifest、release compile target
  manifest.ts          # manifest 解析、完整性和动态依赖校验
```

`cache-store.ts` 不启动 daemon、不读取模型配置、不知道 HTTP 或 CLI；`manifest.ts` 不计算 cache key、不创建目录、不启动编译器。这样每个文件都有单一职责，不新增 workspace 或通用 provider 层。

## 实施顺序与验收

1. 抽取共享 manifest 合同，并将 source/release 的 manifest 比较规则分开。
2. 添加 cache path/key、SQLite lock 和 verified cache entry publish；保留当前本地 `.artifacts` 物化路径。
3. 保留 worktree 内 native download/build 临时目录，只把完成 runtime 放入用户 cache；更新 `build:native` 输出和开发文档。
4. 更新 release builder，使它只消费当前 worktree candidate；不改变 archive 布局。

验收：

- 相同 native 输入的第二个 worktree 执行 `build:native` 不启动 CMake 编译，只验证 cache 并物化 candidate。
- 两个 worktree 并发执行同一 key 时只发生一次 native 编译，等待者获得同一 build identity。
- 修改 patch、CMake 配置或 compiler/SDK 指纹后发生 cache miss；损坏 cache entry 不能被使用。
- 源码 backend 可加载不同本机 build identity、但相同 recipe identity 的 candidate；不匹配 recipe/target/model 或动态依赖时明确拒绝。
- release CLI 仍严格拒绝被替换的 native/manifest；archive 解压并经符号链接启动后完成现有 model lifecycle smoke。
- 单元测试、native 生命周期测试、真实 embedding/daemon integration、typecheck、lint 和 format check 通过。
