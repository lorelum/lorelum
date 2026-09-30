# CLI 文档

Lorelum CLI 的普通命令默认在 stdout 输出可读 text。`lore pack list`、`query`、`get` 的默认 text 是按当前决策用途精简后的视图，不保证逐字段呈现公开 `data`；这三个命令可用 `--verbose` 查看完整 data 的 text。传入 `--json` 时，stdout 输出完整 JSON envelope；成功包含 `command`、`ok: true` 和完整 `data`，失败包含 `command`、`ok: false` 和 `error: { code, message, recovery?, details? }`。`--json` 的内容不受 `--verbose` 影响。默认 text 失败写 stderr，并在同一结构化响应中显示 `diagnostics.traceId`；诊断和模型下载进度也写 stderr。`lore hook codex`、`lore hook cursor`、`lore hook workbuddy` 与 `lore hook zcode` 是集成 ABI 例外：它们输出各自的宿主 Hook envelope，而不参与普通 format 协商。

普通命令正常成功退出码为 `0`，可见命令错误为 `2`。机器调用方必须传 `--json` 并按稳定的 `error.code` 处理结果，不解析 message 或 text；`error.message` 面向人解释原因及修正方向，text 与 JSON 使用同一消息。拥有者已验证的失败还会携带可选 `error.details`，供机器读取 subject、source、reason、received 与 expected。`lore describe --json` 返回当前 protocol 命令和每个 `resultSchema`，可用于动态发现未来新增的普通命令；宿主 Hook ABI 使用各自的专门文档定义的输出。

命令按职责分组：

- [Backend 控制](backend.md)：启动、状态、停止本地 backend。
- [Model 生命周期](model.md)：准备、加载、状态、卸载 embedding 模型。
- [Semantic index](index.md)：查看、构建或替换当前 query context 的 semantic artifact。
- [Query](query.md)：默认使用本地 semantic query；`--mode keyword` 保留离线 keyword query。
- `lore logs` / `lore logs prune`：按 source、level 或 `traceId` 查看受管理的本机日志，或显式清理过期日志；不会启动 Backend/model 或扫描任意目录。
- `lore feedback draft`：从一个 `traceId` 或高级 input 生成仅保存在本机的反馈草稿；默认包含已留存的同 trace `error`、`warn`、`info` 调用链，`--include-logs debug` 才追加此前记录的 debug。任何外发仍须用户单独确认；只有 credential 或其他实际敏感材料需要额外审阅。
- `lore cache status` / `lore cache prune`：查看或显式清理用户级、可重建的 query cache；不会扫描或修改项目源文件。
- [Get](get.md)：读取一个已安装 Practice。
- [Pack catalog](list.md)：列出已安装 Pack 或其 Practice 目录。
- [Pack 生命周期](packs.md)：安装、更新或移除某个 Pack。
- [Host Hooks](hook.md)：向 Codex、Cursor、WorkBuddy 与 ZCode 注入受限的 Installed Pack Catalog，并提供 Codex 的可选会话候选提示。

使用 `lore --version` 查询 CLI 版本；`--help`、`--json`、`--debug` 和 `--log-level` 是全局选项。`--debug` 仅提升本次调用的持久本机日志到 debug；当调用进入 Backend 时，它只传给同一条 authenticated request 及关联 lifecycle，不改变 daemon 全局配置或其他调用的收集等级。`--log-level` 只控制 stderr 呈现。持续 debug 可在 `~/.lorelum/config.yaml` 设置 `logging.level: debug`。需要 Store 的命令支持 `--store-root <path>`；backend/model 命令不读取或修改 LocalStore，传入该选项不会改变它们的模型来源。`query`、`index` 与 cache 命令支持 `--cache-root <path>`，它只选择本次调用的用户级派生数据位置；未指定时默认使用 `~/.lorelum/cache`。

## Protocol versions

普通 CLI envelope 当前为 version 2；backend 内部协议当前为 version 3。内部协议对所有请求使用一致的实例身份和 build 校验。

## Output formats

默认 text 是给人和 Agent 阅读的视图，不是可解析的协议。`pack list`、`query`、`get` 会隐藏当前决策不需要的字段；对这些命令传 `--verbose` 可在 text 中完整展开原有 data。传 `--json` 始终返回完整 envelope 和 data，且优先于 `--verbose`。其他命令按各自文档呈现 text；Help 和 version 可以采用更适合终端浏览的布局。

