# 开发、测试与发布

产品名是 **ds-superbot**。本仓库是 monorepo，安装入口是 `packages/dsh-plugin`。不需要构建，不需要 `npm install`（各包零运行时依赖）。Node.js `>=20`。

## 1. 日常循环

```bash
npm run check    # node --check：插件入口、constitution CLI、runtime / im 入口、脚本 shim
npm test         # node --test：dsh-plugin / constitution / runtime / im
```

在仓库根执行。也可以进入某个包跑 `node --test tests/`。测试用假 `ctx` 和临时目录，不启动 DSH，不访问网络，不写用户的真实仓库。

若本机没有 DeepSeek Harness profile（因此解析不到可选 peer `@deepseek-ai/schemastery`），`npm test` 会在 `packages/dsh-plugin/node_modules/` 写入一个仅供测试的 gitignore 桩，不是运行时依赖，也不会打进插件的 `files`。

- `packages/dsh-plugin/tests/dsh-plugin.test.mjs`：工具注册、章程注入、路由、文档硬门、命令 / 技能、面板与设置页
- `packages/dsh-plugin/tests/p6-live-loop.test.mjs`：人批后 `dispatchWorkItem` + 官方 `startActivation`、缺 subagents 仍保留 Mandate、否决不启动会话
- `packages/dsh-plugin/tests/p7-watchdog-loop.test.mjs`、`p7-auto-low.test.mjs`：人批后武装 Watchdog 循环、有限 auto-low 不签发 Mandate
- `packages/runtime/tests/git-adapter.test.mjs`、`auto-low.test.mjs`：真实 git 适配与仅人合并、有限 auto-low 策略边界
- `packages/constitution/tests/t1-invariants.test.mjs`：T1 含 `INVARIANTS.md`，`--write` 不覆盖已有文件
- `packages/dsh-plugin/tests/docs-ready.test.mjs`、`docs-governance.test.mjs`：通过插件 shim 跑原脚本（退出码与 `--help` 必须与 SSOT 一致）
- `packages/constitution/tests/`：schema、状态机、Mandate、Policy、Receipt / revalidate、卡片、CLI、shim 回归、账本路径禁闭、跨通道 Thread、动态治理 `planSteps`
- `packages/runtime/tests/`：导出形状、L1 / L2、curator / assignment、存算分离、Cartographer 回写、Event Bus、订阅直通、Watchdog、observe / would-accept、auto 灰度、Capability Compiler、能力态 × 风险路由、Steward 候选提案
- `packages/im/tests/`：三种卡、发言允许表、每种状态 × 四张脸的 `presenceOf`、正式原创脸谱 SVG

改了 `packages/constitution/scripts/` 后，至少再跑一遍插件包路径上的 `--help` 和 docs-ready / docs-gate 用例。

## 2. 包职责

| 包 | 开发时注意 |
| --- | --- |
| `packages/dsh-plugin` | 行为保持 0.1.0 兼容。P2 已用官方加法槽接上左栏控制台、顶部迷你脸和右侧舞台；禁止注册 `sidebar` / `rightbar` / `conversation.session.header` / `conversation.header`。`scripts/` 只是 shim。 |
| `packages/constitution` | 不要重写门禁脚本判定逻辑。落盘必须 `--write`。Receipt 手改后必须能被 `revalidate` 识破。账本只写 `.superbot/ledger/`；`planSteps` 的步骤数随策略变，不要删门。 |
| `packages/runtime` | 文件型 Event Bus、订阅直通（不授权）、Watchdog（进度 / 空转 / 费用 / 文档漂移）、Steward 轻量规则 + 预留 `createModelPort`、Capability Compiler（只出 Mandate 草稿）、`routeModel`、存算分离、Cartographer 回写、P5 闭环（`approveDecision` / `rejectDecision` / `canExecute` / `dispatchWorkItem` / `recordMergeIntent`）、真实 git 适配器、有限 auto-low。默认 observe，禁止 auto-merge，不开 HTTP。auto 灰度必须先有观察记录。人批 Mandate 之后该工作项才可 execute；P6 起 Watchdog 对已获 `canExecute` 的工作项按 execute 运行，循环默认仍是 observe；P7 起人批准后插件会真正启动该循环定时器。 |
| `packages/im` | 面板和字幕只调用 `presenceOf`。同一时刻全场 `high` 不得超过 1 个。 |

