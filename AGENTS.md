# 本仓库开发约定（DS Super Bot）

本仓库是 **DS Super Bot** 的完整源码：仓库根目录就是 DeepSeek Harness 插件包，`roles/`、`skills/`、`scripts/` 都是**源文件**，直接改，不存在生成物或构建步骤。

## 目录归属

| 路径 | 内容 | 改这里的后果 |
|---|---|---|
| `index.js` | Host 半：Config、两个工具、`/superbot-roster`、技能注册 | 影响工具与技能在宿主里的行为 |
| `client.js` | Client 半：右侧栏团队面板、设置页模型表格 | 影响用户看到的界面 |
| `cordis.patch.yml` | bundle 补丁，插入一行 Host（`id: superbot`） | 行 id 必须与 `index.js` 的 `CONFIG_NS` 一致 |
| `package.json` | 包清单（`dsh.bundle` / `dsh.client` / `exports` / `files`） | 改导出或文件清单时必须同步 `files` |
| `roles/` | 7 个角色章程 + `manifest.json` | 派单时注入的正文，改了立即影响子代理行为 |
| `skills/` | 13 个技能 + `manifest.json` | 改技能正文 / 增删技能必须同步 manifest |
| `scripts/` | 门禁与文档流水线脚本 | 纯 Node、零依赖，可被目标项目直接运行 |
| `tests/` | 宿主契约测试 | 任何行为改动都要在这里有对应用例 |
| `docs/` | 本项目的开发文档 | 架构、开发与发布说明 |

## 硬性约束

1. **运行时零依赖**：`index.js` / `client.js` / `scripts/` 只用 Node 内置模块。除可选的 `@deepseek-ai/schemastery` peer 外，不新增 `dependencies`。
2. **不注册 Agent Preset**：角色只能是派单时注入的章程。注册可选的专员模式会绕开计划门、QA 与终审，等于毁掉插件的价值。
3. **工具名与命名空间固定**：`superbot_dispatch` / `superbot_board` / `superbot-roster`；配置命名空间 `superbot` 必须与 `cordis.patch.yml` 的行 id 相同。
4. **只走原生扩展点**：不注册页面、不写私有配置文件、不自建 HTTP 桥（`webServer` / `/api/...`）；界面只能用原生 slot、configForms 与原生会话跳转。
5. **项目配置优先**：子代理模型的第一来源是项目根 `superbot.config.json` 的 `modelRouting`，设置页只是兜底；不要反转这个优先级。
6. **角色与技能清单一致**：`roles/manifest.json`、`skills/manifest.json` 与实际目录必须一一对应；`index.js` 从 manifest 读角色，`skills/manifest.json` 是技能名的唯一清单。

## 每次改动都要跑

```bash
node --check index.js && node --check client.js   # 语法
node --test tests/                                # 宿主契约测试（87 例）
```

- 改了 `scripts/` 下的脚本：至少跑 `node <script> --help` / 相关用例，确认参数与退出码没变。
- 改了面向用户的文案（工具描述、locale、README、CHANGELOG）：中英两份一起改，别只改一边。
- 改了角色或技能：同步 manifest，并确认 `tests/dsh-plugin.test.mjs` 的注册断言仍然通过。
- 测试必须真跑，不许用「应该没问题」代替；失败如实上报。

## 文档口径

- `README.md` 是中文主文档，`README.en.md` 是英文镜像；`locale/{zh,en}.json` 是插件页展示的标题与简介。
- `docs/ARCHITECTURE.md` 讲扩展点与数据流，`docs/DEVELOPMENT.md` 讲开发、测试与发布。
- 提交信息用 `<type>(<scope>): <summary>`（如 `feat(panel): ...`、`fix(dispatch): ...`）。

## 发布

1. 改 `package.json` 的 `version`（SemVer；1.0.0 之前允许破坏性变更，但要写进 CHANGELOG）。
2. 把 CHANGELOG 的 `[Unreleased]` 条目移入新的版本小节（Added / Changed / Fixed / Removed / Notes）。
3. 跑完上面两条命令，确认全绿。
4. `git tag -a v<version> -m "v<version>"`，再推送 tag。

安装 / 升级到本仓库的方式见 `README.md` 的「安装」一节：用 DSH 插件管理器 `install_bundle` 指向本仓库根目录，然后重启 DSH。
