# Local backend API

本目录描述本地 backend HTTP 合同。接口只绑定 `127.0.0.1`，统一使用 `/internal/v1` 路由前缀；它是本机控制面，不是公开网络 API。默认模型的稳定下载来源仍待配置；接口与下载恢复能力已实现。

当前合同使用 control protocol version 3 和 business protocol version 3。客户端必须先通过 unauthenticated identity challenge 验证实例，再对受保护接口发送 `Authorization: Bearer <runtime-secret>`。HTTP 请求不能带 `Origin`，`Host` 必须匹配实际 loopback authority。

所有 JSON body 都必须使用 `application/json`。错误 body 统一为：

```json
{
  "error": {
    "code": "backend.busy",
    "message": "The local backend is busy or stopping."
  }
}
```

模型状态和错误不会返回 runtime secret、下载凭据、native 私有端口、本机路径或原始输入。请求体最多 64 KiB，backend client 接收的响应最多 256 KiB；客户端应按 `error.code` 分支，不依赖 message 文案。

接口按领域拆分：

- [Backend 控制](backend.md)：identity、status、stop 和通用状态。
- [Embedding 模型](embedding.md)：模型准备、加载进度、取消和编码。
- [Keyword Query](query.md)：现有 Store-backed 关键词查询接口。

`model load` 的 HTTP 请求只负责接受共享加载任务；HTTP 202 不表示模型已经 ready。SDK/client 可以轮询 status，CLI 会等待最终状态并把进度写到 stderr。

## 可运行的认证与编码示例

下面是仓库内的临时调试脚本，保存为 `try-embedding.ts` 后用 `bun try-embedding.ts` 运行。先通过 CLI 启动 backend 并加载模型。脚本复用现有 client 完成 nonce/proof、协议和响应校验，不自行实现认证：

```ts
import { createBackendClient } from "./packages/backend/src/client/client";
import {
  defaultRuntimeDirectory,
  resolveBackendSettings,
} from "./packages/backend/src/config/index";
import { readRecord, isSameProcess } from "./packages/backend/src/runtime/index";

const record = await readRecord(defaultRuntimeDirectory());
if (!record || !(await isSameProcess(record))) throw new Error("Start the backend first.");
const settings = resolveBackendSettings(record.settings);
const client = createBackendClient({
  identity: record,
  secret: record.secret,
  // 临时调试明确选择正在运行的构建；正式产品调用方应传入自己的构建身份。
  buildIdentity: record.buildIdentity,
  timeoutMs: settings.requestTimeoutMs,
  shutdownTimeoutMs: settings.shutdownTimeoutMs,
});
console.log(await client.embed("query", ["responsibility boundary"]));
```

`@lorelum/backend` 当前是仓库私有 workspace 包，没有独立发布的 SDK。其他语言调用方可按 [identity 合同](backend.md#identity) 实现握手，随后使用 Bearer credential。凭据来自当前用户私有 runtime record，不是配置中的固定 API key；不要记录到日志。

HTTP 边界的通用映射是：`400` 表示 JSON/字段/业务输入校验失败，`401` 表示缺少或错误的 Bearer credential，`403` 表示请求带 `Origin`，`503` 表示 backend/model busy、未加载、下载、资源或 native 失败。未预期的内部错误为 `500 backend.failed`，Query 的特定错误映射见对应页面。
