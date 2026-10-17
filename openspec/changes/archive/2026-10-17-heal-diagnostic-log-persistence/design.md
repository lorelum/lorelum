# Design — heal-diagnostic-log-persistence（重设计版）

> 本变更曾以"祖先自愈 + 备用根 + 双根扫描 + 持久化记录 + protocolVersion 3"实现（PR #242），经维护者评审否决并关闭。本设计按评审、对齐回复（PR #242 #issuecomment-5871703047）与维护者后续裁决重写；被否决方案与完整理由保留在文末，供未来重提者参考。原则：能少写代码就少写代码，完整满足真实需求。

## D1 威胁模型（私有性边界的依据）

- 必须私有：日志文件**内容**（查询词、错误细节）与**文件名**（含 traceId、日期）。
- 不是秘密：`~/.lorelum` 的存在性，以及"其下有一个 logs 目录"这件事。

推论：`0755` 的根 + `0700` 的 `logs/` 子树 + `0600` 的文件，对外只泄露目录存在性。旧规则多守的那一层（信任根及其以上必须 0700）从未被论证值得守，且正是丢证据的直接原因。

| 对象 | 旧规则 | 新规则 |
| --- | --- | --- |
| `~/.lorelum` 及以上 | 每段必须 0700，否则拒写 | 只做结构检查（非 symlink、是目录、归当前用户）；不看、不改 mode；绝不检查或修改 `.lorelum` 之上的任何目录 |
| `logs/` 子树目录 | 必须 0700，否则拒写 | 归我、非 symlink、是目录；group/other 过宽 → 掩码收紧（`& ~0o077`，只减不增） |
| 日志文件 | 0600、非 symlink、`nlink === 1`，否则拒写 | 同样三查 + 过宽掩码收紧；不可修则拒绝该位置 |
| 写入失败 | `disabled = true`，无声 | 当次经既有 stderr 通道一句"诊断日志未保存：<类别>"；业务结果/错误码/exit code 不变 |

缺失的信任根与受管段创建时即为私有（`0700`/`0600`）。本变更不改变已存在 `~/.lorelum` 的权限，也不改 LocalStore 创建根目录的 mode——结构门使根的 mode 与日志私有性无关，`mutation.ts` 的无 mode `mkdir` 由此不再构成触发态。

## D2 受管位置判定与收紧原语（`packages/log/src/sinks/safety.ts`）

- `evaluateManagedTarget(facts, kind, options)`：纯函数；结构、`nlink`、`mode`、`uid`、平台与当前 uid 全部经注入，异主等无特权进程造不出的状态可在单测中覆盖。判定三值：`safe` / `repairable`（附掩码后 mode）/ `unsafe`（附原因）。
- 掩码收紧只清 group/other 位（`newMode = oldMode & 0o7777 & ~0o077`），原样保留特殊位与所有者位，数学上不可能增加权限。
- 掩码后所有者权限不足以完成写入（目录缺 `0700`、文件缺 `0600`，如 `0505`/`0044`）→ `unsafe("owner-bits-insufficient")`，不修复：修复绝不添加权限位。
- 校验与收紧绑定同一打开描述符（目录 `O_RDONLY|O_DIRECTORY|O_NOFOLLOW` 句柄；文件复用写入句柄）：`fstat` → 判定 → `fchmod` → `fstat` 复核。收紧抛错（如 macOS `uchg`）或未生效 → 拒绝该位置并当次说明；**不退回路径 chmod**。
- `O_NOFOLLOW` 打开 symlink 的错误码在运行时间存在 ELOOP/ENOTDIR 差异（Bun 1.4.2/Linux 实测 ENOTDIR），以一次 `lstat` 消歧，不按错误码猜测。
- 段与目标文件的 symlink 拒绝另以一次 `lstat` 前置检查保持平台无关：Windows 无 `O_NOFOLLOW`（常量缺失，旗标被丢弃），仅靠打开失败无法在 NTFS reparse point 上拒绝；POSIX 上两道检查叠加，lstat→open 之间的替换仍由 `O_NOFOLLOW` 打开兜底。硬链接检查先于 win32 结构分叉（`nlink` 在 NTFS 上语义成立，属结构检查）。
- 自建段（缺失的受管目录、新建文件）在自身句柄上直接设为设计 mode（`0700`/`0600`），免疫 umask 剥夺所有者位；同样不经路径 chmod。该设 mode 仅限有 mode 语义的平台（POSIX）——Windows 上**目录句柄的 `fchmod` 为 EPERM**（Windows 复测实证），且本无 mode 语义，创建后不设、私有性由 profile ACL 继承；设 mode 的抛出点位于句柄 `close()` 的保护块内，任何失败都不泄漏句柄。

## D3 walk 与 `JsonlFileSink`

- `walkManagedLocation(trustedDirectory, targetDirectory)`：
  1. **结构门**：`lstat` 信任根——symlink、非目录、（POSIX）非本用户 → 类型化拒绝；mode 不看；其上任何目录不 stat、不 chmod。缺失的信任根按 `0700` 递归创建。
  2. 信任根到目标目录之间每段：缺失 → `mkdir 0700` → 句柄上设 mode 并复核；已存在 → 句柄上判定/收紧。
