> English | [中文](./迭代方向-用户画像记忆.md)

# Iteration Direction: User Portrait Memory

> This document only records features and design trade-offs that **may be developed in the future**; it does not mean they are implemented in the current version.
> The current version (0.1.2) already implements: factual memory, behavioral memory, working memory, the forgetting curve, spaced repetition, consolidation, and the settings card.

## 1. Goals

Over long-term conversation, gradually distill the user's **stable traits** into "user portrait" memories:

- **Verbal tics / favorite words**: e.g. 「其实」「说实话」「说白了」「搞一下」.
- **Sentence-pattern habits**: mostly short sentences / long expository sentences; prefers conclusion first and then explanation, or setup first and then conclusion.
- **Logical habits**: prefers examples, prefers comparisons, prefers being given a solution directly.
- **Communication preferences**: wants detail or brevity; whether they like rhetorical questions; whether they accept English terminology.
- **Domains of interest and goals**: repeatedly recurring projects, tech stacks, long-term goals.

A portrait is not "recording a fact" but a **cross-session, slowly converging statistic + generalization**.

## 2. Why a Separate "Layer"

The existing three layers (episodic / semantic / core) plus working memory answer "what happened, what it is, and how important it is."

A user portrait answers "**who this person is and how to talk to them**," which has different characteristics:

| Dimension | Fact / behavior memory | User portrait |
|------|--------------|----------|
| Source | Single turn / single event | Long-term multi-turn statistics |
| Rate of change | Fast | Very slow (gradually converging) |
| Forgetting | Decays | Almost never forgotten (stable traits) |
| Purpose | Recalling facts | Adjusting reply style / personalization |
| Storage | `memories/*` | Suggest a separate `portrait/` |

So we suggest adding a **portrait layer** alongside the existing memory store, rather than stuffing it into episodic.

## 3. Data Representation (Draft)

```jsonc
{
  "id": "portrait-verbosity",
  "type": "style",              // style | phrase | logic | interest
  "label": "偏好简洁",
  "value": 0.8,                 // 0..1 倾向强度
  "confidence": 0.6,            // 置信度（随证据增加而上升）
  "evidenceCount": 12,          // 支持该结论的用户发言条数
  "examples": ["直接说重点", "别展开"],  // 少量原文证据（可关闭）
  "firstSeenAt": 1793000000000,
  "lastUpdatedAt": 1793300000000
}
```

## 4. Implementation Path (Phased)

### Phase 1: Heuristic statistics (no LLM dependency, get it working first)

- Sampling: take only `user/message` (skip injected/system messages).
- Statistics:
  - average sentence length, ratio of questions, frequency of exclamation marks / ellipses;
  - high-frequency words / verbal tics (high-frequency n-grams after removing stop words);
  - whether the user often uses modal particles such as 「吗/呢/吧」.
- Output: low-confidence style entries (e.g. "sentences tend short," "often uses 「其实」").
- Trigger: update every N turns or every M user messages, to avoid frequent disk writes.

### Phase 2: LLM generalization (more accurate, but costlier)

- Hand the latest batch of user messages (redacted, truncated) to `ctx.llm` and ask for a **structured portrait**:
  - only conclusions backed by evidence are allowed;
  - each conclusion comes with 1–2 pieces of verbatim evidence;
  - if unsure, output nothing.
- Merging: merge new conclusions with the old portrait by confidence weighting, so that a single anomalous message cannot skew it.

### Phase 3: Consuming the portrait

- **Injection**: inject "user preferences: concise, conclusion first" into the system prompt or `agent/pre-step` to influence reply style.
- **Toggle**: users can turn off "adjust replies using the portrait" in `settings.json`.
- **Display**: add a "User Portrait" group to the settings card, where individual portrait entries can be viewed / deleted.

## 5. Relationship to Existing Mechanisms

- **Forgetting curve**: portrait entries **hardly decay** (`tauMs` very large or `decay=false`), because they describe stable traits.
- **Spaced repetition**: portraits are not reinforced by "being mentioned again" but by **evidence accumulation** (`evidenceCount` / `confidence`).
- **Consolidation**: does not take part in episodic→semantic merging; maintained separately.
- **Working memory**: raw evidence for portraits can go into working memory first and be cleaned up after periodic generalization, to avoid bloat.

## 6. Privacy and Boundaries (Important)

- **Entirely local**: the portrait is stored locally only and never uploaded.
- **Can be turned off**: `settings.json` provides `portrait.enabled`, off by default or asked on first use.
- **Can be deleted**: the settings card supports deleting entries one by one and clearing everything with one click.
- **No over-inference**: only "observable language habits" are recorded; sensitive attributes (health, politics, religion, etc.) are not inferred.
- **Evidence minimization**: `examples` can be configured to store only statistics, not the original text.

## 7. Open Questions

1. Portrait update frequency: every turn / every N turns / when idle?
2. Portrait conflicts: when new and old conclusions contradict, overwrite or keep both with timestamps?
3. Cross-project: user style may differ across projects — do we need "per-project portraits"?
4. When multiple users share one machine, how do we distinguish users? (currently assumes a single user via `DSH_HOME`)
5. Should the portrait be injected into the system prompt, or only offered as an optional result of `memory_recall`?

## 8. Explicitly Out of Scope

- No emotion recognition / psychological profiling.
- No cross-device sync.
- No use of portraits for advertising or recommendations.
- No writing verbatim evidence to disk without the user's consent.
