# DS Super Bot · 长期维护型研发团队（DeepSeek Harness 插件）

DS Super Bot 是给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的多角色研发团队插件：主对话代理担任 **Tech Lead**，把需求拆成任务 DAG，按「依赖 + 文件所有权」把任务派给对应角色的子代理，走完计划批准门、QA、浏览器验收与终审才交付。

目标不是「一次把代码写完」，而是让项目在每次变更后仍然**可理解、可验证、可回滚、可继续演进**。

| 项目 | 值 |
|---|---|
| 版本 | 0.1.0 |
| 项目 / 包名 | `ds-superbot` |
| 许可 | MIT |
| 运行时依赖 | 无（只用 Node 内置模块；`@deepseek-ai/schemastery` 是可选的 peer 依赖） |
| DSH 版本 | `>=0.2.1-rc.2 <0.4.0-0` |

插件只使用 DSH 原生扩展点：角色 = **派单时注入的章程**（`roles/*.md`，**不注册 Agent Preset**，因此不占模式选择器）；模型路由 = 项目根 `superbot.config.json` 优先、其次**设置页**；派发 = `superbot_dispatch` over `ctx.subagents`（子代理跑内置 `standard` 组合）；人类入口 = `/superbot-roster` 原生命令（`/superbot` 是触发 `superbot` 技能的斜杠手势）；技能 = `ctx.skills`；界面 = **每会话一份的右侧栏团队面板** + **设置 → Super Bot 的模型表格**，不注册页面、不写私有配置、不自建 HTTP 桥。

## 安装

前置：本机装有 DSH（`0.2.1-rc.2` 及以上、`0.4.0` 以下）与 Node.js。

本仓库根目录就是插件包本身（`index.js` / `client.js` / `cordis.patch.yml` / `package.json` 都在根部）。用 DSH 插件管理器安装本地 bundle 目录：

```text
plugin_manager(action="install_bundle", target="<本仓库检出目录>")
```

装完**重启 DSH**（Host 代码只在启动时加载），再开**新会话**使用——技能目录是会话级快照，旧会话可能仍显示上一版文案。

- 升级 = 对同一目录重新 `install_bundle` 并重启；开发期热重载可用插件管理器的禁用 / 启用。
- 卸载 = 插件管理器里移除该 bundle。
- 该目录不需要运行任何构建或安装脚本。

## 安装后你会得到

| 能力 | 形态 |
|---|---|
| 7 个角色 | 派单时注入的角色章程（`roles/*.md`）：`pm`、`architect`、`backend-dev`、`frontend-dev`、`qa-engineer`、`browser-tester`、`reviewer`。**不注册 Agent Preset**——角色不会出现在模式选择器里 |
| 派发 | `superbot_dispatch(role, description, prompt, cwd?)`：一个角色一次调用，章程自动拼进派单正文，返回子会话 id，结果自动回传 |
| 模型与档位 | 项目根 `superbot.config.json` 的 `modelRouting.<role>`（仓库优先，跑 `scripts/validate-config.mjs` 机检）；没写的角色用**设置 → Super Bot** 里的该角色 / 默认配置；都没有则继承主代理 |
| 右侧栏团队面板 | 每会话一份，三种打开方式（会话标题栏的 Super Bot 图标 / 右侧栏引导页 / 首次派发自动打开）：分层工作流树、自由拖拽缩放、图 / 列表可切；节点带角色 / 实际模型 / 任务 / 状态 / 耗时 / tokens；顶部是**原生任务进度条**；底部是可折叠产物区 |
| 主技能 | `superbot`：Tech Lead 调度手册（定级 / DAG / 派单 / 门禁 / 收尾） |
| 文档入口（4 个） | `docs-new`（新建项目，01→07 建基线）、`docs-takeover`（接手存量，先盘点落位再补）、`docs-feature`（单个功能 / 需求变更，只改受影响阶段）、`docs-review`（派 reviewer 独立评审 + 签发收据） |
| 文档规范总库 | `docs-rules`：七阶段规范正文、SSOT 地图、变更联动表、模板索引（**不是入口**） |
| 文档就绪硬门 | `scripts/docs-ready.mjs`：阶段产物 / 空壳 / 占位符 / `na` 理由 / FR↔FP 追溯 / 计划 `docsRead` / 评审机读结论逐项机检；收据 `.superbot/docs-state.json` 通过后 `backend-dev` / `frontend-dev` 才允许派发 |
| 按需技能 | `inline`（主代理自己动手时的硬动作与范围）、`docs-governance`（文档拆分 / 归档 / 版本快照与 `docs-gate` / `doc-snapshot` 门禁的增量层） |
| 配套技能 | `using-superbot`（路由）、`agent-settings`（模型配置）、`systematic-debugging`、`tdd`、`verification-before-completion` |
| 共享任务板 | `superbot_board(action="sync"/"status"/"brief")`：把 `03-plan.json` 变成 Agent Teams 板上的门禁 + 工作单；任务状态在**原生 Team 面板**里看，右侧栏团队面板只显示进度计数与来源 |
| 命令 | `/superbot-roster`：回显名册与路由口径（不负责派活）；`/superbot` 是触发 `superbot` 技能的斜杠手势 |
| 门禁脚本 | `scripts/`：`validate-plan.mjs`、`verify.mjs`（含 `baseline record/check`）、`run-state.mjs`、`maintain.mjs`、`take-over.mjs`、`validate-config.mjs`、`docs-ready.mjs`（文档就绪收据）、`docs-gate.mjs` / `doc-snapshot.mjs`（文档治理），以及 `doc/` 文档流水线工具 |

