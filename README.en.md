# DS Super Bot · a long-lived engineering team for DeepSeek Harness

DS Super Bot is a multi-role engineering-team plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). The lead conversation agent acts as **Tech Lead**: it turns a request into a task DAG, hands each task to the role that owns it (dependency-ordered, with file ownership), and only reports delivery after the plan gate, QA, browser acceptance and review have run.

The goal is not "write the code in one shot" but to keep the project **understandable, verifiable, rollback-able and extendable** after every change.

| Item | Value |
|---|---|
| Version | 0.1.0 |
| Package | `dsh-super-bot` |
| License | MIT |
| Runtime dependencies | none (Node built-ins only; `@deepseek-ai/schemastery` is an optional peer) |
| DSH version | `>=0.2.1-rc.2 <0.4.0-0` |

The plugin only uses DSH-native extension points: roles are **charters injected at dispatch time** (`roles/*.md`, **no Agent Preset is registered**, so the mode picker stays clean); model routes come from the project's `superbot.config.json` first and the **Settings page** second; dispatch is `superbot_dispatch` over `ctx.subagents` (children run the built-in `standard` composition); the human entry point is the native `/superbot-roster` command (`/superbot` is the slash gesture that triggers the `superbot` skill); skills register on `ctx.skills`; the UI is a **per-session right-sidebar team panel** plus the **Settings → Super Bot model table**. No registered page, no private config file, no custom HTTP bridge.

## Install

Prerequisite: DSH (`0.2.1-rc.2` or newer, below `0.4.0`) and Node.js on the machine.

This repository root **is** the plugin package (`index.js` / `client.js` / `cordis.patch.yml` / `package.json` live at the top). Install the local bundle directory with the DSH plugin manager:

```text
plugin_manager(action="install_bundle", target="<checkout of this repo>")
```

Then **restart DSH** (Host code loads at startup) and open a **new session** — the skill catalog is a per-session snapshot, so older sessions may still show the previous copy.

- Upgrade = `install_bundle` the same directory again, then restart. During development the plugin manager's disable/enable gives a hot reload.
- Uninstall = remove the bundle in the plugin manager.
- The directory needs no build or install step.

## What you get

| Capability | Shape |
|---|---|
| 7 roles | Charters injected at dispatch time (`roles/*.md`): `pm`, `architect`, `backend-dev`, `frontend-dev`, `qa-engineer`, `browser-tester`, `reviewer`. **No Agent Preset** — roles never appear in the mode picker |
| Dispatch | `superbot_dispatch(role, description, prompt, cwd?)`: one role per call, the charter is prepended to the task prompt, the child session id comes back and the result returns automatically |
| Models and effort | `modelRouting.<role>` in the project root `superbot.config.json` (repository wins, checked by `scripts/validate-config.mjs`); roles without an entry use their row / the defaults row in **Settings → Super Bot**; otherwise the parent route is inherited |
| Right-sidebar team panel | One per session, opened from the session-header Super Bot icon, the right-sidebar guide, or automatically on the first dispatch: layered workflow tree, free drag and zoom, graph/list toggle; nodes show role / actual model / task / state / elapsed / tokens; a **native task-progress bar** on top; a collapsed artifacts area at the bottom |
| Main skill | `superbot`: the Tech Lead playbook (classification / DAG / dispatch / gates / wrap-up) |
| Documentation entry points (4) | `docs-new` (new project, build the 01→07 baseline), `docs-takeover` (existing repo: inventory and placement first), `docs-feature` (one feature or requirement change: touch only the affected phases), `docs-review` (independent reviewer + receipt) |
| Documentation rulebook | `docs-rules`: the seven-phase rules, SSOT map, change-link table and template index (an entry point it is **not**) |
| Documentation readiness gate | `scripts/docs-ready.mjs`: machine-checks phase artifacts, empty shells, placeholders, `na` reasons, FR↔FP traceability, planned `docsRead` and the reviewer's machine-readable verdict; once the `.superbot/docs-state.json` receipt passes, `backend-dev` / `frontend-dev` become dispatchable |
| On-demand skills | `inline` (the hard actions and scope when the lead does the work itself), `docs-governance` (split / archive / version snapshots plus the `docs-gate` / `doc-snapshot` gates) |
| Supporting skills | `using-superbot` (routing), `agent-settings` (model configuration), `systematic-debugging`, `tdd`, `verification-before-completion` |
| Shared task board | `superbot_board(action="sync"/"status"/"brief")`: turns `03-plan.json` into Agent Teams board gates and work items; task details live in the **native Team panel**, while the right-sidebar panel only shows progress counts and the source |
| Commands | `/superbot-roster`: echoes the roster and routing rules (it does not dispatch); `/superbot` is the slash gesture that triggers the `superbot` skill |
| Gate scripts | `scripts/`: `validate-plan.mjs`, `verify.mjs` (including `baseline record/check`), `run-state.mjs`, `maintain.mjs`, `take-over.mjs`, `validate-config.mjs`, `docs-ready.mjs` (documentation receipt), `docs-gate.mjs` / `doc-snapshot.mjs`, and the `doc/` pipeline tools |

