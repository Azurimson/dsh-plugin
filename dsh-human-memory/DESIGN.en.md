> English | [中文](./实现思路.md)

# Design Notes for the DSH Human Memory System (Human Memory)

> A conversation starter: this document and the accompanying code only turn the idea of "giving AI a forgetting curve" into a first version — both the architecture and the parameters are still rough. It is open source, so bug reports and suggestions for improvement are welcome.

## 1. Project goals and positioning

Give DSH (DeepSeek Harness) a "human-like memory" inspired by cognitive science. The core idea is not "store everything and retrieve it all equally", but to imitate the brain's **tiered storage, selective forgetting, and spaced repetition**: what matters is remembered firmly, what is irrelevant slowly fades, and at the decisive moment memory is called up through "active recall".

The positioning is a **local DSH plugin**:

- All memories live on the local machine (as plain JSON files), with no networking and no cloud database.
- There is therefore no trade-off between "integrate an external open-source memory engine / rework a remote RAG / integrate a third party deeply" — there is only one path: **implement it inside the DSH plugin model, using local files plus a scoring formula**.

Two classic findings from cognitive science drive the design directly:

- **Forgetting curve (Ebbinghaus)**: new content is forgotten "quickly at first, then slowly" → this determines the **temporal dimension** of memory.
- **Content factors**: content that is meaningful, structured, concrete, self-relevant, distinctive, emotional, and **dwelt on for a long time** is retained more easily → this determines the **quality dimension** of memory.

## 2. Core design principle: forgetting = reduced accessibility, not deletion

In one sentence: **simulate the accessibility of a memory with a multi-factor weighted retrieval score, rather than deleting it physically.** "Forgetting" in AI does not mean deleting data; it means lowering that memory's rank at retrieval time, so that it "cannot be recalled".

This answers a key question directly:

### Question 1: Does decay over time mean memories must be actively updated every day? Is it feasible, and how?

**It is feasible, and it does not require daily updates.** The method is **lazy decay**:

- At write time only two "anchors" are recorded: the creation time `createdAt` and the time of the last reinforcement/access `lastAccessedAt`.
- **Nothing is ever batch-refreshed in the background.** The decay value is computed on the spot, at the instant the memory is read, from `now - lastAccessedAt`:

```
强度 S(m, now) = Importance(m) · exp( -( age / τ )^c )
```

- `age = now - lastAccessedAt`, `τ` is the decay rate, and `c` is the curve shape (`c<1` gives the classic Ebbinghaus shape: steep first, then gentle).

Thus a memory that has sat untouched for 30 days still **has no daily job updating it**; only when it is retrieved does the system compute, from the current time, how much of it has already been "forgotten". This is exactly how the human brain works — stop thinking about something and it quietly fades; think of it again and it gets "refreshed".

## 3. Tiered memory architecture

Rather than cramming every conversation into one store, memories are split into four tiers by directory (all persisted):

| Tier | Purpose | Analogy | Storage strategy |
|------|---------|---------|------------------|
| Working memory `working` | Exact operations: which file was changed, which commands were run | Sticky note / whiteboard | Low weight (0.05 by default), short life (24h TTL, no item cap), cleaned up automatically |
| Episodic memory `episodic` | A distilled summary of "what was done" each turn | Diary | Summary + session/turn/timestamp, normal weight |
| Semantic memory `semantic` | Distilled facts and preferences | Personal dossier | "Consolidated" out of episodic memories (e.g. "the user prefers Python") |
| Core memory `core` | Extremely important, kept forever | Safe | High importance threshold, almost never forgotten |

Under the `memories/` directory these correspond to `working/`, `episodic/`, `semantic/`, `core/`.

### Working memory vs. episodic memory: division of labor

> Requirement: exact records (which file was changed, which commands were run) belong to working memory; episodic memory focuses on "distilling what was done".

