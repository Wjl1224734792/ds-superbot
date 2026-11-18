# Changelog

本项目所有用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **破坏性变更（0.2.0）**：仓库重构为 monorepo。DSH 安装入口改为 `packages/dsh-plugin`（包名仍是 `ds-superbot`）。原先对仓库根执行的 `install_bundle` 需要改路径。1.0.0 之前允许破坏性变更。
- 产品定位升格为常驻工程组织：工作项是唯一对外产品对象；门禁脚本迁到 `packages/constitution/scripts/`，插件 `scripts/` 保留转发 shim，`node <插件包根>/scripts/docs-ready.mjs` 的退出码与 `--help` 不变。
- 新增姊妹包 `@ds-superbot/constitution`（账本 / Policy / Mandate / Receipt / 卡片 / CLI）、`@ds-superbot/runtime`（P0 接口；bus / watchdog / subscribe 为 `NOT_IMPLEMENTED` 占位）、`@ds-superbot/im`（三种卡、发言允许表、`presenceOf`）。
- 放入仓 / 探 / 作 / 验占位头像（`packages/dsh-plugin/assets/residents/`，资产 README 标明「占位」）。P0 不重做左 / 顶 / 右界面；P2 槽位清单见 `docs/DEVELOPMENT.md` 与 `docs/product/INTERACTION.md`。
- 文档同步更新：中英文 README、仓库根 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/product/CONTRACT.md`、`docs/product/INTERACTION.md`。插件版本 `0.2.0`。产品名保持 ds-superbot。
- 默认 Policy 将 `human-critical` 调到 `human-default` 之前（`auto-low` 仍最前），使纯 R3 与未命中 `auto-low` 的 `touches(prod|billing|delete|secrets)` 走到更严规则（含 `merge: human-only`）。R2 且未 touches 仍命中 `human-default`。

### Notes

- 0.1.0 的 7 角色派单路径、`docTier=3` 硬门、工具名与右侧 tab id `ds-superbot` 均保留。不要把「活仓库」当作产品名。
- `.superbot/ledger/` 是目标项目运行时账本，不要强制提交（见 `docs/examples/gitignore`）。
- 默认授权档位仍是 observe；本版本不打开 auto 自动合并。

## [0.1.0] - 2026-11-18

首个正式版本，同时开源发布（MIT）。DS Super Bot 是独立的 DeepSeek Harness 插件，项目 / 包名 `ds-superbot`；仓库根目录即插件包，克隆后用插件管理器 `install_bundle` 安装。

### Added

- **7 个角色章程**（`roles/*.md`）：需求分析师、架构师、后端工程师、前端工程师、测试工程师、浏览器验收员、代码评审员。角色是**派单时注入的章程**，不注册 Agent Preset，因此不会出现在模式选择器里。
- **`superbot_dispatch` 工具**：一个角色一次调用，把角色章程拼在派单正文前，通过 `ctx.subagents` 在内置 `standard` 组合上启动子会话，返回子会话 id 并自动回传结果。
- **三层模型路由**：项目根 `superbot.config.json` 的 `modelRouting.<role>` > 「设置 → Super Bot」的该角色行 > 默认行 > 继承主代理；派发前用 `llm.resolveModelInfo` 校验模型与思考强度，未知模型直接报错而不是静默降级。
- **`superbot_board` 工具**：把 `03-plan.json` 幂等同步到 Agent Teams 共享任务板（G1 计划批准门、每任务一张工作单、G2 QA 门禁、G3 终审），并提供 `sync` / `status` / `brief` 三个动作；没有启用智能体团队时明确报错并回落到单人模式。
- **右侧栏团队面板**（每会话一份）：默认分层工作流树（Lead 在左上作根，主干串起需求 → 架构 → 实施 → 质量 → 验收 → 评审，枢纽向右分叉卡片），支持自由拖拽与缩放、辐射 / 鱼骨 / 树状一键整理、图 / 列表切换、过滤与折叠；节点显示角色 / 实际模型 / 任务 / 状态 / 耗时 / tokens，点节点在右侧栏打开子会话；顶部是只给计数的原生任务进度条，底部是可折叠产物区。数据全部来自原生实时投影，不轮询任务文件、不复制任务列表。
- **设置 → Super Bot**：逐角色 provider / model / 思考强度表格 + 默认兜底行，带真实校验与来源列；配置命名空间与 Loader 行 id 同为 `superbot`。
- **13 个原生技能**：主技能 `superbot`（Tech Lead 调度手册）、文档四入口 `docs-new` / `docs-takeover` / `docs-feature` / `docs-review`、规范总库 `docs-rules`、治理增量层 `docs-governance`、按需 `inline`、路由 `using-superbot`、配置 `agent-settings`，以及 `systematic-debugging` / `tdd` / `verification-before-completion`。
- **文档就绪硬门**：`docTier=3` 时，`superbot_dispatch` 在派 `backend-dev` / `frontend-dev` 前校验 `.superbot/docs-state.json` 收据与文档哈希，未通过直接拒绝；收据只由 `scripts/docs-ready.mjs` 的 `init` / `check` / `approve` / `status` 签发。
- **文档治理增量层**：`scripts/docs-gate.mjs`（G1–G11 体积预算、frontmatter 读契约、07 分层、自动索引、ADR 双向、版本三处一致、快照完整性等）与 `scripts/doc-snapshot.mjs`（基线快照 + `history/` 哈希清单）。
- **门禁脚本**（纯 Node、零依赖）：`validate-plan.mjs`、`verify.mjs`（含 `baseline record/check`）、`run-state.mjs`、`maintain.mjs`、`take-over.mjs`、`validate-config.mjs`，以及 `scripts/doc/` 下的 `doc-init.mjs` / `doc-check.mjs` / `guard-naming.mjs`。
- **`/superbot-roster` 命令**：回显名册、子代理组合与路由口径；`/superbot` 是触发 `superbot` 技能的斜杠手势。
- **宿主契约测试**：`tests/` 下 87 例 `node:test` 用例，用假 `ctx` 驱动 `apply()`，覆盖工具注册与参数校验、章程注入、路由优先级、文档硬门、命令与技能注册、面板渲染与画板交互、设置页表格与样式作用域。

### Notes

- 运行时**零依赖**：只用 Node 内置模块；`@deepseek-ai/schemastery` 是可选 peer 依赖，用于读设置页配置。
- **偏好持久化**：面板的过滤 / 布局 / 缩放保存在浏览器本地 `ds-superbot.panel.*`，早期构建留下的旧键会在首次读取时回填到新键。
- **技能名共存**：技能名全局唯一。若同名技能已被其它插件先注册，本插件跳过该技能并打一条 warning，不影响插件加载与它独有的工具、面板。
- 不注册 Agent Preset、不注册页面、不写私有配置文件、不自建 HTTP 桥：插件只走 DSH 原生扩展点。
- 卸载插件不会删除项目里的 `superbot.config.json`、`.superbot/` 收据与 `tmp/superbot/` 产物。
- 已知边界：工具守卫走 DSH 宿主内建机制，本插件不注册 `PreToolUse` 级 hook；浏览器验收按「仓库自带 Playwright → DSH 侧栏人工驱动 → 人工兜底」三级降级。
