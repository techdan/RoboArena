# Fresh-context implementation and review prompts

Use one bounded implementation context per phase or independently shippable
slice. Do not ask one context to implement the entire roadmap.

## Implementation prompt (Sol Medium)

```text
Work in C:\src\DevProjects\RoboArena.

Start by reading, in order:
1. AGENTS.md
2. CLAUDE.md
3. docs/spec.md
4. tasks/core-build-plan.md
5. docs/implementation-plan.md, especially Phase 3
6. tasks/phase2-resolver-design.md

Then inspect git status and the relevant engine code/tests. The worktree may
contain intentional uncommitted audit changes. Preserve them, do not reset or
revert them, and avoid unrelated refactors.

Objective: implement Phase 3 projectile/blast event semantics completely, then
stop at the phase boundary.

Required behavior:
- Preserve the canonical v1 rule that aimed tile, hit/miss, damage, blast data,
  RNG consumption, HP mutation, and death resolution lock at the fire boundary.
- Add deterministic projectile launch/impact presentation events for named
  missile and grenade behavior. Visual travel duration is presentation data; it
  must not permit dodging, retargeting, rerolling, or renderer authority.
- A projectile/result already fired is not cancelled if its shooter is destroyed.
- Preserve same-boundary deterministic ordering and batched damage/death rules.
- Preserve direct-fire same-Side exclusion and explosive friendly damage.
- Do not implement strict pending-impact gameplay, Scan & Fire, Stealth,
  non-Survival sports, UI, or networking in this phase.
- Keep src/engine pure, immutable, deterministic, UI-independent, and free of
  Math.random/wall-clock/browser APIs.
- Reuse existing types/helpers and keep new public outcomes/events as typed
  discriminated unions. Do not duplicate combat calculations in renderer-facing code.

Working method:
1. Restate the Phase 3 invariants and identify the smallest files/API changes.
2. Add focused failing tests before or alongside each behavior change.
3. Implement in small coherent patches; do not broaden scope to cleanups.
4. Add deterministic tests for same-seed equality, input immutability, named
   explosive dispatch, friendly blast damage, shooter destruction after fire,
   same-boundary interactions, stable event ordering, and turn-end edges.
5. Update docs/spec.md and docs/implementation-plan.md only if implementation
   changes project truth; retain confidence/source labels.
6. Run npm.cmd test, npm.cmd run typecheck, npm.cmd run lint,
   npm.cmd run format:check, and git diff --check.

Before finishing, review your own diff for accidental scope expansion, hidden
nondeterminism, state mutation, event/state disagreement, and missing edge tests.
Do not commit unless explicitly asked. Report the outcome first, tests run,
important design decisions, changed files, and any genuinely unresolved issue.
```

## Independent review prompt (Sol High)

```text
Review the current RoboArena Phase 3 implementation; do not implement a broad
rewrite. Work from the repository state and read AGENTS.md, CLAUDE.md,
docs/spec.md, tasks/core-build-plan.md, the Phase 3 section of
docs/implementation-plan.md, and tasks/phase2-resolver-design.md.

Treat this as an adversarial correctness review. Inspect the full diff and
relevant surrounding code. Prioritize findings in this order:
1. deterministic state/event disagreement or replay divergence;
2. wrong fire-boundary locking, RNG consumption, damage/death ordering, or
   projectile cancellation;
3. named direct/explosive dispatch and friendly-fire mistakes;
4. input mutation, illegal engine dependencies, or nondeterministic APIs;
5. missing boundary/concurrency/regression tests;
6. unnecessary complexity or scope beyond Phase 3.

Run the focused tests plus npm.cmd test, npm.cmd run typecheck, npm.cmd run lint,
npm.cmd run format:check, and git diff --check. Give actionable findings with
file/line references and severity. If there are no findings, say so explicitly
and identify residual risks or test gaps. Do not edit files unless asked after
the review.
```

## Fix-and-verify loop

1. Medium implements one bounded slice and runs all gates.
2. High reviews from a fresh context without editing.
3. Medium fixes only accepted findings and adds regression tests.
4. High performs a short verification of the fixes and phase acceptance gate.
5. Commit the completed phase, then start the next phase in a new context.
