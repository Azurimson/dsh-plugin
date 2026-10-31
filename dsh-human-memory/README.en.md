> English | [中文](./README.md)

# dsh-human-memory

> Version **0.1.4** | For the changelog and testing instructions, see [更新文档.md](./更新文档.md)

A local plugin that gives DeepSeek Harness (DSH) a cognitive-science-inspired form of “human-like memory.”

- **Forgetting curve** (time decay): memories fade quickly at first, then more slowly over time.
- **Content importance** (six-dimensional scoring): content that is meaningful, structured, specific, self-relevant, distinctive, or emotional — or that has a longer dwell time — is remembered more strongly.
- **Spaced repetition + spacing effect**: the longer the interval before the same event is mentioned again, the more the memory is reinforced.
- **Consolidation** (analogous to sleep consolidation): merge and distill high-value episodic memories into semantic memories.
- **Active review**: surface memories that are close to being forgotten.
- **Automatic self-check every turn**: after each conversation turn, automatically decide which information is worth remembering and write it.
- **Behavioral memory + timeline**: record “what was done” each turn; retrieve it in order by day / session.
- **Working-memory layer**: precisely record “which files were changed and which commands were run”; low weight, short-lived.
- **Event date**: each memory records “when the event occurred,” so it can answer “when did this happen?”
- **Memory granularity (gist / detail)**: by default only the gist is returned; details are included only when `detail` is requested (reflecting “details come back only through re-exposure”).
- **Emotional memory**: identify emotion from multiple signals (modal particles, punctuation, emphasis, repetition, rhetorical questions, emoji); the emotional core is retained with priority.
- **Database index**: built-in `node:sqlite` speeds up queries for “what happened on a given day / in a given session” (files remain the single source of truth).
- **Reconstructive recall**: recombine episodic/semantic/emotional/procedural/autobiographical material cued by the current context into a single version (not retrieval of one record).
- **Phased resumption**: `memory_resume` reconstructs “goal / what has been done / next step” from the session’s sequential records.
- **Prediction**: semantics supply concepts, episodic memory supplies cases, procedural memory supplies consequences, and emotion supplies risk.
- **Persona parameter network**: attention / retrieval / interpretation / expression weights influence “what comes to mind first.”
- **Settings card**: a button to open the memory folder plus a memory list sorted by weight.

**All memories are stored locally** (a directory-based memory store, with each memory in its own file); the plugin does not access the network or depend on any cloud database.

> This project is meant to spark discussion; both the architecture and the parameters are still rough, and experienced contributors are welcome to iterate on them. It is open source, and bug reports and improvement suggestions are welcome.

## Directory structure

```
dsh-human-memory/
├── package.json          # dsh.bundle + dsh.client manifest
├── cordis.patch.yml      # 插件挂载行
├── dsh.plugin.json       # 市场注册清单
├── settings.json         # 所有权重与参数（中文注释，可直接改）
├── LICENSE
├── README.md
├── src/
│   ├── index.js          # 插件入口：工具 / 命令 / 事件 / 自动自查
│   ├── memory.js         # 记忆引擎（评分 / 衰减 / 间隔 / 巩固 / 粒度 / 情绪 / 重构 / 续接 / 预测）
│   ├── emotion.js        # 情绪识别（多信号加权）
│   ├── persona.js        # 人格参数网（注意 / 提取 / 解释 / 表达）
│   ├── index-db.js       # node:sqlite 索引（按天/会话/事件查询）
│   ├── store.js          # 目录式记忆库（memories/<layer>/ + index.json + trash/）
│   ├── settings.js       # 配置加载与默认值
│   └── gui.js            # 设置卡片的数据接口（注册到 DSH webServer）
├── client/
│   └── client.js         # 设置区卡片（lazy-CJS，注册到 settings.section）
├── test/
│   ├── self-test.mjs     # 核心逻辑自测
│   ├── emotion-test.mjs  # 情绪识别实测
│   ├── library-test.mjs  # 目录式记忆库与迁移自测
│   ├── consolidate-test.mjs # 巩固实测
│   ├── db-test.mjs       # node:sqlite 索引实测
│   ├── reconstruct-test.mjs # 重构底座实测
│   ├── persona-test.mjs  # 人格参数网实测
│   ├── gui-test.mjs      # 记忆接口服务实测
│   └── plugin-smoke.mjs  # 入口冒烟（mock DSH ctx）
├── 实现思路.md
├── 设计-记忆类型与数据库.md
├── 设计-重构与人格.md
├── 备选方案-人类记忆缺陷.md
├── 测试文档.md
├── 更新文档.md
├── 迭代方向-用户画像记忆.md
└── 迭代方向-会话短期记忆.md
```