Curator 打分权重（写在 `packages/runtime/src/curator.mjs` 的 `WEIGHTS` 常量里）：

```
score = 4 * value + 2 * (reversible ? 1 : 0) + 1 * evidenceCount - 3 * attentionCost
```

## 3. P3 运行时约定

- **Capability Compiler**（`packages/runtime/src/compiler.mjs`）：输入工作项 + 可选 snapshot / 章程加载器，输出 Mandate **草稿**和能力态装配。成功时 `via: 'compiler'`；缺 intent / 缺 AC / AC 不可判定（「体验好」「功能正常」）/ 范围越出仓库根时 `via: 'fallback'`，回落匹配的 `roles/*.md`，且不得扩大 toolsWhitelist 或 scope。编译器不签发、不改门禁、不起进程、不合并、不访问网络。`compileIntent` 走同一套实现。
- **Owner → 能力态**：`pm` / `architect` → Discover（Scout / Explorer / Curator，只读）；`backend-dev` / `frontend-dev` → Build（由现有章程模板编译 Worker）；`qa-engineer` / `browser-tester` / `reviewer` → Verify（独立 Verifier + 确定性脚本，Critic 终审）。缺 owners 时按 gates / 文件范围 / intent 推断，不发明新角色 id。Cartographer 始终装配为任务后能力，并标成 `writeBackCapable`；编译器本身仍把 `writeBack` 设为 false，不写知识库。真正的回写走 `cartographer.writeBack`。
- **模型路由**（`routeModel`）：轻量档给 Discover / Steward / Scout / Explorer / Curator / Cartographer / Build；强档给 Capability Compiler 与 Verify / Critic。R2 / R3 升到强档，避免编译与终验停在最便宜的 Discover 模型。`superbot.config.json` 的 `modelRouting.<role>` 是更低优先级 fallback；0.1.0 的 `superbot_dispatch` 路由行为不改。默认 `createModelPort()` 仍是 rules-only。
- **auto 灰度**（`evaluateAuto` / `canEnterAuto`）：默认仍是 observe。请求 `auto`（执行灰度，不是合并）仅在已有一条落盘的、可比对的 would-accept 记录时允许（至少同一 `action`，请求带风险时还要同一风险档）。R2 / R3、`human-approval`、`requireHuman`、touches 敏感范围、不可逆，一律拒绝并留在 observe。即使允许进入灰度，`would.merge` 仍为 false，且不执行合并。`resolveAuthority('auto')` 只表示「请求了灰度」，不是授权；`resolveAuthority('auto-merge')` 与 `assertNoAutoMerge` 仍抛 `AUTO_MERGE_DISABLED`。`assign` / `consider` / `watchdog` 默认路径仍是 observe，不会因为灰度资格为真就开工。


## 4. P4 约定

