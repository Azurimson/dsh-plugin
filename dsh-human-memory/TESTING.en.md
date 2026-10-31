> English | [中文](./测试文档.md)

# dsh-human-memory Testing

> Version: 0.1.4 ｜ Target: a local plugin that gives DSH "human-like memory"
> This document is both an **acceptance checklist** and a **regression testing guide**. Items marked ✅ have been verified by actual runs.

## 1. Overall Results

| Item | Result |
|------|--------|
| Core logic self-test (`test/self-test.mjs`) | ✅ 32 / 32 passing |
| Emotion recognition test (`test/emotion-test.mjs`) | ✅ 9 / 9 passing |
| Memory store and migration self-test (`test/library-test.mjs`) | ✅ 15 / 15 passing |
| Consolidation test (`test/consolidate-test.mjs`) | ✅ 10 / 10 passing |
| Database index test (`test/db-test.mjs`) | ✅ 8 / 8 passing |
| Reconstruction foundation test (`test/reconstruct-test.mjs`) | ✅ 9 / 9 passing |
| Persona parameter network test (`test/persona-test.mjs`) | ✅ 6 / 6 passing |
| Memory API route test (`test/gui-test.mjs`) | ✅ 17 / 17 passing |
| Settings card render smoke test (`test/client-test.mjs`) | ✅ 4 / 4 passing |
| Fault injection test (`test/robustness-test.mjs`) | ✅ 3 / 3 passing |
| Plugin entry smoke test (`test/plugin-smoke.mjs`, mock DSH ctx) | ✅ 31 / 31 passing |
| Real DSH load (tools appear in the agent tool list) | ✅ passing |
| Real write / recall / forget / persistence | ✅ passing |
| Per-turn auto self-check / directory-based memory store / event dates | ✅ implemented with automated coverage |
| Granularity (gist/detail) / emotion facets / multi-facet storage | ✅ implemented with automated coverage |
| node:sqlite index / memory_rescan | ✅ implemented with automated coverage |
| Reconstruction / resumption / prediction / persona parameter network | ✅ implemented with automated coverage |
| Settings card, slash commands, hot config reload | Pending manual execution (cases listed) |

## 2. Test Environment