The runtime memory-store layout (`~/.dsh/human-memory/`):

```
human-memory/
├── index.json                  # 人类可读索引（含日期、重要性、内容预览）
├── state.json                  # 调度状态（上次巩固时间等）
├── persona.json                # 人格参数（运行时写入；可选）
├── .index/memory.sqlite        # node:sqlite 索引（可删，重扫即重建）
├── trash/                      # 删除缓冲区：删除的记忆先移到这里，下次巩固时真正删除
│   └── <id>.json
└── memories/
    ├── working/<id>.json       # 工作记忆：精确操作，低权重、短寿命
    ├── episodic/<id>.json      # 情节记忆：这一轮做了什么
    ├── semantic/<id>.json      # 语义记忆：巩固后的事实/偏好
    ├── procedural/<id>.json    # 程序记忆：技能 / 习惯（“下次怎么做”）
    ├── autobiographical/<id>.json # 自传体：跨事件的自我叙事 / 人格反馈
    └── core/<id>.json          # 核心记忆：极重要
```

## Installation

This plugin is **pure ESM JavaScript with no build step**, so it can be installed and loaded directly:

```sh
dsh plugin --profile <你的 profile> add ./dsh-human-memory
```

Restart Web Harness for the changes to take effect. To uninstall:

```sh
dsh plugin --profile <你的 profile> remove dsh-human-memory
```

> `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are provided as peerDependencies by the DSH host; the plugin does not need to install them itself.

## Provided tools (model-callable)

| Tool | Purpose |
|------|---------|
| `memory_write` | Write / re-mention a memory (optionally with details, eventId, cues, source, status) |
| `memory_recall` | Recall by “relevance + strength + importance”; `detail` controls whether details are returned |
| `memory_timeline` | Retrieve “what was done each turn” in chronological order by day / session; `detail` includes details |
| `memory_reconstruct` | Recombine distributed memories into one version based on cues (episodic/semantic/emotional/procedural/autobiographical) |
| `memory_resume` | Phased resumption: reconstruct the session’s sequential records into “goal / what has been done / next step” |
| `memory_predict` | Use prior experience to predict the current situation (concept/case/consequence/risk) |
| `memory_feedback` | Record a piece of persona feedback (e.g. “speak more logically”) |
| `memory_persona` | View persona parameters and the incremental suggestions derived from feedback |
| `memory_persona_update` | Change one persona parameter and write it to `persona.json` |
| `memory_forget` | Permanently delete a memory |
| `memory_rescan` | Rescan the memory store and rebuild the index (called by DSH when the user issues the command) |
| `memory_doctor` | Check memory-store health: record count, index, trash, corrupted files, candidates/feedback |
| `memory_consolidate` | Episodic memory → semantic memory |
| `memory_review` | List memories that are close to being forgotten |

## Slash commands (manually triggered by the user)

- `/memory-review` — List memories that are close to being forgotten
- `/memory-consolidate` — Manually trigger a consolidation pass
- `/memory-list` — List all local memories
- `/memory-rescan` — Rescan the memory store and rebuild the index

## Settings card

- Location: **the “Memory” section on the left side of the settings page** (`settings.section` slot, following the approach used by `dsh-notify-say`).
- Top: a row of folder buttons — **All / Working / Episodic / Semantic / Core / Trash** (with counts); clicking one shows only memories in that folder.
- Top right: **Weight↓** (sort by `importance` descending, the default), **Time↓** (sort by `occurredAt` newest first), refresh, and open the memory folder.
- Each list item shows the layer, behavior/operation marker, occurrence time, and short id of the source session; a delete button (a restore button in the trash) appears on the right.
- Delete: clicking does **not** show a confirmation and removes the item from the list immediately; the record is **moved** to the memory store’s `trash/` folder (where it can be backed up/restored) and is permanently deleted at the next consolidation.
- Data source: routes on DSH’s built-in web server — `/api/dsh-human-memory/memories`, `/api/dsh-human-memory/delete`, `/api/dsh-human-memory/trash`, `/api/dsh-human-memory/restore`, and `/api/dsh-human-memory/open-folder` (no separate port is used).
- Note: the card runs on the browser side and cannot read host memory, so it fetches data through host routes; it is not a web GUI and has no standalone page.

## Configuration

Edit `settings.json` (Chinese `//` comments are supported) and restart DSH for changes to take effect. Key parameters:

- `autoCapture.enabled` / `minChars` / `maxPerTurn` / `includeAssistant` — per-turn automatic self-check toggle and thresholds
- `autoCapture.turnLog` — whether to record “behavioral memory” (for timeline retrieval)
- `storage.trashDir` — name of the deleted-item buffer folder (default `trash`, located at the memory-store root)
- `database.enabled` / `dir` / `fileName` — node:sqlite index (default `.index/memory.sqlite`, can be deleted and rebuilt)
- `emotion.threshold` — emotion intensity must reach this value for the memory to be recorded as emotional (default 0.2)
- `persona.attention` / `retrieval` / `interpretation` / `expression` — persona parameter network (attention/retrieval/interpretation/expression weights; overridden by `persona.json`)
- `workingMemory.enabled` / `capacity` / `minRetentionMs` / `importance` — working memory (`capacity: 0` means no limit; `minRetentionMs` defaults to 24h, and pruning happens only at the 24h consolidation checkpoint)
- `gui.enabled` — whether to register the data routes for the settings card
- `forgetting.tauMs` / `c` — forgetting-curve speed and shape
- `importance.*` — six-dimensional importance weights (including memory duration, `dwell`)
- `retrieval.*` — retrieval ranking weights
- `spacing.kappa` / `reinforce` — spacing-effect strength
- `consolidation.*` — consolidation thresholds, archival policy, and `intervalMs` (default 24h; no longer triggered every turn)
- `review.mode` — active-review mode (`manual` / `auto` / `off`)

See the comments in the file for full meanings, and [实现思路.md](./实现思路.md) for the design rationale.

## How to verify that the plugin is working

### 1. Core logic and memory-store self-tests (fastest; DSH not required)

```sh
pnpm test        # self + emotion + library + consolidate + db + reconstruct + persona + gui + client + robustness
# 或分别跑：
node test/self-test.mjs
node test/emotion-test.mjs
node test/library-test.mjs
node test/consolidate-test.mjs
node test/db-test.mjs
node test/reconstruct-test.mjs
node test/persona-test.mjs
node test/gui-test.mjs
node test/client-test.mjs
node test/robustness-test.mjs
```

`self-test` has 32 checks, `emotion-test` 9, `library-test` 15, `consolidate-test` 10, `db-test` 8, `reconstruct-test` 9, `persona-test` 6, `gui-test` 17, `client-test` 4, and `robustness-test` 3.

### 2. Confirm that DSH has loaded the plugin

After restarting DSH, if the previous activation warning is gone, the plugin has loaded. You can also say in the conversation, “List the memory-related tools currently available to you”; you should see 14 tools: `memory_write` / `memory_recall` / `memory_timeline` / `memory_reconstruct` / `memory_resume` / `memory_predict` / `memory_feedback` / `memory_persona` / `memory_persona_update` / `memory_forget` / `memory_rescan` / `memory_doctor` / `memory_consolidate` / `memory_review`.

### 3. End-to-end functional tests

