> English | [中文](./迭代方向-会话短期记忆.md)

# Roadmap: Session short-term memory

> Documents a direction that **may be developed in the future**; it is not implemented in the current version (0.1.2).
> Goal: in long sessions, let the agent avoid repeatedly rereading the entire context and instead use “this session’s short-term memory” to focus on the current conversation.

## 1. Problem

Currently, every DSH request derives the full history from the session log. The longer the session:

- the more expensive and slower the context becomes;
- the agent tends to reread early turns and repeatedly confirm work already done;
- information genuinely relevant to “the current step” is drowned in the long history.

## 2. Approach: give each session a “task state”

Maintain a **session working memory** for each session that stores only “the state of the current task,” not every detail:

```jsonc
{
  "sessionId": "…",
  "goal": "把 dsh-human-memory 的设置卡片改成 settings.section",
  "done": ["读到 dsh-notify-say 的实现", "改完 client.js", "跑通 27 项自测"],
  "todo": ["验证卡片渲染", "更新文档"],
  "constraints": ["不改版本号", "删除不弹确认"],
  "lastUpdatedAt": 1793300000000
}
```

Update it once at the end of each turn (reusing the existing `agent/turn-stopping`), with content drawn from:

- the user’s intent for this turn;
- the results of this turn’s tool calls (success/failure, which files changed);
- the state of the previous short-term memory.

## 3. Include only “what is necessary” when assembling a request

An ideal request context would be:

1. the system prompt;
2. **a session short-term memory summary** (the JSON above rendered as short text);
3. the raw conversation from the most recent N turns (a sliding window, with N configurable);
4. relevant long-term memories recalled from the current input (`memory_recall`).

Earlier turns are not included in the request by default but remain in the session log; when needed, they can be retrieved on demand via `memory_timeline`.

## 4. Relationship to existing memory layers

| Layer | What it stores | Purpose |
|------|--------|------|
| Session short-term memory (this direction) | Current task’s goal / done / todo / constraints | Determines “what this turn should focus on” |
| Working memory `working` | Precise operations (files, commands) | Details that fade quickly |
| Episodic memory `episodic` | “What was done” each turn | Timeline retrieval |
| Semantic memory `semantic` | Long-term facts/preferences | Cross-session knowledge |

Session short-term memory is **session-level**; after the session ends, it can settle into episodic memory.

## 5. Feasibility assessment

**Conclusion: feasible, but a medium-to-large change; it is recommended as the direction for the next major version.**

Favorable conditions:

- DSH has `agent/pre-step` (a waterfall that can replace the messages entering a step) and `agent/request` (which can replace the request configuration);
- the session log is the single source of truth, so trimmed turns can still be recovered via `memory_timeline`;
- existing compaction seams (`compaction/*`) can serve as references.

Problems that need solving:

1. **Tool-call chain integrity**: turns with a “tool/call present but tool/result absent” must not be trimmed;
2. **Recoverability**: content removed from the request must still be retrievable from the log;
3. **Compression quality**: short-term memory summaries require LLM summarization, and key constraints must not be lost;
4. **Regression testing**: A/B comparisons of answer quality between “full context” and “short-term memory” are needed;
5. **Different model windows**: window sizes vary widely and must be configured per route.

## 6. Phased plan (draft)

- **Phase 1 (read-only, no request changes)**: generate and display session short-term memory every turn, and observe quality first.
- **Phase 2 (toggleable)**: when `sessionMemory.enabled` is on, requests carry only “summary + most recent N turns,” validated with A/B tests.
- **Phase 3 (default)**: once quality is stable, consider enabling it by default and provide a settings UI to “view/edit short-term memory.”

## 7. Risks and boundaries

- Summary errors directly mislead subsequent answers → the original log must remain available for verification.
- Safety/permission constraints must not be dropped just to save tokens.
- Do not confuse this with “working memory”: working memory holds operation details, while short-term memory holds task state.
- Not implemented for now; recorded for later.
