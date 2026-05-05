# Codex Prompt: RoboSport Research Extraction

You are helping build a faithful modern clone of the 1991 Maxis game RoboSport.

Your first job is not to code. Your first job is to extract source-backed mechanics from the project docs and any manuals/reference files placed in this folder.

Rules:

1. Separate CONFIRMED from INFERRED from PROPOSED.
2. Do not invent exact formulas unless a source or test establishes them.
3. Update `docs/confirmed-mechanics.md` only when a mechanic is directly supported.
4. Update `docs/open-questions.md` when a mechanic remains unknown.
5. Use `docs/resolution-rules-proposal.md` as a proposed implementation only, not as original-game fact.
6. If you inspect gameplay video/screenshots, record the timestamp and what is visible.
7. If you run the original game, add results to `tests/original-game-test-results.md`.

Deliverables:

- a mechanic source matrix
- updated open questions
- prioritized list of tests needed before implementing the engine
