> English | [中文](./更新文档.md)

# Changelog

> Records the functional changes in each version, and **how each change is tested**.
> Version rule: **each update increments only the last digit (+0.0.1)**; **bump the version only once it is confirmed stable — never while it is unstable**.
> Current version: **0.1.4** | Previous version: 0.1.3

## v0.1.4 — 2026-10-31

This is the first cut of the **reconstruction groundwork + persona wiring**: no new memory layers or storage, just "expression fields" added to existing records, plus read-time reconstruction and a persona parameter network. See [设计-重构与人格.md](./设计-重构与人格.md).

| # | Change | Files touched |
|---|--------|---------------|
| 1 | Records gain `eventId` / `cues` / `source` / `confidence` / `status` / `validFrom` / `validTo` / `reconsolidationCount` | `src/memory.js` |
| 2 | `layer` extended with `procedural` / `autobiographical` (same structure) | `src/memory.js` |
| 3 | Reconstruction: composes episodic/semantic/emotional/procedural/autobiographical material by cue, and returns gaps and sources | `src/memory.js` |
| 4 | Resume: `memory_resume` stitches a session's ordered records into goal / done / last step / next step | `src/memory.js` |
| 5 | Prediction: `memory_predict` returns concepts / cases / consequences / risks | `src/memory.js` |
| 6 | Persona parameter network: attention / retrieval / interpretation / expression weights that shape what reconstruction draws on | `src/persona.js` |
| 7 | Feedback memories → persona parameter suggestions; `memory_persona_update` persists them | `src/index.js`, `persona.json` |
| 8 | Extra columns in the SQLite index (event_id / source / status / confidence / cues_json) | `src/index-db.js` |
| 9 | `memory_doctor`: health check (records / index / trash / corrupted files / candidates / feedback) | `src/index.js` |

### 1. Expression at the storage layer (no new structure)

- Multiple memories of the same event are strung together with `eventId` (distributed); `cues` let different cues evoke different facets.
- `source` separates fact from inference; `status` supports `active / candidate / superseded`; `validFrom/To` marks the validity window.
- All of them are optional fields; older records simply fall back to the defaults — no migration, no directory changes.

### 2. Reconstruction (`memory_reconstruct`)

- Draws material from multiple partitions according to the cue, and composes it into "what I remember / how it felt then / what this reminds me of / what I would similarly do / how it went over the years".
- Returns `gaps` (which partitions are missing) and `confidence`; each referenced record gets `reconsolidationCount++`, and its text is left untouched.
- Supports `asOf` to look up the version as of a given point in time.

### 3. Resume (`memory_resume`)

- No project table is stored: it takes that session's `kind=turn` records, sorts them by `turn`, and reconstructs goal / done / last step / next step.

### 4. Prediction (`memory_predict`)

- Semantic memory supplies concepts, episodic supplies cases, procedural supplies consequences, emotional supplies risks; a read-only composition.

### 5. Persona wiring

- `persona.attention` / `persona.retrieval` influence what reconstruction draws on;
- `interpretation` / `expression` serve as framing hints for the model;
- `memory_feedback` writes an ordinary feedback memory, `memory_persona` produces delta suggestions, and `memory_persona_update` writes them into `persona.json`.

### 6. Robustness and diagnostics

- **Corruption tolerance**: corrupted memory files are skipped (startup is not blocked); a corrupted `state.json` falls back to defaults.
- **List caps**: `memory_recall` ≤ 50, `memory_timeline` ≤ 500, `memory_reconstruct` ≤ 20, and `/memory-list` shows at most 200 entries (highest weight first).
- **`memory_doctor`**: record count, per-layer counts, index status, trash, corrupted files, candidate/feedback counts.
- **Deferred as unnecessary** (no over-engineering): file locking, fsync, schema version migration, large-scale benchmarks, CI matrix.

### 7. Test results

