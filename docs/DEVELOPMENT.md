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
- `packages/dsh-plugin/tests/docs-ready.test.mjs`、`docs-governance.test.mjs`：通过插件 shim 跑原脚本（退出码与 `--help` 必须与 SSOT 一致）
- `packages/constitution/tests/`：schema、状态机、Mandate、Policy、Receipt / revalidate、卡片、CLI、shim 回归
- `packages/runtime/tests/`：导出形状、L1 / curator / assignment、`NOT_IMPLEMENTED`
- `packages/im/tests/`：三种卡、发言允许表、每种状态 × 四张脸的 `presenceOf`、占位 SVG

改了 `packages/constitution/scripts/` 后，至少再跑一遍插件包路径上的 `--help` 和 docs-ready / docs-gate 用例。

## 2. 包职责

| 包 | 开发时注意 |
| --- | --- |
| `packages/dsh-plugin` | 行为保持 0.1.0 兼容。P0 不注册新的左栏主面板，不改顶部和右侧栏。`scripts/` 只是 shim。 |
| `packages/constitution` | 不要重写门禁脚本判定逻辑。落盘必须 `--write`。Receipt 手改后必须能被 `revalidate` 识破。 |
| `packages/runtime` | `bus` / `watchdog` / `subscribe` 文件头标明 `// P1: not implemented`，抛 `code = NOT_IMPLEMENTED`。 |
| `packages/im` | 面板和字幕只调用 `presenceOf`。同一时刻全场 `high` 不得超过 1 个。 |

Curator 打分权重（写在 `packages/runtime/src/curator.mjs` 的 `WEIGHTS` 常量里）：

```
score = 4 * value + 2 * (reversible ? 1 : 0) + 1 * evidenceCount - 3 * attentionCost
```

## 3. P2 才接线的官方加法槽位

P0 只把清单写入文档，不注册这些槽，以免 0.1.0 宿主测试翻车。实现前用宿主文档或 `cordis_inspect what:"client"` 核对名称；若某槽不存在，降级到仍存在的加法槽，不得改去自建页面或 HTTP 控制台。

| 位置 | 槽 | 用途 |
| --- | --- | --- |
| 左栏控制台 | `sidebar.panellist` + `main`，同一 id `ds-superbot-console` | superagent 式控制台：先「待你决定」，再健康 / 授权摘要（默认 observe），再单条历史 |
| 顶部迷你脸 | 优先 `conversation.session.header.corner`，否则 `utilities`；可用 `conversation.session.header.actions` 放次要计数 | 四张脸的迷你眼神条，点击打开右侧舞台 |
| 补充全屏 | `conversation.view` | 可选「舞台 / 控制台」标签，默认仍留在 Chat |
| 右侧舞台 | 现有 `sidebar.right.pane.tab`，id 仍是 `ds-superbot` | 大舞台 + 工作项详情；0.1.0 工作流树降为详情里的 DAG |
| 中栏群聊 | 原生会话 + 三种卡；输入区可用 `conversation.input.dock` 放一行字幕 | 只发结果可用 / 需要决定 / 任务失败 |

禁止注册 `sidebar` / `rightbar` / `conversation.session.header` 做整栏替换。动画只用 `.stwd-` 作用域样式 + 宿主 token + 分层 SVG，并尊重 `prefers-reduced-motion`。同一时刻最多一个高能量头像。

## 4. 目标项目账本

`.superbot/ledger/` 与 `tmp/superbot/` 属于被治理的业务仓库，不要强制提交进本仓库或目标仓库。gitignore 示例见 `docs/examples/gitignore`。

Constitution CLI：

```bash
node packages/constitution/bin/constitution.mjs --help
node packages/constitution/bin/constitution.mjs <root> workitem create --thread TH-demo --intent '…' --risk R1 --reversible --write
```

默认 dry-run，落盘加 `--write`，`--json` 保持机读结构稳定。门禁脚本仍可通过插件包根调用：`node packages/dsh-plugin/scripts/docs-ready.mjs --help`。

## 5. 发布流程

1. 更新 `packages/dsh-plugin/package.json` 的 `version`（SemVer；1.0.0 之前允许破坏性变更，但必须写进 CHANGELOG）。姊妹包版本与之对齐。
2. 把 `CHANGELOG.md` 的 `[Unreleased]` 条目移入新版本小节。
3. 面向用户的文案同步中英两份：`README.md`、`README.en.md`、`locale/{zh,en}.json`。
4. 全绿门禁：`npm run check && npm test`。
5. 提交并打标签：`git tag -a v0.2.0 -m "v0.2.0"`。
6. 装进 profile 复验：`plugin_manager(action="install_bundle", target="<repo>/packages/dsh-plugin")` → 重启 DSH → 新会话。

## 6. 排障

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
