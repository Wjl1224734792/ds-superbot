# ds-superbot 对象契约（schemaVersion 1）

机读 schema 在 `packages/constitution/schemas/`。破坏性改动才升 `schemaVersion`。时间一律 ISO-8601，带偏移。

## 标识

| 对象 | ID |
| --- | --- |
| 工作项 | `WI-YYYY-NNN`（年 + 仓库内递增数字，宽度至少 3） |
| Thread | `TH-<slug>`，slug 为 `[a-z0-9-]{1,64}` |
| Mandate | `MD-<workItemId>`（同一工作项同时只能有一份未吊销 Mandate；重签须先吊销） |
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

完整状态迁移表见实施 Goal 第 5 节，由 `packages/constitution/src/workitem.mjs` 执行。

## Mandate

签发后除 `revokedAt` / `revokeReason` 外任何字段都不得被更新。吊销只允许 `human-stop`、`expired`、`snapshot-stale`。过期 Mandate 不得再授权施工。

## Receipt

只有脚本可签发。`exitCode !== 0` 不得签 `pass`。`status` 为 `pass` | `fail` | `stale`（`browser-ac` 额外允许 `unverified`）。`.superbot/docs-state.json` 仍是 docs-ready 的原生口径；Receipt 是统一包装，不取代它。手改收据后 `revalidate` 必须重算哈希，发现不一致则 `status=stale` 或报错，不许静默相信文件。

## Policy

默认文件：目标仓库 `.superbot/policy/default.yaml`（模板在 `packages/constitution/templates/policy.default.yaml`）。先匹配到的规则生效，返回 `requireHuman` / `allow` / `gates` / `speak` / `merge`。

- `risk <= R1` / `risk >= R2` / `risk == R3`：R0 < R1 < R2 < R3。
- `reversible == true` 读工作项布尔字段。
- `intent.ambiguous` 读 `intentAmbiguous`，缺省 false。
- `touches(prod|billing|delete|secrets)` 与 `touches` 数组做集合相交。
- `requireHuman: true` 时，`authority` 必须是 `human-approval`，不得自动进入 Authorized。
- `merge: human-only` 在 P0 只记录在匹配结果里。

注意：默认文件按「先匹配到的规则生效」解释，规则顺序是 `auto-low` → `human-critical` → `human-default`。因此纯 R3，以及 `touches(prod|billing|delete|secrets)` 且未命中 `auto-low` 的工作项（例如 R2 + touches），会命中 `human-critical`（含 `merge: human-only` 与更严门禁）。R2 且未 touches 仍命中 `human-default`。R1 且可逆仍先命中 `auto-low`，即使 touches 敏感范围。

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
  tmp/superbot/<run>/
    03-plan.json
```

账本不要强制提交，见 `docs/examples/gitignore`。
