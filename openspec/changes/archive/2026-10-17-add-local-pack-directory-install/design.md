## Context

See [proposal.md](./proposal.md) for the user problem. 当前 `pack.install` 与 `pack.update` 都要求一个 `pack[@version]` positional，并把它解析为 Registry release；成功 result 固定含 `registry` 与 Git `source.ref/commit`。这条 route 位于 `packages/cli/src/install/install-command.ts`，并通过 `loadRegistry()`、`resolveRegistryRelease()`、`materializeRegistryRelease()` 才调用 `decodePackDirectory()`。

Engine 已公开 `decodePackDirectory()`，它是 `decodeSnapshot()` 的公共别名。decoder 对 `pack.yaml`、可选 `decisions.yaml`、Practices、resources、symlink、目录深度、文件数、单文件/总字节施加统一格式 gate，再产生 LocalStore 能安装的 candidate；证据在 `packages/engine/src/local-store/storage/artifacts/snapshot-codec.ts`。LocalStore 已拥有 canonical artifact 的 install/upgrade、幂等、`UpgradeRequiredError`、事务和 recovery 语义，CLI 只负责 source route、协议组装与 typed error 映射。

现行 `semantic-index` contract 只要求 `lore pack install` 在 canonical commit 后报告 `indexSync`；当前 implementation/test 也显示 `pack.update` 不提交 index build。此 change 不应借本地 directory route 无关地改变 update 的后台生命周期。

## Goals / Non-Goals

**Goals:**

- 在 CLI 内增加一个无需 Git/Registry 的 source route，同时把 Pack decoding 和 Store mutation 继续交给当前 owners。
- 对“目录不可用”和“目录可读但不是有效 Pack”给出稳定、无路径泄露且可恢复的不同结果。
- 使新 route 的 JSON schema 明确表达 directory provenance，不伪造 Git/Registry 元数据，并保持现有 Store/index contracts。

**Non-Goals:**

- 不改变 Engine decoder 的 Pack format、目录预算或 LocalStore schema，也不把 source path 写入 manifest/projection。
- 不新增 directory discovery、watch、热更新、递归 Pack search、project-local implicit source、Git check 或 Registry fallback。
- 不令 `pack update` 因 source 类型不同开始同步 semantic index；若需要 Pack mutation 统一 post-commit index lifecycle，应以独立 change 修改 `semantic-index`。

## Decisions

### 1. Command grammar 在解析层允许两种形态，handler 强制恰好一种 source selector

`pack.install` 与 `pack.update` 的 command definition 将 positional `pack[@version]` 改为非必填，同时新增必填值 option `--path <directory>`。`--path` 的 value 仍须在 handler 中验证为 non-empty string；空字符串在 resolve 前就是 invalid invocation，不能借 `path.resolve` 退化成 cwd。这只让 parser 表示以下两种有效调用：

```text
lore pack install <pack[@version]> [--registry <selector>]
lore pack install --path <directory>

lore pack update <pack[@version]> [--registry <selector>]
lore pack update --path <directory>
```

handler 在任何 I/O 前检查：有 `--path` 时 positionals 必须为空且 `--registry` 不得出现；没有 `--path` 时恰好一个 Pack specifier 必须存在。非法组合统一使用已有 invalid invocation envelope。这比注册两组几乎相同的 commands 更能保留现有 `pack.install` / `pack.update` discoverability，也避免让 `--registry` 在 local route 看似有效。

### 2. Directory preflight 只决定 source 可用性，Pack decoder 保持唯一格式 gate

local route 先从调用时 cwd 解析非空 `--path`，在不把该值写入 public error 的前提下 realpath 到一个可读 directory root，并以 `opendir` 成功作为 root 可枚举的 availability probe。root 缺失、不可访问、canonicalization 失败或不是 directory 统一映射 `source.unavailable`，并且停止在 Store/Git/Registry 之前。

preflight 成功后，把 canonical root 直接交给 `decodePackDirectory()`；不复制 YAML、frontmatter、symlink、resource 或 byte-budget 检查。decoder/format validation 的失败统一映射 `pack.invalid`，因此“目录存在但缺少 `pack.yaml`”不会被错误描述为 Registry/network 故障。CLI 仅将这些 typed failures 变成稳定、脱敏 message，不能公开 `SnapshotFormatError` 中的 root path 或底层 filesystem message。

选择 realpath 而不是保存原始相对 path，是为了在本次调用内稳定 root 并支持用户常见的 symlinked worktree entry；它不形成 source identity，也不会超出 process lifetime。直接 source 是用户明确给出的本机输入，因而没有 Registry remote resolver 那样的 network/credential threat surface；但 decoder 的内部 symlink/regular-file budget 仍必须完整执行。

