## 1. 单一内容源与宿主适配

- [x] 1.1 按 design 的差异分类抽取正文和 recovery 内容源，保留原生 metadata 与 omp Catalog/read-hint 政策；统一普通 Catalog 与 lease 规则，逐份差异审阅确认没有把历史漂移配置化。
- [x] 1.2 按现行 backend-runtime 合同纠正 omp 的 `error.recovery`/后台重试指导；为生成的 recovery 增加回归检查，确认全部目标使用 message 指导且 deferred 不后台重试，并保留现有协议拒绝 recovery 字段的测试。
- [x] 1.3 实现 profiles 与纯渲染，验证共享正文修改到达七个目标、普通 Catalog 共用、omp child/read-hint 保留、generic 正文补齐共同 lease；用 `bun test scripts/skill-guidance` 验证确定性和固定插槽错误。

## 2. 产物生成与覆盖检查

- [x] 2.1 实现 `--write`/只读 `--check` 和 `skills:generate`/`skills:check` 别名，保持原十四个安装文件路径；测试覆盖旧内容、缺 Skill、缺 reference、直接改产物、非法参数与 check 不修改任何文件。验证产物不含时间戳或本机路径，其他宿主资源不被删除。
- [x] 2.2 从真实 Plugin artifact 目录独立发现覆盖集合，核对 profiles、generic 与原生 registration；回归测试故意删除 omp profile、模拟新增 host 未适配及遗漏一个 reference 都必须失败，不能用生成器清单作为唯一期望来源。
- [x] 2.3 生成并审阅全部安装产物，迁移 `packages/cli/src/feedback/agent-guidance.test.ts` 的共享覆盖到维护端并删除手写路径清单；`--check` 与 `bun test scripts/skill-guidance plugins/scripts` 通过，并补足 omp 分发覆盖。
- [x] 2.4 将新工具 tsconfig 接入现有 typecheck runner，运行 `bun run typecheck`、`bun run lint` 与 `bun test`；验证现有 CI 的 Test 步骤会执行只读覆盖检查，不修改 CI/release workflow。

## 3. 维护说明与真实安装验证

- [x] 3.1 更新 plugin-conventions、checkout development 和 skill-guidance-fixtures，说明唯一人工来源、生成/check 命令、差异归属与原生加载不变；检查链接和命令，确认用户无需运行构建工具且没有重复的人工同步说明。
- [x] 3.2 验证 generic 独立目录安装：脱离源仓库仍可发现、加载正文和相对 recovery；按需 list/query/get，记录实际结果，不使用直接注入正文代替加载。
- [x] 3.3 逐份审阅七个目标的原生 metadata、路径、相对 reference 和适配；以可用宿主的真实原生会话加载仓库外完整 artifact，读取正文及其 reference 并执行 query/get。记录普通 Catalog 与 omp 适配的结果、不可用宿主及限制，不以局部成功宣称全宿主兼容认证。
- [x] 3.4 复核 manifest、selector、Hook、安装/更新/卸载和版本选择未改变，没有新增 locator 或共享目录；在 evidence 区分已验生成/加载边界与未重验的既有生命周期，不将后者的跨宿主、跨平台全矩阵设为本次新增门槛，也不把可读 Skill 说成可执行检索。
- [x] 3.5 对照产物与真实行为复核单一规则所有权、原生 metadata 和 CLI-first 边界，补齐 evidence 中的命令/结果/未验平台；严格校验本 change。上游 Codex 状态单独核查，无失败读取次数对照则不宣称缓解；不把该观察扩成新的性能验收门槛。

3.3、3.4 按 `agentic-coding.implementation.justify-added-checks` 审查收窄了无新增失败依据的生命周期全矩阵；本次验证结果及未重新验证的支持边界见 [实施验证记录](evidence.md#实施验证记录)。任务完成不代表所有宿主、平台和失败路径均经过实际验收。
