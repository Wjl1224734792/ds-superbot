# 本仓库开发约定（ds-superbot）

产品名是 **ds-superbot**。本仓库是 monorepo：仓库根不再等于 DSH 插件包。安装入口是 `packages/dsh-plugin`。

红线：决定在人、操作在 AI、判定在程序。对外只有一个产品对象——工作项。不要用「活仓库」当产品名。不要新增可写的第 8 个角色。默认授权档位是 observe；不要打开 auto 自动合并。

## 目录归属

| 路径 | 内容 | 改这里的后果 |
|---|---|---|
| `packages/dsh-plugin/` | DSH 插件（`name`: `ds-superbot`）：`index.js`、`client.js`、角色、技能、占位头像 | 影响宿主安装与 0.1.0 兼容路径（7 角色派单、右侧栏、硬门） |
| `packages/dsh-plugin/scripts/` | 转发 shim | 必须保持 `node <插件包根>/scripts/docs-ready.mjs` 的退出码与 `--help` |
| `packages/constitution/` | `@ds-superbot/constitution`：账本、Policy、跨通道 Thread、动态治理 `planSteps`、Mandate、Receipt、门禁脚本 SSOT | 影响工作项状态机与收据；不要重写门禁脚本的判定逻辑；账本不得写出 `.superbot/ledger/` |
| `packages/runtime/` | `@ds-superbot/runtime`：Steward（轻量规则 + 预留模型接口）、Capability Compiler、`routeModel`、filter、curator、assignment、存算分离、Cartographer 回写、文件型 Event Bus、订阅直通、Watchdog、observe / would-accept / auto 灰度 | 默认授权 observe；订阅直通不授权；编译器只出草稿不签发；Cartographer 默认不写文件；auto 灰度必须先有观察记录；不得空实现成「假装成功」；不要开 HTTP |
| `packages/im/` | `@ds-superbot/im`：三种卡、发言允许表、`presenceOf` | 面板与字幕只能调用 `presenceOf`，不要在 `client.js` 另写一套 |
| `docs/product/` | 对象契约与交互说明 | 与 `packages/constitution/schemas/`、卡片模板保持一致 |
| `docs/ARCHITECTURE.md` / `docs/DEVELOPMENT.md` | 架构与开发循环 | 改目录或命令时必须同步 |

## 硬性约束

1. **运行时零依赖**：各包 `type: module`，Node `>=20`。`packages/constitution`、`packages/runtime`、`packages/im` 不得添加 `dependencies`；校验自己写，不要用 ajv。插件除可选 peer `@deepseek-ai/schemastery` 外同样零依赖。
2. **不要引入 TypeScript 构建、bundler 或 workspace 构建步骤。** 根 `package.json` 用简单 scripts 调 `node --test`。
3. **不注册 Agent Preset**；不自建 HTTP 桥或独立端口控制台。
4. **工具名、右侧 tab id、配置命名空间、`.stwd-` 前缀一律不改。**
5. **界面只做加法槽位**：禁止整栏替换 `sidebar` / `rightbar` / `conversation.session.header` / `conversation.header`。P2 已用官方加法槽接上左栏控制台、顶部迷你脸和右侧舞台（槽位对照 DeepSeek Harness 0.2.2-rc.2）。
6. **现有门禁脚本的判定逻辑不重写。** Constitution Service 是薄包装：调用同一套脚本、沿用退出码（0 通过 / 1 判定失败 / 2 用法或 IO 错误），再落 Receipt。
7. **`.superbot/ledger/` 是目标项目运行时账本，不要强制提交。** 执行目录在 `tmp/superbot/<run>/`，二者不得混用。见 `docs/examples/gitignore`。

## 每次改动都要跑

```bash
npm run check    # node --check 覆盖插件与新入口
npm test         # 各包 node:test（含迁移后的宿主契约 / docs-ready / docs-governance）
```

- 改了 `packages/constitution/scripts/`：至少跑插件 shim 的 `--help` / 相关用例，确认参数与退出码没变。
- 改了面向用户的文案：中英 README、locale、CHANGELOG 一起改。
- 改了角色或技能：同步 manifest，并确认 `packages/dsh-plugin/tests/dsh-plugin.test.mjs` 仍然通过。
- 测试必须真跑，不许用「应该没问题」代替；失败如实上报。不要在测试里访问网络或写用户的真实仓库。

## 文档口径

- `README.md` 是中文主文档，`README.en.md` 是英文镜像；`locale/{zh,en}.json` 是插件页展示的标题与简介。
- `docs/ARCHITECTURE.md` 讲三层架构与扩展点，`docs/DEVELOPMENT.md` 讲开发、测试、发布与 P2 槽位。
- `docs/product/CONTRACT.md` 与 `docs/product/INTERACTION.md` 是对象契约和交互说明。
- 提交信息用 `<type>(<scope>): <summary>`。

## 发布

1. 改 `packages/dsh-plugin/package.json` 的 `version`（SemVer；1.0.0 之前允许破坏性变更，但要写进 CHANGELOG）。姊妹包版本与之对齐。
2. 把 CHANGELOG 的 `[Unreleased]` 条目移入新的版本小节。
3. 跑完上面两条命令，确认全绿。
4. `git tag -a v<version> -m "v<version>"`，再推送 tag。

安装方式见 `README.md`：`plugin_manager(action="install_bundle", target="<repo>/packages/dsh-plugin")`，然后重启 DSH。
