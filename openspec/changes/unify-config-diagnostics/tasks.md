## 1. 配置事实与终止错误

- [x] 1.1 按 design 的内部类型扩展安全 ConfigError 与 YAML 边界，保留 ENOENT/空文件/大小与 close 行为；在 `packages/config/src/document/load.test.ts` 验证 syntax 可靠位置、root/type/size/read 类别、无原始 snippet/cause 泄露和已有文件不变。
- [x] 1.2 实现 `resolveConfigWithFallback(load, fallbackValue)`，仅捕获 ConfigError 并返回实际采用值及原 error；`fallback.test.ts` 使用非生产 `display.pageSize` fixture 验证直接传播、明确默认值20、成功值10原样返回与TypeError原样抛出，确认无需 section/Issue 分支、无附加校验或默认策略注册。
- [x] 1.3 迁移 query 与 Backend/embedding 的规则映射与安全 message、统一约束真源，保留来源 precedence 和覆盖消费范围；通过 CLI `query/settings.test.ts`、Backend `config/load.test.ts` 与 `embedding.test.ts` 验证整数、枚举、嵌套字段、unknown-key 安全定位但不回显对应值、env 无前导零词法规则、override、resolved bytes 和 secret 边界。仅在已有 validator 产出事实，不加 query validation gate、重复 schema 检查或输出重校验。
- [x] 1.4 保留 CLI/Backend/显式初始化错误适配链中的安全 ConfigError cause，新增有限的 fact 提取与同文档判定；用 `backend/error.test.ts`、`runtime/errors.test.ts` 验证 allowlist、resource、未知错误泛化和非同因不抑制，且 HTTP/envelope schema 无新增字段。

## 2. logging 解析与呈现

- [x] 2.1 在 `packages/config/src/logging.ts` 用通用 fallback 函数实现薄 LoggingResolution adapter，保留严格 loader；补齐正常、缺失、`logging: {}`、非法 section/type/enum、YAML/read failure、debug及未知可用性异常的 `logging.test.ts`，验证 persistent/fallback/effective、不改文件、未知异常不猜来源且仅 logging 保留原fail-open策略。
- [x] 2.2 CLI/Hook 日志 runtime 使用 resolver，写一次普通 `logging.level-fallback` warning，flush 时按 terminal fact 呈现一次；复用输出安全函数并保留原 sinkFailureNotice；通过 `log/runtime.test.ts` 和 main 测试验证 text/JSON、`--log-level error`、重复 flush、同因/独立失败、正常零提示和 stdout 不变。
- [x] 2.3 daemon 独立使用同一 resolver，以 Backend source/instance 写一次 warning，保留 detached stdio、request-scoped debug 和 sink 安全预检/关闭；Backend runtime 单测与隔离 integration harness 验证 startup fallback、无 fake trace、预检拒绝、I/O 禁用和原 ready/cleanup 行为。

## 3. 一体化行为与交付检查

- [x] 3.1 在隔离 HOME、Store/cache/log 路径运行真实 CLI text/JSON process fixtures：query/Backend 终止配置错误、有效配置、logging fallback 成功/无关失败、debug、malformed YAML 同因去重、sink 不可用；断言原 code/exit/envelope/resource/trace，保留真实输出与文件逐字不变的证据。
- [x] 3.2 运行真实 Hook 原生 ABI 路径与 CLI fallback trace 的 `lore logs`、`feedback draft --include-logs debug` 读回；验证 Hook no-op/exit0/纯 stdout、记录恰好一次、info/debug 有效收集及原缺失词汇；daemon 另按 Backend source 检查，不用 CLI trace 假关联。
- [x] 3.3 回归共享 query method loader 的 index 和 Pack indexSync：验证 canonical commit 成功后仍为原 `indexSync.failed`、不回滚不提升顶层失败，且独立 logging warning 仍显示；覆盖原 keyword/显式 method override 不消费设置的路径。
- [x] 3.4 在同一集成 PR 的范围内更新实际支持的站点中英文 `configuration`/`troubleshooting` 与维护者配置说明；审查文档无 details/notices 误承诺、无 daemon stderr/trace 误承诺、无临时发布状态，检查变更链接和真实文档路径。
- [x] 3.5 运行受影响 package 测试、typecheck、lint 与 `openspec validate unify-config-diagnostics --strict`；独立结构审查通用传播/fallback与领域适配的分离、规则所有权/依赖方向/cause 安全/资源作用域及旧 silent 分支、重复 key 正则/规则表清理，复核完整 diff 无范围外改动。

以上顺序是同一集成 PR 内的实施检查点，不要求拆 PR；检查通过后提交 PR，CI 成功后按授权合并。
