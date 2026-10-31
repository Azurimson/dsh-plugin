> English | [中文](./设计-记忆类型与数据库.md)

# Design: Memory Typing and Database Indexing (0.1.3)

> This document records two designs from 0.1.3: **three-axis memory typing** and the **node:sqlite index**. The code is implemented; see [测试文档.md](./测试文档.md) for the tests.

## 1. Three-Axis Memory Typing

Humans recall different kinds of memory in different ways: working memory only remembers "what happened that day", and details come back only on renewed contact; emotional memory foregrounds the emotional core and fades the periphery. In the design this maps to three axes.

### Axis A: Granularity (gist / detail)

Every memory carries a `fidelity` field:

- `gist` (default): the gist; visible by default and resistant to forgetting;
- `detail`: the details; not returned by default, brought out only by a `detail` query or by cues.

**Why it is needed**: a database can retrieve anything by predicate, but "can be retrieved" does not mean "should be returned by default". Returning only the gist by default avoids dumping every file, command and argument when someone asks "what did you do yesterday".

**Where the cues come from**: no separate `cues` index is maintained — the database's `session_id`, `occurred_at` and `layer` are the cues. Axis A is only responsible for "gist by default, details on drill-down".

**Interfaces**:

- `memory_recall({ query, detail?: boolean })`
- `memory_timeline({ date?, sessionId?, detail?: boolean })`

### Axis B: Emotion Recognition

Rather than matching only 「开心/生气」, it weights multiple signals:

| Signal | Example | Weight |
|------|------|------|
| Explicit emotion words | 开心、生气、难过、害怕、讨厌、惊喜、沮丧 | 0.5 |
| Complaint / repetition patterns | 又…这样 / 又…错 / 又…搞 | 0.4 |
| Particles / interjections | 哇、哦、啊、唉、哎、呀、哈、嗯、哼、咦、呜、靠、卧槽、天哪、绝了、离谱、服了、无语、麻了、破防、上头、下头、笑死、哭死 | 0.3 |
| Intensifying adverbs | 太、真、特别、非常、超级、巨、简直、完全、根本、竟然、居然、怎么 | 0.2 |
| Rhetorical questions / sarcasm | 不是吧、这也行、行吧、随便、呵呵、就这 | 0.2 |
| emoji | 😄😡😭😱 | 0.2 |
| Repetition / drawn-out sounds | 好好好、哈哈哈、啊啊啊 | 0.15 |
| Punctuation | `!`/`！` (capped at 0.3), `……`/`...` (0.2), `?`/`？` (0.1), `~`/`～` (0.1) | 0.1–0.3 |

```
intensity = 1 - exp(-sum(weights))      // 0..1，饱和
kind      = 权重最高的非 neutral 信号
core      = 包含最强信号的子句
```

Only when the intensity is ≥ `settings.emotion.threshold` (default 0.2) is the memory recorded as an "emotional memory".

### Axis C: One Record + Multiple Facets

A single 「哇你又犯错了」 carries emotion, event and operational detail at once. **Do not split it into three records** (that duplicates data and makes decay inconsistent); instead, one event record carries multiple fields:

```jsonc
{
  "layer": "episodic",
  "kind": "event",
  "content": "用户指出我又犯了同类错误",      // gist
  "fidelity": "gist",
  "details": ["涉及文件：…", "命令：…"],       // 细节 facet
  "emotionKind": "frustration",
  "emotionIntensity": 0.55,
  "emotionCore": "哇…又…",
  "sessionId": "…",
  "tags": ["error", "recurring"]
}
```

- **Layer**: decide by the nature of the event first → `episodic`; emotion is a facet and does not take a layer of its own.
- **Details**: concrete files/commands go into `details` (or into a related `working` record with `fidelity: "detail"`), and are surfaced only in detail mode.
- **Recurrence**: `reinforce`, keeping the larger `emotionIntensity`; repeated occurrences can be promoted to `core`.

## 2. Database Index (node:sqlite)

### Principles

- **Files remain the single source of truth**: `memories/<layer>/<id>.json`, `trash/` and `state.json` are unchanged.
- **The database is only a rebuildable index**: `<root>/.index/memory.sqlite`, which can be deleted and rebuilt from the files.
- **Zero extra build step**: uses Node's built-in `node:sqlite` (verified working on DSH's runtime, Electron 44.7.0 / Node 24.21.0) and pulls in no native modules.

### Schema

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,          -- 相对路径，如 memories/episodic/xxx.json
  layer TEXT NOT NULL,
  kind TEXT,
  fidelity TEXT,               -- gist | detail
  session_id TEXT,
  occurred_at INTEGER NOT NULL,
  importance REAL,
  emotion_kind TEXT,
  emotion_intensity REAL,
  gist TEXT,
  details_json TEXT,
  deleted_at INTEGER,
  mtime INTEGER, size INTEGER
);
CREATE INDEX idx_time         ON memories(occurred_at);
CREATE INDEX idx_session_time ON memories(session_id, occurred_at);
CREATE INDEX idx_emotion      ON memories(emotion_kind, occurred_at);
CREATE INDEX idx_layer_time   ON memories(layer, occurred_at);
CREATE INDEX idx_fidelity     ON memories(fidelity, occurred_at);
```

### Synchronization and Rescan

- Startup: `MemoryLibrary` loads the files and then calls `index.rebuild(...)`.
- Write/delete/move to trash: the index is updated in sync.
- **External changes**: when the user tells DSH 「重新扫描记忆」, DSH calls the `memory_rescan` tool (which first `flush`es to disk, then rescans the files and rebuilds the index). There is no file watching.
- **Fallback**: when `node:sqlite` is unavailable, the index methods degrade quietly to empty results and the plugin still works from the files.

### Quick Queries

- A given day: `SELECT … WHERE occurred_at >= ? AND occurred_at < ? AND fidelity = 'gist' ORDER BY occurred_at`
- A given session: `SELECT … WHERE session_id = ? AND fidelity = 'gist' ORDER BY occurred_at`
- Details: same as above with `fidelity = 'detail'`

### Directory Structure Evolution

- The indexer scans `*.json` under the memory store root (excluding `.index/`, `trash/`, `state.json`, `memories.json*`).
- `layer` prefers the record field and falls back to the first path segment; `path` stores a relative path.
- Adding directories later (e.g. `portrait/`) needs no schema change — just rescan.

## 3. Field and Module Mapping

| Capability | Field / module |
|------|-------------|
| Granularity | `fidelity` (memory.js) |
| Emotion | `emotionKind` / `emotionIntensity` / `emotionCore` (emotion.js + memory.js) |
| Details | `details: string[]` (memory.js) |
| Index | `src/index-db.js` (node:sqlite) |
| Rescan | `memory_rescan` tool / `/memory-rescan` command |

## 4. Tests

- `test/emotion-test.mjs` (9 items)
- `test/db-test.mjs` (8 items)
- `test/self-test.mjs` (32 items, covering granularity/emotion/details)
- `test/plugin-smoke.mjs` (22 items, including `memory_rescan`)
