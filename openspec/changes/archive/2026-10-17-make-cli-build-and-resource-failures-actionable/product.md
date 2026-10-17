# 完整 CLI 构建与资源失败体验

开发者在 worktree 中运行 `bun run build:cli`，得到 `dist/release/<target>/`。这个目录同时含 `lore` 和匹配的 `native/<target>/`；可以从该目录运行 `lore model load`，随后在隔离 Store 上做真实语义查询。若只测 keyword、`get` 或进程启动成本，明确使用 `bun run build:cli-only`，得到 `dist/lore`；该单文件不是模型或语义检索安装包。旧的 `build:release-staging` 保留为完整构建别名，不发布、不生成归档；正式归档仍由 `build:release` 完成。

从完整目录复制 dev 版本时，要复制整个目录，而非只取可执行文件。缺少相邻 native runtime 的编译版在尝试下载模型前失败，返回 `embedding.native-resource-invalid`，并指出如 `native/darwin-arm64/manifest.json` 缺失以及“重新安装同一次构建的完整目录”这一恢复动作。此前已下载的模型保留可用；重复下载模型不会被当作 native 资源修复。

若模型文件本身未通过大小或 SHA-256 校验，错误仍为 `embedding.resource-invalid`，说明校验的是缓存模型还是显式 `embedding.modelPath`，并在可取得时提供预期与实际值。`lore model status --json` 的失败状态、`lore model load --json` 以及语义 query 的失败 envelope 均携带相同的受限资源信息；文本输出同样能看到具体的下一步。示意（省略 envelope 其他字段）：

```json
{
  "error": {
    "code": "embedding.native-resource-invalid",
    "message": "Native runtime file native/darwin-arm64/manifest.json is missing. Reinstall the matching complete CLI build; reloading the model will not repair it.",
    "resource": {
      "kind": "native",
      "file": "native/darwin-arm64/manifest.json",
      "check": "missing"
    }
  }
}
```

完整性校验继续拒绝损坏、不匹配或被替换的资源；不会调用 PATH 中的替代程序，也不会将语义请求悄悄改成 keyword。模型缓存没有经证实的损坏现场，本变更不增加自动删除或重下载。若 native 资源验证失败，之前的 Store、Pack 和模型缓存均不被更改；修复完整安装后可显式 `lore model load` 再试。显式 `modelPath` 无效时必须由使用者修正该配置/文件，不得自动选择另一个模型。