## Why no Agent Presets

A DSH preset is a **user-selectable session mode**; there is no such thing as an "internal preset". Turning the seven roles into presets would put writable specialist modes into the picker: switch to "Backend engineer", edit code directly, and you have a fake team that bypassed the plan gate, the baseline guard, QA and review — exactly the parts that make the plugin worth using.

So the plugin registers no Agent Preset: DS Super Bot is a process (skills + tools + gate scripts). `superbot_dispatch` starts each child on DSH's built-in `standard` composition and prepends the role charter to the task prompt. The trade-off is that a worker carries all `standard` tools (delegation depth defaults to 1, which stops a worker from re-delegating); the benefit is a clean mode picker and no preset composition to keep in sync with DSH upgrades.

## Quick start

1. Install as above, restart DSH, open a new session.
2. Ask in natural language:

   ```text
   Use Super Bot to add a total-amount script under tmp/demo, with a unit test, and get it green
   ```

   The lead loads the `superbot` skill: classify (S/M/L) → clarify → task DAG + file ownership → dispatch → QA → browser acceptance → review → report.

3. To change a subagent's model, write `modelRouting` in the project-root `superbot.config.json` (or ask "configure the subagent model" and the lead loads `agent-settings`, edits the file and runs `validate-config.mjs`). The next `superbot_dispatch` uses the new route; no restart needed.

## Entry points

| You want | Say |
|---|---|
| Feature delivery | "Use Super Bot to build <request>" → six phases + plan approval gate |
| Do it yourself (inline) | "Do it yourself / don't dispatch" → S / B3 / maintenance only; M needs an explicit request; L and B0/B1/B2 are refused |
| Bug fix | "Fix this bug / this feature broke" → B0–B3 triage |
| Plan only | "Plan only, no code yet" → stop at the approval gate |
| Maintenance sweep | "Run a maintenance sweep" → eight scan classes + scored backlog + small fixes |
| Take over a repo | "Take over this repository, inventory first" → T1 project memory + first health scan |
| New-project docs | "New project / initialise the seven-phase docs" → `docs-new` |
| Existing-repo docs | "Take over this repo / add docs to an existing project" → `docs-takeover` |
| One feature's docs | "Write docs for this feature / which docs does this change touch" → `docs-feature` |
| Review the docs | "Review the docs / are we ready to start" → `docs-review` |
| Rules and templates | "How should a PRD/FRD/contract be written" → `docs-rules` |
| Documentation governance | "Docs are too long / reviews pile up / keep requirement versions" → `docs-governance` |
| Change a model / effort | "Configure the subagent model" → `agent-settings` |
| Not sure which entry | Load `using-superbot` to route |

## Roles

| Role | `role` | Responsibility |
|---|---|---|
| Requirements analyst | `pm` | Vague request → testable spec |
| Architect | `architect` | Spec → technical plan + task DAG |
| Backend engineer | `backend-dev` | Test-first implementation within file ownership |
| Frontend engineer | `frontend-dev` | UI implementation + acceptance script |
| QA engineer | `qa-engineer` | Test / lint / typecheck quality gates |
| Browser tester | `browser-tester` | Black-box acceptance in a real browser |
| Code reviewer | `reviewer` | Final diff review with three-level findings |

## Model routing

```json
{
  "modelRouting": {
    "reviewer": { "model": "provider/strong-model", "effort": "high" },
    "qa-engineer": { "model": "provider/fast-model" }
  }
}
```

Priority: **`modelRouting.<role>` in the project-root `superbot.config.json` > that role's row in Settings → Super Bot > the defaults row > the parent route**.

