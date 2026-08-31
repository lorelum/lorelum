# ADR 0008: Repository Registry and user-scope Pack install

- **Date:** 2026-08-31
- **Status:** Accepted
- **Related:** ADR 0003, ADR 0004, ADR 0007

## Context

Lorelum 已能把有效 Pack 目录原子安装到 user-level LocalStore，但 CLI 还不能把 `lore install agentic-coding` 解析为可安装目录。公共 `lorelum/lorelum-packs` 也缺少 machine-readable Catalog。

本轮需要连接三个已有边界：Pack root 格式、安装名到 Git release 的索引，以及 LocalStore 的 seal/activate 语义。若同时加入 project scope、lockfile、依赖解析和通用 transport，会把首个安装纵切扩成包管理器。

同时，官方仓库不能成为唯一来源。团队或社区维护独立 Registry 仓库是合理扩展点；CLI 应允许用户显式选择这样的仓库，而不是只允许官方内容。

## Decision

### 1. Phase 1 只安装到 user scope

`lore install <pack>` 安装并激活到 `defaultStorageRoot()`（`~/.lorelum`）。本轮不接受 `--scope`，也不扫描项目 `.lorelum/packs/`。

项目自己维护的 Pack 源码仍建议放在 `<project>/.lorelum/packs/<name>/`。其 config/lock、trust 和与 user scope 的合并语义需要独立 ADR。

### 2. Registry 的选择单位是 GitHub 仓库

CLI 内置官方仓库标识 `lorelum/lorelum-packs`，不内置 Pack 内容。默认命令：

```sh
lore install agentic-coding
```

用户可以一次性显式选择另一个公开 GitHub Registry 仓库：

```sh
lore install backend-standards --registry acme/team-packs
```

`--registry` 接受 `owner/repository` 或规范的 `https://github.com/owner/repository(.git)`。CLI 从同一仓库的 `.lorelum/registry.yaml` 读取索引，并从同一仓库物化 release。Phase 1 不接受本地文件、`file:`、任意 HTTP descriptor、其他 Git host 或持久 `registry add`。

这保留了团队/社区扩展能力，同时避免“descriptor 指向任意 repository”的第二跳和每个 release 重复 source repository。

### 3. Registry v1 只索引仓库内的 release

```yaml
schema_version: 1
name: lorelum-official
packs:
  - name: agentic-coding
    description: Practices for evidence-aligned agentic coding workflows.
    releases:
      - version: 0.1.0
        ref: agentic-coding-v0.1.0
        path: packs/agentic-coding
```

`ref` 和 `path` 都相对于所选 Registry 仓库解释。`path` 是 Catalog 组织合同，不改变 Pack root 的 `pack.yaml + practices/**/*.md + decisions.yaml?` 格式。

Registry schema 是 strict 的：拒绝未知字段、不安全 ref/path、重复 Pack 名，以及 semver precedence 相同的重复 release。它不携带 engine 内部 canonical artifact digest；该 digest 属于安装后 Store artifact，而不是发布者必须预计算的分发格式。

### 4. 版本选择确定且保守

- 默认选择最高稳定 semver，不依赖 YAML 顺序。
- `--pack-version` 只接受 Registry 中存在的精确版本；prerelease 必须显式选择。
- 物化后再次校验 `pack.yaml.name/version` 与 Registry entry/release 完全一致。
- 已安装相同 canonical artifact 为幂等成功；同名但内容不同返回 `pack.upgrade-required`，不静默替换。

Phase 1 不解析 semver range、依赖或 update policy。

### 5. Git source 隔离物化，Pack 解析只保留一套

CLI 在临时目录中用参数数组执行 Git，不经过 shell。clone 使用 `--no-checkout`；随后检查 Git tree 的类型、路径、数量和字节预算，并用 `git cat-file` 只读取 `pack.yaml`、可选 `decisions.yaml` 和 `practices/**/*.md`。它不执行 checkout、content filter 或 Pack 脚本。

engine 暴露 `decodePackDirectory()`，复用 LocalStore snapshot decoder 和 `createPackCandidate()` 格式 gate。decoder 对目录项、深度、Practice 数量、单文件和总字节设置预算，并拒绝 symlink/非普通文件。

临时 source 在候选构建后 best-effort 清理。LocalStore 从 candidate 重建并 seal 自己的不可变 artifact，不复用下载目录。

### 6. 完成声明以 Store commit 和实际证据为准

Registry/source/Pack/Store errors 在 CLI 边界映射为 install 命令声明的稳定错误码；未声明异常收敛为 `runtime.unexpected`。消息不回显 Git stderr、临时绝对路径或用户 home。

成功结果包含：Registry 名与仓库、Pack 名与版本、resolved ref/commit、LocalStore 实际 `artifactDigest`、generation/effectiveRevision、delta、diagnostics、idempotent 和 Store cleanup 状态。它不声称 Registry 已签名，也不把安装后的 digest 冒充成下载前完整性证明。

## Consequences

### Positive

- 官方 Pack 可独立发布，CLI binary 保持无内容绑定。
- 团队和社区能用相同仓库结构提供 Pack，不需要修改 CLI。
- Registry release 不再重复 repository/type，也不绑定 engine snapshot 实现。
- Registry install、未来本地 source 与 Store recovery 共用一个 Pack decoder。
- user scope 复用已有 LocalStore 原子性、幂等和恢复语义。

### Negative / accepted risk

- Phase 1 只支持公开 GitHub Registry 仓库；私有仓库认证和其他 Git host 尚未定义。
- 系统必须有 Git；否则返回 `source.unavailable`。
- Registry 没有签名、checksum 或 transparency log。可移动 ref 是供应链风险；resolved commit 和安装后 digest 只提供可审计证据，不提供发布者真实性。
- user scope 对该用户的所有项目可见；项目级可复现依赖仍需 config/lock。

## Rejected alternatives

- **每个 release 内重复 `source.type/repository`：** 当前 Registry 已由仓库选定，多一层 repository 既冗余又扩大远端跳转面。
- **Registry 内声明 engine `artifact_digest`：** 会要求发布工具复刻 LocalStore seal/projection，并把内部 artifact 格式固化为发布合同。
- **任意本地/HTTP locator fallback：** 一个 flag 同时表示仓库、descriptor 文件和 URL，错误与信任语义不清；需要时应作为独立 source 合同设计。
- **CLI 内置 Pack：** 把 Pack 发布节奏绑定 CLI release，违背独立 Catalog 目标。

## Follow-ups

1. 为 project/local scope、`.lorelum/packs`、config/lock 和 trust gate 编写独立 ADR。
2. 设计私有 Registry 认证、其他 Git host、签名/checksum 和撤回机制。
3. 增加显式 `lore upgrade` / `uninstall`，保持 install 不静默升级。
4. 正式编写 `agentic-coding` 的 25–30 条 Practice，替换占位内容后再发布稳定 release。

## References

- ADR 0003 — Practice/Pack format and validation semantics.
- ADR 0004 — agent-first CLI JSON protocol.
- ADR 0007 — LocalStore lifecycle, idempotency, recovery and commit semantics.
- `docs/plans/lorelum-packs-repository-plan.md` — public Catalog vs project-authored source.
- `docs/plans/agentic-coding-pack-plan.md` — planned Practice content architecture.
