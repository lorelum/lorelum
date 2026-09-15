# 隔离验收记录

本记录只描述 `add-project-context-packs` 的实现期验证；current specs 尚未同步，change 也尚未归档。

## 已执行命令

在仓库根目录执行：

```sh
bun test packages/cli/src/project-context/query-get.integration.test.ts \
  packages/engine/src/project-context/resolver.test.ts \
  packages/engine/src/project-context/semantic-progress.test.ts \
  packages/backend/src/modules/query/project-semantic-runtime.test.ts \
  packages/backend/src/modules/query/project-operation-journal.test.ts \
  packages/backend/src/modules/query/controller.test.ts \
  packages/backend/src/modules/index/controller.test.ts \
  packages/engine/src/project-context/cache-manager.test.ts \
  packages/cli/src/cache/commands.test.ts
```

测试在临时 Store、普通目录、`.lorelum/` layer 和临时 cache root 下运行；不读取开发者 Store，也不使用 Git metadata 作为 context 或 artifact 身份。

## 观察结果

- parent/child layer 默认继承；child 按单条 Practice 覆盖，`--no-project` 返回 Store-only 结果。
- 一个坏 Practice 只被 ignored；同 Pack 邻居和低优先级 fallback 仍可 query/get/index。
- Store-only 100 条 target 的第二批被阻塞时，semantic query 返回 current progress 的 `50 / 100` partial；未发布的 50 条不进入候选。
- 相同最终语料的两个无关普通目录得到相同 operation ID，document embedding 只发生一次；路径、Git/worktree、branch 和 mtime 不参与 artifact identity。
- 同一目录连续 source edit 会 supersede 旧 target；旧 target 后续 batch 不再发布为当前结果。
- daemon journal 只持久化 opaque source/slot/cache/artifact identity、Profile、计数和状态。restart 后未完成 target 进入 `waiting-for-source`；下一次同 source command reattach。
- `lore cache prune` 只清理未被 artifact lease 保护的派生数据；不写项目 source 或 LocalStore。强制 rebuild 失败时旧 `active.sqlite` 仍保持 ready。

## 限制

本 change 的单元/协议验收使用受控 EmbeddingPort，而不是下载或运行真实 native 模型。native/model 实际运行、吞吐、cache 容量和自动 LRU 策略不属于本 change 的完成标准。
