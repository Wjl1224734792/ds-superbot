# ds-superbot 插件硬约束

本目录是 DeepSeek Harness 的安装入口（`package.json` 的 `name` 仍是 `ds-superbot`）。产品名是 **ds-superbot**，不要改成「活仓库」。

1. **运行时零依赖**：只用 Node 内置模块。除可选 peer `@deepseek-ai/schemastery` 外，不新增 `dependencies`。
2. **不注册 Agent Preset**。角色只是派单时注入的章程；`roles/*.md` 在 P0 仍用于 7 角色派单，并作为 Mandate 编译失败时的 fallback 模板。
3. **工具名与命名空间固定**：`superbot_dispatch` / `superbot_board` / `superbot-roster` / `superbot`。右侧 tab id 仍是 `ds-superbot`。`.stwd-` 样式前缀与 localStorage 键不改。
4. **只走官方加法槽位**。禁止注册 `sidebar` / `rightbar` / `conversation.session.header` 做整栏替换。禁止自建 HTTP / 独立端口控制台（`webServer` / `/api`）。P2 槽位见仓库根 `docs/DEVELOPMENT.md` 与 `docs/product/INTERACTION.md`。
5. **门禁脚本的判定逻辑不在这里改**。`scripts/` 是转发到 `packages/constitution/scripts/` 的 shim，退出码与 `--help` 必须与 SSOT 一致。`index.js` 的 `checkReadiness` 仍指向同一份 `docs-state.mjs` 逻辑。
6. **P0 不重做左栏、顶部或右侧栏**。`assets/residents/` 里的四张脸是占位 SVG。