Agent 与 Skill 在普通检索中直接阅读默认 text，不要把 text 排版当作机器协议。人工需要核对完整字段时，对 `pack list`、`query` 或 `get` 使用 `--verbose`；脚本、CI 或其他程序调用方使用 `--json`，以读取完整 `data`、`error.code`、`sources[].packRoot`、coverage 或 operation ID：

```sh
lore query "verify the release" --json
lore get agentic-coding.testing.verify-before-publish --json
lore pack list --details --json
```

## 版本更新结果

`lore update [--channel stable|prerelease] [--apply] --json` 使用普通 CLI envelope，`command` 为 `update`。成功时的 `data` 包含 `currentVersion`、`channel`、`latestVersion`、`status`、`canApply` 和 `releaseNotesUrl`；没有匹配发行版时后两个版本/页面字段为 `null`。`status` 为 `available`、`current`、`ahead`、`no-release` 或 `updated`。只有 `--apply` 安装完成且从新的默认命令入口核对版本成功，才出现 `installedVersion`。

`currentVersion` 和 envelope 的 `toolVersion` 都描述发起命令的 CLI 进程；自更新成功时它们仍是旧版本。判断新安装版本应看 `data.installedVersion`，或另起一次 `lore --version`。`canApply` 表示当前入口是否由默认位置的官方 installer 管理。`--apply` 的安装进度写入 stderr，stdout 只输出一条最终 JSON envelope。

更新命令的错误码包括 `update.unavailable`、`update.unsupported-platform`、`update.apply-unsupported`、`update.apply-failed` 和 `update.verification-failed`。调用方应按 `error.code` 分支，不得将查询失败当作“已是最新版”，或把安装后核对失败当作更新成功。面向用户的路径和恢复步骤见[安装指南](../../apps/site/content/docs/installation.zh.mdx)。

## JSON envelope

示例：

```json
{
  "protocolVersion": 2,
  "toolVersion": "…",
  "command": "model.status",
  "diagnostics": {
    "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  },
  "ok": true,
  "data": {
    "state": "unloaded",
    "encodingId": "…",
    "device": "cpu",
    "dimensions": 384,
    "threads": 4
  }
}
```

普通命令失败保留一条面向人的 `error.message`，可纠正的错误会说明已知的选项或配置项及修正方向；已声明的枚举选项会指出参数及允许值，不回显被拒绝的原始输入。拥有者已验证的失败可额外携带非空 `error.details`：每项使用封闭的 `kind/subject/reason`，并按事实提供 `source`、非秘密 `received`、结构化 `expected`、`hint` 和 YAML 行列位置。text 模式在 stderr 的 `error` 区块展示同一消息和同一 facts 的单行压缩。未知异常使用安全通用文案，不暴露原始异常或敏感值，也不会虚构 details。`protocolVersion` 保持 `2`；严格校验旧 failure shape 的 consumer 需要允许该可选字段。面向用户的示例见[站点 JSON envelope 说明](../../apps/site/content/docs/cli.mdx)。

`model load` 的 stdout 在任务最终完成前保持沉默；stderr 使用 `model: resolving`、`model: downloading 50% (attempt 1)`、`model: verifying` 和 `model: starting` 这样的文案，只输出发生变化的阶段、百分比或 attempt。被取消、下载失败或 native 启动失败在默认格式以 text error 返回，在 `--json` 格式以最终 failure envelope 返回；两者都不把 202 接受状态当作命令成功。

每个 `--json` CLI envelope 的 `diagnostics.traceId` 是该次调用的本机排障关联 ID；普通 text failure 也会在 stderr 中显示同一个 ID。它可用于 `lore logs --trace-id <traceId>` 或后续生成本地 feedback 草稿；它不是鉴权 token，也不会出现在 Codex/ZCode/Cursor/WorkBuddy Hook envelope。`--debug` 不改变 stdout 单行 JSON、progress 输出、已接受后台 operation 或退出码；`--log-level` 仍只控制 stderr。面向用户的排查顺序见[站点故障排查说明](../../apps/site/content/docs/troubleshooting.mdx)。