| Test | Result |
|------|--------|
| `test/self-test.mjs` | ✅ 32 / 32 |
| `test/emotion-test.mjs` | ✅ 9 / 9 |
| `test/library-test.mjs` | ✅ 15 / 15 |
| `test/consolidate-test.mjs` | ✅ 10 / 10 |
| `test/db-test.mjs` | ✅ 8 / 8 |
| `test/reconstruct-test.mjs` | ✅ 9 / 9 |
| `test/persona-test.mjs` | ✅ 6 / 6 |
| `test/gui-test.mjs` | ✅ 17 / 17 |
| `test/client-test.mjs` | ✅ 4 / 4 |
| `test/robustness-test.mjs` | ✅ 3 / 3 |
| `test/plugin-smoke.mjs` | ✅ 31 / 31 |

## v0.1.3 — 2026-10-30

This version delivers **three-axis memory typing** plus a **node:sqlite index**; see [设计-记忆类型与数据库.md](./设计-记忆类型与数据库.md).

| # | Change | Files touched |
|---|--------|---------------|
| 1 | Granularity `gist` / `detail`: only gists come back by default, details are returned only with `detail` | `src/memory.js` |
| 2 | Emotion detection: weighted multi-signal scoring over interjections, punctuation, emphasis, repetition, rhetorical questions, and emoji | `src/emotion.js` |
| 3 | One record, multiple facets: gist + details + emotion, not split into several records | `src/memory.js` |
| 4 | node:sqlite index: fast queries by day/session, while files remain the source of truth | `src/index-db.js`, `src/store.js` |
| 5 | `memory_rescan`: after the user issues the instruction, DSH rescans and rebuilds the index | `src/index.js` |
| 6 | New config: `database` / `emotion` | `settings.json` |
| 7 | Settings card: folder tabs along the top + sort button in the top-right corner | `client/client.js` |

### 1. Granularity (gist / detail)

- Every memory carries a `fidelity` field, defaulting to `gist`; working memories (tool calls) are marked `detail`.
- `memory_recall` / `memory_timeline` gain a `detail` parameter: by default only gists are returned, and only `detail: true` brings back detail records and the `details` field.

**How to test**: `node test/self-test.mjs` (covers "default recall excludes detail" and "recall includes detail when detail=true").

### 2. Emotion detection

- New `src/emotion.js`: explicit words + complaint patterns + interjections + emphasis + rhetorical questions + emoji + repetition + punctuation, weighted and then saturated with `1-exp(-score)`.
- Outputs `emotionKind` / `emotionIntensity` / `emotionCore`; a record is stored as an emotional memory only when the intensity is ≥ `emotion.threshold`.
- Examples: "wow, you got it wrong again" → frustration ≈ 0.5; "why are you like this again!!!" → clearly emotional.

**How to test**: `node test/emotion-test.mjs` (9 checks).

### 3. Multi-facet storage

- A single "wow, you got it wrong again" is stored as **one** episodic record: `content` (the gist) + `details` (files/commands) + emotion fields + `sessionId`, not split into three.

**How to test**: `node test/self-test.mjs` (covers "details and emotion fields come back with the recall").

### 4. node:sqlite index

- Runtime is Electron 44.7.0 / Node 24.21.0, where `node:sqlite` is built in and available, so **no extra build step**.
- Index file: `<root>/.index/memory.sqlite`; the schema includes `fidelity`, `emotion_kind`, `session_id`, `occurred_at` and more, with indexes created on them.
- Rebuilt at startup; kept in sync on writes/deletes; external changes are handled by a rescan triggered via `memory_rescan`.
- Fallback: when `node:sqlite` is unavailable the index methods degrade, and file storage is unaffected.

**How to test**: `node test/db-test.mjs` (8 checks, including by-day/by-session queries, gist/detail, rebuild, and idempotence).

### 5. memory_rescan

- New tool `memory_rescan` and command `/memory-rescan`: write to disk first, then rescan from the files and rebuild the index.
- Trigger: the user says "rescan memories", and DSH calls the tool (the user does not run a command by hand).

