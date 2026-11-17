# 开发与发布

## 1. 环境

| 依赖 | 要求 |
|---|---|
| Node.js | `>=20`（仓库在 Node 26 上开发与验证） |
| DSH | `>=0.2.1-rc.2 <0.4.0-0`（`package.json` 的 `dsh.engines.dsh`） |
| 构建 | 无。仓库根目录就是可安装的插件包，不存在构建步骤或生成物 |

运行时零依赖，`npm install` 不是必需动作；只有可选 peer `@deepseek-ai/schemastery` 在 DSH 环境里由宿主提供。

## 2. 本地开发循环

```bash
# 1. 装进当前 DSH profile（指向本仓库根目录，不是子目录）
#    在 DSH 里执行：plugin_manager(action="install_bundle", target="<本仓库绝对路径>")

# 2. 改代码后按需热重载：
#    - 只改 client.js：插件管理器禁用 → 启用，刷新页面即可看到新界面
#    - 改 index.js / 补丁：重启 DSH（Host 代码只在启动时加载）

# 3. 技能目录是会话级快照：验证技能文案要开新会话
```

验证顺序建议：`node --check` → `node --test tests/` → 装进 profile 实际点一遍面板 → 新会话跑一次派发。

## 3. 测试

```bash
node --test tests/          # 86 例
npm test                    # 同上
```

| 文件 | 覆盖 |
|---|---|
| `tests/dsh-plugin.test.mjs` | 宿主契约：`Config` 形状、两个工具的参数校验与执行、角色章程注入、路由优先级、文档硬门、`/superbot-roster`、技能注册、client 面板渲染 / 画板交互 / 设置页表格 / 样式作用域 |
| `tests/docs-ready.test.mjs` | `scripts/docs-ready.mjs` 的端到端行为（init / check / approve / status、错误码） |
| `tests/docs-governance.test.mjs` | `scripts/docs-gate.mjs` 与 `scripts/doc-snapshot.mjs` 的门禁与快照行为 |

测试用**假 `ctx`** 驱动 `apply()`，并用假的客户端模块加载器执行 `client.js` 的工厂函数，因此不需要启动 DSH 就能覆盖绝大部行为。写新用例时沿用同一个 `boot()` 夹具，不要另起一套。

## 4. 新增一个角色

1. 在 `roles/` 下新建 `<role-id>.md`，写 frontmatter（`name`、`description`）与章程正文。
2. 在 `roles/manifest.json` 追加一条 `{ id, name, description, path }`。
3. 如需模型路由，在 `superbot.config.json` 的 `modelRouting.<role>` 里登记（可选）。
4. 在 `client.js` 的 `ROLES` 常量里补一条（面板要用中文名 / 英文名渲染角色）。
5. 跑 `node --test tests/`：章程注入与角色枚举都有断言，漏改会直接失败。

注意：新增角色**不要**注册 Agent Preset；工具参数里的 `role` 枚举来自 `roles/manifest.json`。

## 5. 新增一个技能

1. 在 `skills/<skill-name>/SKILL.md` 写正文（frontmatter 至少 `name` + `description`）。
2. 在 `skills/manifest.json` 的 `skills` 数组追加 `{ name, description, path, dir }`。
3. 跑 `node --test tests/`：会校验技能名与命令名不冲突、清单与目录一致。

技能名是用户在会话里 `加载 xxx 技能` 的入口，**改名等于破坏兼容**；新增技能优先，改名要写进 CHANGELOG。

## 6. 改界面（`client.js`）

- 只用原生槽位：`settings.section`、`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`conversation.session.header.utilities`。
- 样式必须作用域化（`.stwd-` 前缀）并只用宿主主题 token；测试会断言「不泄漏全局样式」。
- 面板数据只能来自原生投影（`subagentCatalog` / `modelSelection` / `tokenUsage` / `subagentTiming` / `sessionStats` / `agentTeam` / `todos` / 会话 UI 状态），不要为了图省事去读 `03-plan.json`。
- 显示状态（过滤、布局、缩放）持久化在 `localStorage` 的 `ds-superbot.panel.*` 键下，按会话区分。

## 7. 脚本约定（`scripts/`）

- 纯 Node、零依赖、`#!/usr/bin/env node`；参数风格 `<root> <subcommand> [flags]`。
- 退出码：`0` 通过、`1` 判定失败、`2` 用法 / IO 错误；**非 0 就是失败，如实上报**。
- 默认 dry-run（只打印计划），落盘要显式 `--write`；重复执行必须幂等。
- 支持 `--json` 的脚本必须保持机读结构稳定，方便 CI 与后续脚本消费。
- 改动脚本后至少：`node --check` + `node --test tests/` + 手工跑一次 `--help` 或真实目标。

## 8. 发布流程

1. 更新 `package.json` 的 `version`（SemVer；1.0.0 之前允许破坏性变更，但必须写进 CHANGELOG）。
2. 把 `CHANGELOG.md` 的 `[Unreleased]` 条目移入新版本小节；补 `Added` / `Changed` / `Fixed` / `Removed` / `Notes`。
3. 面向用户的文案同步中英两份：`README.md`、`README.en.md`、`locale/{zh,en}.json`。
4. 全绿门禁：

   ```bash
   node --check index.js && node --check client.js
   node --test tests/
   ```

5. 提交并打标签：

   ```bash
   git add -A
   git commit -m "release: v0.1.0"
   git tag -a v0.1.0 -m "v0.1.0"
   ```

6. 装进 profile 复验（`install_bundle` → 重启 → 新会话），确认插件行显示正确标题 / 简介 / 图标，面板与派发正常。

## 9. 排障

| 现象 | 原因 / 处理 |
|---|---|
| 装完没变化 | Host 代码要重启 DSH；技能目录是会话级快照，开新会话 |
| 面板不出现 | 确认 `package.json` 的 `dsh.client.inject` 包含 `@deepseek-ai/dsh-client-ui-settings`，且 bundle 已启用 |
| 设置页没有「Super Bot」 | 同上；`Config` 未导出或命名空间与补丁行 id 不一致也会导致 |
| `superbot_dispatch` 报 `subagents service unavailable` | 当前 profile 没有子代理服务；确认 DSH 版本满足 `dsh.engines.dsh` |
| 报 `subagent composition "standard" is not registered` | 宿主的 `standard` 组合还没加载完，稍后重试；不要改成自建组合 |
| 派发被文档硬门拒绝 | 项目 `docTier=3` 且收据缺失 / 过期：按报错提示跑 `docs-ready.mjs` 与 `docs-review` |
