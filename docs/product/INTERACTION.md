# ds-superbot 交互说明：布局、头像、群聊与控制台

> 产品名是 **ds-superbot**。本文是布局、脸谱、眼神、群聊与控制台的实施说明，与 `GOAL.md` 一起交给 DeepSeek。冲突时：对象模型和门禁以 GOAL 为准，界面与在场表现以本文为准。
> 必须充分使用 DeepSeek Harness 的原生插件槽位来改造**左栏、右栏和顶部**，不要另开页面或自建 HTTP 控制台。
> 头像与群聊的气质参照 Grok Bot 那种「角色一直在场、用微动作和眼神说话、聊天本身很克制」，控制台的信息结构参照 dsh-superagent 面板。都是参照原则和气质，**禁止复刻任何现成产品的界面、角色、商标或官方形象**。脸谱必须是 ds-superbot 的原创。

---

## 1. 交互原则

1. **聊天仍然要纳税。** 主会话（DSH 群聊形态）只发三种消息：结果可用、需要决定、任务失败。过程、心跳、「正在分析」一律不发。
2. **状态改走在场层，不走聊天。** 人要知道「谁在干活、谁在等我」，靠顶部迷你脸、右侧舞台的眼神和动作，以及左侧控制台里「待你决定」的列表。
3. **对外只有一个声音：ds-superbot。** 头像是在场的脸，不是各自对人群发消息的人格。默认只有「仓」这张对外脸配合开口。
4. **头像不是第 8 个角色席位，也不是 7 个固定工种的复活。** 只有仓 / 探 / 作 / 验四张稳定的脸。并发任务复用同一张脸，用工作项徽章区分。
5. **动作也要纳税。** 同一时刻只允许一个「高能量」头像。禁止全员一起跳，禁止用动画代替本该沉默的聊天消息。
6. **只做加法槽位，不替换宿主壳。** 禁止对已被占用的 `single` 槽做整栏替换，尤其不要注册 `sidebar`、`rightbar`、`conversation.session.header`、`conversation.header`。槽位以当前安装的 DeepSeek Harness 版本为准；实现前用宿主文档或 `cordis_inspect what:"client"` 核对名称，本文给出的是官方已公布的加法槽。若某槽在当前版本不存在，降级到仍存在的加法槽，不得改去自建页面。

---

## 2. 三栏 + 顶部：用 DSH 原生槽位搭起来

```text
左栏                              顶部（会话标题栏，加法）              右栏
sidebar.panellist + main          utilities / corner / view tab       sidebar.right.pane.tab
+------------------+     +--------------------------------------+     +------------------+
| ds-superbot      |     |  会话标题    [仓探作验迷你眼神]  图标  |     | 舞台              |
| 控制台           |     +--------------------------------------+     | (仓)(探)(作)(验)  |
|                  |     |  中栏：原生会话 = 群聊（Grok Bot 气质）|     | 仓正在看你        |
| 待你决定 1       |     |  【审批】WI-114  请批 Mandate         |     |                  |
| 施工中 2         |     |  （没有过程消息）                      |     | 当前工作项详情    |
| 观察 / 暂停      |     |  输入区上方可有一行字幕                |     | AC / 门禁 / 证据  |
| 健康 · 费用      |     |  [输入框]                              |     | DAG              |
+------------------+     +--------------------------------------+     +------------------+
```

### 2.1 顶部（在场条，不替换标题栏）

使用这些加法槽，不要声明或抢占 `conversation.session.header` 本身：

| 槽 | 基数 | 用途 |
| --- | --- | --- |
| `conversation.session.header.utilities` | list | 保留现有入口图标，点击打开右侧舞台或左侧控制台 |
| `conversation.session.header.corner` | single | 优先把四张脸的迷你眼神条放这里（仅在有内容时占位） |
| `conversation.session.header.actions` | list | 次要动作（例如「待你决定」计数），不要堆工具栏 |
| `conversation.view` | list | 可增加「舞台」或「控制台」View 标签，作为补充全屏，但默认仍留在 Chat；不要把 Chat 换成唯一入口 |

顶部迷你脸是右侧大舞台的缩略：同一套 `presenceOf`，只显示眼睛和极弱呼吸，点击某张脸打开右侧舞台并选中对应工作项。

### 2.2 左栏（控制台，参照 superagent 面板）