**How to test**: `node test/plugin-smoke.mjs` (covers "memory_rescan returns the load count and index count").

### 6. Settings card UI

- A row of folder buttons at the top: **All / Working / Episodic / Semantic / Core / Trash** (with counts); clicking one shows only that folder's memories.
- Small buttons in the top-right corner: **Weight↓** (by `importance`, highest first; the default), **Time↓** (by `occurredAt`, newest first), refresh, and open memory folder.
- In ordinary folders the delete button moves a record to the trash; records in the trash get a "Restore" button.

**How to test** (manual): open the "Memory" section of the settings page → switch folders → click "Weight↓ / Time↓" and watch the order change.

### 7. Test results

| Test | Result |
|------|--------|
| `test/self-test.mjs` | ✅ 32 / 32 |
| `test/emotion-test.mjs` | ✅ 9 / 9 |
| `test/library-test.mjs` | ✅ 15 / 15 |
| `test/consolidate-test.mjs` | ✅ 10 / 10 |
| `test/db-test.mjs` | ✅ 8 / 8 |
| `test/gui-test.mjs` | ✅ 17 / 17 |
| `test/client-test.mjs` | ✅ 4 / 4 |
| `test/plugin-smoke.mjs` | ✅ 22 / 22 |

## v0.1.2 — 2026-10-29

This version: **the settings-section card becomes the only GUI** (the standalone web GUI is removed), **a working memory layer is added**, behavior memories are enhanced, and the GitHub/marketplace structure plus the user-profile iteration-direction doc are filled in.

| # | Change | Files |
|---|--------|-------|
| 1 | The settings-section card becomes the only GUI; the standalone web GUI and `/memory-gui` are removed | `client/client.js`, `src/gui.js`, `src/index.js` |
| 2 | New working memory layer `memories/working/` (exact operations, low weight, short life) | `src/memory.js`, `src/store.js`, `src/index.js` |
| 3 | Behavior memories now record "which tools this turn used" | `src/index.js` |
| 4 | Measured consolidation runs written into the test doc | `测试文档.md` |
| 5 | GitHub / marketplace structure (LICENSE, CI, dsh.plugin.json) | `LICENSE`, `.github/`, `dsh.plugin.json` |
| 6 | Doc on the iteration direction for the user profile | `迭代方向-用户画像记忆.md` |

### 1. Settings-section card (the only GUI)

**Changes**

- The GUI keeps only the **settings-section card**: it registers into the **"Memory" section on the left of the settings page** (the `settings.section` slot, following the approach in `dsh-notify-say`).
- Card contents: "Open memory folder" + "Refresh" at the top; below that, the memory list ordered by **descending weight (importance)** (layer, date, content, source session). The weight number is no longer shown in the top-right corner.
- Data source: read-only routes `/api/dsh-human-memory/memories` and `/api/dsh-human-memory/open-folder` registered on the **DSH built-in web server** (**no separate port is occupied any more**).
- **Removed**: the standalone web GUI (`GET /` no longer returns HTML), the `/memory-gui` command, and the `memory_gui` tool.

**Why a route is still needed**

The card runs on the web/browser side and cannot read memory data held in the host process. DSH's client↔host Remote is fairly involved in the local build, so the host's own `webServer.register` exposes two read-only, low-risk routes as the data channel; no extra port is opened.

**How to test**

