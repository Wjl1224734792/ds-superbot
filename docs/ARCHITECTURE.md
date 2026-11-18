# ds-superbot 架构

产品名是 **ds-superbot**，不要用「活仓库」当对外名称。仓库是 monorepo：制度层、运行时层和交互层合在同一个产品里，不是三个插件拼盘。

红线：决定在人、操作在 AI、判定在程序。对外只有一个产品对象——工作项。

## 三层一块

1. **制度层（`packages/constitution`）**：工作项账本、Policy as Code、Claim / Evidence / Receipt、现有零依赖门禁脚本。模型越强，这一层越值钱。Constitution Service 是薄包装：调用同一套脚本、沿用退出码，再落 Receipt。手改收据无效，使用时必须重算哈希。
2. **运行时层（`packages/runtime`）**：Steward 只分派、不执行、不做判定；L1 程序快筛；Curator 按显式字段打出 Top-K；Assignment 只描述隔离边界。Event Bus、Watchdog、订阅直通在 P0 导出占位，调用必须得到 `NOT_IMPLEMENTED`，不得假装成功。
3. **交互层（`packages/im` + `packages/dsh-plugin`）**：群聊是注意力总线（三种卡、PASS、Goal = 计划批准门）。DSH 原生会话是群聊主控；过程状态走顶部迷你脸、右侧舞台和左侧控制台，不走聊天。P0 实现卡片渲染、发言允许表和 `presenceOf`，并放置可区分的占位头像；P0 **不**重做左 / 顶 / 右界面。

交互层必须走 DSH 官方加法槽位：左栏用 `sidebar.panellist` + `main` 做控制台，顶部用会话标题栏的 utilities / corner 放迷你眼神条，右侧现有 tab（id `ds-superbot`）做四张脸的舞台，中栏原生会话做成克制的群聊。禁止整栏替换 `sidebar` / `rightbar` / `conversation.session.header`，禁止自建 HTTP 控制台。细节以 `docs/product/INTERACTION.md` 为准。

## 与 0.1.0 的边界

DSH 插件继续：零运行时依赖、不注册 Preset、不自建 HTTP、原生 slot、工具名不变（`superbot_dispatch` / `superbot_board` / `superbot-roster` / `superbot`）。7 角色派单路径保留；`roles/*.md` 同时作为 Mandate 编译失败时的 fallback 模板。`docTier=3` 对 `backend-dev` / `frontend-dev` 的硬门在插件兼容路径上仍然有效。动态治理走 Constitution / Policy。

安装入口改为 `packages/dsh-plugin`。门禁脚本的 SSOT 在 `packages/constitution/scripts/`，插件 `scripts/` 只保留转发 shim。

## 能力态，不是第 8 个席位

Discover / Build / Verify 三类能力态 + 按需编译的 Mandate。Scout、Explorer、Curator、Cartographer 都是能力，不要新增 `roles/explorer.md`。仓 / 探 / 作 / 验是四张在场的脸，不是四个新角色席位。

## 治理函数

`governance = f(risk, reversible)`。R0–R3 与默认 Policy 见 `docs/product/CONTRACT.md`。默认授权档位 observe，auto 不在 P0 打开。

## 注意力税

每条 Agent 消息必须自证属于：结果可用、需要决定、任务失败。否则不发。群聊不是通知渠道。在场映射的唯一实现是 `packages/im/src/presence.mjs` 的 `presenceOf`。

## 演化

固定角色与每次必出的批准门，会随模型变强而收窄；独立验证、不可变 Mandate、可重建账本、人可回滚，不会消失。