## 为什么不注册模式（Agent Preset）

DSH 里 preset 就是**用户可选的会话模式**，没有「内部 preset」这种东西。把 7 个角色做成 preset，等于把「后端工程师」这类**可写的专员模式**摆进选择器：用户切过去随手改代码，就得到一个绕开计划门、基线守卫、QA 与终审的假团队——正好把本插件唯一的价值（流程与门禁）绕掉。

所以本插件不注册任何 Agent Preset：DS Super Bot 是一套流程（技能 + 工具 + 门禁脚本），`superbot_dispatch` 让子代理跑在 DSH 内置的 `standard` 组合上，把该角色的**章程**拼在派单正文前面。代价是工人拥有 `standard` 的全套原生工具（委派深度默认 1，会挡住「工人再派工」），收益是模式选择器干净、也没有一套要和 DSH 升级同步的 preset 组合要维护。

## 快速开始

1. 按上文装好并重启 DSH，新开一个会话。
2. 直接用自然语言提需求：

   ```text
   用 Super Bot 给 tmp/demo 写一个金额汇总脚本，带单测并跑绿
   ```

   主代理会加载 `superbot` 技能：受理定级（S/M/L）→ 需求澄清 → 任务 DAG + 文件所有权 → 派子代理 → QA → 浏览器验收 → 终审 → 汇报。

3. 需要换子代理模型：在项目根写 `superbot.config.json` 的 `modelRouting`（或直接说「配置子代理模型」，主代理会加载 `agent-settings` 技能来改并跑 `validate-config.mjs`）。下一次 `superbot_dispatch` 立即使用新路由，不需要重启。

## 入口与模式

| 想做什么 | 怎么说 |
|---|---|
| 功能交付 | 「用 Super Bot 做 <需求>」→ 六阶段 + 计划批准门 |
| 直接执行（inline） | 「你直接做 / 别派子代理」→ 限 S / B3 / 维护小修；M 需显式要求；L 与 B0/B1/B2 禁止 |
| Bug 修复 | 「修这个 Bug / 这个功能坏了」→ B0–B3 分流 |
| 只出计划 | 「只出方案，先别写代码」→ 到批准门停止，不实施 |
| 维护循环 | 「做一次维护扫描」→ 八类扫描 + 评分 backlog + 小修 |
| 接手存量 | 「接手这个仓库，先盘点再动手」→ T1 项目记忆 + 首轮健康扫描 |
| 新建项目文档 | 「新建项目 / 初始化七阶段文档」→ `docs-new`：01→07 建基线，审查通过后签发收据 |
| 接手存量文档 | 「接手这个仓库 / 存量项目补文档」→ `docs-takeover`：先盘点落位，再按缺口补齐 |
| 单个功能文档 | 「给这个功能写文档 / 这个需求要动哪些文档」→ `docs-feature`：影响面 → 只改受影响阶段 |
| 审查文档 | 「审查文档 / 文档齐了吗 / 能不能开工」→ `docs-review`：reviewer 全新实例评审 → 评审记录 → `approve` |
| 文档规范与模板 | 「PRD/FRD/契约怎么写」→ `docs-rules`（总库，不是入口） |
| 文档治理 | 「文档太长了 / 评审堆在 07 / 需求文档要留版本」→ `docs-governance`：拆分、归档、`history/` 快照、`docs-gate` / `doc-snapshot` |
| 改模型 / 档位 | 「配置子代理模型」→ `agent-settings`：改项目根 `superbot.config.json` 的 `modelRouting` 并跑 `validate-config.mjs` |
| 不知道用哪个入口 | 加载 `using-superbot` 做路由 |

