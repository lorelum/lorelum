## 1. Command surface 与 directory source route

- [x] 1.1 将 `pack.install`/`pack.update` 的 positional 与 `--path <directory>` option 调整为可表达两种 source selector；用 command parser tests 验证无 selector、empty path、双 selector、path + Pack specifier、path + registry 都在任何 I/O 前返回 `usage.invalid`，且空 path 不会解析为 cwd。
- [x] 1.2 实现 local directory preflight：按调用 cwd 解析、canonicalize、以 `opendir` 验证 root 可读且为 directory；用 CLI unit tests 验证缺失、不可读、非目录和 canonicalization failure 映射 `source.unavailable`，且 stdout/error 不含输入或 canonical source path。
- [x] 1.3 实现 source-neutral mutation composition：local route 的 source acquisition 只调用 `decodePackDirectory()`、selected LocalStore `install`/`upgrade` 与既有 error mapper；用 spies 验证它不调用 Registry selector、descriptor/release loader、Git materializer、fetch 或 Registry/network source client，同时验证 local install 在 canonical commit 后仍调用既有 index runtime。

## 2. Store/index 与 JSON protocol

- [x] 2.1 为 local install 接入现有 canonical commit 后的 `indexSync`，并为 local update 保持当前无 indexSync 的结果/lifecycle；用 install/update command tests 验证 index failure 不回滚 install，且 update 不意外启动 index client。
- [x] 2.2 将 install/update result schemas 改为 Registry 和 directory source branches；用 schema/describe tests 验证 directory branch 含 `source.type: "directory"`、Pack/Store fields、既有 `packRoot` 与正确的 indexSync，而没有 registry/ref/commit/source path，现有 remote branch 保持兼容。
- [x] 2.3 覆盖 local idempotent install、changed artifact 的 `pack.update-required`、explicit local update、`pack.not-installed`、Store busy/recovery 与 `--store-root`；验证失败不会改动既有 artifactDigest、generation、Registry catalog 或 project config。

## 3. 用户与维护者文档

- [x] 3.1 更新 `apps/site/content/docs/` 的英文和中文 Pack 指南/reference，说明 `pack install|update --path`、relative path 基于调用 cwd、一次性/不自动同步、directory vs local Git Registry 的取舍、source unavailable/pack invalid 恢复，并验证链接与命令一致。
- [x] 3.2 更新受影响的 `docs/cli` maintainer material，只说明 command protocol/result union 与 Engine decoder ownership，并链接站点用户指南；验证不将 OpenSpec proposal 当作 current contract。

## 4. 验证

- [x] 4.1 运行受影响的 CLI/Engine focused tests 和 `bun test packages/cli`，验证所有新增 source-route、隐私、result schema 与 Store recovery regression cases。
- [x] 4.2 运行 `bun test`、`bun run lint`、`bun run typecheck`、相关文档/链接检查、`git diff --check` 与 `openspec validate add-local-pack-directory-install --strict`；记录任何与本 change 无关的既有失败。
