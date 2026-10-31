> English | [中文](./备选方案-人类记忆缺陷.md)

# Human Memory Defects · Alternative Implementation Approaches

## 0. Why This Document Exists Separately

The human memory system is far from perfect — you could even say it is "full of bugs." When we build a "human-style memory" for DSH, we face a choice: **which features of human memory are worth imitating, and which are actually defects that should not be copied?**

Some "defects" are really features — forgetting, for instance, exists to keep the system focused on important information and is worth implementing; interference forces us to do deduplication and comparison, so it is worth implementing too. But others (false memory, memory tampering) are reliability incidents, and **deliberately implementing them is actively harmful**.

This document lists the typical defects of human memory one by one and gives three judgments for each — **can it be implemented, how would it be implemented, and is it recommended** — as alternative reference material alongside the main design doc [实现思路.md](./实现思路.md).

## 1. Judging Principles (Criteria First)

Score each defect with three questions:

1. **Does it make DSH more "human" and more usable?** Yes → plus.
2. **Does it harm the reliability / reproducibility of answers?** Yes → minus.
3. **Is the implementation cost manageable?** Manageable → plus.

Resulting stance:

- **Worth imitating**: forgetting, interference (and how to cope with it), retrieval failure, the serial position effect, working-memory capacity limits, and the loss of detail under emotion — these are both human-like and force the system to do "dedup / comparison / prioritization," so they are beneficial overall.
- **Should not imitate**: false memory, suggestibility, memory tampering — these are pure incidents; deliberately implementing them only reduces reliability.

## 2. Defect-by-Defect Analysis

### 2.1 Similar Memories Interfere With Each Other (Proactive / Retroactive Inhibition)

**Phenomenon**: After learning A, learning B interferes with recall of A (retroactive inhibition); earlier-learned A interferes with later-learned B (proactive inhibition). Typical scenario: memorizing a batch of similar words in a row, or reading ten similar cases — all the details blur together.

**Can it be implemented?** Yes, and **the first version already covers part of it**. A dense cluster of similar items naturally lowers retrieval discrimination (because their n-gram similarities are all high), making them "compete for rank" with each other.

**How to implement (reinforcement)**:
- Detect "similar items in the same batch" at write time: if the similarity between a new memory and an existing one is ≥ the threshold, tag both as "easily confused."
- For easily confused groups, return comparison information at retrieval time as well (e.g. "this one is similar to X and Y; the difference is…") instead of only the top-scoring item.
- Optional: merge similar items into a "comparison table" (the consolidation clustering in the main design already reuses this logic).

**Recommendation**: **Do it.** It is a natural driver for "active deduplication" and significantly reduces redundancy in the memory store.

### 2.2 Remembering Something but Being Unable to Recall It (Tip-of-the-Tongue / Retrieval Failure)

**Phenomenon**: The information is still in the brain, but there is no cue to extract it — "I know I've seen this concept, I just can't recall the name."

**Can it be implemented?** Yes. This is exactly the direct expression of the main design's "forgetting = lowering accessibility, not deleting": the memory is not deleted, its retrieval score is just too low to "reach."

**How to implement**:
- Ensure "forgetting" only lowers retrieval rank and **never physically deletes** (unless the user explicitly calls `memory_forget`), so "can't recall it" becomes a reversible state.
- Provide "multiple cues": retrieval looks not only at semantic similarity but also falls back on auxiliary cues such as `layer`, tags, and time windows (e.g. `/memory-list` can browse everything).
- Optional: `memory_recall` supports "fuzzy recall" — returning memories that score slightly below the threshold as "weak candidates," simulating the "on the tip of my tongue" state.

**Recommendation**: **Do it** (the core mechanism is already in the first version).

### 2.3 Forgetting (Trace Decay)

**Phenomenon**: Without review, memories gradually weaken — fast at first, then slow.

**Can it be implemented?** Yes, it is the core of the main design. Implemented with lazy time decay `exp(-(age/τ)^c)`, **no daily update needed**.

**Recommendation**: **Already done**, see sections 2 and 4 of the main design.

### 2.4 Primacy / Recency Effect (Serial Position Effect)

**Phenomenon**: The beginning and the end of a list are remembered better than the middle.

**Can it be implemented?** Yes, and simply.

**How to implement**:
- In retrieval ranking, give a small recency bonus to memories that were "most recently written / most recently accessed" (recently first), and a primacy bonus to "the earliest-established core memories."
- Part of the effect is already implicit in time decay (newer is stronger); to model it explicitly, add another `recency` weight term in `retrieval`.

**Recommendation**: **Optional.** The recency part is already covered by time decay; primacy can serve as a supplement to "core memories resisting forgetting."

### 2.5 Flashbulb Memories Are Inaccurate (Detail Loss Under High Emotion)