## 角色名册

| 角色 | `role` | 职责 |
|---|---|---|
| 需求分析师 | `pm` | 模糊需求 → 可测规格 |
| 架构师 | `architect` | 规格 → 技术方案 + 任务 DAG |
| 后端工程师 | `backend-dev` | 按任务单 TDD 实施 |
| 前端工程师 | `frontend-dev` | UI 实施 + 验收脚本 |
| 测试工程师 | `qa-engineer` | 测试 / lint / typecheck 质量门 |
| 浏览器验收员 | `browser-tester` | 真实浏览器黑盒验收 |
| 代码评审员 | `reviewer` | 终审 diff，三级意见 |

## 模型路由

```json
{
  "modelRouting": {
    "reviewer": { "model": "provider/strong-model", "effort": "high" },
    "qa-engineer": { "model": "provider/fast-model" }
  }
}
```

优先级：**项目根 `superbot.config.json` 的 `modelRouting.<role>` > 设置 → Super Bot 里该角色 > 设置页默认行 > 继承主代理**。

- `superbot_dispatch` 按派单的 `cwd` 上溯找项目根并读取项目配置，下次派发即生效（不需要重启）。
- 派发前会用 `llm.resolveModelInfo` 校验模型与档位；模型不存在或档位不支持会直接报错，不会静默降级。
- 格式错误（如 `model` 少了 `provider/` 前缀）按「没有配置」处理，落到继承主代理。
- 结构机检：`node <包>/scripts/validate-config.mjs <项目根>/superbot.config.json`。

## 右侧栏团队面板

面板在会话的**右侧栏**里。DSH 的右侧栏本身按会话保存布局，所以**每个会话各开各的面板，切换会话就是切换面板**。打开方式三种：

1. 会话标题栏的 **Super Bot 图标**（`conversation.session.header.utilities`）；
2. **右侧栏引导页**（guide）里的「Super Bot 团队」入口；
3. **自动打开**：该会话第一次出现 Super Bot 派发（label 形如 `backend-dev · T1 导出接口`）时自动打开一次；用户手动关掉后不再抢回。

**升级兼容**：重命名前保存的右侧栏布局仍能打开面板（旧的标签页身份被注册为兼容别名）；旧的过滤 / 布局 / 缩放偏好也会在首次读取时迁移到新键，不丢现场。

**面板只回答一件事：哪个智能体、用什么模型、在做什么、到哪了。** 自上而下三块：

1. **任务进度条（原生任务）**：一行 `完成/总数` + 每任务一段（完成绿 / 进行中蓝呼吸 / 待开始灰 / 被阻塞橙）+ 进行中/被阻塞计数 + 来源（`Agent Teams 任务板` 或 `会话任务列表`）。**只给计数，不列任务名**——要读任务请用 DSH 自带的列表 / 原生 Team 面板。
2. **工作流画板（默认分层树，自由拖拽 + 缩放）**：`Lead · 本会话` 在左上作根，主干串起需求 → 架构 → 实施 → 质量 → 验收 → 评审各枢纽（没有智能体的阶段自动省略），每个枢纽向右分叉出该阶段的卡片。工具栏可一键整理为辐射 / 鱼骨 / 树状，整理后仍可自由拖拽；连线是 Lead → 每个子代理，无箭头。每个节点一屏可读：角色 / **实际模型**（`model @ 思考强度`，没发过请求时显示「模型待定」，不编造）/ 任务描述 / 状态 / 用时 / tokens。点节点主体在右侧栏打开该子代理会话，点右下角 `⌄` 原地展开详情（提供方 / 思考强度 / 四类 token / 轮次·步骤 / 模式 / 子会话 id）。
3. **产物区（默认折叠）**：`tmp/superbot/<run>/` 下的文件（`run.json`、`03-plan.json`，以及 `reports/`、`evidence/` 里的报告与证据），点一行在右侧栏打开文件。

