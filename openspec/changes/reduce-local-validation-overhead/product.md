# 本地检索的验证边界与用户流程

## 正常安装、首次查询和读取

用户已正常安装 CLI/native release，或在当前 worktree 完成完整开发构建。无需开启“信任本机”、关闭安全模式或手工生成校验缓存。

```sh
lore pack install agentic-coding
lore query "提交前检查有没有不必要的实现" --top-k 5
lore get <query返回的practice-id>
```

1. install 对外部 Pack/Registry 做格式、路径、引用和冲突检查；成功后提交 canonical 数据，再提交派生索引工作。模型准备可以在安装后的索引同步阶段开始，不一定等第一次 query。
2. 模型尚未存在时，沿用下载进度、断点续传、大小和固定 digest 校验；校验后的 partial 原子提升为正式模型，加载阶段消费同一次准备结果，不再次扫描相同模型。
3. 缺少 native executable 或 target/manifest 不匹配时，在下载模型前返回既有 native 专用错误。缺失许可证/notices 不阻止已经安装好的 executable 加载模型；完整发布包的许可证检查仍由构建/打包验收承担。
4. query 沿用 preparing/indexing、partial/complete、operation ID、退出码和重试指引。索引构建发布前完成全量验证；现成索引的正常打开不再执行数据库全库审计。
5. get 返回相同正文、contentDigest、source 和可读 packRoot。它校验目标行和已提交快照，修复可恢复的 current locator，不再为了读一条 Practice 哈希所属 Pack 的全部资源或校验其他 Practice。

结构示例（不是运行记录）：

```json
{ "mode": "semantic", "retrievalMethod": "single-vector", "coverage": "complete", "results": [] }
```

示例只强调方法和 coverage；实际 results 字段、完整 JSON envelope、正文与默认 text 渲染继续遵循现有命令合同，本变更不新增字段。

## 已有缓存和常驻 daemon

- daemon 和模型常驻时，后续 query/get 不触发下载。业务文本编码不读取 executable、模型、许可证或 notices 的文件属性。
- 一个 Backend client 首次接入验证 instance/build/protocol，后续请求使用相同身份和 Bearer credential，不为每次状态查询或业务调用增加一次 identity 往返。创建新 client、显式重新识别或连接另一个实例仍执行接入验证。
- 新 daemon 在自己的准备阶段验证模型，不能靠旧进程的持久“已验证”标记跳过准备；不新增校验缓存文件、后台巡检、锁或自动重试。
- Store-only 查询的收尾用已提交身份判断 canonical 语料是否变化；正在发生真实安装/更新时仍不允许返回混合快照。ProjectContext 文件允许被编辑器直接修改，继续由项目 resolver 发现真实变化。

## 方法选择和已有数据

默认方法保持 single-vector；用户可继续通过配置或 `--mode multi-view-vector` 选择实验方法。两种方法的 Profile、encoding inputs、索引与缓存仍隔离，已接受 operation 不因后续配置变化而切换算法。keyword 继续离线，不接入 Backend、不加载模型。

不迁移 canonical Store 或现有索引 schema，不要求重新安装 Pack、手工清缓存或重下模型。旧 daemon 的构建不兼容时仍按既有 guarded stop/start 指引处理，本变更不擅自停止用户任务。

## 可遇到的失败与恢复

| 情况 | 可见结果与原有数据 | 恢复动作 |
| --- | --- | --- |
| Pack 格式、路径或引用错误 | 安装失败，不提交半个 Pack | 修正 Pack 或选择正确 release |
| 安装或升级进程中断 | 既有 journal/manifest/SQLite 机制收敛到已提交状态 | 重试原命令；无法收敛时按 Store 恢复错误处理 |
| 下载中断 | partial 保留，未作为正式模型使用 | 按原流程重试/继续下载 |
| 模型大小/digest 不匹配 | 原模型专用错误保留；不偷偷删除或重下 | 修正 modelPath 或模型缓存来源 |
| native 缺失或不匹配 | 下载前返回 native 专用错误，模型缓存保留 | 重新安装匹配的完整构建 |
| 加载、readiness 或进程退出失败 | 保留 failed 状态和稳定错误，不伪报 ready | 按现有模型错误指引重试或重启 |
| 已发布索引不兼容或实际读取失败 | 重建派生索引，或返回现有稳定错误；不把索引当正文来源 | 执行现有 index build/rebuild 或错误提示的动作 |
| 查询期间 Store/项目发生真实变化 | 重取当前 target 或返回已有忙碌/pending 结果 | 稍后重试原查询 |
| current locator 缺失或落后 | 从 active manifest 修复后返回；非链接占位不覆盖 | 移走冲突对象后重试 |

## 不再承诺的事情

正常 query/get/encode 不承担发现用户或同用户程序绕过 Lorelum API 任意改写 artifact、SQLite、模型/native 文件的责任。完整 Store open/reindex 与构建/恢复边界继续做其所属的完整审计；不增加新的 doctor 命令。运行中的文件被直接替换不触发后台监控，重新准备或显式恢复时按对应边界验证。

这不削弱 loopback、浏览器 Origin/Host、Bearer token、凭据文件权限，或停止进程前的 PID/启动时间核对。保护用户数据免受正常崩溃、错误版本和并发提交影响，仍是产品正确性要求。
