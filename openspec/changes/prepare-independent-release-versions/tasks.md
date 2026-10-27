## 1. 独立版本准备入口

- [x] 1.1 按 `design.md` 新增 `scripts/release/versions.ts` 和根 `release:version` 入口，复用现有 SemVer 校验；用 colocated 测试验证无选择、非法版本、未知/重复参数零写入，以及三个动作的参数边界。
- [x] 1.2 实现七个发布物的固定原生字段/镜像清单、精确文本修改和预检；用 CLI-only、六个宿主逐个更新、CLI/Codex 不同版本的测试证明未选文件与无关字节不变，Codex marketplace 不增 version，CLI lockfile 只改所属 workspace。
- [x] 1.3 实现 dry-run、无改动、写入前内容核对与普通 I/O 失败的有限回退；用测试证明预检失败零写入、重复执行字节不变，模拟部分写入后失败也尝试恢复失败文件，并报告恢复失败路径。

## 2. 公开安装推荐与关系检查

- [x] 2.1 新增单一 `apps/site/content/public-release.json`，实现 `docs --cli` 与离线 `check`；用测试验证 docs 只改公开推荐值、不改 manifest 或文档正文，推荐可以落后于源码，非法/缺失数据零写入，重复执行无改动。
- [x] 2.2 实现 `<CliInstall platform="unix" />` / `windows` 的构建期 Markdown 展开并接入现有 Fumadocs preset，迁移站点双语 installation、agents；用测试验证实际代码块含同一公开版本、未知属性/平台报文档位置，并通过实际页面、复制内容及 `agents.md` 输出验证没有未展开 JSX 或占位符。
- [x] 2.3 保留现有 Plugin 原生合同测试并补 omp marketplace/package 关系；补 CLI `toolVersion` 与 manifest 的关系断言，保留独立 golden/安装升级/资产命名样例；运行版本工具与相关 CLI/Plugin focused tests 验证不再需要每次改当前版本字面值。
- [x] 2.4 将两个 README 的安装段落改为对应语言安装指南入口，删除 README 和双语 Quickstart setup 提示中的当前版本；检查链接可达、Agent 提示仍能进入 `agents.md`，并核对未新增 README 模板、生成文件或版本定位标记。

## 3. 维护者流程与实际入口验收

- [x] 3.1 在根 `AGENTS.md` 的 Global commands and verification 加入 `prepare`、`docs`、`check` 与 `--dry-run` 的简短用途及发布手册链接；同时更新 `docs/development/release.md` 的实际用法、发布时机、审阅和按路径回退。验收时从 AGENTS 入口走到完整用法，确认命令与已实现参数一致、未复制整套流程，且保留 Release workflow、tag/asset 关口及 Plugin-only 原生发布路径。
- [x] 3.2 在临时 checkout 走真实根入口的 prepare/dry-run、单宿主、混合版本、docs、check 和 Git diff，证明未选发布物、历史内容、workflow/installer 不变；记录命令和结果，本地 docs 演练不作公开发布声明。
- [x] 3.3 运行 focused tests、`bun run lint`、`bun run typecheck` 及 `bun run --filter @lorelum/site build`，检查网页和 `agents.md` 安装命令使用同一推荐值且可直接复制；运行 `openspec validate prepare-independent-release-versions --strict` 并核对最终 diff 与设计一致，分别记录通过项和真实环境限制。

## 4. 审查整改与精简

- [x] 4.1 收敛版本字段定位，修复合法 JSONC 注释引起的误拒绝；合并重复目标/原值校验并复用读取结果生成报告，保留精确修改、全部预检、写前内容核对和有限回退；补注释与结构路径回归测试。
- [x] 4.2 用准确的 AST 属性类型替代对象形状防御，合并安装 code 节点构造和属性判断；保留文档位置错误与既有不支持用法的覆盖。
- [x] 4.3 压缩设计与维护手册中的重复用法、接口伪代码，保留所有权、必要校验的依据及 AGENTS 入口；使设计与实际实现一致。
- [x] 4.4 重跑相关测试、lint/typecheck、站点构建和真实维护入口演练，经 Sol 复核整改结果；记录实际缩减量和验证范围。
- [x] 4.5 按维护者要求删除发布后才改推荐、额外 PR/二次部署及站点先于 Release 的等待要求；同步产品、spec、设计、AGENTS 与发布手册，将 alpha.7 推荐放进现有发布 PR，验证生成的双语安装命令。
