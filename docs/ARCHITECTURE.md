# 架构

DS Super Bot 是一个**单包两半**的 DSH 插件：Host 半（`index.js`）负责注册与执行，Client 半（`client.js`）负责界面。两半都只使用 DSH 原生扩展点，没有构建步骤、没有运行时依赖、没有私有服务。

## 1. 设计目标

1. **流程即产品**：价值在「计划门 → 派单 → QA → 验收 → 终审」这条链，而不是一个能写代码的模型。角色是**派单时注入的章程**，不是用户可切换的模式。
2. **配置跟仓库走**：子代理模型的第一来源是项目根 `superbot.config.json`，它跟代码一起进同一个 diff、可评审可回滚；设置页只是兜底。
3. **进度用原生系统**：任务状态由 DSH 原生任务列表 / Agent Teams 任务板负责，插件只做计数，不复制任务列表。
4. **门禁是代码不是提示词**：文档就绪、计划校验、基线守卫都由脚本判定，AI 无法用一句「已经检查过了」绕过。

## 2. 包结构

```text
package.json  ── dsh.bundle.patch ──▶ cordis.patch.yml ──▶ 一行 Host（id: superbot）
      │                                   │
      │ dsh.client                        └─ name: ds-superbot → index.js
      ▼
client.js（Web 端模块，由 DSH 模块加载器加载）
```

| 文件 | 角色 |
|---|---|
| `index.js` | 导出 `Config`、`inject`、`apply(ctx, config)`；注册工具、命令、技能 |
| `client.js` | 通过 `window.__ModuleLoader__.load({ id: 'ds-superbot', factory })` 注册槽位 |
| `cordis.patch.yml` | bundle 补丁，插入 Host 行；行 id 必须等于 `index.js` 的 `CONFIG_NS`（`superbot`） |
| `package.json` | `dsh.bundle` / `dsh.client` / `exports` / `files`；`dsh.client.inject` 声明依赖的客户端设置包 |

## 3. 扩展点映射

### Host 半（`index.js`）

| DSH 扩展点 | 用法 | 位置 |
|---|---|---|
| `export const Config` | Schemastery 配置：`defaults` + 每个角色一组 `provider` / `model` / `effort` | `Config` |
| `export const inject` | 声明依赖 `tools` | 文件末尾 |
| `ctx.get('tools')` + `ctx.effect(tools.register(...))` | 注册 `superbot_board`、`superbot_dispatch` | `defineSuperBotTools` |
| `ctx.inject(['commands'])` | 注册 `/superbot-roster` | `registerCommands` |
| `ctx.inject(['skills'])` | 注册 13 个技能（`ctx.skills.register`） | `registerSkills` |
| `ctx.get('subagents')` + `getProvider('spawn')` + `startActivation` | 起子会话，pin 在内置 `standard` 组合 | `superbot_dispatch` |
| `ctx.get('agentPresets').resolve('standard')` | 派发前确认子组合可用（拿不到该服务时跳过） | `assertChildPresetReady` |
| `ctx.get('llm').resolveModelInfo` | 校验 provider/model/effort 组合，返回思考强度集合 | `resolveRoute` |
| `ctx.get('agentTeams')` | 共享任务板：`sync` / `status` / `brief` | `superbot_board` |
| `ctx.get('settings').describe()` | 读设置页里该命名空间的当前值，作为路由的第二层 | `readPanelRoute` |
| `ctx.get('workingDirectory').ensure` | 把相对 `cwd` 解析成真实工作目录 | `resolveBaseDir` |

### Client 半（`client.js`）

| 槽位 / 服务 | 用法 |
|---|---|
| `settings.section` | 「设置 → Super Bot」分区：逐角色模型与思考强度表格（`ctx.configForms.get('superbot')`） |
| `sidebar.right.pane.tab` | 右侧栏面板主体（`id: ds-superbot`；旧布局用的 `dsh-steward` 身份注册为兼容别名，同一个组件） |
| `sidebar.right.pane.tab.title` | 面板标题栏 |
| `conversation.session.header.utilities` | 会话标题栏的 Super Bot 图标（`right.openTab('superbot')`） |
| `sidebar.right.pane.tab` 的 guide | 右侧栏引导页里的「Super Bot 团队」入口 |
| `useSessionStatus` / `subagentCatalog` / `modelSelection` / `tokenUsage` / `subagentTiming` / `sessionStats` / `agentTeam` / `todos` | 面板数据来源（原生实时投影，非轮询） |
| `remote` / `remote.session`（workspace-files） | 读 `tmp/superbot/<run>/` 产物，15s 轮询一次 |

## 4. 派发流程（`superbot_dispatch`）

```text
superbot_dispatch(role, description, prompt, cwd?)
   │
   ├─ 1. 校验 role ∈ 7 个角色；description 非空；parent agent 存在
   ├─ 2. 解析 baseDir（workingDirectory.ensure，失败退回 process.cwd()）
   ├─ 3. 文档硬门：role ∈ {backend-dev, frontend-dev} 且项目 docTier=3
   │      → 读 <root>/.superbot/docs-state.json，跑 checkReadiness({root, gate:'dev'})
   │      → 缺失 / 未批准 / stale 一律拒绝，并给出下一步命令
   ├─ 4. 解析模型路由（见 §5），用 llm.resolveModelInfo 校验
   ├─ 5. assertChildPresetReady：确认 standard 组合可用
   ├─ 6. 拼任务正文 = 角色章程 + 「# 本次任务（派单正文）」 + prompt
   ├─ 7. subagents.startActivation({ composition: 'standard', label: '<role> · <description>', ... })
   └─ 8. 返回子会话 id；子代理完成后把最终结果作为完成通知回传
```