- **存算分离**：账本与事件只在目标仓库 `.superbot/ledger/`（threads / work-items / mandates / receipts / snapshots，以及已有的 `events.jsonl`），写入必须走 constitution 账本 API（幂等、路径禁闭，不得逃出仓库根）。执行 / Assignment 的 `workDir` 只在 `tmp/superbot/<run>/`。API：`assertStoragePath` / `assertComputePath` / `separate`（`packages/runtime/src/separation.mjs`，账本禁闭在 `packages/constitution/src/ledger.mjs`）。计算路径不能当账本根；账本 API 不会写进 `tmp/superbot` 或业务源码。执行助手 `writeLedgerDocument` 必须拒绝直接写账本。不要用插件 HTTP / BFF / 独立端口控制台来「加固」这一边界。
- **跨通道 Thread**：`bindChannel`、`findThreadsByChannel`、`resolveThread`。一个 Thread 对象联合多个 `scheme://` 通道（如 `group://`、`github://`），不叉出第二份。工作项通过 Thread 关联到全部已绑定通道。只做数据模型，不接真实 IM / GitHub。
- **Cartographer 回写**：`packages/runtime/src/cartographer.mjs` 的 `writeBack`。只追加 `docs/project/DECISIONS.md`（Decision / ADR）和 `docs/project/INVARIANTS.md`（不变量；模板在 `packages/constitution/scripts/templates/INVARIANTS.md`）。允许名单之外的路径（`src/`、`packages/`、业务文件、`.superbot/ledger/`、门禁脚本）一律拒绝。默认授权仍是 observe：只记录 would-accept，`executed: false`，不写文件。真正落盘必须同时满足：`write: true`、`authority` 解析为 `execute`、工作项状态为 `Delivered`。不自动合并，不启动 Worker，不新增 `roles/cartographer.md`。
- **动态治理强度**：`planSteps` / `intensity`（`packages/constitution/src/governance.mjs`）。`governance = f(risk, reversible)` 由 Policy 决定，返回匹配规则的 `gates`、`allow`、`requireHuman`、`speak`、`merge` 和 `steps`（门禁个数）。验证信号：同一套代码换更松的策略文档，步骤数下降，而不是改代码删门。默认策略里 `auto-low`（R0/R1 可逆）是 2 步，`human-critical`（R3 / 敏感 touches）是 6 步。插件兼容路径上，`docTier=3` 对 `backend-dev` / `frontend-dev` 的硬门不要拆掉。一旦绑定 snapshot，即使步骤里没有 `docs-ready`，哈希失效仍然生效。`merge: human-only` 照常记录并执行；不要打开 auto-merge。

## 5. P5 闭环约定

- **控制台批准 / 否决**（`packages/runtime/src/loop.mjs`）：`approveDecision` 取 Capability Compiler 草稿（`compileMandate` / `compileIntent`），调用 constitution `issueMandate` 签发不可变 Mandate。`issuedBy` 必须是人的 id 或名字，缺省或 watchdog / observe / auto 来源一律拒绝。批准不得把 tools / scope / budget 扩大到草稿之外。`rejectDecision` 只在账本事件里记录否决，不签发 Mandate；若当前状态在 `PARK_FROM` 内则迁到 `Parked`。控制台不自动合并。插件 `console-model.mjs` 保持纯函数，副作用都在 runtime。
- **工作项执行权**：全局 `DEFAULT_AUTHORITY` 仍是 `observe`。人签发、仍然有效（未过期、未吊销）的 Mandate 存在后，该工作项可在 Mandate 范围内进入 execute（`canExecute` / `assertCanExecute`）。没有这样的 Mandate 不得 execute。`assign` / `consider` 不会因为 Mandate 存在就把默认改成 execute。`assertNoAutoMerge` 与 `resolveAuthority('auto-merge')` 仍抛 `AUTO_MERGE_DISABLED`。
- **工作项派单**：`dispatchWorkItem` 按工作项 / 能力态调用 `routeModel`，并返回 `assignment.create` 的隔离结构（`workDir` 仍在 `tmp/superbot/<run>/`）。不起进程，不访问网络，不改 `createModelPort()` 的 rules-only 默认。0.1.0 `superbot_dispatch`（含 `docTier=3` 对 `backend-dev` / `frontend-dev` 的硬门）保持兼容路径，行为不改。
- **Watchdog execute**：循环级 `DEFAULT_AUTHORITY` 仍是 observe。未获可用人签 Mandate 的工作项，以及 hands-off `auto`，仍只记 would-accept（`executed: false`），不吊销、不 Park、不合并。当 tick 显式带 `authority: 'execute'`，或该工作项的 `itemAuthorities` / `workItemAuthority` 为 execute，或 P6 起 `canExecute(root, item)` 允许时，超时 / 空转 / 文档漂移会真正 `revokeMandate` 并把该工作项迁到 `Parked`。未批准的兄弟项不受影响。`itemAuthorities` 可把已批准项显式覆回 observe。Halt / 超预算即使在 execute 下也只记 would-accept。漂移复用已绑定 snapshot 的哈希 stale 检查；未绑定 snapshot 时不虚构漂移失败。空转吊销原因是文档化扩展的 `timeout`；过期仍用 `expired`；漂移仍用 `snapshot-stale`。
- **状态机扩展**（有意、有测试）：Goal §5 原表只有 `AwaitingApproval` / `Building` → `Parked`。P5 增加 `Proposed`、`Authorized`、`Planned`、`Approved`、`Verifying` → `Parked`，供人否决 / 叫停与 Watchdog execute 使用。其它非法迁移仍然失败。见 `PARK_FROM` / `isLegalTransition`。
- **结果卡与合并意图**：`renderResultCard` 列出 AC、Receipt 与产物路径（支持复数，提供 ledger `root` 时可从账本加载 Receipt）。`recordMergeIntent` 只记录「合并」/「打回」意图，不执行 `git merge` / `git push`；`auto-merge` 仍抛 `AUTO_MERGE_DISABLED`。P7 的 `packages/runtime/src/git-adapter.mjs` 可对真实仓库做 `status` / `diff` / `log` / `rev-parse` / 只读 `branch`；仅当 `issuedBy` / `decidedBy` 为人时，显式调用 `applyMerge` 才会运行 `git merge`（可以快进或产生合并提交）。机器 issuer 不得合并。永不 `git push`。非 git 仓库安全失败。