| Action | Expected result |
|------|------|
| Say “Remember: this project is developed with Python and Vue” | Calls `memory_write` and returns “Remembered …” |
| Say “What language is my project written in?” | Calls `memory_recall` and answers Python / Vue |
| Say “What did we do in this session today?” | Calls `memory_timeline` and lists each turn in order |
| Enter `/memory-list` | Lists the memories just written |
| Enter `/memory-review` | Lists memories that are close to being forgotten |
| Open Settings → Plugins → dsh-human-memory | The card is visible (open-folder button + weight-sorted list) |
| Write several similar memories, then enter `/memory-consolidate` | A semantic memory is created and the original episodic memories are archived |

### 4. Inspect local data

The memory store is located at `~/.dsh/human-memory/` by default (on Windows: `C:\Users\<你>\.dsh\human-memory\`). A record looks like:

```json
{ "id": "mem-…", "content": "…", "layer": "episodic", "kind": "fact", "occurredAt": 1793248628335, "importance": 0.58 }
```

A working-memory record looks like:

```json
{ "id": "work-…", "content": "写文件：src/index.js", "layer": "working", "kind": "tool", "importance": 0.05 }
```

### 5. Plugin entry-point self-test (optional; requires a mock, or a DSH host that provides `@deepseek-ai/dsh-tools`)

```sh
node test/plugin-smoke.mjs
```

Runs `apply()` once with a mock ctx and verifies the 14 tools, 4 commands, automatic self-check, behavioral/working memory (including deduplication), reconstruction/resumption/prediction/persona, `memory_rescan`, `memory_doctor`, and directory-based persistence (31 checks).

See [测试文档.md](./测试文档.md) for the complete acceptance checklist.

## Repository layout

The repository is organized for publishing: `package.json`’s `dsh.bundle` / `dsh.client` / `exports`, plus `cordis.patch.yml`, `dsh.plugin.json`, `LICENSE`, and `.github/workflows/ci.yml`. When pushing to GitHub, add the `dsh-plugin` topic so the marketplace can recognize it by convention.

## Current limitations (contributions welcome)

- **Settings card** is registered in `settings.section` (the “Memory” section on the left side of the settings page); its data is served through the `/api/dsh-human-memory` routes on DSH’s built-in web server.
- **Database index** uses Node’s built-in `node:sqlite` (zero extra build); files remain the single source of truth; external changes require a rescan with `memory_rescan`.
- **Emotion detection** is a local heuristic (multi-signal weighting), not LLM semantic judgment, so it can misclassify; `emotion.threshold` is configurable.
- **Reconstruction** is a deterministic composition (relevance + cues + strength), not LLM generation; `confidence` and `gaps` indicate uncertainty.
- **Persona parameters** affect only the memory side (attention/retrieval) and do not replace higher-level decision-making; `persona.json` overrides `settings.json`.
- **Event cues (cues)** are currently supplied at write time plus rough rule-based extraction; NER is not integrated.
- **Working memory** has no item limit by default and is reclaimed via a 24-hour TTL at consolidation checkpoints; it participates in recall, review, and consolidation but is deliberately given very low weight (0.05); repeated identical operations in the same session are deduplicated.
- **Consolidation and working-memory reclamation** run once every 24 hours (`consolidation.intervalMs`), not every turn.
- **Working memory** currently records only tool calls (files/commands); finer-grained parameter diffs are not yet recorded.
- **Behavioral memory** is a lightweight summary of “user + assistant + tool name.”
- **User-profile memory** (verbal tics, sentence patterns, reasoning habits) is a future direction; see [迭代方向-用户画像记忆.md](./迭代方向-用户画像记忆.md).
- **Session short-term memory** (to reduce the agent’s repeated rereading of context) is a future direction; see [迭代方向-会话短期记忆.md](./迭代方向-会话短期记忆.md).
- **Semantic relevance** uses character n-grams; embeddings are not integrated.
- **Consolidation** is rule-based concatenation; LLM summarization is not integrated.
- **The initiator of automatic review** (DSH-initiated vs. user command) has not been decided.
- **Multiple instances writing to the same memory store concurrently** have no file lock, so later writes overwrite earlier ones (not an issue within a single instance).
