## 1. Runtime names

- [x] 1.1 在现有 Backend child spawn 中传递 `lore-backend` argv0，不新增 executable、build identity 或 lifecycle 分支；验证 command/supervisor focused tests 断言 spawn option，且既有 Backend command 路由保持不变。
- [x] 1.2 将 native build 输出、三个 target manifest、catalog/manifest fixtures 与 resource resolver 的发布文件名统一为 `lore-model`/`.exe`，继续构建 upstream `llama-server` target；验证受影响的 native manifest/resource tests 通过，并在可用本机 target 执行 `lore-model --version`。

## 2. Existing release paths and Windows CLI icon

- [x] 2.1 更新 release archive、`install.sh`、`install.ps1` 及其 fixtures 中 native executable 的既有路径断言；验证正常安装和“缺少 renamed native”失败路径的现有 installer integration tests 通过，且用户入口仍只有 `lore`/`lore.cmd`。
- [x] 2.2 为 Windows `lore.exe` 的现有 Bun compile 路径加入 Lorelum `.ico`、title 和 description；验证 release compiler 的 focused test 覆盖这些 Windows compile inputs，不修改 native CMake、patch 或 recipe。

## 3. Focused verification

- [x] 3.1 运行受影响的 Backend spawn、native manifest、release compiler 与 installer tests，并在支持 argv0 的本机宿主观察 Backend 显示名；验证只记录必要结果，不要求模型下载、三平台矩阵、全量 typecheck/lint 或新的 recovery 验收。
- [x] 3.2 执行 `openspec validate improve-runtime-process-identity --strict` 和 `git diff --check`；验证提案、spec、design 与任务不再要求 companion executable、共享 identity、native icon 链或额外 release gate，且这些内容仅作为明确排除项出现。