| Dimension | Working memory `working` | Episodic memory `episodic` |
|-----------|--------------------------|----------------------------|
| What it records | **Exact operations** (file paths, commands) | A **distillation** of "what this turn did" |
| Weight | Very low (0.05), fades fast | Normal, subject to the forgetting curve |
| Lifetime | Short (24h TTL, no item cap) | Long (unless consolidated and archived) |
| Retrieval | Participates in recall / review / consolidation (expires by relative retention ratio) | Participates in the timeline and consolidation |

This is precisely the imitation of human memory: **the details are forgotten first, and what remains is the gist of "what was done"**.

> From 0.1.3 onward this adds "granularity (gist/detail)", "emotion facets", "multi-facet storage", and a `node:sqlite` index; see [设计-记忆类型与数据库.md](./设计-记忆类型与数据库.md).
>
> From 0.1.4 onward it moves into "reconstruction groundwork + persona wiring": distribution is strung together with `eventId/cues`, recall becomes read-time reconstruction (episodic/semantic/emotional/procedural/autobiographical), and the persona parameter network takes part in choosing material. See [设计-重构与人格.md](./设计-重构与人格.md).

## 4. The mathematics of forgetting and memory strength

The final ranking score for retrieving a memory:

```
Score(m, q) = α · Relevance(m, q) + β · Strength(m) + γ · Importance(m)
```

- **Relevance (semantic relatedness)**: how well the query `q` matches the memory `m`. The first version uses Jaccard similarity over character n-grams (Chinese is split into single characters and two-character groups); this can be replaced by embedding vectors later.
- **Strength (memory strength, including time decay)**: see section 2; this is where the "forgetting curve" lands.
- **Importance (content importance)**: see section 5; this is where the "content factors" land.
- The `α、β、γ` weights all live in `settings.json`, so the user can change them.

## 5. Content importance scoring (six dimensions, including "dwell time")

Importance (0–1) is computed when a memory is written, as a weighted sum of six dimensions (the weights are configurable):

| Dimension | Meaning | Definable description |
|-----------|---------|-----------------------|
| Self-relevance | Involves the user's goals/preferences/identity | Can be rephrased as "how this relates to one of my experiences/goals is…" |
| Causality/structure | Contains "because… therefore…", "first… then…" | Can state a causal chain or a sequence of steps |
| Concreteness | Contains identifiable names/places/numbers/events | Can be sketched or pointed at in real life within 5 seconds |
| Distinctiveness | Entirely new, clearly different from what is known | Each item in the same group has ≥2 distinguishing features |
| Emotional intensity | Strongly colored by emotion | Happy / angry / afraid / important |
| **Dwell time** | How long was spent on the same thing | The longer the dwell, the deeper the memory |

### Addendum: dwell time

> This was missing before: the longer a person spends on the same thing at the same time, the deeper the memory of that event.

It is implemented as a **saturation function**:

```
dwellFactor(dwellMs) = 1 - exp( -dwellMs / dwellRefMs )
```

`dwellRefMs` is a configurable reference duration; once the dwell time reaches that value, the dwell score ≈ 1. When the same thing is "brought up again", the dwell time **accumulates** onto the existing record instead of overwriting it.

## 6. Spaced repetition and the spacing effect

Forgetting alone is not enough; forgetting has to be countered by "bringing it up again". Two mechanisms stack here:

### Mechanism A: bringing it up again = deepening the memory (for "an event mentioned repeatedly should be remembered more deeply")

Each time `memory_write` writes a memory with **the same content** (or the user emphasizes a requirement again), no new record is created; instead the original record is **reinforced**:

- `mentionCount += 1`
- the importance score is raised
- `lastAccessedAt = now` (the time-decay anchor is reset, so the curve "climbs back up")

### Mechanism B: the spacing effect (for "the longer the gap, the higher the weight")

> The human pattern is: bringing something up several times in a short span strengthens the memory less than bringing it up again after a gap. Structurally this means: **the longer the gap, the higher the weight**.

The boost applied on reinforcement is not fixed; it grows with "the gap since it was last brought up":

```
gap = now - lastAccessedAt
spacingWeight = 1 + κ · log2( 1 + gap / spacingTau )
newImportance = min( Importance + reinforce · spacingWeight, maxImportance )
```