1. Restart DSH.
2. Open the settings page; a "Memory" section should appear on the left.
3. Click "Open memory folder" → Explorer opens `C:\Users\<你>\.dsh\human-memory\`.
4. The list should show memories, ordered from highest to lowest weight.
5. Automated: `node test/gui-test.mjs` (12 checks).

**Expected**: "Memory" appears on the left of the settings page; the buttons work; the list is sorted by weight.

### 1.1 Delete button and delete buffer

- Each row of the card gains a "Delete" button on the right; clicking it **asks for no confirmation** and removes the row from the list immediately.
- The backend **moves the record into the memory library's `trash/` folder** (renameable via `storage.trashDir`), so it no longer shows up in the current memory view, recall, review, or consolidation; the file is kept, which makes backup/restore easy.
- **It is genuinely deleted on the next consolidation** (files under `trash/` are removed); it can also be restored through `POST /api/dsh-human-memory/restore`.
- Endpoints: `POST /delete`, `GET /trash`, `POST /restore` (JSON `{ "id": "..." }`).
- Automated: `node test/gui-test.mjs` (17 checks, including moving into the buffer, hiding from the list, and restoring), `node test/library-test.mjs` (15 checks, including the trash folder, restore, and emptying).

### 2. Working memory layer (high volume, plenty of detail, gone quickly)

**Changes**

- New `memories/working/` directory (`layer: "working"`).
- Every turn records the **exact operations**: `运行命令：…`, `写文件：…`, `编辑文件：…`, `读取文件：…`.
- Weight is deliberately very low: `workingMemory.importance` (default **0.05**), imitating "fades fast".
- **No item cap**: `capacity: 0` (high volume, plenty of detail, messy relationships), reclaimed through a short TTL.
- Retention: `minRetentionMs` defaults to **24 hours**; and reclamation happens **only at the 24-hour consolidation checkpoint**, so nothing is wiped out all at once.
- **A recall refreshes `lastAccessedAt`**, pushing that working memory's cleanup time further out (the same idea as review).
- **It takes part in recall, review, and consolidation** (no longer excluded); review expires entries by "relative retention ratio", so low-weight records do not flood the list the moment they appear.
- **Deduplication**: the same operation within one session is kept as a single record, and a repeat refreshes its access time.
- **Source session recorded**: every working memory carries a `sessionId` (optional, not mandatory), so different sessions are not mixed up.

### 2.1 Cadence of consolidation and reclamation (once every 24 hours)

- Automatic consolidation **does not run every turn**: once every **24 hours** by default (`consolidation.intervalMs`).
- Trigger points: the check at session end (executes only when due), one check 15 seconds after startup, and an hourly scheduled check.
- Working memory reclamation runs at the **same checkpoint** as consolidation: only records whose "last access" is older than `workingMemory.minRetentionMs` (default 24h) are cleaned up.
- Records that have been recalled get their `lastAccessedAt` refreshed, so they are not cleared when due — they are deferred instead.
- Manual `/memory-consolidate` or `memory_consolidate` runs immediately (ignoring the interval).

**Division of labor**

| Layer | What it records | Weight / lifetime |
|-------|-----------------|-------------------|
| Working memory `working` | Exact operations (which file was changed, which command was run) | Very low weight, short life (24h) |
| Episodic memory `episodic` | A distilled "what this turn did" | Normal weight |
| Semantic memory `semantic` | Facts/preferences after consolidation | Higher |
| Core memory `core` | Extremely important, long-lived | Highest |

**How to test**

1. Have the agent change a file or run a command.
2. Open `C:\Users\<你>\.dsh\human-memory\memories\working\`; an `<id>.json` should be there.
3. Inspect that file: `importance` should be ≤ 0.1, and `content` should contain the command/file path.
4. Ask a question related to the working record; `memory_recall` should be able to bring it back.
5. Automated: `node test/self-test.mjs` (23 checks, including low weight, prune, and participation in recall/review/consolidation), `node test/plugin-smoke.mjs` (18 checks, including working memory being written to disk).

**Expected**: working memories live in their own files, carry low weight, can be recalled/reviewed/consolidated, but are reclaimed at the consolidation checkpoint 24 hours later (a recall defers that).

### 3. Behavior memory (what this turn did)

**Changes**

- At the end of each turn a behavior memory with `kind: "turn"` is written, now with "tools: write, bash…" attached.
- `memory_timeline({ date?, sessionId?, limit? })` retrieves every turn of a given day/session in chronological order.
- Behavior memories do not take part in factual recall; the timeline retrieves them separately.

**How to test**

1. Chat for 2–3 consecutive turns in the same session (including file/command operations).
2. Ask "what did we do in this session today?" → it should call `memory_timeline` and list the turns in order.
3. Automated: `node test/plugin-smoke.mjs` (18 checks, including "behavior memories carry the turn and tools").

**Expected**: one per turn, in chronological order, with a tool summary.

### 4. Measured consolidation (now in the test doc)

- The test doc gains a **3.4 Measured consolidation** subsection with 10 assertions and an input/output table.
- Run: `node test/consolidate-test.mjs`.

Result summary:

| Input | Output |
|-------|--------|
| 3 similar high-value episodic memories (Python backend) | Merged into 1 semantic memory; the source memories are archived |
| 1 dissimilar high-value memory (PostgreSQL) | Kept, not archived |
| 1 low-value memory (weather) | Skipped, kept as-is |

### 5. GitHub / marketplace structure

Added:

- `LICENSE` (MIT)
- `.gitignore`
- `.github/workflows/ci.yml` (runs 4 tests)
- `dsh.plugin.json` (marketplace registration manifest, version 0.1.2)

Key points: **a public repo + the `dsh-plugin` topic + the `dsh` field in `package.json` + semantic tags**.

### 6. User profile (future direction)

Adds [迭代方向-用户画像记忆.md](./迭代方向-用户画像记忆.md), which records the follow-up design for profile memories such as verbal tics, sentence patterns, and reasoning habits; **not implemented yet**.

### 6.1 Session short-term memory (future direction)

Adds [迭代方向-会话短期记忆.md](./迭代方向-会话短期记忆.md), which records the direction and feasibility assessment for "using session short-term memory to reduce how often the agent re-reads its context"; **not implemented yet**.

### 7. Test results

| Test | Result |
|------|--------|
| `test/self-test.mjs` | ✅ 27 / 27 |
| `test/library-test.mjs` | ✅ 15 / 15 |
| `test/consolidate-test.mjs` | ✅ 10 / 10 |
| `test/gui-test.mjs` | ✅ 17 / 17 |
| `test/plugin-smoke.mjs` | ✅ 20 / 20 |

---

## v0.1.1 — 2026-10-29

This version reworks three pieces of feedback: **automatic per-turn self-check**, **a directory-based memory library**, and **event dates**, plus **automatic migration from the old format**.

| # | Change | Files touched |
|---|--------|---------------|
| 1 | Automatic self-check after every turn that writes memories (no need to say "remember: " each time) | `src/index.js`, `settings.json` |
| 2 | The memory library goes from a single file to a directory layout (one file per memory) | `src/store.js` |
| 3 | Every memory records "when the event happened", shown along with recall results | `src/memory.js`, `src/index.js` |
| 4 | Old `memories.json` is migrated automatically to the new structure | `src/store.js` |

- **Automatic self-check**: listens on `session/event` to buffer each turn's text, and on `agent/turn-stopping` decides whether to write based on "length / not a question / not a greeting / not injected / contains signal words"; the parameters live under `autoCapture` in `settings.json`.
- **Directory-based memory library**: `human-memory/index.json` + `human-memory/memories/<layer>/<id>.json`.
- **Event date**: new `occurredAt`, which `memory_write` accepts as ISO / `YYYY-MM-DD` / epoch; recall output carries `[YYYY-MM-DD HH:mm]`; repeated mentions keep the earliest time.
- **Migration**: the old `memories.json` is split into `memories/`, the original file is backed up as `.bak`, and old records get `occurredAt = createdAt`.

See the original v0.1.1 notes or `测试文档.md` for test details.

## v0.1.0 — Initial release

- 5 tools: `memory_write` / `memory_recall` / `memory_forget` / `memory_consolidate` / `memory_review`
- 3 slash commands: `/memory-review` / `/memory-consolidate` / `/memory-list`
- Forgetting curve (lazy time decay), six-dimension importance, spacing effect, consolidation, review
- Centralized configuration in `settings.json`
- Single-file local storage in `memories.json`