用 `sidebar.panellist` 注册一个图标行（建议 `id: ds-superbot-console`，label 用无直角引号的 ds-superbot），并在根作用域 `main` 的**同一 id** 注册控制台主体。这是官方加面板的方式，**不属于**红线里禁止的「自建页面 / HTTP 桥」。

禁止：注册 `sidebar` 整栏替换；禁止学习某些 superagent 社区实现去开 `127.0.0.1` 端口或 BFF。

控制台只回答三件事，顺序与 [dsh-superagent-prototype 面板说明](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/HEAD/docs/005-panel.md) 一致，对象名改用本产品的工作项，不要对外写 Ticket：

1. **现在有没有要我决定的？** 待批准 / 待合并 / 失败待处理，放在最上面，一行一个动作。
2. **系统是否健康、正在做该做的事？** 授权档位（默认 observe）、暂停、费用与空转摘要；健康时不占额外空间。
3. **某一件工作从提出到证据的历史？** 工作项列表和详情：状态、Mandate、门禁、Receipt、模型与耗时。

原则也一并参照：数字必须能点到对应列表；健康默认安静；一处概念只出现一次；用宿主设计 token；破坏性操作要确认。P0 不实现 Watchdog 循环和订阅直通，控制台里这些块可以显示「未启用」，不要做假数据。

0.1.0 的分层工作流树不再作为默认主视图，DAG 放到工作项详情里。

### 2.3 中栏（群聊，参照 Grok Bot 的在场聊天）

主控制台仍然是 **DSH 原生会话**。把它做成群聊形态，而不是再开一个聊天窗口：

- 气泡旁是说话者的脸：默认是仓。探 / 作 / 验只在舞台上表演，不分别对人群发；若将来某条结果卡需要标明「验已签字」，用卡片内的静帧，而不是第二条人格发言。
- 三种卡就是发言动作，卡片样式克制、像在对话里递过来的文件，不要做成后台工单墙。
- 人用自然语言、`@探子` / `@施工` / `@验收`、或对审批卡回复「批准 / 改 AC / 否决」。
- 会话安静时，顶部迷你脸和右侧舞台仍在呼吸，代替「正在输入」。
- 输入区可用 `conversation.input.dock` 放一行字幕（如「仓正在看你 · 待批 WI-114」），不要在 dock 里堆进度日志。
- 若当前 Harness 版本提供消息级加法槽（如助手消息动作、turn tail），只用来放与该条卡相关的次要动作，不要插入过程行。

外部 IM（飞书等）仍是 P2 才接：那边通常做不了动画，只用静帧头像和卡片字幕。DSH 会话里要把动画和群聊气质做出来。

### 2.4 右栏（舞台）

继续用现有 `sidebar.right.pane.tab`（`id: ds-superbot`，与 `openTab` 的 kind `superbot` 对应），以及 `sidebar.right.pane.tab.title`、右侧栏引导页入口。不要注册 `rightbar` 去替换整列。

右侧是大舞台：四张脸的眼神与动作、一句状态字幕、当前选中工作项的详情（AC / 门禁 / 证据 / DAG / 实际模型 / 耗时 / tokens）。顶部的原生任务进度条可保留为次要计数。

---

## 3. 四张脸（脸谱）

短名用于字幕、`@` 抓手和文件名。不要再增加第五张常驻脸。

| 脸 | 目录名 | 能力 | 人怎么叫 | 谁在用它 |
| --- | --- | --- | --- | --- |
| 仓 | `cang` | Steward：接注意力、派单、唯一默认开口 | 不用 @，就是 ds-superbot 本身 | 始终在场 |
| 探 | `tan` | Discover：只读取证、出候选 | `@探子` | 探索中才提高能量，否则低能量待命 |
| 作 | `zuo` | Build：按文件所有权实施 | `@施工` 或 `@WI-…` | 每个施工中的工作项一个实例 |
| 验 | `yan` | Verify：独立验证 + 门禁脚本 | `@验收` | 每个验收中的工作项一个实例 |

并发时：第二份「作」不画新角色，只用同一张作的脸，右下角徽章写工作项短号。舞台第一排保持四张基础脸，需要时再加一行实例小头像，避免头像墙。

过渡期把 0.1.0 的 7 个角色章程映射到脸上，而不是为每个角色单做一套动画：

- `pm` / `architect` → 仓在「编译计划」时的姿态，或短时借探的扫视（不要新脸）
- `backend-dev` / `frontend-dev` → 作
- `qa-engineer` / `browser-tester` / `reviewer` → 验

