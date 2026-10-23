# 开发构建与 Backend 的交互

## Outcome

普通使用只关心“这份 CLI 能否与 Backend 正确协作”，开发验证还关心“Backend 是否真在运行这份代码”。默认复用兼容进程；只有开发者明确选择本构建时才尝试安全交接。以下是拟议交互，不是执行记录。

## Normal use

用户有两个完整的开发构建 A、B，共用用户级 Backend 和 Store。A 已经加载模型，随后用 B 执行：

```sh
lore query "如何分配校验职责"
```

若内部协议相同，直接执行查询，不先报一次 mismatch，不停止 A、不重载模型。返回既有检索结果或真实 preparing/indexing 状态，不加每次重复的跨 build 警告。`model`、`index` 与默认 `backend start` 遵循相同兼容原则。它们复用 A 的实现；切换 CLI 文件本身不等于切换 Backend 代码。

## Inspect builds

`lore --version` 不连接 Backend、不创建 Store、不检查模型。默认文本示意：

```text
Lorelum 0.1.0-alpha.6
CLI envelope protocol 2; Backend internal protocol 4
Build 222222222222 (compiled), revision 0dde46120000, dirty
```

`--version --json` 的 data 保留完整身份；外层沿用既有 CLI envelope，以下 ID 和 revision 均为示意值：

```json
{
  "protocolVersion": 2,
  "toolVersion": "0.1.0-alpha.6",
  "backendProtocolVersion": 4,
  "buildIdentity": "2222222222222222222222222222222222222222222222222222222222222222",
  "revision": "0dde46120000000000000000000000000000000000",
  "dirty": true,
  "buildKind": "compiled"
}
```

`protocolVersion` 仍指 CLI envelope；`backendProtocolVersion` 才是 Backend 接入协议。可读版本不篡改包版本，也不从 `versions/` 目录名推断 codex/claude 标签。两份同 commit 的构建仍可由完整 `buildIdentity` 区分；脏工作树只说明存在未提交内容，commit 不代表全部构建输入。

`lore backend status` 保持只读，兼容但不同构建时成功并直接显示双方：

```text
Backend: ready; model: ready
Backend build: 0.1.0-alpha.6 compiled 94f3552a; id 111111111111; protocol 4
CLI build:     0.1.0-alpha.6 compiled 0dde4612 dirty; id 222222222222; protocol 4
Same build: no; protocol compatible: yes
```

对应 JSON 的 `data` 片段（外层沿用现有完整 envelope）：

```json
{
  "state": "ready",
  "model": "ready",
  "instanceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "buildIdentity": "1111111111111111111111111111111111111111111111111111111111111111",
  "backendProtocolVersion": 4,
  "build": {
    "toolVersion": "0.1.0-alpha.6",
    "revision": "94f3552a0000000000000000000000000000000000",
    "dirty": false,
    "buildKind": "compiled"
  },
  "cli": {
    "toolVersion": "0.1.0-alpha.6",
    "revision": "0dde46120000000000000000000000000000000000",
    "dirty": true,
    "buildKind": "compiled",
    "buildIdentity": "2222222222222222222222222222222222222222222222222222222222222222",
    "backendProtocolVersion": 4
  },
  "sameBuild": false,
  "protocolCompatible": true
}
```

没有 Backend 时返回 `state: stopped`、`model: unloaded` 和 `cli`，不编造远端 build、协议或比较结果。Git 不可用时 revision/dirty 为 null，文本明确 unknown；复制编译产物后不依赖 Git 仓库仍能显示编译时信息。Backend 信息取自它启动时的快照，不因原 worktree 后续修改而变化。

## Run the code under test

在目标 worktree 使用既有 source 入口：

```sh
bun packages/cli/src/main.ts backend start --current-build
bun packages/cli/src/main.ts --store-root /absolute/path/to/test-store query "如何分配校验职责"
```

编译路径先构建完整 target 目录，再执行其中的 CLI；macOS arm64 示例：

```sh
bun run build:cli
./dist/release/darwin-arm64/lore backend start --current-build
./dist/release/darwin-arm64/lore --store-root /absolute/path/to/test-store query "如何分配校验职责"
```

不需要改全局 `lore` 链接、安装到 `versions/`、清理模型缓存或手写 stop/start。若确实使用 version-store，仍须复制完整 target 目录，不能只复制 executable。