## 5b. P6 现场可用

- **批准后活环**：`/superbot-decide` 在 `approveDecision` 成功之后调用 `packages/dsh-plugin/lib/live-loop-adapter.mjs`。先走 runtime `dispatchWorkItem`（`routeModel` + assignment 隔离，仍不起进程、不访问网络），再用官方 `ctx.subagents.getProvider('spawn')` + `subagents.startActivation({ provider: 'spawn', label, prompt, parent, agentPreset: 'standard', cwd?, agentOptions?, signal, delivery: 'parent' })` 启动子会话。标签带上 仓/探/作/验 与工作项 id，以便和 0.1.0 七角色 `superbot_dispatch` 子会话区分。派单正文自包含（工作项、Mandate、路由、隔离目录）。没有父代理或 `subagents` / `spawn` 时 Mandate 已签发，只回报会话未启动，不回滚批准。否决不调用 `startActivation`。不改 `superbot_dispatch`，不加公共工具，不开 HTTP，不自动合并。
- **批准后 Watchdog 循环**：同一路径接着调用 `packages/dsh-plugin/lib/watchdog-loop-adapter.mjs`：`watchdog.start({ root, authority: 'observe' })`，立即 `tick` 一次，再用宿主进程 `setInterval` 按默认 30s 循环 `watchdog.tick({ root })`。间隔可通过 `options.intervalMs` 或环境变量 `SUPERBOT_WATCHDOG_INTERVAL_MS` 配置；测试可注入调度器。调度器缺失时明确回报「循环未能武装」，不回滚 Mandate。否决不为此项启动 execute 循环；若已无 `canExecute` 项则停循环并清定时器。插件卸载（`ctx.effect` teardown）也会清定时器。
- **有限 auto-low**：当 `evalPolicy` 命中 `auto-low` 时，运行时 `dispatchAutoLow` 与插件 `applyAutoLow` 可自动 `dispatchWorkItem`，并在有父代理 / subagents 时启动 DSH 子会话。不调用 `approveDecision`，不由机器签发 Mandate。未被人批准的 auto-low 项 Watchdog 仍为 observe（只记 would-accept）。R2 / R3、敏感 touches、`requireHuman` 以及 `human-approval` 不得走此路径，仍须控制台人批。不自动合并，不 `git push`，不把默认授权改成 auto / execute。
- **正式脸谱**：`packages/dsh-plugin/assets/residents/{cang,tan,zuo,yan}/face.svg` 与 client 内联分层肖像已换成正式原创脸谱；短名、目录和 `presenceOf` 状态代号不变。动画仍只走 `.stwd-` 作用域 CSS。


## 6. P2 已接线的官方加法槽位



以下槽位已对照本机安装的 DeepSeek Harness **0.2.2-rc.2**（桌面版 `E:\\DSH`，官方契约来自 `ui-sidebar` / `ui-layout` / `ui-conversation`）核对后接入。官方加法槽都在；禁止占用的整栏 / 单例槽只避开，不改名、不发明新槽。若后续宿主版本缺失某槽，降级到仍存在的加法槽，不得改去自建页面或 HTTP 控制台。