- `κ` (kappa) controls the strength of the spacing effect, and `spacingTau` is the normalization reference; both are in `settings.json`.
- The result: bring it up again the day after you just did → almost no bonus; bring it up after a month → a large bonus. This is a simplified version of spaced-repetition theory (SM-2 / FSRS).

There is also **retrieval as review**: when `memory_recall` hits a memory, it also updates that memory's access count and time anchor along the way, reinforcing it slightly.

## 7. Consolidation (analogous to sleep consolidation)

### Question 5: How should the periodic scan scan? The whole store, or only the high-value parts? How should tidying be done?

Earlier documents had only one sentence on consolidation; here it is spelled out. Consolidation **does not scan the whole store**; it **scans only high-value episodic memories**, in three steps:

1. **Selection (scan only the high-value part)**: from the episodic memories, pick the entries whose "current strength ≥ `strengthThreshold`" or whose "access count ≥ `minAccessCount`". Low-value memories that nobody touches do not take part, which avoids cementing noise.
2. **Clustering**: pair up the selected episodic memories by similarity (`mergeSimilarity`), grouping the similar ones into a cluster.
3. **Distill + archive**: each group (≥2 entries) is merged into one **semantic memory**; the original episodic memories are marked `archived` (kept, but excluded from routine retrieval and given lower weight).

In the first version step 3 is a **rule-based merge** (take the top few entries by access count and concatenate them into a summary), and the code leaves a clear place where `ctx.llm` can later be injected to have the model do real summarization — that is an already-stated iteration direction.

**Trigger timing**: by default it runs **every 24 hours** (`consolidation.intervalMs`), not every turn. The checkpoints are: the check at session end (runs only when due), 15 seconds after startup, and an hourly scheduled check. It can also be triggered by hand with the `/memory-consolidate` command or the `memory_consolidate` tool.

## 8. Active review (open question)

Besides "sleep consolidation" there should be an "active review": find the memories whose strength is below a threshold and which are close to being forgotten, and bring them back in front of the user/model.

**What is not yet settled is "who initiates it"**; both modes are already supported in the code and switched by `settings.review.mode`:

- **`manual` (default)**: the user triggers it with the `/memory-review` command. Stable and unobtrusive, but it relies on the user remembering to review.
- **`auto`**: when DSH is idle (`agent/status` turns `idle`), if more than `minIntervalMs` has passed since the last review, the due memories are injected into the context of the next request via `agent.inject`. More "human", but possibly intrusive, and the timing is hard to get right.
- **`off`** : disabled.

This one is **recorded for the record for now**; the default will be decided from actual experience once it is in use.

## 9. Automatic self-check: extracting memories after every turn

> Requirement: after every turn the system should check itself for information that ought to go into memory.

The current version no longer relies on the user saying "remember: " every time; instead it **checks itself at the end of every turn**:

1. **Buffering**: listen on `session/event`, buffer this turn's `user/message` text (and optionally `assistant/message`) per session, and record the event time.
2. **Filtering**: at the end of each turn (`agent/turn-stopping`), apply heuristic checks to the buffered text:
   - length ≥ `autoCapture.minChars`;
   - not a question (does not end with "?" or "吗"), not a greeting;
   - not an injected prompt (starts with `【` / `[` or is too long);
   - contains "worth remembering" signal words (我叫 / 我的 / 项目 / 偏好 / 要求 / 配置 / 版本 / 决定 / 规则…).
3. **Writing**: matching text is written as an episodic memory, with **this turn's event time** as `occurredAt`; when the content is exactly identical it goes through the "brought up again" reinforcement path.

At most `autoCapture.maxPerTurn` records are written per turn, to avoid flooding. It is **heuristic** rather than LLM semantic judgment, so it can miss things or record the wrong thing; you can adjust the thresholds under `autoCapture` in `settings.json`, or turn the self-check off and use explicit `memory_write` calls instead.

