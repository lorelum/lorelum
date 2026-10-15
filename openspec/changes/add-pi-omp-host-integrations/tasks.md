## 1. omp CLI bridge

- [x] 1.1 实现 `lore hook omp` 的 `event: catalog` 协议、入口分发及共用 Catalog 读取/渲染；对隔离 Store 运行真实 CLI，证明 metadata 有界、空 Store 与失败不同、非法参数仍失败。
- [x] 1.2 覆盖畸形 JSON、不支持 event、Store 失败、Store override 与 stderr/stdout 分离；运行相关 CLI Hook 行为测试一次，并证明现有宿主 envelope 不变。

## 2. omp 插件

- [x] 2.1 创建 `plugins/omp/lorelum/` 与独立 `.omp-plugin/marketplace.json`，包含原生类型 extension 和完整 Skill/references；实际 checkout marketplace 安装，确认 extension/Skill 都被发现、entry/package 版本一致且不加载 Claude/Codex artifact。
- [x] 2.2 实现原生生命周期失效与请求级 Catalog 注入；行为测试覆盖切换/fork/compact、重复请求复用、失效期间旧读取结束、缺失/超时 CLI 非阻塞、其他消息不变且不累积永久 Catalog。

## 3. 真实宿主验收

- [x] 3.1 用正在使用的正常 omp 配置验证真实主 Agent：Catalog 可见、targeted semantic query、完整 get、compact/新会话刷新与准备状态恢复；记录宿主/CLI 状态、实际结果和未覆盖边界，不以单测或 startup probe 替代。
- [x] 3.2 验证原生 marketplace 更新/卸载，以及缺失 CLI、超时/取消不阻塞任务。支持声明与平台实测范围一致；macOS 不代替 Windows/Linux，未覆盖平台明确记录。

## 4. 支持说明与集成

- [x] 4.1 更新插件索引、开发约定、CLI Hook 合同、英文与中文 omp 用户指南和安装入口；沿用其他宿主的文档结构，说明独立 CLI、安装/更新/卸载、恢复及会话读取关联和子 Agent 提示的支持边界，验证文档链接与实际路径一致。
- [x] 4.2 执行聚焦的合并检查、类型检查与 OpenSpec 严格校验；复用各验证负责人的证据，只补跨模块缺口。pi 不实现、不加入支持入口，不发布或改 release workflow。

## 5. omp 读取关联与子 Agent 候选

- [x] 5.1 实现 shell/read-hints CLI bridge、共享 shell 设置与身份校验，Backend 接受 omp；覆盖默认/全部 shell、引号、非法身份、成功与失败读取、Backend 不可用、旧宿主行为。
- [x] 5.2 在原生 extension 注册 Bash 输入改写、派发时父 session 关联与 task/eval 子会话 metadata；覆盖并行、嵌套、切换、compact、shutdown、取消、晚到结果与非阻塞失败，不改变宿主权限和 transcript。
- [x] 5.3 更新英中功能表与用户指南、Skill 恢复指导、维护文档和相关规格；用正常配置的真实 omp 验证成功 get 会话记录、task/eval provider 候选和失败路径，记录实际覆盖，运行聚焦测试、类型检查和严格 OpenSpec 校验。

## 6. Main / 子 Agent 上下文与可选 Pack Catalog

- [x] 6.1 实现并覆盖 `agent.subagentPackCatalog` 布尔配置（默认 false）及可选 `agentKind: main/sub`；省略保持 main 语义，禁用 sub 正常返回 `{}` 且不读取 Store，开启复用 renderer，Main 不受影响，其他 shell 设置消费方不受新配置影响。
- [x] 6.2 extension 显式标记 sub Catalog 请求并接受正常 `{}`；所有嵌套 task/eval 候选保留源头 Main，自己的 get 仍归自己。覆盖身份缺失/冲突、并行、生命周期、取消与晚到结果；候选协议和 Catalog 开关互相独立，无 Main 身份但开启时仍能取 Catalog。
- [x] 6.3 用最终安装的 omp Plugin、官方 Pack 和正常用户 provider 配置，分别捕获默认 false 与显式 true 下真实 Main 和一级 task/eval 子 Agent 的最终 provider 请求；证明 Main 有 Catalog，默认子 Agent 只有 Main 成功读取摘要，开启时额外包含 Catalog 而无正文。Main 生命周期刷新及连续请求复用、嵌套保留 Main 身份和自身 get 隔离由行为测试覆盖；实机若顺便观察到可如实记录，不增加嵌套或 compact 实机门槛，也不重复历史检查。由集成负责人记录本次真实上下文证据并完成勾选。
- [x] 6.4 对齐本 change、Plugin README/Skill、维护指南及英中用户指南；由集成负责人运行聚焦检查并记录结果。保留历史验收日期，当前主规格暂不同步，不归档。