- `superbot_dispatch` walks up from the dispatch `cwd` to find the project root and reads the project file; the next dispatch uses it (no restart).
- Before dispatch the route is validated through `llm.resolveModelInfo`: an unknown model or an unsupported effort fails loudly instead of silently degrading.
- A malformed entry (e.g. `model` without a `provider/` prefix) counts as "not configured" and falls back to the parent route.
- Structure check: `node <package>/scripts/validate-config.mjs <root>/superbot.config.json`.

## Right-sidebar team panel

The panel lives in the session's **right sidebar**. DSH stores the sidebar layout per session, so **every session gets its own panel**. Three ways to open it:

1. the **Super Bot icon** in the session header (`conversation.session.header.utilities`);
2. the "Super Bot team" entry on the **right-sidebar guide** page;
3. **automatically** on the session's first Super Bot dispatch (labels look like `backend-dev · T1 export endpoint`); once the user closes it, it does not come back.

**The panel answers exactly one question: which agent, with which model, doing what, and how far along.** Top to bottom:

1. **Task progress bar (native tasks)**: `done/total` plus one segment per task (done green / running blue pulse / pending grey / blocked orange), the running and blocked counts, and the source (`Agent Teams board` or `session task list`). **Counts only, never task names** — read tasks in DSH's own list or the native Team panel.
2. **Workflow canvas (layered tree by default, free drag and zoom)**: `Lead · this session` at the top left as the root, a trunk through spec → architecture → implementation → quality → acceptance → review hubs (empty phases omitted), with that phase's cards branching to the right. The toolbar can tidy the canvas into radial / fishbone / tree layouts, and cards stay draggable. Connectors run from the Lead to each subagent, without arrowheads. Each node shows role / **actual model** (`model @ effort`, "model pending" until a request has run — never invented) / task description / state / elapsed / tokens. Click a node to open that child session in the sidebar; click `⌄` to expand provider / effort / four token buckets / turns and steps / mode / child session id in place.
3. **Artifacts (collapsed by default)**: files under `tmp/superbot/<run>/` (`run.json`, `03-plan.json`, plus reports and evidence under `reports/` and `evidence/`); click a row to open the file in the sidebar.

Panel data comes from native live projections, never from polling a task file:

| What the panel shows | Native DSH source |
|---|---|
| Subagent list / role | `subagentCatalog` projection (label = `role · task`) |
| Running / waiting for input | session UI state (`running` / `pendingInteraction`) |
| Actual model | `modelSelection` projection (`lastUsed`, else `next`) |
| Tokens | `tokenUsage` projection |
| Elapsed / normal completion | `subagentTiming` projection |
| Turns / steps (detail) | `sessionStats` projection |
| Task progress | `agentTeam` projection, else `todos` |
| Artifacts / run dirs | workspace-files Remote, polled every 15s |

The panel does **not** read tasks out of `03-plan.json`, does **not** draw a task DAG and does **not** copy the task list: task state belongs to DSH's native task system. When artifacts cannot be read, the artifacts area says so and the rest keeps working.

**The Settings page keeps only models**: the "Settings → Super Bot" section renders just the per-role model and effort table (role / provider / model / effort / source, a defaults row, save and revert).

## Shared task board (Agent Teams)

With the "agent teams" host bundle enabled, the shared task board is the **authoritative source** of task state, and the **native Team panel** in the session header is where task detail is read. `superbot_board(action="sync", plan="<artifacts>/03-plan.json", level="M")` turns the plan into native board tasks (idempotent, matched through the `superbot:plan=` / `superbot:gate=` markers in each description):

| Board task | Source | What the native Team panel shows |
|---|---|---|
| `G1 · plan approval` | gate | Work items cannot be claimed until it completes (native dependency gate) |
| `T<id> · <role> · <title>` | `03-plan.json` tasks | State, owner, dependencies, readiness; write scopes come from file ownership and overlaps raise warnings |
| `G2 · QA gate` / `G3 · final review` | gates | Depend on all work items / on QA; the process order is visible on the board |

- Assignment: `superbot_board(action="brief", role="backend-dev", task="T1")` returns a self-contained brief → `spawn_teammate` → `team_task_update(action="reassign", owner=<teammate>)`; the teammate claims before starting.
- Without the team bundle there is no `agentTeams` service: `superbot_board` fails loudly and the flow falls back to `superbot_dispatch` + `run.json`.

## Documentation pipeline and the hard gate (docTier=3)

Documentation is not one do-everything skill: three entry points by scenario plus a review entry, with the rules and templates kept separately.

