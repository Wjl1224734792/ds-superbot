# ds-superbot 对象契约（schemaVersion 1）

机读 schema 在 `packages/constitution/schemas/`。破坏性改动才升 `schemaVersion`。时间一律 ISO-8601，带偏移。

## 标识

| 对象 | ID |
| --- | --- |
| 工作项 | `WI-YYYY-NNN`（年 + 仓库内递增数字，宽度至少 3） |
| Thread | `TH-<slug>`，slug 为 `[a-z0-9-]{1,64}` |
| Mandate | `MD-<workItemId>`；吊销后重签为 `MD-<workItemId>-N`（N≥2）。同一工作项同时只能有一份未吊销 Mandate；重签须先吊销。已吊销记录作为历史副本保留，不得覆盖。 |
| Receipt | `RC-<gate>-<8位hex>` |
| Snapshot | `CS-<12位hex>` |

## 工作项

合法状态：`Signal`、`Candidate`、`Dropped`、`Explored`、`Proposed`、`AwaitingApproval`、`Authorized`、`Parked`、`Planned`、`Approved`、`Building`、`Verifying`、`Delivered`、`Failed`。终态（`Dropped` / `Parked` / `Delivered` / `Failed`）之后只能只读。非法迁移必须失败，不得暗改。

- `origin.kind` 只能是 `human` 或 `trigger`。`trigger` 必须带非空 `evidence`。
- `ac[].text` 必须可判定；拒绝「体验好」「功能正常」。进入 `Planned` 之后，每条 AC 的 `coveredBy` 必须指向计划任务 ID。
- `risk` 只能是 `R0` | `R1` | `R2` | `R3`。`authority` 只能是 `policy:<id>` 或 `human-approval`。R2/R3 必须是 `human-approval`，不得自动进入 Authorized。
- `gates` 只能从：`validate-plan`、`docs-ready`、`docs-gate`、`verify`、`browser-ac`、`review`、`naming-guard`。
- `plan` 为相对路径，指向 `tmp/superbot/<run>/03-plan.json`，沿用现有 schemaVersion 1，不另起一套计划格式。
- 进入 `Authorized` 时绑定 `constitution_snapshot`；之后口径类文档哈希变更，则该工作项所有未结 Receipt 立即 `stale`。口径集合与哈希算法复用 `docs-state.mjs`（`listDocs` + `hashExclude` + CRLF 归一）。
- 可选字段 `intentAmbiguous`（缺省 false）与 `touches: string[]`（缺省空）供 Policy 表达式使用。

完整状态迁移表见实施 Goal 第 5 节，由 `packages/constitution/src/workitem.mjs` 执行。P5 有意扩展 `Proposed` / `Authorized` / `Planned` / `Approved` / `Verifying` → `Parked`（加上 Goal 已有的 `AwaitingApproval` / `Building` → `Parked`），供人否决 / 叫停与 Watchdog execute 使用；见 `PARK_FROM` / `isLegalTransition`。其它非法迁移仍然失败。

## Owner → 能力态（P3）

`scope.owners` 仍使用现有角色 id，运行时再映射到能力态，不新增第 8 个角色文件：

| owners / 角色 id | 能力态 | 装配 |
| --- | --- | --- |
| `pm`, `architect` | Discover | Scout（只读感知）/ Explorer（只读 Fact Pack）/ Curator（只交 Top-K） |
| `backend-dev`, `frontend-dev` | Build | 由现有章程模板编译的 Worker，工具可含 shell / read / edit / git，范围不得扩大 |
| `qa-engineer`, `browser-tester`, `reviewer` | Verify | 独立上下文 Verifier + 确定性脚本；Critic 对抗性终审 |
| （非 role id） | Cartographer | 任务结束后只写知识库（Decision / Invariant），不得改业务代码。回写 API 是 `cartographer.writeBack`；默认 observe 只记 would-accept。允许写入的路径只有 `docs/project/DECISIONS.md` 与 `docs/project/INVARIANTS.md` |

缺 owners（或 owners 都不是已知角色 id）时的推断：规划 / 文档类 gates → Discover；`scope.files` / `newFiles` 非空 → Build；`verify` / `browser-ac` / `review` → Verify；以上都没有但 intent 存在 → 仅 Discover。成功编译始终附上 Cartographer。未知 owner id 被忽略，永不发明新角色 id。推断结果只影响装配，不回写到 `scope.owners`。

Capability Compiler（`compileMandate` / `compileIntent`）只产出与 Mandate 字段兼容的**草稿**（goal / ac / nonGoals / scope / toolsWhitelist / budget / evidenceRequired / constitution_snapshot / workItem）。签发仍走 `issueMandate`，R2 / R3 与 `human-approval` 仍要人批。编译失败（缺 intent、缺 AC、AC 不可判定、范围越出仓库根）时 `via: 'fallback'`，只用匹配的 `roles/*.md`，且不得扩大 tools 或 scope。

模型路由升级为「能力态 × 风险」：轻量档给 Discover / Steward 等，强档给契约编译与终验；R2 / R3 升到强档。`superbot.config.json` 的 `modelRouting.<role>` 保留为 fallback，0.1.0 派单解析不改。

