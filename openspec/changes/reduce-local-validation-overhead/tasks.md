## 1. 基线与完整边界

- [x] 1.1 同步 main 724389e 并保留已有哈希改动；核对新版 single-vector/multi-view、Profile 和 encoding-input schema，确认不改方法/迁移。
- [x] 1.2 完成 proposal、product、design 与六项 capability delta；通过 openspec validate --strict 后开始实现。

## 2. semantic reader、状态和 freshness

- [x] 2.1 分离轻量 metadata/reader/status 与完整发布审计；reader/progress/status 不再扫描全向量或执行 integrity_check，以正常 reader 行为和构建拒绝坏产物的现有/补充行为测试验证。
- [x] 2.2 合并可信内部向量转发的重复数值校验，保留 native 输入、写入/发布、method/Profile/representation 隔离；用两种方法的排名、partial/complete 和不兼容输入回归验证。
- [x] 2.3 Store-only 收尾改用 readSnapshotIdentity，迁移 runtime Store dependency 与 fixtures；用查询期间有效变更、仅来源变化和项目外部编辑场景验证。

## 3. 准备结果与本机文件

- [x] 3.1 建立具体 PreparedEmbeddingResources 交接，模型准备校验一次后原子提升；runtime 消费同一准备结果，无 resolver fallback 或持久校验缓存。迁移 daemon、service、process、benchmark、integration 和 smoke 调用者；验证取消/失败不 spawn、坏下载不提升。
- [x] 3.2 native 准备只验证 matching manifest 与 executable，完整许可证检查留在构建/打包；删除 encode 文件巡检和 obsolete API/测试，用缺 native 下载前失败、真实 readiness/超时/退出与缺 notice 可加载场景验证。
- [x] 3.3 模型读取支持正常 symlink/hardlink，解除 credential mode/owner/nlink 限制；私有 partial 写入保护保留，用链接模型与不完整/错误模型回归验证。

## 4. Backend client 接入

- [x] 4.1 每 client 首次业务接入识别实例，后续不重复 identity 往返；保留显式识别、严格 build 比较、Bearer/Origin/Host 和现有错误，以真实 HTTP client 多请求、mismatch、取消和替换实例场景验证。
- [x] 4.2 取消可信祖先目录的递归 symlink 拒绝，保留 credential 叶节点私有属性；用 symlink 祖先可用和非法 credential 仍拒绝的回归验证。

## 5. canonical get 与内部重复检查

- [x] 5.1 get 的来源解析只核对已提交 manifest/current locator 与 snapshot fence，不哈希 artifact 或解析全 projection；验证正文/来源、locator 修复、并发提交和非链接占位不被覆盖。
- [x] 5.2 row materializer 复用已解析 canonical 数据/来源，普通读不重算提交 digest；完整 cold-open audit 增加必要 canonical/projection 对账以保留坏数据检测。验证 malformed 目标拒绝、普通读取边界和完整 audit/reindex 恢复。
- [x] 5.3 合并 JSON success 的重复递归检查，text 不执行冗余 JSON 扫描；验证完整 JSON envelope、非 JSON 数据错误和现有 text 行为。

## 6. 真实验收与合同同步

- [x] 6.1 运行 typecheck、lint、格式检查和完整测试，处理新 main 集成边界；不以旧版本测试结果代替最终状态。
- [x] 6.2 完整构建当前 CLI/native，在隔离 Store/cache/model/runtime 跑 install、冷下载/load、两种方法 query、get、reload 与进程失败场景；保留正常用户路径的真实观察。
- [x] 6.3 用临时 instrumentation 证明模型单次 hash、encode 零资源 stat、reader/status 零全库 audit、client 首次 identity、get 不读整包与 Store freshness 不重读语料；分别记录无 instrumentation 的前后可比延迟，不把计数脚本加入永久测试。
- [x] 6.4 同步六项 current spec、维护资料和受影响中英文站点用户说明，核对无方法/数据格式回退与 obsolete callsites；运行 OpenSpec 严格验证并记录实际未覆盖平台。

## 7. 验证记录

验证状态：2026-10-18，macOS arm64，Bun 1.4.2，基于 main `724389e` 的本变更工作树。以下结果不代表 Linux/Windows 已实机验收。

- `bun test --timeout 15000`：1800 pass、19 skip、0 fail，覆盖 246 个文件、1819 个测试。首轮默认 5 秒上限曾使安装器 fallback 用例超时；未修改安装器或该用例断言，最终完整运行显式使用 15 秒上限。
- `bun run typecheck`、`bun run lint`、`bun run fmt:check` 通过；lint 保留既有 warning。
- `bun run build:cli` 成功，生成包含 matching native runtime 的完整 darwin-arm64 目录。`bun run test:integration` 通过 source/compiled CLI、get、keyword query 和宿主 Hook 验收。
- `bun run test:native-smoke -- <固定模型>` 通过真实 native 的 ProjectContext 和两种 retrieval method：48 条项目 Practice、非法 Practice、空模型缓存、下载中断续传、partial/complete、增量修改、等价目录复用、get、prune 后读取及 unload/reload。
- 隔离 Store 的临时脚本安装 48 条 Practice，完成 index build、30 次 complete query、get 与 status。`daemon-embedding.integration.ts` 通过 resident reuse、超时回收、native crash、parent death、protocol mismatch 安全恢复与干净重启。
- 临时 compiled fixture 使用正式 `compileReleaseCli`、完整相邻 native 文件及 embedded manifest，通过真实模型 symlink 准备、两次 384 维单位向量编码和进程回收。该轮未停止占用默认端口的另一 build；后续默认端口编译版完整复测见下一节。
- `bun run build:site` 成功预渲染中英文 get/model 文档。六项 current spec 已同步，`openspec validate --specs` 为 23 passed / 0 failed；本变更严格校验通过。已同步的 ADDED requirement 会产生“归档需跳过重复 spec 同步”的信息提示，并非本变更校验失败。