`--current-build` 的结果：

| 起点 | 可观察结果 | 下一步 |
| --- | --- | --- |
| 没有 Backend | 启动当前构建，返回 ready | 执行要验证的命令 |
| 已是当前构建且协议相同 | 复用原 instance，不重载模型 | 继续验证 |
| 是另一构建或另一协议，明确 idle | 等旧 daemon/native 退出，启动当前构建，返回新 instance 的 ready | 再运行要验证的命令 |
| 正在处理业务请求、模型准备、index operation、有效 lease 或活动未知 | `state: deferred`，reason 为 active-long-task 或 unknown-activity；exit 1 | 让既有任务完成或核实活动后，手动再执行一次 |
| 旧实例停止后新实例启动失败 | 具体启动错误，exit 2，不声称仍在使用旧实例 | 按具体错误修复后重试同一 start 命令 |

deferred JSON data 仍采用简单形态：

```json
{ "state": "deferred", "reason": "active-long-task" }
```

这代表已完成一次安全尝试，但没有切换构建，不代表开发验证已准备好。不会后台排队、强停其它任务或自行重放 query。显式模式返回 ready 后表示该时刻的 Backend 确实属于当前构建；它不提供跨多条命令的永久独占权。需要跨步骤保持可用时继续使用已有 lease，不能把一次 start 当成锁住整个开发会话。

占用不是“另一个 Agent 还在工作”：仅指 Backend 已接受的业务请求、后台操作或未过期 lease。模型只是在内存里、另一个聊天会话开着或 Agent 正在写代码，都不阻止切换。v4 中 lease 到期即不再保留占用，不需要扫描持有人进程；活动记录确实损坏或归属不明仍会拒绝自动停止。停止接入与判断在途请求由 Backend 一次完成，不让 CLI 和每个业务模块各自重复校验。

Backend ready 不等于 model ready。真正切换代码需要新进程，模型可能按既有流程重新加载；命令不承诺跨进程热迁移模型。已有同构建 model failed 也不会被 start 隐藏或自动重试。

## Incompatible or untrusted instances

内部协议不同仍返回 `backend.protocol-mismatch`，不向不兼容实例提交业务，也不由 query/status 自动停止。错误示意：

```text
The local backend uses an incompatible Lorelum protocol.
CLI: 0.1.0-alpha.6, build 222222222222, Backend protocol 4.
Backend: version unknown, build 111111111111, Backend protocol 3.
Run `lore backend stop --if-idle`; if stopped, run `lore backend start`, then retry this command.
If deferred, leave it running; do not retry in the background or force-stop it without explicit user approval.
```

旧实例没有 provenance，就诚实显示 unknown；不把当前 CLI 的版本套给远端。可以用本次 CLI 的 `--version --json` 获取完整本地 ID；未知旧实例也保留已认证的完整远端 build ID 供比较。实际 message 的两侧 buildIdentity 使用完整值，以上短值仅为排版示意。

开发者也可明确运行 `backend start --current-build`，将 guarded stop 和启动当前代码合并为一次操作；不把这个变更动作为只读 status 的副作用。认证、record 或 listener 归属失败时保留原有具体错误，不假定可以交接，不 kill 未归属进程。

新 status 合同引入一次 Backend 内部协议升级：旧协议 3 到新协议 4 的首次交接需要重启；之后协议 4 的普通重建不再因 build ID 改变而重启。旧协议 3 的 guarded stop 只能按它已有的后台操作与 lease 记录判断，过期 lease 仍可能返回 unknown；它没有 v4 的在途请求接入保护，不能据此承诺迁移时所有旧请求都不受影响。CLI JSON envelope 仍是 2。回退旧 CLI 时先用较新 CLI 停止其 Backend，避免旧 CLI 的严格 decoder 误报新 status/协议。

## Unchanged boundaries

继续使用一个用户级 Backend；`--store-root` 只选择 Pack/index 数据，不隔离模型或 Backend。互不兼容的两份测试构建不能同时拥有它。协议版本覆盖 wire、操作语义和共享派生状态兼容约束：破坏这些约束的改动必须提升协议，不用“同协议”掩盖真正的不兼容。正式安装器升级、模型校验失败恢复和自动重试策略不在本 change 中调整。