**Trigger timing**: the automatic self-check runs at the end of each turn (`agent/turn-stopping`); consolidation and working memory reclamation run on a 24-hour interval, and the two are no longer mixed together.

## 10. Memory library structure (directory-based) and event dates

### 10.1 Directory-based memory library

> Requirement: all memories should not be crammed into one file; a memory library should be created.

At runtime the memory library is organized as "one file per memory, one directory per layer":

```
~/.dsh/human-memory/
├── index.json                  # 人类可读索引（日期、重要性、内容预览）
└── memories/
    ├── episodic/<id>.json
    ├── semantic/<id>.json
    └── core/<id>.json
```

The benefits: a single memory can be inspected/backed up/migrated on its own; a write only rewrites that one file instead of the entire store; `index.json` is convenient for human browsing. On load, `memories/*/*.json` is scanned; the old single-file `memories.json` is migrated automatically to the directory structure on first load and backed up as `.bak`.

### 10.2 Event date (answering "when did this happen")

> Requirement: it must be able to answer "when did this happen".

Besides `createdAt` (write time) and `lastAccessedAt` (last access), every record gains **`occurredAt` = when the event actually happened**:

- `memory_write` accepts `occurredAt` (ISO / `YYYY-MM-DD` / epoch milliseconds); it defaults to the write time;
- when the automatic self-check writes a memory, it uses this turn's event `event.time` as `occurredAt`;
- when the same event is mentioned again, **the earliest occurrence time is kept**;
- the output of `memory_recall` / `/memory-list` / `/memory-review` all carry "YYYY-MM-DD HH:mm".

So when the user asks "when did this happen", the model can read the date straight out of the recall result and answer.

### 10.3 Behavior memory and the timeline (answering "what did that session do that day")

> Requirement: at the end of each turn, distill "what this turn did"; when the same session has several turns on the same day, every turn should be retrievable in order.

Implementation:

- At the end of every turn (`agent/turn-stopping`), this turn's "user input + assistant reply" summary is written as a behavior memory with `kind: 'turn'`, carrying `sessionId`, `turn`, and `occurredAt`;
- behavior memories do not take part in `memory_recall`'s factual recall (to avoid noise) and are retrieved separately by `memory_timeline`;
- `memory_timeline({ date?, sessionId?, limit? })` returns every turn of a given day / session in **chronological** order.

Limitation: currently it is a lightweight summary of "user + assistant text"; to be precise about "which files were changed, which commands were executed", it needs to be wired further into `tool/call` / `tool/result` events.

### 10.4 Settings-section card (the only GUI)

> Requirement: only a settings-section card, like the other plugins; no standalone web GUI.