视觉要求（原创，必须能在约 32–72 px 识别，气质参照 Grok Bot 的角色在场，不抄形象）：

- 半身或大头像，四分之三侧或正面，眼睛明显大于写实比例，装饰少，剪影可辨。
- 四张脸的轮廓、发型或头饰、服装色块必须明显不同。
- 不要做成仪表盘图标，不要用字母块代替脸，不要使用现成聊天产品或模型品牌的形象与配色梗。
- 跟随宿主亮暗色 token。

---

## 4. 眼神与动作

眼神是主通道，身体动作是辅通道，字幕给无障碍和一眼确认。顶部迷你脸、右侧舞台、群聊气泡头像、卡片字幕，全部调用同一个 `presenceOf`。

### 4.1 眼神

| 代号 | 名称 | 怎么演 | 何时 |
| --- | --- | --- | --- |
| `idle` | 闲 | 半睁，3–6 秒眨一次，间隔加一点随机 | 默认静默 |
| `scan` | 瞄 | 视线左右缓慢移动，眨眼仍在 | 探在 Candidate / Explored |
| `await` | 盯 | 看向用户，眨眼变少，瞳孔略停住 | 仓在 AwaitingApproval，或结果卡等你合并 |
| `focus` | 凝 | 微眯，看向斜下方或前方「工作点」 | 作在 Building |
| `inspect` | 审 | 视线上下打量，停顿后再看 | 验在 Verifying |
| `done` | 亮 | 略睁大、眉眼放松；保持约 2 秒再回到闲 | 刚进入 Delivered |
| `alert` | 警 | 先睁大一怔，随即稳住看向用户；禁止循环惊慌 | 刚进入 Failed |
| `down` | 垂 | 目光下垂或偏开，画面略降饱和 | Parked / Dropped |
| `avert` | 避 | 眼帘微垂，不看用户 | 此轮轮到别人开口，自己 PASS |

### 4.2 动作

| 代号 | 名称 | 怎么演 | 何时 |
| --- | --- | --- | --- |
| `breathe` | 呼吸 | 肩或头极小幅度起伏 | 全员默认垫底 |
| `gaze` | 注视 | 微前倾，面向用户 | 与 `await` 同时 |
| `search` | 扫视 | 头随眼神小幅转动 | 与 `scan` 同时 |
| `work` | 动手 | 手部或上身小循环，稳定不要狂躁 | 与 `focus` 同时 |
| `check` | 核对 | 短暂停、微点头或看向手边 | 与 `inspect` 同时 |
| `offer` | 递出 | 一次前倾或点头，随结果卡同时出现 | 仓在发言 result-ready 的瞬间 |
| `withdraw` | 退后 | 身体略转开 | 与 `avert` 同时 |
| `startle` | 一怔 | 单次，不循环 | 与 `alert` 同时 |
| `still` | 静止 | 几乎冻结，只保留极慢呼吸 | `down`，或系统 `prefers-reduced-motion` |

### 4.3 状态映射（必须写成纯函数，并配测试）

函数：`presenceOf({ workItem, face, speakKind })`，返回 `{ face, eye, motion, energy, caption }`。`energy` 只能是 `low` | `mid` | `high`。同一时刻全场 `high` 不得超过 1 个：若冲突，优先级为 `alert` > `await` > `offer`，其余降为 `mid` 或 `low`。

| 工作项状态 | 仓 | 探 | 作 | 验 |
| --- | --- | --- | --- | --- |
| Candidate / Explored | idle / breathe / low | scan / search / mid | idle / breathe / low | idle / breathe / low |
| Proposed（将出审批卡） | await / gaze / high | avert / withdraw / low | idle / breathe / low | idle / breathe / low |
| AwaitingApproval | await / gaze / high | avert / withdraw / low | avert / withdraw / low | avert / withdraw / low |
| Authorized / Planned / Approved | idle / breathe / low | idle / breathe / low | idle / breathe / low | idle / breathe / low |
| Building | idle / breathe / low | avert / withdraw / low | focus / work / mid | idle / breathe / low |
| Verifying | idle / breathe / low | avert / withdraw / low | avert / withdraw / low | inspect / check / mid |
| Delivered（出结果卡） | done→idle，动作 offer 一次 / high 再降 | idle | idle | done 短时 / mid 再降 |
| Failed | alert / startle / high | down 或 avert / low | down 或 avert / low | down 或 avert / low |
| Parked / Dropped | down / still / low | down / still / low | down / still / low | down / still / low |

字幕格式固定为：