面板的数据全部来自原生实时投影，不轮询任务文件：

| 面板里看到的 | 来源（DSH 原生） |
|---|---|
| 子代理清单 / 角色 | `subagentCatalog` 投影（label = `角色 · 任务`） |
| 运行中 / 等待输入 | 会话 UI 状态（`running` / `pendingInteraction`） |
| 实际模型 | `modelSelection` 投影（`lastUsed`，否则 `next`） |
| tokens | `tokenUsage` 投影 |
| 用时 / 是否正常收尾 | `subagentTiming` 投影 |
| 轮次 / 步骤（详情） | `sessionStats` 投影 |
| 任务进度 | `agentTeam` 投影，没有则 `todos` 投影 |
| 产物 / 运行目录 | workspace-files Remote，15s 轮询一次 |

面板**不读** `03-plan.json` 的任务内容、**不画**任务依赖图、**不复制**任务列表：任务状态由 DSH 原生任务系统负责。读不到产物时产物区显示一行说明，其余照常。

**设置页只留模型**：「设置 → Super Bot」分区只渲染逐角色模型与思考强度表格（角色 / 提供方 / 模型 / 思考强度 / 来源 + 默认兜底行 + 保存 / 撤销）。

## 共享任务板（Agent Teams）

宿主启用「智能体团队」后，共享任务板是任务状态的**权威来源**；**会话页头的原生 Team 面板**是读任务详情的地方。`superbot_board(action="sync", plan="<工件>/03-plan.json", level="M")` 把计划变成板上的原生任务（幂等，按描述里的 `superbot:plan=` / `superbot:gate=` 标记匹配）：

| 板上任务 | 来源 | 在原生 Team 面板里能看出什么 |
|---|---|---|
| `G1 · 计划批准` | 门禁 | 未完成时所有工作单 claim 不上（原生依赖闸门，绕不过去） |
| `T<id> · <role> · <标题>` | `03-plan.json` 的 tasks | 状态点、负责人、依赖、就绪态；写范围来自文件所有权，重叠会出告警 |
| `G2 · QA 门禁` / `G3 · 终审` | 门禁 | 依赖全部工作单 / 依赖 QA，流程顺序在板上一目了然 |

- 派活：`superbot_board(action="brief", role="backend-dev", task="T1")` 取自包含任务书 → `spawn_teammate` → `team_task_update(action="reassign", owner=<teammate>)`；teammate 先 claim 再动手。
- 没启用团队时没有 `agentTeams` 服务，`superbot_board` 直接报错，回到 `superbot_dispatch` + `run.json` 的单人模式。

## 文档流水线与开发硬门（docTier=3）

文档不是一个「全走」的技能：按场景分成三个入口 + 一个审查入口，规范与模板单独成库。

| 你说的 | 加载 | 管到哪 |
|---|---|---|
| 新建项目 / 从零搭文档基线 | `docs-new` | 01-需求（PRD→FRD）→ 02-架构 → 03-契约（+05-页面）→ 06-测试基线 → 07-治理件 → 闭环 → 审查 → 收据 |
| 接手存量仓库 | `docs-takeover` | `take-over.mjs` 生成 T1 → 盘点与落位映射（需拍板）→ `docs-gate --baseline-write` 记基线 → 按缺口补齐 |
| 单个功能 / 需求变更 | `docs-feature` | 影响面扫描 → 打包需拍板项 → 只改受影响的阶段（其余 `na` + 理由）→ 联动表同批落档 |
| 审查 / 能不能开工 | `docs-review` | reviewer 全新实例（干净上下文、只读）→ 结论落 `docs/07-治理/评审记录/` + 机读块 → `approve` |