| 位置 | 槽 | 用途 |
| --- | --- | --- |
| 左栏控制台 | `sidebar.panellist` + `main`，同一 id `ds-superbot-console` | superagent 式控制台：先「待你决定」（批准走 `/superbot-decide` → `approveDecision` 签发 Mandate，再经 live-loop 适配层 `dispatchWorkItem` + 官方 `startActivation` 启动子会话，并武装该工作项 Watchdog 循环；否决需确认后走 `rejectDecision`、不签发、不启动会话或 execute 循环），再健康 / 授权摘要（默认 observe），再单条历史 |
| 顶部迷你脸 | 优先 `conversation.session.header.corner`，否则 `utilities`；可用 `conversation.session.header.actions` 放次要计数 | 四张脸的迷你眼神条，点击打开右侧舞台 |
| 补充全屏 | `conversation.view` | 可选「舞台 / 控制台」标签，默认仍留在 Chat |
| 右侧舞台 | 现有 `sidebar.right.pane.tab`，id 仍是 `ds-superbot` | 大舞台 + 工作项详情；0.1.0 工作流树降为详情里的 DAG |
| 中栏群聊 | 原生会话 + 三种卡；输入区可用 `conversation.input.dock` 放一行字幕 | 只发结果可用 / 需要决定 / 任务失败 |

禁止注册 `sidebar` / `rightbar` / `conversation.session.header` 做整栏替换。动画只用 `.stwd-` 作用域样式 + 宿主 token + 分层 SVG，并尊重 `prefers-reduced-motion`。同一时刻最多一个高能量头像。

## 7. 目标项目账本

`.superbot/ledger/` 与 `tmp/superbot/` 属于被治理的业务仓库，不要强制提交进本仓库或目标仓库。gitignore 示例见 `docs/examples/gitignore`。

Constitution CLI：

```bash
node packages/constitution/bin/constitution.mjs --help
node packages/constitution/bin/constitution.mjs <root> workitem create --thread TH-demo --intent '…' --risk R1 --reversible --write
```

默认 dry-run，落盘加 `--write`，`--json` 保持机读结构稳定。门禁脚本仍可通过插件包根调用：`node packages/dsh-plugin/scripts/docs-ready.mjs --help`。

## 8. 发布流程

1. 更新 `packages/dsh-plugin/package.json` 的 `version`（SemVer；1.0.0 之前允许破坏性变更，但必须写进 CHANGELOG）。姊妹包版本与之对齐。
2. 把 `CHANGELOG.md` 的 `[Unreleased]` 条目移入新版本小节。
3. 面向用户的文案同步中英两份：`README.md`、`README.en.md`、`locale/{zh,en}.json`。
4. 全绿门禁：`npm run check && npm test`。
5. 提交并打标签：`git tag -a v0.2.0 -m "v0.2.0"`。
6. 装进 profile 复验：`plugin_manager(action="install_bundle", target="<repo>/packages/dsh-plugin")` → 重启 DSH → 新会话。

## 9. 排障

| 现象 | 原因 / 处理 |
|---|---|
| 装完没变化 | Host 代码要重启 DSH；技能目录是会话级快照，开新会话。确认安装路径是 `packages/dsh-plugin`，不是仓库根。 |
| 面板不出现 | 确认 `packages/dsh-plugin/package.json` 的 `dsh.client.inject` 包含 `@deepseek-ai/dsh-client-ui-settings`，且 bundle 已启用 |
| 设置页没有「Super Bot」 | 同上；`Config` 未导出或命名空间与补丁行 id 不一致也会导致 |
| `superbot_dispatch` 报 `subagents service unavailable` | 当前 profile 没有子代理服务；确认 DSH 版本满足 `dsh.engines.dsh` |
| 报 `subagent composition "standard" is not registered` | 宿主的 `standard` 组合还没加载完，稍后重试；不要改成自建组合 |
| 派发被文档硬门拒绝 | 项目 `docTier=3` 且收据缺失 / 过期：按报错提示从插件包根跑 `scripts/docs-ready.mjs` 与 `docs-review` |
| 跑脚本找不到 constitution | 必须从 monorepo 布局安装或开发：shim 通过相对路径转发到 `packages/constitution/scripts/` |
| `revalidate` 把收据标成 stale | 收据被手改，或口径文档哈希已漂移。不要手改 Receipt；重新跑门禁脚本签发。 |
