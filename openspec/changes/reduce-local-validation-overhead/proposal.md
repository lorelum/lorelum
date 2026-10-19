## Why

Lorelum 的 Backend/daemon 只服务正常、可信的同用户本机环境。现有链路把下载/提交边界上的完整验证重复放进 query、get 和每次编码，导致全库审计、重复文件读取和额外 HTTP 往返；这些工作不应承担防御已控制同一用户环境的攻击者。本变更引入新的正常读取校验边界，不只是记录现状。

## What Changes

- 正常 semantic reader/status 只检查版本、Profile、method/representation 与必要的行结构；全库 integrity 和全量向量质量检查保留在构建发布/恢复边界，不在每次查询重复执行。
- get 信任经 LocalStore 提交的 canonical 内容和来源，仅校验目标行、已提交快照及 current locator；不再整包哈希或解析整个 Pack projection。完整 open/reindex 审计继续保留。
- 模型准备拥有下载、完整摘要验证和原子发布；把已准备的 native/model 资源明确传给进程启动，消除改名后的第二次模型哈希。编码不再巡检磁盘文件，许可证/notices 不作为运行时可用性的条件。
- Backend client 在首次接入时验证 nonce-bound identity、build 和 protocol，后续同 client 的业务请求沿用该身份并继续携带 Bearer credential；保留 loopback、Host/Origin 和请求边界，消除逐请求重复身份挑战。
- Store-only target 以轻量提交身份确认是否变化，不为这一确认再读取全语料；外部可编辑 ProjectContext 保留真实变更发现。
- 合并内部重复 canonical/JSON 校验；公开模型与 credential 文件分开处理，不把模型硬链接或可信路径祖先当成本地攻击默认拒绝。
- 整合已有未提交的编译期 build identity、native 构建输入摘要复用和 sealed staging 摘要传递优化。
- **BREAKING（校验保证收窄）**：正常 query/get/encode 不承诺发现绕过 Lorelum API 的本地文件/数据库任意篡改。CLI 参数、输出字段、排名算法、退出码和正常故障恢复流程不变。

## Capabilities

### New Capabilities

无。只调整既有能力的验证边界，不新增产品 surface。

### Modified Capabilities

- `backend-runtime`：身份验证从每个业务请求改为每个 client 的首次接入；保留认证、兼容性和安全停机边界。
- `local-model-runtime`：明确准备阶段单次完整验证、原子发布和运行时就绪验证，不进行逐编码文件巡检。
- `native-runtime-artifact`：运行时关注匹配 manifest 与 executable；许可证/完整包验证属于构建/安装验收。
- `practice-read`：正常 committed Store 读取不再进行 Pack artifact/projection 全量审计；保留一致快照和来源 locator。
- `semantic-index`：区分发布前完整验证和 reader/status 的轻量检查。
- `retrieval-query`：保留所选 method/Profile、current target 和结果语义，Store-only freshness 使用轻量提交身份。

## Impact

基于 main `724389e`（#279）实施，保留默认 `single-vector`、显式 `multi-view-vector`、多表示 schema、method/Profile 隔离、progress 与 operation 生命周期。涉及 Engine semantic reader/metadata、LocalStore 读取，Backend client/model/process 组装，以及 CLI 输出、测试和对应中英文用户说明/维护文档。无新依赖、无 canonical Store 或索引 schema 迁移、无发布/部署操作。

用户流程和失败边界见同目录 `product.md`；具体模块责任、接口迁移与基于新代码的证据见 `design.md`。
