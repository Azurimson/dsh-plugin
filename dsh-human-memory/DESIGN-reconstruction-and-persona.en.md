> English | [中文](./设计-重构与人格.md)

# Design: Reconstruction foundation and persona integration (0.1.4)

> This release does only two things: **turn recall into “reconstruction”** and **let persona parameters participate in reconstruction**.
> It adds no new memory layer, adds no new storage, and does not touch multi-agent / workbench functionality.

## 1. Why not add a “project memory”

The memory model used by this project is:

- **Distributed**: an event is spread across multiple brain regions, and different cues evoke different facets;
- **Reconstructive**: recall regenerates a version from cues rather than retrieving a single record;
- **Predictive**: past experience is used to generate an interpretation of, and an action plan for, the current situation;
- **Persona as a parameter network**: attention, interpretation, retrieval, action, and expression.

So “where to start next time” should not be a new `project` table, but **a reconstruction of existing session/time/sequence records**. This release only adds “representation fields” to records so that reconstruction has material to draw on.

## 2. Storage representation (fields, not a new structure)

| Field | Purpose |
|------|------|
| `eventId` | Links the distributed memories of one event (shared by episodic/semantic/emotional/procedural/autobiographical) |
| `cues` | Cues: `{ person, place, topic, time, emotion }`; different cues evoke different facets |
| `source` | `user / assistant / tool / inference / self`; separates facts from inferences |
| `confidence` | 0–1, with inferences < 1 |
| `status` | `active / candidate / superseded` |
| `validFrom` / `validTo` | Validity interval for the judgment |
| `lastConfirmedAt` | Time of the most recent confirmation |
| `reconsolidationCount` / `lastReconstructedAt` | Number of reconstructions and the time of the last reconstruction (the original text is not changed) |
| `layer` | Extends to `procedural` (skills) and `autobiographical` (autobiographical memory) — the same record structure |

Older records that lack these fields are read with default values; no migration is performed and no directories are changed.

## 3. Reconstruction (`memory_reconstruct`)

### Gathering material

Score all records against the current cues:

```
score = (相关度 + 线索重合) * 检索权重
      + 强度 * 权重
      + 重要性 * 权重
```

Then multiply by the persona’s “retrieval bias” (`persona.retrieval[脑区]`) and filter out `superseded`, `archived`, and `deletedAt`.

### Partitioning

Group matched records by `layer` into episodic / semantic / emotional / procedural / autobiographical / working memory. The emotional partition additionally collects any record with `emotionIntensity ≥ threshold`.

### Composition

```
我记得：<情景 gist>
那时的感觉：<情绪核心>（<类型> <强度>）
这让我想到：<语义概念>
类似地，我会：<程序技能>
一路走来：<自传体>
细节：<details>（可选）
```

This is “regenerating a version from the current cues,” not concatenating the original text.

### Gaps and confidence

- `gaps`: which partitions have no material (for example, only episodic material and no semantic material);
- `confidence`: estimated from the hit count and average strength;
- `sources`: ids of the records referenced in this reconstruction.

### Reconsolidation

Records referenced by a reconstruction:

- `reconsolidationCount += 1`
- `lastReconstructedAt = now`
- `lastAccessedAt = now`

**The original content is not changed.** If the model wants to write a “reconstructed version,” it should write a new record with a normal `memory_write` and attach it to the same event via `eventId`.

## 4. Resumption (`memory_resume`)

No project table is stored:

1. Take the session’s records with `kind = turn` and sort them by `turn` / `occurredAt`;
2. Take the most recent N turns;
3. Compose `goal` (first turn), `done` (middle turns), `last` (last turn), and `next` (look for a “next step / to-do” in the last record’s details; if none is found, leave it empty for the model to infer);
4. Perform a reconstruction using the last turn’s content and attach `related`.

## 5. Prediction (`memory_predict`)

Perform one reconstruction of the current situation and split it by purpose:

| Field | Source | Answers |
|------|------|------|
| `what` | Semantic | What kind of situation is this? |
| `before` | Episodic | How did similar situations play out before? |
| `how` | Procedural | What happens if we do this? |
| `risk` | Emotional | Is this dangerous/important? |
| `prediction` | Composite text | Overall plan |

## 6. Persona integration

Persona is not a memory structure but a set of parameters (`src/persona.js`):

```jsonc
{
  "attention":   { "person": 1, "place": 1, "topic": 1, "time": 1, "emotion": 1 },
  "retrieval":   { "working": 0.6, "episodic": 1, "semantic": 1, "emotional": 1, "procedural": 1, "autobiographical": 1 },
  "interpretation": { "logic": 0.5, "warmth": 0.5, "caution": 0.5 },
  "expression":  { "directness": 0.5, "verbosity": 0.5 }
}
```

- **Attention**: `attention` affects the weight of cue overlap (whether “person” or “place/topic/time/emotion” is noticed first);
- **Retrieval**: `retrieval` affects which brain region is more likely to be recalled;
- **Interpretation/expression**: framework hints passed to the model (the memory side only supplies material and does not make judgments on the model’s behalf).

### Feedback → parameters

- `memory_feedback` writes an ordinary memory: `kind: 'feedback'`, `layer: 'autobiographical'`, `trait`, `direction`;
- `memory_persona` reads feedback and uses `suggestPersonaDeltas` to produce incremental suggestions (without applying them automatically);
- `memory_persona_update` writes a parameter to `persona.json`, effective on the next startup.

This is the memory-side closed loop of “persona self-iteration”: **experience → feedback memory → parameter adjustment → changed bias in the next recall**.

## 7. Boundaries

- No new memory layer/storage: `layer` simply gains two values, `procedural` / `autobiographical`;
- No “project state” is stored: resumption is reconstruction at read time;
- No multi-agent / workbench work;
- Persona only covers attention/retrieval/interpretation/expression that the memory side can support, and does not replace higher-level decision-making;
- `memory_predict` is a read-only composition; it does not train or call a model.

## 8. Tests

- `test/reconstruct-test.mjs` (9 checks): distributed aggregation, multi-facet composition, superseded exclusion, gaps, resumption, prediction, and persona retrieval bias;
- `test/persona-test.mjs` (6 checks): default parameters, merge and clamping, priority, path writing, and feedback deltas;
- `test/plugin-smoke.mjs` (29 checks): registration of 13 tools and executability of the reconstruction/resumption/prediction/persona tools.