| You say | Loads | Covers |
|---|---|---|
| New project / build the doc baseline | `docs-new` | 01-requirement (PRD→FRD) → 02-architecture → 03-contract (+05-pages) → 06-test baseline → 07-governance → closure → review → receipt |
| Take over an existing repo | `docs-takeover` | `take-over.mjs` produces T1 → inventory and placement mapping (needs a decision) → `docs-gate --baseline-write` → fill the gaps |
| One feature / requirement change | `docs-feature` | Impact scan → collect decision items → touch only the affected phases (`na` + reason elsewhere) → change-link table in the same batch |
| Review / are we ready to start | `docs-review` | A fresh reviewer (clean context, read-only) → verdict under `docs/07-治理/评审记录/` + machine-readable block → `approve` |

**The hard gate is not a prompt.** With `docTier: 3` in `superbot.config.json`, `superbot_dispatch` checks the receipt and document hashes in `.superbot/docs-state.json` before dispatching `backend-dev` / `frontend-dev` and refuses when they do not pass (`architect` / `reviewer` / `qa-engineer` / `browser-tester` are not blocked, leaving humans room to fix docs and review). Receipts are only issued by the script:

```bash
node scripts/docs-ready.mjs <root> init --scope new|takeover|feature --write   # declare the scope
node scripts/docs-ready.mjs <root> check [--plan <03-plan.json>] [--strict]    # machine-check closure
node scripts/docs-ready.mjs <root> approve --review <review-record>            # issue the receipt
node scripts/docs-ready.mjs <root> status                                      # current state (incl. stale)
```

The criteria and error codes (`E-DOC-MISSING` / `E-DOC-PLACEHOLDER` / `E-DOC-THIN` / `E-NA-REASON` / `E-PLAN-DOCSREAD` / `E-PLAN-NA-CONFLICT` / `E-STATE-STALE` / `E-REVIEW-*`) are in `docs-ready --help` and the `docs-rules` skill. Editing any normative document (PRD / FRD / architecture / contract / page / test plan) invalidates the receipt; `执行步骤.md`, `评审状态.md` and `评审记录/` are excluded from the hash so day-to-day bookkeeping does not force a re-review.

**Rollback**: set `docTier` back to 1/2 and the whole gate turns off — no code change required.

## Repository layout

```text
.
├── index.js              # Host half: Config, superbot_dispatch / superbot_board, /superbot-roster, skill registration
├── client.js             # Client half: right-sidebar team panel + Settings model table
├── cordis.patch.yml      # bundle patch: one Host row (id = superbot)
├── package.json          # manifest (dsh.bundle / dsh.client / exports)
├── icon.svg              # plugin icon
├── locale/{zh,en}.json   # plugin title and summary (shown on the plugin page)
├── roles/                # 7 role charters + manifest.json (injected at dispatch time)
├── skills/               # 13 native skills + manifest.json
├── scripts/              # gate and documentation scripts (plain Node, zero dependencies)
├── tests/                # host-contract tests (node:test, driven by a fake ctx)
└── docs/                 # developer documentation for this project
```

## Development and tests

```bash
node --check index.js && node --check client.js   # syntax
node --test tests/                                # host-contract tests (86 cases)
npm test                                          # same as the line above
```

The tests drive `apply()` with a fake `ctx` and cover: tool registration and argument validation, role-charter injection, model-route precedence, the documentation readiness gate, command and skill registration, client panel rendering and canvas interaction, the Settings table, and stylesheet scoping. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for details and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture.

## Troubleshooting

- **`/superbot` echoes the roster instead of the skill**: the roster command is `/superbot-roster`; `/superbot` is the slash gesture for the `superbot` skill. Still seeing the roster means a different build is installed — re-run `install_bundle` and restart DSH.
- **The `/superbot` gesture does not trigger the skill**: the gesture needs a space after `/superbot` (or Enter on its own); a stuck-on form such as `/superbotdoX` is not recognised. Natural language is the safest entry.
- **Nothing changed after installing**: Host code loads only after a DSH restart; the skill catalog is a per-session snapshot, so open a **new session**. During development, disable/enable in the plugin manager for a hot reload.
- **Model routing does not apply**: a malformed `modelRouting.<role>` counts as "not configured" and falls back to the parent route; run `validate-config.mjs` to check the structure.
- **`superbot_board` says "Agent Teams not enabled"**: that is an optional capability; keep using `superbot_dispatch` + `run.json`, or enable "agent teams" on the plugin page and refresh.

## More

- Architecture and extension points: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Development and release: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- 中文: [README.md](README.md)
- License: MIT