| Item | Value |
|------|-------|
| Operating system | Windows (Chinese locale) |
| DSH profile | Desktop profile (example) |
| Plugin installation | Local `link:` or plugin package install |
| Memory store directory (default) | `$DSH_HOME/human-memory/` (on Windows, `%USERPROFILE%\.dsh\human-memory\`; `index.json` + `memories/<layer>/<id>.json`) |
| `DSH_HOME` | Defaults to `~/.dsh` (on Windows, `%USERPROFILE%\.dsh`) |
| Node version | 22+ (DSH's bundled Electron runtime) |

> Note: reading the data files directly with PowerShell `Get-Content` may show garbled Chinese text. That is a display issue caused by the console decoding UTF-8 as GBK; **the files themselves are valid UTF-8** and display correctly in an editor or with the `read` tool.

## 3. Automated Tests

### 3.1 Core Logic Self-Test `test/self-test.mjs`

Run:

```sh
node test/self-test.mjs
```

Does not depend on DSH; tests `src/memory.js` and `src/settings.js` directly.

| # | Case | Result |
|---|------|--------|
| 1 | JSONC comments are stripped, while `//` inside strings is preserved | ✅ |
| 2 | `settings.json` loads, with all six weight dimensions present | ✅ |
| 3 | All six dimensions at full score → importance ≈ 1 | ✅ |
| 4 | All six dimensions at zero → importance ≈ 0 | ✅ |
| 5 | The memory-duration factor increases monotonically with dwell time | ✅ |
| 6 | Memory strength decreases monotonically with age (forgetting curve) | ✅ |
| 7 | Strength is always positive (it only lowers the ranking, never drops to zero) | ✅ |
| 8 | The longer the interval, the higher the boost on re-mention (spacing effect) | ✅ |
| 9 | Re-mention resets the decay anchor | ✅ |
| 10 | Retrieval ranks the semantically relevant record first | ✅ |
| 11 | Two similar high-value episodic memories → a semantic memory is merged out | ✅ |
| 12 | Writing records the event time `occurredAt` | ✅ |
| 13 | Repeated writes keep the earliest occurrence time | ✅ |
| 14 | `formatDate` outputs a human-readable date | ✅ |
| 15 | `parseTime` supports ISO / date-only / epoch | ✅ |
| 16 | `recall` results carry `occurredAt` | ✅ |
| 17 | `write` accepts an explicit `importance` (low weight for working memory) | ✅ |
| 18 | `pruneWorking` keeps only the most recent N records | ✅ |
| 19 | `pruneWorking` clears records past their TTL | ✅ |
| 20 | `pruneWorking`: `capacity=0` means no limit | ✅ |
| 21 | Working memory takes part in factual recall | ✅ |
| 22 | Working memory takes part in review (due by relative retention rate) | ✅ |
| 23 | Working memory takes part in consolidation (high access count) | ✅ |
| 24 | Working memory has its cleanup deferred after being recalled (`lastAccessedAt` refreshed) | ✅ |
| 25 | `recall` results carry `sessionId` | ✅ |
| 26 | Soft-deleted records are excluded from recall | ✅ |
| 27 | Soft-deleted records are excluded from review and consolidation | ✅ |
| 28 | Writes default to `fidelity=gist` | ✅ |
| 29 | Writes can be marked with `fidelity=detail` | ✅ |
| 30 | Default recall excludes `detail` records | ✅ |
| 31 | `detail=true` recalls `detail` records | ✅ |
| 32 | `details` and emotion fields are returned with recall results | ✅ |

### 3.3 Memory Store and Migration Self-Test `test/library-test.mjs`

```sh
node test/library-test.mjs
```

Tests `src/store.js` (directory-based storage + legacy migration + delete buffer); does not depend on DSH.

| # | Case | Result |
|---|------|--------|
| 1 | The legacy `memories.json` is backed up as `.bak` | ✅ |
| 2 | Legacy records are backfilled with `occurredAt` | ✅ |
| 3 | The `memories/semantic` directory is created | ✅ |
| 4 | Semantic memories get their own files | ✅ |
| 5 | An `index.json` index is generated | ✅ |
| 6 | The index contains dates and file paths | ✅ |
| 7 | New memories are written to files by layer | ✅ |
| 8 | Two records load back after a restart | ✅ |
| 9 | The file is removed after deletion | ✅ |
| 10 | Moving into the delete buffer succeeds | ✅ |
| 11 | The file has been moved into the `trash/` folder | ✅ |
| 12 | The active memory set no longer contains it | ✅ |
| 13 | `listTrash` can list it | ✅ |
| 14 | `restoreFromTrash` can restore it | ✅ |
| 15 | `purgeTrash` empties the buffer | ✅ |

### 3.2 Plugin Entry Smoke Test `test/plugin-smoke.mjs`

Run (requires `@deepseek-ai/dsh-tools` to be provided by the host or a mock):

```sh
node test/plugin-smoke.mjs
```

| # | Case | Result |
|---|------|--------|
| 1 | `apply()` registers 14 tools | ✅ |
| 2 | Registers 4 slash commands | ✅ |
| 3 | Registers the `agent/turn-stopping` listener | ✅ |
| 4 | Registers the `session/event` listener (auto self-check) | ✅ |
| 5 | Registers the `memory_rescan` tool | ✅ |
| 6 | Registers the `memory_doctor` tool | ✅ |
| 7 | Registers the reconstruct / resume / predict / persona tools | ✅ |
| 8 | `memory_write` returns `id/importance/layer/occurredAt` | ✅ |
| 9 | `memory_recall` recalls and includes the occurrence time | ✅ |
| 10 | `/memory-list` returns success and includes dates | ✅ |
| 11 | The per-turn auto self-check writes user information into factual memory | ✅ |
| 12 | The behavior timeline records that turn | ✅ |
| 13 | Behavior memories carry the turn and the tools | ✅ |
| 14 | Questions are not auto-written into factual memory | ✅ |
| 15 | `memory_reconstruct` returns composed text | ✅ |
| 16 | `memory_resume` returns goal / last / next step | ✅ |
| 17 | `memory_predict` returns prediction text | ✅ |
| 18 | `memory_feedback` returns an id | ✅ |
| 19 | `memory_persona` returns parameters and suggestions | ✅ |
| 20 | `memory_persona_update` returns ok | ✅ |
| 21 | `memory_rescan` returns the loaded count and the index count | ✅ |
| 22 | `memory_doctor` returns record count / index / corrupted count | ✅ |
| 23 | Generates the `index.json` index | ✅ |
| 24 | Generates the `memories/episodic` directory | ✅ |
| 25 | Each episodic memory gets its own file | ✅ |
| 26 | Working memory (which files changed) gets its own file | ✅ |
| 27 | The same operation in the same session is deduplicated (only 1 record kept) | ✅ |
| 28 | Working memory has low weight (importance ≤ 0.1) | ✅ |
| 29 | Working memory content includes file paths | ✅ |
| 30 | Working memory records the originating session | ✅ |
| 31 | The index includes the occurrence-time field | ✅ |

### 3.4 Consolidation Test `test/consolidate-test.mjs`

```sh
node test/consolidate-test.mjs
```

| # | Case | Result |
|---|------|--------|
| 1 | Only similar groups are merged (created = 1) | ✅ |
| 2 | 4 high-value episodic memories are scanned (low-value ones skipped) | ✅ |
| 3 | One semantic memory is created | ✅ |
| 4 | The semantic memory content merges the original information | ✅ |
| 5 | The three source memories of the similar group are archived | ✅ |
| 6 | Dissimilar high-value memories are not archived | ✅ |
| 7 | Low-value memories are kept as they are | ✅ |
| 8 | The semantic memory inherits the highest importance in the group (0.9) | ✅ |
| 9 | Archived memories no longer appear in regular recall | ✅ |
| 10 | Consolidating again does not merge twice (created = 0) | ✅ |

Observed input / output:

| Input | Output |
|------|------|
| 3 similar high-value episodic records (Python backend) | Merged into 1 semantic memory; the source memories are archived |
| 1 dissimilar high-value record (PostgreSQL) | Kept, not archived |
| 1 low-value record (weather) | Skipped, kept as it is |

### 3.5 Memory API Route Test `test/gui-test.mjs`

```sh
node test/gui-test.mjs
```

A mock server captures the handler passed to `webServer.register`, and simulated req/res objects verify the `/api/dsh-human-memory` routes.

| # | Case | Result |
|---|------|--------|
| 1 | Registers the `prefix` route `/api/dsh-human-memory` | ✅ |
| 2 | `GET /memories` returns 200 | ✅ |
| 3 | Returns all memories (including working memory) | ✅ |
| 4 | Sorted by weight, descending | ✅ |
| 5 | `POST /delete` returns 200 with `buffered=true` | ✅ |
| 6 | After deletion the record is gone from the active memory set | ✅ |
| 7 | After deletion the record is in the delete buffer | ✅ |
| 8 | The deleted record is marked with an id | ✅ |
| 9 | The list hides that record after deletion | ✅ |
| 10 | `GET /trash` returns the buffer contents | ✅ |
| 11 | `POST /restore` restores successfully | ✅ |
| 12 | After restore the record is back in the active memory set | ✅ |
| 13 | After restore the buffer is empty | ✅ |
| 14 | `GET /health` returns 200 and ok | ✅ |
| 15 | Unknown paths return 404 | ✅ |
| 16 | Non-JSON POSTs are rejected (415) | ✅ |
| 17 | A missing id returns 400 | ✅ |

### 3.6 Emotion Recognition Test `test/emotion-test.mjs`

| # | Case | Result |
|---|------|--------|
| 1 | Explicit emotion word 「开心」 → joy | ✅ |
| 2 | 「哇你又犯错了」 → frustration, intensity > 0.2 | ✅ |
| 3 | 「你怎么又这样！！！」 → intensity > 0.4 | ✅ |
| 4 | 「……好吧」 → ellipsis signal | ✅ |
| 5 | 「不是吧，这也行？」 → frustration | ✅ |
| 6 | 「好好好」 → repetition signal | ✅ |
| 7 | Neutral text has low intensity | ✅ |
| 8 | Empty text returns neutral / 0 | ✅ |
| 9 | `core` points to the clause containing the strongest signal | ✅ |

### 3.7 Database Index Test `test/db-test.mjs`

| # | Case | Result |
|---|------|--------|
| 1 | `node:sqlite` indexing is available | ✅ |
| 2 | Querying by day returns only gist | ✅ |
| 3 | Querying detail by day | ✅ |
| 4 | Querying by session returns only gist | ✅ |
| 5 | Querying detail by session | ✅ |
| 6 | Rebuilding the index | ✅ |
| 7 | Deleting an index entry | ✅ |
| 8 | upsert updates are idempotent | ✅ |

### 3.8 Settings Card Render Smoke Test `test/client-test.mjs`

Executes `client/client.js` with mocked React / window / document / fetch.

| # | Case | Result |
|---|------|--------|
| 1 | The client module exports apply / inject / name | ✅ |
| 2 | Registers `settings.section` with label=记忆 | ✅ |
| 3 | Renders 6 folder buttons at the top | ✅ |
| 4 | Has 「权重↓」 and 「时间↓」 buttons at the top right | ✅ |

### 3.9 Reconstruction Foundation Test `test/reconstruct-test.mjs`

| # | Case | Result |
|---|------|--------|
| 1 | Written records carry `eventId / cues / source / confidence / status` | ✅ |
| 2 | Reconstruction aggregates multiple partitions by event | ✅ |
| 3 | The reconstructed text contains multiple facets | ✅ |
| 4 | `superseded` records are excluded from reconstruction | ✅ |
| 5 | `gaps` reports the missing partitions | ✅ |
| 6 | Stage resumption returns goal / done / last / next step | ✅ |
| 7 | Resumption returns an empty structure when there are no records | ✅ |
| 8 | Prediction returns four kinds of material | ✅ |
| 9 | The persona's 「提取偏向」 affects partition ordering | ✅ |

### 3.10 Persona Parameter Network Test `test/persona-test.mjs`

| # | Case | Result |
|---|------|--------|
| 1 | Default persona parameters are complete | ✅ |
| 2 | merge overrides and clamps to [0,2] | ✅ |
| 3 | `loadPersona` reads settings first, then file (file wins) | ✅ |
| 4 | `setPersonaPath` writes a valid path | ✅ |
| 5 | Feedback derives parameter deltas | ✅ |
| 6 | Unknown traits produce no delta | ✅ |

### 3.11 Fault Injection Test `test/robustness-test.mjs`

| # | Case | Result |
|---|------|--------|
| 1 | Corrupted memory files are skipped | ✅ |
| 2 | Healthy records remain readable | ✅ |
| 3 | A corrupted state file does not affect startup | ✅ |

## 4. Manual Test Cases (Acceptance Checklist)

> The "Actual" column in the tables: ✅ done; ⬜ pending. Record the result in "Actual" as you run each case.

### A. Loading and Registration

| ID | Step | Expected | Actual |
|------|------|------|------|
| A1 | Restart DSH and watch the startup log | No `did not activate human-memory` warning | ✅ |
| A2 | Ask the agent "list your memory tools" | 14 appear: write / recall / timeline / reconstruct / resume / predict / feedback / persona / persona_update / forget / rescan / doctor / consolidate / review | ✅ |
| A3 | Type `/` and check command completion | `memory-list` / `memory-review` / `memory-consolidate` / `memory-rescan` appear | ⬜ |
| A4 | Inspect the disk after the first `memory_write` | `~/.dsh/human-memory/index.json` and `memories/<layer>/<id>.json` are created | ✅ |
| A5 | Open the settings page and look at the left navigation | A 「记忆」 section appears (`settings.section`) | ⬜ |

### B. Writing (memory_write)

| ID | Step | Expected | Actual |
|------|------|------|------|
| B1 | Say "remember: this project is built with Python and Vue" | `memory_write` is called and returns "remembered … (importance 0.xx)" | ✅ |
| B2 | Say the same sentence again (identical content) | No new record; `mentionCount` +1 and `importance` is raised | ⬜ |
| B3 | Say "store this as a semantic memory: …" and specify the layer | The record has `layer: "semantic"` | ✅ (one semantic record exists) |
| B4 | Write the same content with `dwellMs: 1000` and `600000` respectively | The latter has higher importance (the memory-duration dimension takes effect) | ⬜ |

### C. Recall (memory_recall)

| ID | Step | Expected | Actual |
|------|------|------|------|
| C1 | Ask "what language is my project written in?" | `memory_recall` is called and returns Python / Vue | ✅ |
| C2 | With several memories present, ask a question that matches only one of them | The relevant one has the highest score and ranks first | ✅ |
| C3 | Check `accessCount` in the file after recalling | The hit record is +1 (retrieval is rehearsal) | ✅ (`accessCount: 2`) |
| C4 | Ask about a topic that is not in the store at all | Returns "no relevant memories recalled" | ⬜ |

### D. Forgetting (memory_forget)

| ID | Step | Expected | Actual |
|------|------|------|------|
| D1 | Call forget on an existing `id` | Returns "deleted." and the record no longer appears in recall results | ✅ |
| D2 | Call forget on a non-existent `id` | Returns "memory not found." | ⬜ |
| D3 | After deletion, wait ≥ `flushIntervalMs` and then check the file | The record is gone from the file | ✅ (after about 7 seconds) |

### E. Consolidation (memory_consolidate)

| ID | Step | Expected | Actual |
|------|------|------|------|
| E1 | Write 2 highly similar, high-value memories, then trigger consolidation | 1 `layer: "semantic"` record is created | ⬜ |
| E2 | Write low-value, mutually dissimilar episodic memories and trigger consolidation | No semantic memory is produced | ⬜ |
| E3 | Inspect the source memories after consolidation | `archived: true`; regular recall no longer returns them | ⬜ |
| E4 | Only 1 high-value memory | No merge (a group needs ≥2) | ⬜ |
| E5 | Chat for many turns without triggering it manually | Consolidation **does not run every turn**; it only runs when more than 24h have passed since the last run | ✅ (code gate) |
| E6 | Run `/memory-consolidate` manually | Runs once immediately (ignoring the 24h interval) and also reclaims expired working memory | ✅ (code path) |
| E7 | Create a working-memory record whose "last access" is more than 24h old, then wait for the next consolidation | It is cleaned up; if it was recalled in the meantime, the cleanup is postponed | ✅ (self-test 19/24) |
| E8 | Repeat the same operation in the same session | Only 1 working-memory record is kept, and its access time is refreshed | ✅ (smoke 16) |

### F. Review (memory_review)

| ID | Step | Expected | Actual |
|------|------|------|------|
| F1 | Call `memory_review` | Returns memories with strength < `review.dueThreshold` | ✅ |
| F2 | Memories with sufficiently high strength | Do not appear in the review list | ✅ |
| F3 | When many memories are due | At most `review.maxPerBatch` are returned | ⬜ |

### G. Slash Commands

| ID | Command | Expected | Actual |
|------|------|------|------|
| G1 | `/memory-list` | Lists all memories (with layer markers) | ⬜ |
| G2 | `/memory-review` | Lists memories nearing forgetting | ⬜ |
| G3 | `/memory-consolidate` | Triggers consolidation and returns the number merged | ⬜ |

### N. Delete Button and Delete Buffer

| ID | Step | Expected | Actual |
|------|------|------|------|
| N1 | Click 「删除」 to the right of a memory in the settings card | **No confirmation dialog**; it disappears from the list immediately | ⬜ |
| N2 | Inspect storage | The file has been moved to `trash/` and is no longer under `memories/`; it can be backed up/restored manually | ⬜ |
| N3 | Run `/memory-consolidate` | Files under `trash/` are actually deleted | ⬜ |
| N4 | Ask about related content after deletion | `memory_recall` should not recall it | ⬜ |
| N5 | Call `POST /restore { id }` | The record is restored from `trash/` to the active memory set | ⬜ |

### O. Granularity / Emotion / Database

| ID | Step | Expected | Actual |
|------|------|------|------|
| O1 | Say 「哇你又犯错了」 | An episodic memory is written with `emotionKind=frustration` and `emotionIntensity>0.2` | ⬜ |
| O2 | `memory_recall({ query, detail: false })` | Only the gist is returned by default, without `working` details | ⬜ |
| O3 | `memory_recall({ query, detail: true })` | Detail records and `details` are returned | ⬜ |
| O4 | Say "rescan the memory store" | DSH calls `memory_rescan`, which returns the loaded/indexed counts | ⬜ |
| O5 | Inspect `~/.dsh/human-memory/.index/memory.sqlite` | The index file exists; deleting it and rescanning rebuilds it | ⬜ |

### P. Settings Card: Folders and Sorting

| ID | Step | Expected | Actual |
|------|------|------|------|
| P1 | Open the 「记忆」 section on the settings page | A row of buttons appears at the top: 全部 / 工作 / 情节 / 语义 / 核心 / 回收站 (with counts) | ⬜ |
| P2 | Click 「工作」 | Only memories with `layer=working` are shown | ⬜ |
| P3 | Click 「回收站」 | Only records in `trash/` are shown, with a 「恢复」 button on the right | ⬜ |
| P4 | Default sort order | By weight, largest first | ⬜ |
| P5 | Click 「时间↓」 at the top right | By occurrence time, newest first | ⬜ |
| P6 | Click 「权重↓」 at the top right | Restores weight ordering, largest first | ⬜ |
| P7 | Click 「恢复」 in the trash | The record returns to its layer folder and the trash count decreases | ⬜ |

### Q. Reconstruction / Resumption / Persona

| ID | Step | Expected | Actual |
|------|------|------|------|
| Q1 | Write three records for the same event (episodic / semantic / procedural, same `eventId`) | `memory_reconstruct` returns multiple partitions | ⬜ |
| Q2 | Ask "where did we get to last time?" | `memory_resume` returns goal / done / last / next step | ⬜ |
| Q3 | Ask "how did this go before?" | `memory_predict` returns concept / case / consequence / risk | ⬜ |
| Q4 | Say "be more logical when you speak" | `memory_feedback` writes a feedback memory | ⬜ |
| Q5 | Call `memory_persona` | Returns parameters and delta suggestions | ⬜ |
| Q6 | `memory_persona_update { path: "interpretation.logic", value: 0.7 }` | `persona.json` is updated and takes effect after restart | ⬜ |

### H. Forgetting Curve

| ID | Step | Expected | Actual |
|------|------|------|------|
| H1 | Check the strength of the same memory at different intervals | The longer the interval, the lower the strength, and the decline is "steep first, then flat" | ✅ (self-test 6) |
| H2 | Lower `forgetting.tauMs` and restart | Forgetting speeds up noticeably | ⬜ |
| H3 | Enable `forgetting.usePowerLaw` and set `powerBeta` | Switches to power-law decay | ⬜ |

### I. Spacing Effect

| ID | Step | Expected | Actual |
|------|------|------|------|
| I1 | "Re-mention" the same content after 1 second and after 30 days respectively | The 30-day re-mention raises importance more | ✅ (self-test 8) |
| I2 | Check `reviewHistory` after repeated mentions | A new timestamp is appended and `lastAccessedAt` is updated | ⬜ |

### J. Persistence and Cross-Session

| ID | Step | Expected | Actual |
|------|------|------|------|
| J1 | Inspect the memory store directory after writing | `index.json` and `memories/<layer>/<id>.json` appear | ✅ |
| J2 | Recall after restarting DSH | The memory is still there (loaded from files) | ⬜ |
| J3 | **Open a new session** and ask about content written in an old session | It can be recalled (memory is a global shared directory store, not isolated per session) | ⬜ |
| J4 | Inspect the file immediately after writing/deleting, then again after 5 seconds | The file lags briefly and is flushed in batches within 5 seconds | ✅ |

### K. Configuration

| ID | Step | Expected | Actual |
|------|------|------|------|
| K1 | Change a weight in `settings.json` (e.g. `importance.dwell`) and restart | Scores of newly written memories change accordingly | ⬜ |
| K2 | Corrupt `settings.json` (invalid JSON) | The plugin falls back to defaults and prints a warning without crashing | ⬜ |

### L. Auto Self-Check (after every turn)

| ID | Step | Expected | Actual |
|------|------|------|------|
| L1 | Say something that contains a preference (e.g. "my project uses Rust for the backend and is deployed locally") without saying "remember" | It is written automatically at the end of the turn and visible to recall | ✅ (covered by smoke test) |
| L2 | Only ask a question (e.g. "what database do you use?") | Nothing is written | ✅ (covered by smoke test) |
| L3 | Say "hello" / "thanks" | Nothing is written | ⬜ |
| L4 | Disable `autoCapture.enabled` and restart | No more automatic writes; only manual `memory_write` | ⬜ |
| L5 | Say the same sentence twice | The second time goes through re-mention reinforcement without adding a record | ⬜ |

### M. Memory Store and Event Dates

| ID | Step | Expected | Actual |
|------|------|------|------|
| M1 | Inspect `~/.dsh/human-memory/` after the first write | `index.json` and `memories/<layer>/<id>.json` appear | ✅ |
| M2 | Start with the legacy `memories.json` | It migrates automatically to the directory structure and the original file is backed up as `.bak` | ⬜ |
| M3 | Ask "when did this happen?" | Recall results carry `[YYYY-MM-DD HH:mm]`, which can be used to answer | ✅ (output includes dates) |
| M4 | Pass `occurredAt: "2026-01-15"` to `memory_write` | The event time is recorded as that date, not the write time | ✅ (self-test 12/15) |
| M5 | Write the same event again after some time | `occurredAt` keeps the earliest time | ✅ (self-test 13) |

## 5. Edge Cases and Exceptions

| ID | Scenario | Expected |
|------|------|------|
| X1 | Empty string content | Written normally (or rejected as appropriate) without crashing |
| X2 | Very long content (thousands of characters) | Written normally; `importance.uniqueness` saturates |
| X3 | Content containing newlines / quotes / emoji | Stored and recalled normally (JSON escaping is correct) |
| X4 | Data files locked or corrupted | The plugin warns and starts from empty memory without crashing |
| X5 | Concurrent writes (multiple sessions writing at once) | Serialized by the single-threaded event loop; no records lost |
| X6 | DSH force-killed mid-session | Unflushed changes from the last 5 seconds may be lost (known limitation) |

## 6. Acceptance Criteria

1. `test/self-test.mjs` and `test/plugin-smoke.mjs` all pass.
2. Cases A/B/C/D/F/J/L/M are all ✅ (G/E are enhancements; they are acceptable but should be executable).
3. No uncaught exceptions; the plugin falls back when `settings.json` is invalid.
4. The memory store location matches expectations and the contents are valid UTF-8 JSON.

## 7. Known Limitations (Out of Scope)

- **The auto self-check is heuristic**: it uses keywords + length + question/greeting filters, not LLM semantic judgement, so it may miss or misrecord things; adjust the thresholds or disable it via `autoCapture`.
- **Semantic relevance** uses character n-grams without embeddings, so matching on long texts or paraphrases is not accurate enough.
- **Consolidation** is rule-based stitching, without LLM summarization.
- **Batched flushing** defaults to 5 seconds, so a force-kill loses the latest changes; set `storage.syncWrite` to `true` if you need immediate persistence.
- **Not shared across installations**: memory is bound to `DSH_HOME`; different profiles/installations with different `DSH_HOME` values stay independent.