## Mandate

签发后除 `revokedAt` / `revokeReason` 外任何字段都不得被更新。吊销允许 `human-stop`、`expired`、`snapshot-stale`，以及 P5 文档化扩展的 `timeout`（Watchdog 在 execute 下对空转 / 超时吊销）。过期或已吊销的 Mandate 不得再授权施工。人批签发之后，该工作项可在 Mandate 范围内进入 execute；全局默认授权仍是 observe。第一次签发仍使用 Goal 规定的 `MD-<workItemId>`；若该 id 已被一份已吊销记录占用，新签发使用 `MD-<workItemId>-2`、`-3`……，历史文件保持原样。`schemaVersion` 仍为 1（只放宽了 id 模式，既有 id 仍然合法）。

## Receipt

只有脚本可签发。`exitCode !== 0` 不得签 `pass`。`status` 为 `pass` | `fail` | `stale`（`browser-ac` 额外允许 `unverified`）。`.superbot/docs-state.json` 仍是 docs-ready 的原生口径；Receipt 是统一包装，不取代它。手改收据后 `revalidate` 必须重算哈希，发现不一致则 `status=stale` 或报错，不许静默相信文件。Delivered / Failed 结果卡（`renderResultCard`）必须可核对，列出 AC、Receipt 与产物路径（可复数；提供账本 root 时可从 ledger 加载 Receipt）。「合并」仍由人决定；本轮只通过 `recordMergeIntent` 记录意图，不自动执行 git merge / push。

## Thread（跨通道）

一个 Thread（`schemaVersion: 1`）可以绑定多个通道 URI（`scheme://…`，例如 `group://repo-ops`、`github://owner/repo`），并下挂多个工作项。P4 在创建 / 按 id 读取 / 追加 `workItems` 之外提供：

- `bindChannel(root, threadId, channel)`：向已有 Thread 追加通道，幂等，不叉出第二份对象。
- `findThreadsByChannel(root, channel)`：按通道查找。
- `resolveThread({ root, channels, slug, title })`：任一已绑定通道命中则复用该 Thread 并联合通道；若通道分属两个已有 Thread 则失败，不合并对象。

工作项和结果卡通过 Thread 关联到全部已绑定通道。这只是数据模型与 API，并不真正连接 GitHub、群聊或其它 IM。订阅直通仍不授予任何权限。

## Policy

默认文件：目标仓库 `.superbot/policy/default.yaml`（模板在 `packages/constitution/templates/policy.default.yaml`）。先匹配到的规则生效，返回 `requireHuman` / `allow` / `gates` / `speak` / `merge`。`planSteps` / `intensity` 在此基础上给出 `steps`（该规则的门禁个数）。同一套代码换一份更松的策略文档，R0/R1 可逆工作的步骤数应少于 R3 / 敏感 `touches`，不要靠删除门禁实现下调。`merge: human-only` 仍被记录并执行；策略里写 `merge: auto-merge` 会被拒绝。

- `risk <= R1` / `risk >= R2` / `risk == R3`：R0 < R1 < R2 < R3。
- `reversible == true` 读工作项布尔字段。
- `intent.ambiguous` 读 `intentAmbiguous`，缺省 false。
- `touches(prod|billing|delete|secrets)` 与 `touches` 数组做集合相交。
- `!expr` 对原子条件取反，例如 `!touches(prod|billing|delete|secrets)`；空的 `touches` 视为未命中该集合。
- `requireHuman: true` 时，`authority` 必须是 `human-approval`，不得自动进入 Authorized。
- `merge: human-only` 在 P0 只记录在匹配结果里。
- auto 执行灰度（不是合并）必须先有一条已落盘的 would-accept 观察记录，匹配键至少是同一 `action`，请求带风险时还要同一风险档。R2 / R3、`human-approval`、`requireHuman`，以及 `touches` 命中 prod / billing / delete / secrets 的工作项，不得进入 auto，保持人工门。即使灰度资格成立，`would.merge` 仍为 false，且不得执行合并。默认授权档位仍是 observe。

注意：默认文件按「先匹配到的规则生效」解释，规则顺序是 `auto-low` → `human-critical` → `human-default`。`auto-low` 仅匹配 R1 及以下、可逆、且未 `touches(prod|billing|delete|secrets)` 的工作项。纯 R3，以及 touches 敏感范围（含 R1 且可逆但 touches）的工作项，会命中 `human-critical`（含 `requireHuman`、`merge: human-only` 与更严门禁）。R2 且未 touches 仍命中 `human-default`。

## 目标项目落盘

```text
<target-repo>/
  superbot.config.json
  .superbot/
    docs-state.json
    policy/default.yaml
    ledger/
      threads/TH-*.json
      work-items/WI-*.json
      mandates/MD-*.json
      receipts/RC-*.json
      snapshots/CS-*.json
      events.jsonl
      subscriptions/<channel>.json
      watchdog/<id>.json
  tmp/superbot/<run>/
    03-plan.json
```

账本不要强制提交，见 `docs/examples/gitignore`。