要点：

- **章程来自磁盘**：`roles/*.md` 在首次使用时读取并缓存（CRLF 归一），frontmatter 与构建横幅被剥掉。
- **label 前缀**：`角色 · 任务`，右侧栏面板据此把子代理映射到角色节点。
- **不注册 Agent Preset**：`standard` 是宿主内置组合，插件只挑选，不定义。

## 5. 模型路由解析顺序

```text
1. <project>/superbot.config.json 的 modelRouting.<role>      ← 仓库优先
2. 设置 → Super Bot 里该角色的 provider/model/effort          ← 机器本地
3. 设置 → Super Bot 的 defaults 行
4. 继承主代理当前路由
```

- 项目根由 `cwd` 上溯查找（找到含 `superbot.config.json` 的目录即停）。
- 路由项必须是 `provider + model` 成对；`effort` 必须在该模型真实支持的集合里，否则派发失败。
- `validate-config.mjs` 可在 CI / 交付前对 `superbot.config.json` 做结构机检。

## 6. 文档就绪硬门

状态文件：`<root>/.superbot/docs-state.json`（由 `scripts/docs-ready.mjs` 读写；`scripts/lib/docs-state.mjs` 提供 `readState` / `checkReadiness` 供 `index.js` 复用，保证「脚本判定」与「派发判定」是同一份逻辑）。

| 阶段 | 命令 | 结果 |
|---|---|---|
| 声明范围 | `docs-ready.mjs <root> init --scope new\|takeover\|feature --write` | 写初始状态（scope、阶段清单） |
| 闭环机检 | `docs-ready.mjs <root> check [--plan ...] [--strict]` | 产物缺失 / 空壳 / 占位符 / `na` 理由 / 追溯 / 计划 `docsRead` 逐项判定 |
| 评审 | `docs-review` 技能（reviewer 全新实例） | 结论落 `docs/07-治理/评审记录/` + 机读块 |
| 签发 | `docs-ready.mjs <root> approve --review <记录>` | 写 `ok` + `review.status = approved` + 文档哈希 |
| 失效 | 任一被哈希文档改动 | `checkReadiness` 发现哈希不匹配 → stale → 拒绝派开发 |

只有 `backend-dev` / `frontend-dev` 受门禁约束；`architect`、`pm`、`reviewer`、`qa-engineer`、`browser-tester` 始终可派，留出「补文档、评审、写方案」的余地。手改收据无效——派发时会重新计算哈希。

## 7. 共享任务板同步

`superbot_board(action="sync")` 把 `03-plan.json` 投影成原生任务板上的任务，靠描述里的标记做幂等匹配：

| 标记 | 含义 |
|---|---|
| `superbot:plan=<plan>` | 该任务来自哪份计划 |
| `superbot:gate=G1\|G2\|G3` | 门禁任务 |
| `superbot:role=<role>` | 工作单负责角色 |

- 板上依赖：所有工作单依赖 G1（计划批准），G2（QA）依赖全部工作单，G3（终审）依赖 G2——流程顺序由原生依赖闸门保证，claim 不上就是没到。
- 没有 `agentTeams` 服务时工具直接报错，不静默降级；单人模式继续用 `superbot_dispatch` + `run.json`。

## 8. 面板数据流

```text
DSH 会话 ── 原生投影 ──▶ client.js ──▶ 右侧栏面板
  subagentCatalog     子代理 → 角色 / 任务（label 解析）
  useSessionStatus    running / pendingInteraction（等待输入泳道）
  modelSelection      实际模型（lastUsed，否则 next）
  tokenUsage          四类 token
  subagentTiming      用时 / 是否正常收尾
  sessionStats        轮次 / 步骤（点开详情时按需请求）
  agentTeam | todos   任务进度（只读计数）
  workspace-files     产物列表（15s 轮询，默认折叠）
```

面板**不读** `03-plan.json` 的任务内容，也不复制任务列表；任务的权威来源是原生任务系统。

## 9. 状态与文件

| 路径 | 谁写 | 说明 |
|---|---|---|
| `<project>/superbot.config.json` | 人或 agent（版本化） | 项目级配置：`modelRouting`、`docTier`、`execution.mode` 等 |
| `<project>/.superbot/docs-state.json` | `docs-ready.mjs` | 文档就绪收据（哈希 + 评审结论） |
| `<project>/tmp/superbot/<run>/` | 子代理产出 | 运行产物：`run.json`、`03-plan.json`、报告与证据 |
| 浏览器 localStorage | 面板自己 | `ds-superbot.panel.filters` / `.positions` / `.camera`（纯显示状态）；旧键 `dsh-steward.panel.*` 只读回填一次 |

## 10. 安全与边界

- **不注册 Agent Preset**：没有可切换的专员模式，流程不可被「切模式」绕开。
- **不注册页面、不自建 HTTP 桥、不写私有配置文件**：所有 UI 走原生 slot，所有配置走原生 Config 或项目文件。
- **零运行时依赖**：只用 Node 内置模块；`@deepseek-ai/schemastery` 是可选 peer，缺失时插件仍能加载（配置层级降级）。
- **门禁不可手改**：收据由脚本签发，派发时重新计算哈希。
- **卸载插件不删项目数据**：`superbot.config.json`、`.superbot/`、`tmp/superbot/` 留在项目里，方便回滚与审计。