```text
<脸>正在<一句短状态> · <WI-… 或无>
```

例子：`仓正在看你 · 待批 WI-114`，`作正在施工 · WI-113`，`验正在核对 · WI-113`，`仓已交出结果 · WI-114`。不超过 20 个汉字。

---

## 5. 技术约束（DSH 插件内）

插件包继续零运行时依赖、不引入打包器。动画只能用作用域样式（`.stwd-` 前缀）+ 宿主主题 token、内联或随插件分发的分层 SVG。禁止在 `packages/dsh-plugin` 引入 Lottie、Three.js、视频或任何 npm 动画库。禁止自建 `webServer`、独立端口或私有 HTTP 桥来承载控制台。

建议资产目录：

```text
packages/dsh-plugin/assets/residents/
  cang/face.svg
  tan/face.svg
  zuo/face.svg
  yan/face.svg
  README.md          # 四张均为正式原创脸谱；短名与 presence 代号不得改
```

每张脸是可分层 SVG：脸底、眼白、瞳孔、眼睑、眉。用 class 切换眼神，用 CSS transform / opacity 做呼吸、眨眼、点头。眨眼间隔 3–6 秒并加抖动；循环动画 2–4 秒一圈。

无障碍与降动效（必须做）：

- 每个头像有 `aria-label`，内容与字幕一致，例如「仓，正在看你，待批 WI-114」。
- 控制台和工作项条用文字状态，不把信息只放在眼神里。
- 若 `prefers-reduced-motion: reduce`，停掉循环，切到该状态的静帧（`still`）。

`packages/im/src/presence.mjs`（P0 必须落地，纯函数、有测试）是唯一映射表实现。顶部迷你脸、右侧舞台、群聊气泡头像、卡片字幕都只调用它，不要在 `client.js` 再写一套 if/else。

槽位 id 约定：

- 右侧舞台 tab：保持 `id: ds-superbot`、kind `superbot`（兼容 0.1.0）。
- 左侧控制台：`sidebar.panellist` / `main` 使用 `id: ds-superbot-console`。
- 样式前缀 `.stwd-`、localStorage 键前缀、工具名一律不改。

参考（实现时按已安装版本核对，不要把过期名称写死到会崩溃的路径）：

- 对话槽：[ui-conversation slots.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/contract/slots.ts)
- 左栏加面板：[ui-sidebar README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar/README.md)
- 壳层槽（不要占用 `sidebar` / `rightbar`）：[ui-layout](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/src/client/index.ts)
- 控制台信息结构：[superagent 面板 005](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/HEAD/docs/005-panel.md)

---

## 6. 和实施阶段的关系

- **P0**：实现 `presenceOf` 与测试；放四张占位 SVG（几何简化脸亦可，但必须四张可区分，并在 README 标明「占位」）；把本文落入 `docs/product/INTERACTION.md`。不改现有右侧栏行为，不注册新的左栏主面板，以免 0.1.0 宿主测试大面积翻车。可在 DEVELOPMENT 中写明 P2 的槽位清单。
- **P2**：已按本文接上顶部迷你脸、左侧控制台、右侧舞台和群聊卡片头像（槽位对照安装的 DeepSeek Harness 0.2.2-rc.2）；全部走官方加法槽；外部 IM 厂商不在本轮选定，只提供静帧和字幕辅助。
- 正式脸谱绘制可以后补，但不能改变四张脸的短名、目录名和状态代号。换皮不得改契约。
- **P6**：四张占位 SVG 已换成正式原创脸谱，短名 / 目录 / `presenceOf` 状态代号不变。

---

## 7. 验收（P2 界面完成时）

1. 左、顶、右都有 ds-superbot 的加法界面；宿主原有会话列表、标题栏和右侧文件/终端等能力仍在，没有被整栏替换。
2. 默认同席最多一个高能量头像；四个基础脸能在静默时只靠呼吸/眨眼被看出「还在」。
3. 工作项进入 AwaitingApproval 时，仓进入「盯 + 注视」，聊天里只出现审批卡，没有过程消息；左侧控制台把这条放在「待你决定」最上方。
4. Building / Verifying 时作或验进入中能量循环，聊天保持静默。
5. Delivered / Failed 时仓给出一次递出或一怔，同时出结果卡；警不循环。
6. 打开系统「减少动态效果」后，无循环动画，控制台文字状态仍完整。
7. 现有工具名、右侧 tab id、`.stwd-` 前缀、localStorage 键不变。
