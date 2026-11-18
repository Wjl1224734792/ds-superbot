# ds-superbot 架构

产品名是 **ds-superbot**，不要用「活仓库」当对外名称。仓库是 monorepo：制度层、运行时层和交互层合在同一个产品里，不是三个插件拼盘。

红线：决定在人、操作在 AI、判定在程序。对外只有一个产品对象——工作项。

## 三层一块

1. **制度层（`packages/constitution`）**：工作项账本、Policy as Code、跨通道 Thread、动态治理强度（`planSteps`）、Claim / Evidence / Receipt、现有零依赖门禁脚本。模型越强，这一层越值钱。Constitution Service 是薄包装：调用同一套脚本、沿用退出码，再落 Receipt。手改收据无效，使用时必须重算哈希。
2. **运行时层（`packages/runtime`）**：Steward 只分派、不执行、不做判定，决策用轻量规则并预留模型接口；Capability Compiler 按工作项即时编译 Mandate 草稿（不签发）；L1 程序快筛，L2 按书面 Policy 做规则慢判；Curator 按显式字段打出 Top-K；Assignment 只描述隔离边界，计算目录固定在 `tmp/superbot/<run>/`，与 `.superbot/ledger/` 存算分离（`separate` / `assertStoragePath` / `assertComputePath`）。模型路由按「能力态 × 风险」，`modelRouting.<role>` 仅作 fallback。Event Bus 接文件型事件（`.superbot/ledger/events.jsonl`）；订阅直通只把外部信号写入账本，不授予任何新权限；Watchdog 循环跟踪进度 / 空转 / 费用。默认授权档位 observe：只记录 would-accept，不执行，不自动合并。auto 灰度必须先有对应的 would-accept 观察记录，且永远不打开 auto-merge。
3. **交互层（`packages/im` + `packages/dsh-plugin`）**：群聊是注意力总线（三种卡、PASS、Goal = 计划批准门）。DSH 原生会话是群聊主控；过程状态走顶部迷你脸、右侧舞台和左侧控制台，不走聊天。P0 实现卡片渲染、发言允许表和 `presenceOf`，并放置可区分的头像（P6 起为正式原创脸谱）；P0 **不**重做左 / 顶 / 右界面。

交互层必须走 DSH 官方加法槽位：左栏用 `sidebar.panellist` + `main` 做控制台，顶部用会话标题栏的 utilities / corner 放迷你眼神条，右侧现有 tab（id `ds-superbot`）做四张脸的舞台，中栏原生会话做成克制的群聊。禁止整栏替换 `sidebar` / `rightbar` / `conversation.session.header`，禁止自建 HTTP 控制台。细节以 `docs/product/INTERACTION.md` 为准。

## 与 0.1.0 的边界

DSH 插件继续：零运行时依赖、不注册 Preset、不自建 HTTP、原生 slot、工具名不变（`superbot_dispatch` / `superbot_board` / `superbot-roster` / `superbot`）。7 角色派单路径保留；`roles/*.md` 同时作为 Mandate 编译失败时的 fallback 模板。`docTier=3` 对 `backend-dev` / `frontend-dev` 的硬门在插件兼容路径上仍然有效。动态治理走 Constitution / Policy。

安装入口改为 `packages/dsh-plugin`。门禁脚本的 SSOT 在 `packages/constitution/scripts/`，插件 `scripts/` 只保留转发 shim。

## 能力态，不是第 8 个席位

Discover / Build / Verify 三类能力态 + 按需编译的 Mandate 草稿。Scout、Explorer、Curator、Cartographer 都是能力，不要新增 `roles/explorer.md`。仓 / 探 / 作 / 验是四张在场的脸，不是四个新角色席位。Owner / 角色 id 映射到能力态：`pm` / `architect` → Discover，`backend-dev` / `frontend-dev` → Build，`qa-engineer` / `browser-tester` / `reviewer` → Verify。Cartographer 是任务结束后只写知识库的能力，不是新的 `roles/*.md` 文件；回写由 `packages/runtime/src/cartographer.mjs` 的 `writeBack` 执行，只追加 `docs/project/DECISIONS.md` / `docs/project/INVARIANTS.md`，默认 observe 不落盘。编译器只把该能力标成 write-back-capable，自身仍只出 Mandate 草稿。编译失败时才回落到现有七份章程模板。API 在 `packages/runtime/src/compiler.mjs`（`compileMandate` / `compileIntent`）。

## 治理函数

`governance = f(risk, reversible)`，由 Policy 决定，不写死在角色章程里。`planSteps` / `intensity` 返回匹配规则的 `gates` / `allow` / `requireHuman` / `speak` / `merge` 以及由该规则得出的步骤数；改策略即可下调流程步数，不要靠删门禁实现。一旦绑定 `constitution_snapshot`，即使步骤里没有 `docs-ready`，哈希失效规则仍然生效。R0–R3 与默认 Policy 见 `docs/product/CONTRACT.md`。默认授权档位 observe，auto 自动合并不打开。auto 执行灰度（不是合并）由 `evaluateAuto` / `canEnterAuto` 判断，必须先有一条已落盘的、同一 action（及风险档，若请求带了风险）的 would-accept 记录；R2 / R3、`human-approval`、`requireHuman` 以及 touches prod / billing / delete / secrets 不得进入 auto。模型路由见 `packages/runtime/src/routing.mjs` 的 `routeModel({ capability, risk, role, config })`。P5 把控制台批准 / 否决、按工作项的 execute 授权、工作项派单和合并意图接到 `packages/runtime/src/loop.mjs`（`approveDecision` / `rejectDecision` / `canExecute` / `dispatchWorkItem` / `recordMergeIntent`）：批准用编译器草稿签发不可变 Mandate，否决不签发；全局默认仍是 observe，execute 是人批之后的按项授权；派单走 `routeModel`，不改 0.1.0 `superbot_dispatch`；合并只记账，不自动跑 git。P6 在人批准之后由插件薄适配层调用 `dispatchWorkItem` 并用官方 `subagents.startActivation` 启动子会话；`dispatchWorkItem` 本身仍不起进程。P6 起 Watchdog 对已获人批 Mandate、`canExecute` 允许的工作项按 execute 运行（循环默认仍是 observe）；未批准项与未显式授权时仍只记 would-accept。halt / 超预算即使在 execute 下也只记录。

## 注意力税

每条 Agent 消息必须自证属于：结果可用、需要决定、任务失败。否则不发。群聊不是通知渠道。在场映射的唯一实现是 `packages/im/src/presence.mjs` 的 `presenceOf`。

## 演化

固定角色与每次必出的批准门，会随模型变强而收窄；独立验证、不可变 Mandate、可重建账本、人可回滚，不会消失。