- The browser-side half `client/client.js` registers a settings-page section into **`settings.section`** via `window.__ModuleLoader__.load({ id, factory(require) })` (lazy-CJS, DSH's own format), following the approach in `dsh-notify-say`;
- the card renders in the **"Memory" section on the left of the settings page**: an "Open memory folder" button at the top, and below it the memory list in descending weight order;
- the card runs on the browser side and cannot read host memory, so the Host uses `ctx.inject(['webServer'])` to register the read-only routes `/api/dsh-human-memory/memories` and `/api/dsh-human-memory/open-folder` on DSH's built-in web server as the data channel (no extra port is opened);
- it is not a web GUI: there is no standalone page (`GET /` returns 404), and no command that opens a browser.

### 10.5 Delete buffer (trash folder)

- "Delete" on the card **asks for no confirmation** and removes the record from the list immediately.
- The backend **moves the record file into the memory library's `trash/` folder** (the folder name is configured by `storage.trashDir`, default `trash`), so it no longer appears in the current memory view, recall, review, or consolidation; the file is kept, which makes backup/restore easy.
- On the next consolidation it is physically deleted in one go (files under `trash/` are removed); it can also be restored through `POST /restore`.

## 11. Configuration file (settings.json)

All tunable parameters are collected in one `settings.json` (JSONC, `//` comments supported), **every field has a Chinese comment explaining what it does**, and users can edit the file directly without touching code. It covers:

- storage paths and write-to-disk policy
- automatic self-check switch and thresholds (`autoCapture`)
- forgetting-curve parameters (`tauMs`, `c`, the power-law switch and `β`)
- the six-dimension importance weights
- the three retrieval weights (`α/β/γ`)
- spacing-effect parameters (`κ`, `reinforce`)
- consolidation thresholds, archiving policy, and the **trigger interval** `intervalMs`
- active-review mode and thresholds
- working memory: `capacity` (0 = unlimited), `minRetentionMs` (minimum retention), `importance` (weight), `enabled`

If configuration loading fails or a field is missing, the defaults are used and a warning is raised, so the plugin never crashes.

## 12. First-version implementation structure

```
dsh-human-memory/
├── package.json / cordis.patch.yml      # 插件 manifest 与挂载行
├── settings.json                        # 权重与参数（中文注释）
├── src/
│   ├── index.js        # 入口：5 个工具 + 3 个命令 + 自动自查 + 巩固
│   ├── memory.js       # 核心：评分 / 衰减 / 间隔 / 巩固 / 复习 / 日期
│   ├── store.js        # 目录式记忆库（memories/ + index.json + 迁移）
│   └── settings.js     # 配置加载与默认值
├── test/               # self-test.mjs / plugin-smoke.mjs
└── 实现思路.md / 备选方案-人类记忆缺陷.md / 测试文档.md / README.md
```

The plugin plugs in through DSH's standard plugin model: `ctx.tools.register` registers tools, `ctx.commands` registers commands, `ctx.on('session/event')` buffers conversations, and `ctx.on('agent/turn-stopping')` runs the automatic self-check; consolidation and working memory reclamation run on a 24-hour cadence.

## 13. Known limitations and iteration directions

- **The automatic self-check is heuristic** (keywords + length + filters), not LLM semantic judgment, so it may miss or mis-record → `ctx.llm` could be wired in for semantic extraction.
- **Behavior memories are a "user + assistant + tool names" summary** (the tool names plus files/commands from `tool/call` are already wired in), but argument diffs are not recorded yet.
- **Working memory** has landed as `memories/working/` (low weight, short life, automatic cleanup), but it only records file/command-level operations.
- **Conversational habits / user profile**: see [迭代方向-用户画像记忆.md](./迭代方向-用户画像记忆.md); **a future direction, not implemented yet**.
- **Semantic relatedness** is currently n-gram similarity, and long texts or cross-phrasing semantic matches are inaccurate → wire in embeddings.
- **Consolidation distillation** is currently rule-based concatenation → wire in `ctx.llm` for summarization.
- **The initiator of automatic review** (DSH-initiated vs. user command) is not settled yet.
- **Multiple concurrent instances** writing to the same memory library have no file lock, so the later write wins (harmless within a single instance).
- **The settings-section card** registers under `settings.section` (the "Memory" section on the left of the settings page), and its data goes through the `/api/dsh-human-memory` routes of DSH's built-in web server.
- **Marketplace distribution**: currently installed locally via `link:`; it must be published to npm/git and tagged with the `dsh-plugin` topic before the marketplace can scan it.

## 14. Summary

The key to giving DSH a forgetting curve is to simulate memory accessibility with a **multi-factor weighted retrieval score**:

- **Tiered architecture + a directory-based memory library** manage lifetime and persistence;
- **importance scoring (including dwell time)** expresses the content factors;
- **time decay (computed lazily, with no daily updates)** expresses the forgetting curve;
- **spaced repetition + the spacing effect (the longer the gap, the higher the weight)** make memory firmer the more it is used;
- **an automatic self-check every turn** lets memories settle naturally during conversation;
- **consolidation (scanning only the high-value part) and active review** correspond to sleep consolidation and retrieval practice respectively;
- **`occurredAt`** makes "when did this happen" answerable.

The three together determine a memory's rank at retrieval time. All weights and parameters are gathered in `settings.json` and can be tuned by the user. This is only a first version — further iteration is welcome.
