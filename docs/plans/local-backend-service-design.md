# 本地后端：第一阶段

- 状态：B1–B3 已通过 #98、#99、#100 合并；[第二阶段：embedding 常驻](./local-backend-stage-2-design.md) 已确定采用 llama.cpp + Q4_0 CPU，Mac 首批接入已实现，Windows 与跨平台交付仍待完成。
- Issue：#95（服务基础）、#96（进程管理）、#97（Query 接入）。
- 相关设计：[Semantic Query v1](./semantic-query-v1-design.md)。

> 历史范围说明：本文记录 B1–B3 的设计边界，不是当前 CLI 支持面的完整说明。其中“本轮不加载 embedding 模型”等表述仅描述当时第一阶段的范围。当前 Backend、model 和 semantic index 的实际行为以 [CLI 文档](../cli/README.md) 为准。

## 第一阶段范围（历史记录）

使用 **Elysia + Bun + TypeScript** 建立常驻服务，固定监听 `127.0.0.1:26186`。提供 `lore backend start/status/stop`，并允许本地客户端通过 HTTP 调用现有 keyword QueryService。不同 Store 共用服务，每个请求明确传入自己的绝对 Store root。

本轮保留现有 CLI 命令结构。HTTP client 和进程控制入口本身保持轻量；**完整 CLI 的启动优化另行测量和实施，本轮不承诺降低 fresh CLI 延迟。**

不加载 embedding 模型，不改变 `lore query` 的默认行为，不迁移 Store 写入，不添加 MCP、模型下载、后台 index 构建或登录自启。原定 B4–B6 留待后续阶段。

## 代码如何组织

