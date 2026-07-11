# Phase 2 turn resolver — design record

**Status:** design decisions locked (Fable planning pass, 2026-07-11).
Implement AFTER `tasks/engine-realignment-plan.md`. This is the architecture;
the implementation plan §Phase 2 has the acceptance criteria.

## Core model

The resolver is a **discrete-event simulation over a 60-unit/s clock**.
Input: `{ initialState, seed, ordersPerRobot }`. Output: an append-only
**event stream** `{ tick, seq, type, payload }[]` — this IS the movie and IS
the replay. No other channel of truth.

Each robot holds a command queue (its program). Each command has a duration
in 60ths (from the realigned constants). The loop:

```
for tick = 0 .. 900:
  1. collect robots whose current command completes at this tick
  2. process completions in CANONICAL ORDER (below)
  3. process projectile impacts scheduled for this tick (same order rule)
  4. evaluate Scan & Fire triggers (cone entry) AFTER movement settles
  5. start each robot's next command; emit events as effects apply
```

## Determinism rules (the contract — violating any breaks replay)

1. **Canonical actor order:** team index, then roster slot index. All
   same-tick processing iterates in this order. Never iterate a Map/Set/object
   keys for game effects; use arrays with fixed indices.
2. **One RNG stream**, consumed only inside the resolver in canonical order.
   Renderer/UI never touches it (mirror of the original's two-stream design —
   we get stream separation by simply not exposing the engine RNG).
3. **`seq` counter** disambiguates multiple events at the same tick; assigned
   in emission order. Replay equality = deep-equal of the full event array.
4. Resolver is a pure function: `resolveTurn(state, orders, rng) → { events,
   nextState }`. No mutation of inputs.

## Simultaneity decisions

- **Same-tick fire vs move:** completions process before trigger checks, so a
  robot that moves off a tile at tick T is already gone when a tick-T Scan &
  Fire evaluates. Fire commands resolving at tick T target positions as of
  step 2's canonical-order snapshot — accept the order-dependence; it is
  deterministic, matches "the original locks outcome at fire resolution."
- **Movement collision (two robots entering the same tile, same tick):**
  earlier canonical actor wins the tile; the later one's move FAILS (stays
  put, loses the time already spent, command aborts, next command starts).
  Original behavior unknown — flagged `// PLAYTEST RE §20-adjacent` for a
  DOSBox probe; this rule is a placeholder chosen for simplicity + determinism.
- **Mutual destruction:** damage applies immediately at impact processing;
  a robot destroyed at tick T with its own projectile already in flight still
  gets its hit (fire-time resolution — result was locked at fire).
  Two projectiles killing each other's shooters at the same tick: both land.

## Fire pipeline integration (from realignment plan)

Fire command completes → run full pipeline (range/cone/LoS gates → cover
class → hit score, halved if target off aimed tile → damage roll) → spawn
projectile carrying `{ hit, damage, impactTick, path }`. `path` is a
tile-per-tick schedule (integer steps, no floats) used ONLY by the renderer;
impact processing reads the pre-rolled result. Burst = 3 projectiles, one
roll each, one fire-interval cost total.

## Scan & Fire (Gate B)

Evaluated per tick after movement: first enemy (canonical order) inside
cone ∩ range ∩ LoS ∩ the command's engagement cap (`maxDistance`, `seconds`)
triggers a fire at that robot's CURRENT tile. Cone width stays playtest
±90°/±45° (RE §20 #22). One shot per fire-interval while triggered.

## Events (minimum vocabulary)

`turnStart, commandStart, moved, postureChanged, scanRotated, deployed,
fired (with projectile id+path), projectileImpact, damaged (amount, hp
after), destroyed, commandAborted (reason), turnEnd`. Renderer consumes
these only — it must be able to play the movie with no engine calls.

## Testing strategy

- Golden-replay tests: fixed seed + orders → snapshot the event array.
- Property test: resolve twice, deep-equal.
- Targeted simultaneity tests: same-tick collision, same-tick mutual kill,
  fire-at-vacated-tile (score halving visible via seeded RNG).
- No statistical tests here — resolver adds no new randomness sources.