**Phenomenon**: The core of an intensely emotional event is remembered firmly, but the surrounding details, their order, and numbers are impaired — "I only remember that something happened, not the details."

**Can it be implemented?** Yes, and worth doing.

**How to implement**:
- In the importance score, the emotion score `emotion` only raises the overall weight of the "core content" and does not raise (it may even lower) confidence in the accuracy of detail fields.
- Each memory could carry a "detail confidence" field: under high emotion, core confidence is high and detail confidence is low; retrieval results are then annotated accordingly as "core reliable, details uncertain."

**Recommendation**: **Optional** (somewhat academic, moderate payoff).

### 2.6 False Memory / Memory Reconstruction

**Phenomenon**: People "remember" things that never happened, or during recall reassemble memories according to current beliefs and embellish them.

**Can it be implemented?** Technically yes (let the LLM "fill in" details during consolidation), but **it should not be done**.

**How to implement (description only, not recommended)**: Let the LLM improvise freely to complete the narrative during consolidation → producing "plausible errors."

**Recommendation**: **Don't do it.** It harms reliability. Instead, consolidation should **explicitly preserve provenance** (which episodic memories each semantic memory came from) and keep the "original text" rather than invented content, minimizing reconstruction.

### 2.7 Suggestibility

**Phenomenon**: However the question is asked, recall drifts accordingly — leading questions make people "remember" details that do not exist.

**Can it be implemented?** Technically yes, but **it should not be done**.

**Recommendation**: **Don't do it.** In system terms, retrieval should be as **decoupled from query wording** as possible (using normalized, debiased similarity), rather than letting the query steer the content of memories.

### 2.8 Working Memory Capacity Limit (7±2 Chunks)

**Phenomenon**: A person can hold only about 7±2 chunks in working memory at a time; anything beyond that is lost.

**Can it be implemented?** Yes. DSH itself has a context window limit, which is a natural analogue.

**How to implement**:
- Define "working memory" = the key information from the most recent N items of the current session (`workingMemory.capacity`, default 7).
- When capacity is exceeded, important content "spills over" into episodic memory and the rest is discarded — this corresponds to the working-memory overflow action in the main design's layered architecture.

**Recommendation**: **Do it**, but the first version only implemented the concept and the configuration item; it does not yet automatically capture from sessions, so it is listed as an iteration item.

### 2.9 State-Dependent Memory (Mood / Context Dependence)

**Phenomenon**: The state you learned in is the state in which recall comes easiest.

**Can it be implemented?** Yes, at somewhat higher cost.

**How to implement**: Record context tags at write time (topic, time, conversational role) and weight retrieval when the current context matches.

**Recommendation**: **Optional / defer**, uncertain payoff, skip for now.

### 2.10 Egocentric Bias in Memory

**Phenomenon**: Self-related information is over-weighted and remembered more firmly.

**Can it be implemented?** Yes, and it is already in the main design.

**How to implement**: In the importance score, `selfRelevance` carries the highest weight (default 0.25) — precisely an "active modeling" of this bias.

**Recommendation**: **Already done** (as one dimension of the content factors).

## 3. Summary

| Defect | Implementable | Recommended | First-version status |
|------|:---:|:---:|:---:|
| Similar memories interfere with each other | ✅ | ✅ Do | Partial (similarity naturally competes; reinforcement pending) |
| Remember but can't recall (retrieval failure) | ✅ | ✅ Do | Done (forgetting = lower rank, no deletion) |
| Forgetting (trace decay) | ✅ | ✅ Do | Done (lazy time decay) |
| Primacy / recency effect | ✅ | 🔶 Optional | Recency covered by time decay |
| Flashbulb memory detail loss | ✅ | 🔶 Optional | Not done |
| False memory / memory reconstruction | ✅ | ❌ Don't do | Inverse: consolidation keeps provenance |
| Suggestibility | ✅ | ❌ Don't do | Inverse: retrieval decoupled from wording |
| Working memory capacity limit | ✅ | ✅ Do | Concept + config; auto-capture pending |
| State-dependent memory | ✅ | 🔶 Deferred | Not done |
| Egocentric bias | ✅ | ✅ Do | Done (selfRelevance weight) |

## 4. Conclusion

- **Defects to deliberately implement** (making the system more human and more focused): forgetting, retrieval failure, similar-item interference and how to cope with it, working-memory capacity, egocentric bias — these have mostly landed in the first version already.
- **Defects to deliberately avoid** (pure incidents): false memory, suggestibility — implementing them would only reduce reliability, so we should do the opposite (preserve provenance, debias retrieval).
- **Undecided**: primacy / recency, flashbulb details, state dependence — uncertain payoff; keep them as alternatives and decide once there is real usage feedback.

In one sentence: **what we imitate is "how human memory makes trade-offs under limited resources," not "how human memory goes wrong."**