- `JsonlFileSink` 每次写入前重走 walk（替换防御，保留既有语义）；目标文件先以 `O_APPEND|O_WRONLY|O_NOFOLLOW` 打开已存在文件（仅 ENOENT 才带 `O_CREAT`、mode `0600` 新建），在**写入句柄上**判定/收紧后追加并 `fsync`。
- 首次失败以 `{category, path, detail?}` 暴露（单一受管位置下首因即根因），此后 sink 静默禁用，语义与现状一致。类别：`symlink | wrong-type | multiple-links | foreign-owner | owner-bits-insufficient | write-failed`（`write-failed` 附 OS 错误码）。

## D4 当次一句报告（`packages/cli/src/log/runtime.ts`）

- `flush()` 在 sink 关闭后读取 `failure`，有则向既有 stderr 通道写一行；健康路径保持安静。单一发送点覆盖 CLI 全部出口与 Host Hook。
- 文案：`lorelum: diagnostic logs for this run were not saved (<category> at <path>[: detail])`。
- 信任根异主特例：`… is owned by another user. If lore ran with sudo, restore ownership with: sudo chown "$(id -u):$(id -g)" <path>`——聚焦实测异主的那一个路径、**非递归**。
- 业务结果、错误码、exit code 与 envelope 内容不变（协议零变更）。

## D5 观察行为与读端

- `protocolVersion` 保持 2；envelope 无新字段；`lore logs`、feedback 与 Backend trace 投影的 `missingEvidence` 字面值逐字保留。
- 事后读取不推断历史：读端只报告实际读到的记录与读取限制，不为"当时为何没写"编造原因。
- 三入口词汇收敛与显式空结果陈述**不在本变更**：纯内部派生重构没有可观察变化，缺之不违反任何当前需求（极简原则），若未来有真实消费者需要，作为 additive 单独提案。

## D6 平台差异

- Linux/macOS：同一规则（POSIX mode/uid + 掩码收紧）。目录句柄 `fstat`/`fchmod` 已在 Linux（Bun 1.4.2；tmpfs 与 btrfs）实测通过；macOS 由 CI 验证，句柄 chmod 不支持或失败（如 `uchg`）落入"收紧失败 → 拒绝并当次说明"，无路径 chmod 回退。macOS 未本机验证，PR 如实披露。
- Windows：维持既有分叉——只做结构检查（类型、symlink/junction），无 mode/uid 语义、不做 chmod；私有性由用户 profile 既有 ACL 边界继承（`runtime-state.ts` 既有立场）；`nlink === 1` 在 NTFS 上语义成立，保留。
- 净效果：唯一平台分叉仍是"POSIX 查 mode/uid、win32 只查结构"（今日已存在）。

## D7 守卫断言（把事故变成不可回归的测试）

- 全场景下 HOME 与信任根之上的目录 mode 逐 bit 不变：sink 级测试守卫信任根；子进程隔离 HOME 的集成测试守卫真实 HOME 与 `.lorelum`。
- 健康路径 stderr 为空；位置不可用时恰好一行提示，envelope（除 `traceId` 外）与 exit code 和健康路径完全一致。
- `0755` 根端到端闭环：写入成功 → 文件 `0600`、子树 `0700`、根保持 `0755` → `lore logs --trace-id` 读回记录。

## 被否决方案（保留决策脉络）

1. **备用根 `~/.lorelum-diagnostics` + 双根扫描 + 持久化记录 + protocolVersion 3**（PR #242，已关闭）：核心策略未证明即在其上建出第二套存储、读取、清理、状态与协议；实锤事故——备用根的信任根是 HOME，walk 第一步即校验并收紧用户 HOME（`0755`→`0700`，维护者隔离复现），与 #224 是同一不变量错误上移一层；`not-persisted` 证据状态逻辑上近乎不可达（证明其未持久化的记录本身也写不进去）；边界修对后 fallback 触发集收窄到"`~/.lorelum` 归他人且 HOME 可写"，最现实场景（sudo 后遗症）一条非递归 chown 指引即可覆盖，而其本该救场的场景（HOME 只读/损坏）中备用根作为 HOME 的亲兄弟通常一起坏。重开条件：若有证据表明"`~/.lorelum` 归他人 + HOME 可写"在真实环境有可观发生率、且当次 stderr 指引不足以让用户自救，以独立 change 重提。
2. **受管段过宽即拒绝**（不收紧、直接拒写）：把可安全修复的状态当终态、把修复责任推给用户——#224 的原始形态下移一层；拒绝也不减少存量暴露（旧 `0644` 文件会一直躺在那），自愈把存量暴露一并关掉。受管子树是产品创建、命名、清理的命名空间，掩码只减不增。维护者已裁定采用自愈。
3. **路径 chmod 回退**（句柄收紧不可用时按路径 chmod + 事后校验）：维护者明确否决——无法对同一对象安全收紧时直接拒绝该位置，不做路径级回退。
4. **递归 chown 指引**（建议 `sudo chown -R … ~/.lorelum`）：维护者明确否决；指引聚焦实测异主的那一个路径、非递归。
5. **信任根及以上参与自愈**（把收紧应用到 `.lorelum` 与其祖先）：即 PR #242 的 HOME 事故机制；新方案从结构上排除——walk 的私有段从 `logs/` 才开始，从不触达 `.lorelum` 之上。
6. **daemon 启动降级并入本变更**：该能力独立成立、与本次争议零耦合，拆独立 change 另行处理，不作为本修复的前置。
7. **三入口词汇收敛的内部派生重构**：零观察变化，按极简原则从本变更裁掉（见 D5）。