**硬门不是提示词**：`superbot.config.json` 配了 `docTier: 3` 后，`superbot_dispatch` 在派 `backend-dev` / `frontend-dev` 前会校验 `.superbot/docs-state.json` 的收据与文档哈希，未通过直接拒绝（`architect` / `reviewer` / `qa-engineer` / `browser-tester` 不受限，留人补文档与评审）。收据只由脚本签发：

```bash
node scripts/docs-ready.mjs <root> init --scope new|takeover|feature --write   # 声明范围
node scripts/docs-ready.mjs <root> check [--plan <03-plan.json>] [--strict]    # 闭环机检
node scripts/docs-ready.mjs <root> approve --review <评审记录>                  # 签发收据
node scripts/docs-ready.mjs <root> status                                      # 现状（含 stale）
```

判据与错误码（`E-DOC-MISSING` / `E-DOC-PLACEHOLDER` / `E-DOC-THIN` / `E-NA-REASON` / `E-PLAN-DOCSREAD` / `E-PLAN-NA-CONFLICT` / `E-STATE-STALE` / `E-REVIEW-*`）都在 `docs-ready --help` 与 `docs-rules` 技能里。口径类文档（PRD / FRD / 架构 / 契约 / 页面 / 测试方案）改一次收据即失效；`执行步骤.md`、`评审状态.md`、`评审记录/` 已从哈希里排除，日常销项不会触发重审。

**回滚**：把 `docTier` 改回 1/2 即关闭整套门禁（不需要改代码）。

## 仓库结构

```text
.
├── index.js              # Host 半：Config、superbot_dispatch / superbot_board、/superbot-roster、技能注册
├── client.js             # Client 半：右侧栏团队面板 + 设置页模型表格
├── cordis.patch.yml      # bundle 补丁：一行 Host（id = superbot）
├── package.json          # 包清单（dsh.bundle / dsh.client / exports）
├── icon.svg              # 插件图标
├── locale/{zh,en}.json   # 插件标题与简介（插件页展示）
├── roles/                # 7 个角色章程 + manifest.json（派单时注入）
├── skills/               # 13 个原生技能 + manifest.json
├── scripts/              # 门禁 / 文档流水线脚本（纯 Node、零依赖）
├── tests/                # 宿主契约测试（node:test，驱动假 ctx）
└── docs/                 # 本项目的开发文档
```

## 开发与测试

```bash
node --check index.js && node --check client.js   # 语法
node --test tests/                                # 宿主契约测试（86 例）
npm test                                          # 等价于上面这行
```

测试用假 `ctx` 驱动 `apply()`，覆盖：工具注册与参数校验、角色章程注入、模型路由优先级、文档就绪硬门、命令 / 技能注册、客户端面板渲染与画板交互、设置页表格、样式作用域等。细节见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 排障

- **`/superbot` 回显的是名册而不是技能正文**：名册命令是 `/superbot-roster`，`/superbot` 是触发 `superbot` 技能的斜杠手势；若仍回显名册，说明装的是别的版本，重新 `install_bundle` 并重启 DSH。
- **`/superbot` 手势没触发技能**：手势要求 `/superbot` 后接空格（或直接回车），连写（如 `/superbot做个X`）不识别为手势；用自然语言「用 Super Bot 做 <需求>」最稳。
- **装完没变化**：Host 代码在 DSH 重启后才加载；技能目录是会话级快照，开**新会话**；开发期可用插件管理器的禁用 / 启用热重载。
- **模型路由不生效**：`superbot.config.json` 的 `modelRouting.<role>` 格式错误按「没配置」处理、降级继承主代理；跑 `validate-config.mjs` 校验结构。
- **`superbot_board` 报错「Agent Teams 未启用」**：这是可选能力；单人模式继续用 `superbot_dispatch` + `run.json`，或到插件页启用「智能体团队」后刷新页面。

## 更多

- 架构与扩展点：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 开发与发布：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)
- English: [README.en.md](README.en.md)
- License: MIT
