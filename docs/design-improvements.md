# RoboArena improvements: v1 choices and later rules experiments

This note separates verified RoboSport behavior, parity-friendly improvements
adopted for the internet-first v1, and balance-changing ideas deferred until
later. It is not a second mechanics spec: `spec.md` remains canonical, and any
adopted gameplay change must update that spec, the implementation plan, and
focused engine tests together.

The v1 product is 2-4 humans on separate devices playing free-for-all Survival:
one Team and unique Side per player. Hot-seat, allied/multi-Team Sides, Stealth,
and other sports are post-v1.

## The three clocks

The original design becomes clearer when three different quantities are never
called simply “time”:

1. **Program horizon** — simulated time available for robot commands, normally
   15 seconds / 900 engine ticks.
2. **Simulation time** — deterministic 60 Hz event timestamps and ordering.
3. **Presentation time** — how long the player spends watching the movie.

RoboArena v1 keeps the first two authoritative and makes the third flexible.
Movie playback may run at 0.5×–4×, pause, scrub, skip idle spans, or briefly
slow around important simultaneous events. Presentation must not change event
ticks, RNG use, acquisition, damage, or replay outcome.

Adopted v1 UI:

- show command start/completion ticks and remaining program horizon while
  planning;
- show a compact event-density strip before playback;
- offer “skip idle” without reordering events;
- preserve a one-click “original 12 fps” presentation preset;
- let replay analysis jump from a damage event to the firing decision that
  caused it.

This solves the classic plan-time/render-time mismatch: a 15-second simulated
turn need not consume exactly 15 seconds of wall-clock viewing, but every
tactical consequence still belongs to the same simulation tick.

## Strict impact timing

RoboSport locks target tile, hit, and damage at fire time. The current RoboArena
MVP also mutates HP at that boundary and treats projectile travel as visual.

The recommended later rules experiment is **pre-rolled pending impact**:

- at fire time, consume RNG and freeze aimed tile, hit/miss, damage/blast data;
- schedule an immutable impact at a deterministic future tick;
- allow robots to execute commands and be hit by other shots before it arrives;
- do not cancel the projectile if its shooter is destroyed;
- batch impacts sharing a tick before death cleanup;
- render from the same launch/impact events that mutate state.

This gives audiovisual causality and richer simultaneous tactics without
turning movement into an impact-time dodge or consuming RNG twice. The tradeoff
is a pending-impact subsystem and the need to choose or audit projectile travel
constants. Until that work is approved, fire-boundary mutation remains the
canonical v1 rule and the renderer must not imply that visual travel permits
dodging.

## Scan & Fire versus movement

Verified behavior is opportunity-sampled. A scanner checks at its weapon repeat
interval, after movement completing at that tick. A runner crossing the cone
between checks can escape acquisition; a runner present at a check is evaluated
at its current tile. Speed itself is not a numeric hit modifier.

This is faithful but opaque. Improvement options, in increasing order of rules
change:

1. Keep the rule and visualize future scan opportunities on the planner/movie
   timeline. This is the adopted v1 choice.
2. Add an explicit reaction-delay stat and check cone-entry events. Easier to
   understand, but changes balance and replay event density.
3. Continuously check every tick. Most intuitive visually, but makes automatic
   fire much stronger and devalues timing paths between repeat opportunities.

If option 1 ships, a post-turn explanation should say, for example, “crossed
the cone between Rifle checks at ticks 120 and 150” rather than appearing to
miss a visible target arbitrarily.

## Surface hidden combat state

Several original rules are tactically meaningful but hard to infer:

- damage assigns 1–4 later firing actions with halved hit score;
- Scan & Fire uses terrain-derived sight-strength accuracy bands inside its
  broad hard cone;
- rough, bush, low wall, posture, distance, and current tile feed different
  stages of hit/damage resolution;
- Aim & Fire targets a tile, and leaving it before fire halves the score;
- slow terrain works by losing two-tile command compression, not by a displayed
  speed percentage.

RoboArena v1 exposes these through a probability/explanation panel, status
icons, route arrival ticks, and a post-turn causality log. The player should be
able to answer “why did this miss?” without reading source code. For uncertain
future state, show ranges or conditions rather than a falsely exact preview.

## Planner improvements

- Draw a unit route but display how it compresses into 30/40-tick commands;
  highlight slow tiles that break a double.
- Show ghost arrival positions at selected ticks and warn when a command falls
  beyond the program horizon.
- Treat posture, scan direction, and fire as editable timeline blocks with
  keyboard nudging and undo/redo.
- Preview scan opportunities and cone coverage at the robot's predicted
  position, while clearly marking outcomes dependent on hidden enemy orders.
- Keep deterministic validation in shared engine helpers so the planner cannot
  authorize an order the resolver later rejects.

## Internet-first free-for-all

Separate devices materially improve the original design: planning is truly
simultaneous and private, no privacy curtain or device handoff interrupts the
match, and ready/lock status makes waiting legible. The server waits for all
players' locked orders, resolves once, and persists the result. Players may
close the app after submitting and return later. Each watches/skips unseen turns
and plans the next turn on an independent schedule; there is no global movie
playback gate. The room/home UI makes `your turn`, `waiting`, and `result ready`
obvious without requiring push notifications.

This async model makes durable server state a v1 correctness feature, not
production polish. Accepted orders, seeds, results, replay digests, ownership,
and per-player seen-through cursors must survive ordinary process restarts.

Four-player Survival must not be enabled merely because `teams[]` accepts four
entries. Phase 11.6 exercises explicit Home slots, per-Team contacts, four-way
crossfire, simultaneous elimination, disconnect/rejoin, and replay agreement.
v1 requires unique Sides. The audited same-Side rules—direct-fire exclusion,
blast friendly damage, always-visible allies with private contacts, and shared
ceremony totals—are deliberately held for the post-v1 alliance phase.

Hot-seat is also post-v1. When added, it should reuse the authoritative phase
machine through a local adapter and add a privacy handoff; it must not become a
second resolver or divergent rules implementation.

## Recommended order

1. Finish exact deterministic Survival resolution and replay.
2. Establish durable authoritative rooms, private asynchronous order submission,
   leave/return recovery, and exactly-once resolution
   before building the planner around local-only state.
3. Ship exact timeline feedback, editable plans/undo, scan-opportunity previews,
   flexible presentation speed, and post-turn explanations without changing
   combat rules.
4. Harden 2-, 3-, and 4-player free-for-all play through Phase 11.6.
5. Add hot-seat and alliance/multiple-Team Sides in v2 using the audited rules.
6. Evaluate pending impacts, continuous/reaction scanning, and other
   balance-changing redesigns as an explicit RoboArena ruleset, while retaining
   an Original-compatible rules preset if practical.