### 3. 在 CLI 组合层增加 directory mutation，而非向 Engine 引入 source 类型

install route 的编排为：

```text
validate invocation
  -> resolve readable directory root
  -> decodePackDirectory(root)
  -> LocalStore.install(selectedStore, candidate, diagnostics)
  -> existing install indexSync
  -> directory-result envelope
```

update 将 `install` 和 indexSync 替换为既有 `LocalStore.upgrade` 与 update result。两条 directory route 都复用已存在的 `throwVisibleRegistryMutationError` 中 Store/Pack error mapping，但将其更名或收敛为 source-neutral mutation mapping；其 **source acquisition** 不得调用 `loadRegistry`、release resolver、Git materializer、fetch 或 Registry/network source client。local install canonical commit 之后仍会调用已有 index runtime，后者的 Backend/模型准备与网络行为完全遵循现有 `semantic-index` contract，而不是本 source route 的新承诺。

Engine 不需要了解 `source.type: "directory"`：它只接收 validated Pack candidate 并将 canonical immutable artifact 保存到选中的 Store。这样 registry release 和 directory 两个来源共享最重要的 data-integrity/recovery contract，却不会把 CLI transport/protocol concerns 倒灌到 Engine。

### 4. 成功结果使用 source-route union，directory branch 不伪造 Registry/Git 字段

当前 remote install/update schema 将 `registry` 和 `{ type: "git", ref, commit }` 设为 required。实施时改为 source-route union：existing Registry-backed branch 保持其当前 remote fields；directory branch 包含 `pack`、Store mutation data、`idempotent`、`artifactDigest`、既有 Store `packRoot` 与 `source: { type: "directory" }`，没有 `registry`、`ref`、`commit` 或 source directory path。directory install branch 另外沿用既有 `indexSync`；directory update branch 与当前 remote update 一样没有它。

这个结果不试图让 LocalStore 记住原始目录，也不将一个安装时 source 误报为 Pack 的长期 provenance。后续查询、list、Installed Pack Catalog 仍读取 canonical artifact/Pack identity；要重新安装或更新本地目录，用户需要再次明确传 `--path`。

### 5. 验证围绕“不越过 route 边界”与 Store 不变性

CLI unit tests 使用 services spies 验证 valid directory 不调用 `loadRegistry` 或 materializer；混合参数在 decoder/remote reader 之前失败。以临时 Pack root 驱动已有 decoder，验证 install idempotency、changed local install 的 update-required、local update 的 replacement、isolated Store、缺失 root 的 unavailable、invalid root 的 pack-invalid，以及错误/成功 JSON 不包含输入或 canonicalized source directory path；既有 `packRoot` 按当前 Store locator contract 保留。

结果 schema、command describe 与 process JSON-envelope tests 验证新的 optional positional 和 union result：旧 Registry invocation 的 wire result 保持不变，而显式 `--path` consumer 必须按 `source.type` 分支。Engine decoder 本身已有 format/budget tests；本 change 只为 CLI mapping 和 route selection 增加覆盖，不复制 Engine fixtures。

## Risks / Trade-offs

- [optional positional 让无参数 invocation 到 handler] → handler 在第一步统一验证“恰好一种 source selector”，并在测试中固定无 selector、双 selector、path + registry 的无 I/O 失败。
- [source preflight 与 directory contents 之间存在本机 TOCTOU] → 该 source 是用户显式给出的本地输入；decoder 与 LocalStore 都在后续重新读取/validate，任何变化只会导致 source/Pack failure，绝不产生未验证 artifact。
- [为了隐藏路径而损失诊断] → public envelope 提供 source unavailable vs Pack invalid 和一个可执行 next step；详细路径仍只留在调用方已知的 `--path`，不会写 stdout、manifest 或 docs 示例数据。
- [directory result union 让 consumer 误假设 registry 永远存在] → `lore describe` 的 JSON schema 明确两 branch；现有 Registry branch 保持字段/含义不变，并用 protocol regression tests 覆盖。
- [direct directory install 被误当成持续同步] → result 标识 transient source，docs 明确修改目录不会自动更新 Store，且本 change 不增加 watch 或保存 path。

## Migration Plan

1. 不迁移 LocalStore、Registry catalog、project config 或 Engine schema；新 route 只在用户明确传 `--path` 时可达。
2. 先完成 handler source-selector validation 与 result union，再接入 directory preflight/decode/Store mutation，确保错误不会进入 remote Registry route。
3. 在同一发布中完成 protocol tests、site 双语指南和 `docs/cli` ownership documentation；旧调用及 Registry result branch 保持兼容。
4. 若需回滚，移除 CLI directory route 即可；已安装 Pack 保持现有 canonical artifacts，且没有需要清理的路径 provenance 或 catalog state。