### 临时计数

计数与计时分开执行，未把 spy 或性能计数加入永久测试：

| 路径 | 实际观察 |
| --- | --- |
| 冷下载准备 | partial 验证一次，随后加载不验证 published 路径；显式 unload/load 才再验证 published 模型 |
| complete Store query | 每次 0 次 integrity audit、0 次 native/model 资源 stat、1 次 corpus snapshot、1 次轻量 snapshot identity |
| ready index status | 0 次 integrity audit，不扫描向量 payload |
| Store get | 0 次 artifact digest、0 次 sealed projection 读取 |
| client | 真实 loopback 回归验证同一 client 的首次业务识别与后续 Bearer 请求；显式 identity 仍新建挑战。CLI coordinator 的显式接入识别不属于被移除的重复业务挑战 |
| 完整 audit | 计数全程仍观察到 publication/recovery integrity、artifact digest 和 projection 读取，未把检查整体删除 |

### Source 进程内的无 instrumentation 对比

同机、同一固定模型、4 threads、相同临时脚本，各自独立 Store/cache、48 条 Store Practice、ready 后连续 30 次 single-vector complete query；基线为独立 clean main `724389e`。下表为相邻空闲运行，不使用早期负载较高的样本。

| 指标 | main | 本变更 |
| --- | --- | --- |
| 平均 query 延迟 | 19.65 ms | 14.98 ms |
| p50 | 18.9 ms | 13.9 ms |
| p95 | 23.8 ms | 19.9 ms |

这是小型本机 fixture 的路径观察，不是容量基准，不证明其他语料、平台或模型推理吞吐的同比收益。

### 编译版 CLI 默认端口端到端复测

2026-10-18，使用同一 main `724389e` 和本工作树各自通过 `bun run build:cli` 产生的完整 darwin-arm64 bundle。正常生命周期停止先前的 Backend 后，两个编译版在默认端口顺序启动，运行真实 native 模型。

- 数据为已安装 4 个 Pack、97 条 Practice 的一致独立副本；原 canonical Store 未修改。模型固定为同一 Q4_0 artifact，4 threads，使用独立的 derived cache。
- 测量边界从每次新建 CLI 进程开始，到收完 stdout/stderr 并观察退出为止，包含 CLI 启动、HTTP、检索和退出；不是 source 进程内耗时，也不代表纯推理吞吐。
- 顺序为 main、优化版、优化版、main。每个 block 每指标 20 次，每版本合计 40 次；每个方法预热 3 次。5 条固定 query 轮换，两种方法各自比较；get 从每个 Pack 选一个 ID，轮换读取。
- 正式采样使用原用户配置，request timeout 为 5000 ms。冷索引准备单独使用临时 HOME 的 120000 ms 设置，准备完成后停止该 daemon，再以原配置启动被测 daemon。原配置文件保持不变，未使用 instrumentation。
- 两版 query 的完整 results、get 正文、contentDigest 与 source metadata 一致。编译版在默认端口完成临时 Pack install、两种方法 query、get 以及 model unload/load；最终优化版 Backend/model 均为 ready。

| 操作 | main 平均 | 优化版平均 | 平均降低 | main p50 | 优化版 p50 | main p95 | 优化版 p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| single-vector query | 254.89 ms | 176.85 ms | 30.6% | 255.07 ms | 176.69 ms | 262.21 ms | 179.39 ms |
| multi-view query | 303.73 ms | 194.32 ms | 36.0% | 304.68 ms | 194.32 ms | 311.19 ms | 196.84 ms |
| get | 238.14 ms | 185.24 ms | 22.2% | 236.71 ms | 184.41 ms | 245.36 ms | 189.30 ms |
| backend status | 217.28 ms | 170.29 ms | 21.6% | 215.81 ms | 170.42 ms | 222.71 ms | 172.30 ms |

相同版本的两个 block 的平均耗时范围：main 的 single-vector 为 250.95–258.82 ms、multi-view 为 300.18–307.27 ms；优化版分别为 176.68–177.03 ms、193.91–194.73 ms。收益只适用于本次 workload 和环境，不外推为平台容量或模型推理吞吐提升。

冷构建限制：main 在默认 5 秒设置下分别观察到 `backend.deadline-exceeded` 与 operation 的 `embedding.deadline-exceeded`。上表排除了索引准备；没有验证或声称优化版已解决 97 条真实语料在默认 5 秒下的冷构建。临时脚本、Store/cache 副本和 baseline worktree 在验收后清理，原始本地运行数据不纳入版本控制。

PR 前独立审查发现共享 embedding cache 的数值损坏不能再按 cache miss 恢复；已保留构建实际命中条目的 finite/L2 验证，不恢复 query/status 全量审计。新增两种方法 × 非有限值/非单位向量的 4 个回归：修复前 4 fail，修复后 4 pass；Engine 全包 350 pass、1 skip、0 fail。该修复仅涉及索引构建读取共享缓存，不改变上述 ready CLI 路径。