参考 [Elysia Best Practice](https://elysiajs.com/essential/best-practice.md)，按功能组织 controller、service 和 model：

```text
packages/backend/src/
  app.ts                         # 组装模块及统一错误边界
  app.test.ts                    # HTTP 合同与真实 Store 集成验证
  modules/
    backend/
      controller.ts              # identity、status、stop 路由
      service.ts                 # 就绪、停止状态和幂等关闭
      model.ts                   # 请求/响应 DTO schema 与推导类型
    query/
      controller.ts              # 调用已有 Engine QueryService
      model.ts                   # 查询请求/响应 DTO schema
  plugins/local-auth.ts          # loopback、Host、Origin、认证边界
  config/                        # 配置 schema、文件/env 读取、内部启动参数
  runtime/                       # OS 进程、启动互斥、私有文件、日志
  client/                        # HTTP 客户端及依赖隔离测试
  protocol/                      # 跨模块错误、协议常量、身份签名
```

- Controller 使用 Elysia 实例和内联 handler，让框架推导 Context；只传普通参数给 service，不将整个 Context 传入业务层。
- Backend service 拥有服务内状态；runtime supervisor 拥有外部进程启动/停止及资源回收。HTTP controller 不发现 PID、不直接执行文件或 SQL 操作。
- Query 复用 Engine 中的 QueryService，不新增纯转发 service。snapshot、排序、候选回读和 digest 校验继续由 Engine 所有。
- Model 是 DTO schema，同时推导 TypeScript 类型。共享 schema 使用 Zod，通过 Standard Schema 接入 Elysia 校验；client 复用相同定义，不加载 Elysia 服务端。不另写 DTO class 或重复类型。
- `app.ts` 不堆业务逻辑。`index.ts` 遵循仓库规范，只做 re-export；官方示例中的路由入口在本仓库命名为 `controller.ts`。

包导出分别为 `./client`、`./protocol`、`./control`、`./server`、`./daemon`。前两类客户端入口和 `./control` 不导入 server/Engine 运行时代码；完整 CLI 仍保留现有 Engine 依赖。

## 可见行为

| 命令                  | 行为                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `lore backend start`  | 幂等启动一个兼容实例，等待初始化完成并通过身份验证。                     |
| `lore backend status` | 返回 starting/ready/stopping/stopped；不启动服务、不创建缺失的运行目录。 |
| `lore backend stop`   | 请求经过验证的实例停止，确认它退出后才报告成功；未运行时幂等成功。       |

命令继续使用现有 CLI 单行 JSON envelope 和退出码：成功为 0，失败为 2。第一阶段的模型状态固定为 `unloaded`。全局 `--store-root` 不影响控制命令；它们不读取 LocalStore。

内部协议只供第一方客户端使用：

| 路由 | 合同 |
| --- | --- |
| `GET /internal/v1/identity?nonce=...` | 返回实例、build、控制/业务协议版本和 nonce 签名；不接受或返回凭证。 |
| `GET /internal/v1/status` | 认证后读取服务状态。 |
| `POST /internal/v1/stop` | 认证后进入 stopping，响应发送后开始关闭；重复请求不重复执行关闭回调。 |
| `POST /internal/v1/query` | 认证后接收 `{ storageRoot, query: { text, limit? } }`，返回现有 keyword 结果摘要。 |

请求和成功响应都经 schema 校验，错误不返回内部 stack、私有路径或凭证。非法请求返回输入错误；服务产出非法响应属于服务端失败，不归咎调用方。Query 的领域错误沿用 `usage.invalid`、`query.*` 和 `store.*`。

## 进程、身份和数据边界

运行文件位于用户私有的 `~/.lorelum/run/backend/`，目录权限 0700，实例凭证文件 0600。它与 Store config/index 分离，不受 `--store-root` 重定向；拒绝不安全权限和符号链接。

并发启动使用独立 `control.sqlite` 的 `BEGIN IMMEDIATE` writer lock。它不保存业务数据，进程崩溃会释放锁。父 CLI 先记录子进程身份，再通过 stdin 授予启动许可；子进程完成监听与初始化后才报告 ready。服务只继承必需的环境变量，不保留 CLI 环境里的无关密钥。

身份握手通过私有密钥验证随机 nonce 的 HMAC；确认服务身份后才发送 bearer 和业务数据。拒绝浏览器 Origin、非预期 Host 和超过限制的请求；客户端禁用代理、重定向并限制响应大小/等待时间。该边界不承诺隔离能读取同一用户私有文件的程序。

所有请求使用同一内部协议和 build 校验，不保留跨 build 的控制豁免。当前尚未发布 release，按最终协议一次性实现，不维护开发中间版本的兼容逻辑。端口被其他进程占用时明确失败，不另选外部端口，不按端口或进程名杀进程。

停止时不再接受新查询，限时等待在途请求，再释放监听。控制端核对 PID 与进程启动时间，不将 PID 本身视为所有权。异常退出的 descriptor 只有确认旧实例失效后才清理。日志有大小上限，只写生命周期事件。

Store 的 canonical 内容、完整 snapshot 和跨进程 writer lock 仍由 Engine 所有。本阶段不缓存现有 SQLite/FTS handle；外部进程更新 Store 后，下一次查询继续执行现有 snapshot/revision 校验。

## 验收与后续

| Task | 本轮完成标准 |
| --- | --- |
| B1 服务基础 | Elysia 模块职责明确；身份、认证、DTO、错误、请求与响应边界可测试。 |
| B2 进程管理 | 并发启动单实例；CLI 退出后服务存活；正常停止、build 不匹配拒绝与崩溃恢复通过真实子进程验证。 |
| B3 Query 接入 | HTTP 与 Engine 结果一致；多 Store 隔离、外部 mutation 可见；client/control 包导出不加载服务端。 |

保留真实 SQLite 和进程测试；单元测试不访问模型/registry，不使用用户 Store 或运行目录。依赖隔离测试检查完整构建图，不将被检查模块设为 external，并用服务端构建作正向对照。

实现 PR 需要通过相关测试、lint、typecheck 和完整 diff 审查。必要的安全与恢复用例不能为了减少行数删除。CLI 全局懒加载和完整性能矩阵已移出本轮；在获得配对测量后另行提出小范围改动，不能把服务存活当作性能收益。

配置由 config 层统一读取和校验，优先级为默认值 < 可选的 `~/.lorelum/config.yaml` 中的 `backend` 段 < 明确命名的环境变量 < 内部显式注入。当前仅开放启动、请求、退出超时（毫秒，1–120000），监听地址仍固定。每次控制命令读取配置，daemon 使用启动时保存的快照，重启后更新。内部启动握手参数和生成的实例凭证不属于用户配置；业务层只接收已解析的配置，不读取文件或环境变量。

共享 YAML 文件由 `packages/config/src/document/` 读取，保留各模块的配置段；后端 config 层校验 `backend` 段并合并环境变量。其他模块及后端未来使用的其他配置均复用共享读取入口，各自负责领域校验，无需依赖后端包。
