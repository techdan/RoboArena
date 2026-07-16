# RoboArena game specification

The canonical, current spec for v1 mechanics. Numbers here match `src/engine/constants.ts` and `src/engine/catalog.ts` — those files are the literal source of truth; this doc explains them.

**Confidence labels** on each rule:
- ✅ **CONFIRMED** — binary path/semantics or controlled DOS test verified
- 🟨 **MAPPED / PROVISIONAL LABEL** — raw mechanism is verified, named mapping remains open
- 🔵 **PROPOSED** — engine ships with these defaults; tunable in playtest
- ⏳ **TBD** — strawman value in code, awaiting empirical pass

The binary-derived tables and code paths are documented in
[`reverse-engineering.md`](./reverse-engineering.md) and independently checked by
[`re-verification.md`](./re-verification.md). Named weapon selectors, command
timing, the scan-cone boundary, and diagonal endpoint-cover sampling are now
path- and semantics-confirmed against the version-locked Windows binary.
Deliberate post-parity alternatives are kept separately in
[`design-improvements.md`](./design-improvements.md) so recommendations do not
silently become original-game claims.

---

## 1. Game overview

Two to four human players, each on a separate Internet-connected device, each
command one Team of robots in a top-down tactical arena. Each turn, players
privately program their robots' actions over a 15-second timeline. The room
server resolves every locked program simultaneously as a deterministic movie,
then the next turn begins. Last Team standing wins the v1 free-for-all Survival
mode.

**v1 scope (Phases 1-11.6)**: 2-4 humans on separate devices join an online
room; one player controls one Team; every Team has a unique Side, so matches are
1v1, 1v1v1, or 1v1v1v1. Desktop mouse + keyboard only. The server is
authoritative. Hot-seat, alliances/multiple Teams per Side, Stealth, every
non-Survival sport, and AI are later phases.

### Scope trims and deliberate deviations

RoboArena v1 is a playable Survival MVP, not full RoboSport parity.

Deferred deliberately:
- Hot-seat / shared-device play. Separate-device rooms are the v1 path; privacy
  curtains and sequential handoff are v2 work.
- Alliances and multiple Teams sharing a Side. The audited original behavior is
  retained in the engine/spec, but v1 room validation assigns a unique Side to
  every player.
- AI personalities. Original RoboSport includes AI levels; v1 is human-only.
- Non-Survival sports and their commands. Treasure Hunt / Capture the Flag / Hostage / Baseball plus sport-specific commands are out of v1.
- Stealth class behavior and Stealth-specific visibility/Scan & Fire rules.
  The catalog may reserve its original stats, but main-game setup, resolver,
  visibility, planner, tests, and assets must not depend on Stealth.
- Full Custom Game team builder and point-buy roster editing. v1 can start with Quick Start / preset rosters.
- Full original weapon-system parity. v1 uses the core weapon set currently represented in `catalog.ts`; do not add extra original weapon systems without a new phase.
- Production persistence, accounts, observability, deployment automation, and full help/tutorial systems.

### Closed audit boundary and deferred content

No unresolved original-game business rule blocks the 2-4 Team Survival build.
The focused trace closed same-Side combat, visibility, ceremony scoring, Home
slots, and canonical Team order. v1 deliberately uses only the free-for-all
subset: one Team and one unique Side per connected player. Alliance and hot-seat
UI are v2 implementation work, not research gaps. The other remaining
boundaries are explicit product/data choices:

- **Projectile presentation timing**: hit/damage are locked at fire time; exact
  visual travel duration is a Phase 7 RoboArena animation choice.
- **Target speed wording**: the live resolver contains no independent numeric
  speed term. Movement matters through the confirmed off-aimed-tile score
  halving; the Scan & Fire Seconds field controls command duration only.
- **Arena setup**: `.TWN` MAP payloads are verified row-major terrain with no
  flip/transpose. Home rectangles are derived exactly from arena dimensions
  (§9); Dock is an off-field robot state, not hidden MAP/INF metadata.

---

## 2. Match structure

### Teams

- Original supports 2-4 Teams. v1 rooms accept 2-4 human players with exactly
  one Team each. Every v1 Team receives a unique Side; 2v2/3v1 alliances are
  rejected until v2. ✅ original player count / deliberate v1 FFA restriction
- Each team: name, color, side (1-4), brain (`'human'` only in v1; `'stupid'` AI is post-v1), home area corner.
- **Side** is an alliance axis: multiple teams can share a side (free-for-all vs. 2v2 etc.). Manual confirms ≥2 sides required. ✅
- The original assigns Home Areas NW, NE, SE, SW by occupied Team Name box,
  clockwise. A two-team game can therefore use nonadjacent boxes/homes; the
  home slot is setup data, not safely derivable from compacted `teams[]` index.
- Internal field `+0x28` is the zero-based Side index, not a unique Team id.
  Direct fire and Scan & Fire skip every robot/Team with the shooter's Side.
  Explosive blast still damages same-Side allies. ✅
- Team-box/Home-slot order, then roster order, is the canonical actor/candidate
  order. Equal Scan & Fire candidates retain the earlier candidate after the
  traced distance and priority comparisons. ✅

### v1 online-room contract

- A host creates a room and receives a short join code/deep link. The room
  starts with 2-4 connected, ready players.
- The host chooses the supported Survival preset; each player chooses only
  their own name/color. Server assignment supplies a unique Home slot and Side.
- Each client edits only its own Team and submits one immutable `TurnOrders`
  payload. Other players see ready/not-ready status, never draft or locked
  orders.
- The server validates every order, waits until all active players lock, runs
  the deterministic resolver once, stores the canonical result, and sends each
  participant only the state/events they are authorized to observe.
- A per-room rejoin token restores the same player slot after closing the tab,
  changing devices by explicitly transferring the token/link, or disconnecting.
  Accounts are not required. A submitted turn remains locked on the server, so
  the player may leave and return hours or days later.
- When all players submit turn N, the server resolves it immediately and stores
  its canonical result durably. Turn N+1 may become the room's current planning
  turn without requiring everyone to be online or to watch together.
- Each player has an independent `seenThroughTurn`. On return, a player first
  sees “Turn N ready,” watches or explicitly skips that resolved movie, then may
  plan turn N+1. The server rejects turn N+1 orders from that player until the
  result acknowledgement is recorded; other caught-up players may plan and
  submit without waiting for synchronized playback.
- The home screen lists rooms known by locally stored rejoin tokens and shows
  `your turn`, `waiting for N players`, `turn ready to watch`, or `finished`.
  Browser/push notifications are optional later work; v1 must work by returning
  to the room URL and checking status.
- Rooms and canonical turn/replay data survive ordinary service restarts. A
  player may resign and the room may be ended as abandoned; v1 never invents AI
  orders for an absent player.

### Game lengths

| Length | Robots/team | Arena dimensions | Default roster |
|---|---:|---|---|
| Skirmish | 2 | 16×16 source map available; not selectable in main game | post-main preset |
| Melee | 4 | 24×24 (Rubble Two) ✅ | 1 Rifle / 1 Burst / 1 Auto / 1 Missile ✅ |
| Battle | 6 | 32×32 (Rubble Three) ✅ | 2 Rifle / 2 Burst / 1 Auto / 1 Missile ✅ |
| Campaign | 8 | 40×40 source map available; not selectable in main game | 3 Rifle / 2 Burst / 2 Auto / 1 Missile ✅ |

### Formations

5 formations: Beginner / Standard / Fire Fight / Missile Fest / Beat the Clock. ✅
v1 ships **Beginner** only; others deferred (they affect roster composition and turn-time bounds).

### Sport modes

5 modes from the original: Survival / Treasure Hunt / Capture the Flag / Hostage / Baseball. ✅
**v1 ships Survival only.**

### Arena types

3 types: Rubble Town / Suburbs / Computer Town. ✅
v1 ships **Rubble Town only** (Two and Three sizes; Suburbs and Computer Town can come later).

### Turn budget

- Beginner default: **15.0 seconds = 900 ticks**. ✅
- Other formations: configurable 1-40 seconds (Turn Length dialog in original). ✅
- The planner permits commands extending past the budget; commands beyond 15.0 s are greyed out and not executed. ✅

---

## 3. Robot classes

Four combat classes participate in the main-game Survival roster. Point-buy by
**rating** and Stealth are reserved for post-main-game Custom Game/parity work.

| Class | Primary weapon | Accuracy tier¹ | Armor (HP) | Rating | Special |
|---|---|---|---:|---:|---|
| Rifle | Rifle | High | 140 | 40 | — |
| Burst | Burst Gun | Medium | 120 | 50 | — |
| Auto | Auto Rifle² | Low | 100 | 60 | — |
| Missile | Missile Launcher (+ Rifle secondary³) | Medium | 100 | 80 | 3 missiles starting ammo |

All ✅ from B&W Mac team-builder dialog.

¹ Accuracy is the exact binary tier `Rifle=2`, `Burst/Missile=1`,
`Auto=0`; it feeds the live-fire score (§6).
² Auto Rifle's in-game label is "Machine Gun"; manual calls it "Automatic Rifle". Engine uses `auto-rifle` as the canonical id.
³ Missile robots also carry rifles per Amiga manual. Other formation grants are
post-main-game content and do not alter the Beginner roster.

The original Stealth class (`Burst Gun`, accuracy 1, armor 120, rating 100) is
historical parity data only. It is not a legal main-game roster choice and its
visibility mechanic is deferred until the explicit post-main-game Stealth
phase. ✅ stats / deferred behavior

### Postures

**v1 ships all 3 postures.** The binary stores them as `1/2/3`; Ducking is the
mobile middle point in the cover system.

| Posture | Movement | Exposed / Bush / Low-wall cover class |
|---|---|---|
| Upright (default) | passable terrain | 4 / 4 / 3 ✅ |
| Ducking | same traversal as Upright | 4 / 3 / 2 ✅ |
| Crouching | Open Ground only | 3 / 2 / 1 ✅ |

Posture commands set an absolute posture. Any actual change costs **10 ticks
(1/6 s)**; selecting the current posture is a no-op. ✅

---

## 4. Weapons

| Weapon | Bullets/click | Engine firing interval | Max range | Ammo |
|---|---:|---|---:|---|
| Rifle | 1 | 30 ticks (0.50 s) ✅ | 18 ✅ | unlimited |
| Burst Gun | **3** ✅ | 15 ticks (0.25 s) ✅ | 18 ✅ | unlimited |
| Auto Rifle | 1 | 10 ticks (0.17 s) ✅ | 18 ✅ | unlimited |
| Missile Launcher | 1 (explosive) | 30 ticks (0.50 s) ✅ | 18 ✅ | 3 |
| Grenade Launcher | 1 (explosive) | 30 ticks (0.50 s) ✅ | 18 ✅ | custom grant 0–9; not granted in main game |

Scan & Fire repeat intervals are Rifle/Burst/Auto/Missile/Grenade =
`30/20/10/20/20` ticks. Named selectors and both timing columns are confirmed;
range uses **floored Euclidean distance** and is uniform at 18. ✅

### Bullet weapon damage

Each direct-fire hit rolls `base + (random & mask)`, then applies cover and
distance adjustments. The roll families and labels are exact.

| Weapon | Base roll per bullet |
|---|---|
| Rifle | `10 + (random & 7)` → 10–17 ✅ |
| Burst Gun | `8 + (random & 15)` → 8–23, three independent bullets ✅ |
| Auto Rifle | `6 + (random & 15)` → 6–21 ✅ |

Damage adjustment: cover class 1/2/3/4 adds `-4/0/0/+4`; distance `<5` adds
4 and distance `>12` subtracts 4. Clamp final damage to at least 0. ✅

### Explosive weapon damage (Missile)

Blast at impact tile; falloff by floored Euclidean radius:

| Radius | Damage |
|---|---|
| 0 (direct hit) | 60-91 ✅ |
| 1 | 40-55 ✅ |
| 2 | 10-17 ✅ |
| 3+ | 0 ✅ |

**Blast radius = 2.** Friendly-fire rule: explosives damage all robots in radius regardless of team. ✅

Grenade category: radius 0/1/2 = `45-76 / 25-40 / 5-12`. Projectile type 1 is
created by the named Grenade handlers and dispatches to blast category 0. ✅

Cover class 1/2/3/4 reduces blast damage to `1/2`, `3/4`, `7/8`, or full using
integer shifts/truncation. ✅

---

## 5. Movement

### Step costs

Movement uses fixed selector costs; there is no stride parity:

| Move size | Cost |
|---|---:|
| Single tile (8 directions) | 30 ticks / 0.50 s ✅ |
| Double tile (16 offsets) | 40 ticks / 0.67 s ✅ |

The pathfinder chunks long paths into the original one- and two-tile commands
to minimize total time. There is no triple-tile move selector. ✅

Slow terrain is represented by which one-/two-tile commands the planner may
emit; the resolver has no alternating stride state. ✅

The exact slow rule is command chunking, not a multiplier:

- TIL movement property `2` is full-speed Open Ground; `1` is slow/conditional
  Rough, Bush, or Low Wall; `0` is blocked.
- The original path compressor begins with a contiguous unit-step route. It may
  replace two consecutive steps with one 40-tick two-tile selector only when
  the entered intermediate and destination tiles are full-speed.
- An encoded two-tile movement step retains both its selected intermediate
  waypoint (`via`) and destination (`to`). Resolver validation uses that exact
  route rather than reconstructing a potentially different intermediate tile.
- Entering a slow tile therefore remains a 30-tick one-tile selector. A run of
  two slow tiles costs 60 ticks; two eligible open tiles cost 40 ticks.
- Mixed and diagonal routes use the same rule on their selected unit-step
  waypoints. There is no terrain multiplier and no parity to reset. ✅

### Terrain & traversal

Upright and Ducking share traversal and speed classification rules.

| Terrain | Upright/Ducking | Crouching |
|---|---|---|
| Open Ground | yes | yes |
| Rough Ground | yes | **no** |
| Low Walls | yes | **no** to enter; may crouch in place |
| Walls | **no** | **no** |
| Bushes | yes | **no** |
| Crevices | **no** | **no** |
| Outer Walls | **no** except Dock transitions | **no** |

### Deployment

First action of each robot: deploy from Dock into Home Area. Cost:
**2.0 s = 120 ticks** ✅ (selector 74).
First move out of the Dock must enter the Home Area. ✅

---

## 6. Combat resolution

Hit chance is an integer score indexing the exact 20-word live-fire threshold
table. Damage is a separate wide roll plus cover/distance adjustments.

### Scan cone

Each robot has one of 8 scan headings. The hard firing gate is the **closed
forward ±90° semicircle**: exact perpendicular boundary rays are accepted and
the first tile behind either boundary is rejected. Implement as integer
`dot(headingVector, target-shooter) >= 0`. ✅

Scan headings are absolute commands; any changed heading costs **5 ticks
(1/12 s)** regardless of angular distance. ✅

### Per-shot resolution pipeline

```
1. Range gate: `floorEuclidean(shooter, aimedTile) <= 18`.
2. Angle gate: aimed tile must be inside the scan cone.
3. LoS/cover: centerline LoS rejects walls. Target cover samples the target,
   one neighbor toward the shooter on the major axis (distance ≥2), and a
   corner neighbor only when `abs(dx-dy)<2`; ties are y-major. This yields
   cover class 1..4.
4. Score starts from cover class `1/2/3/4 -> 4/8/12/18`.
5. Add the exact accuracy/distance ladder and target-terrain modifier
   (`rough +2`, `bush -1`, `low-wall -3`, otherwise weapon-property add).
6. Aim & Fire passes scan-sight strength 16, so no scan penalty applies.
   Scan & Fire subtracts 4 at sight strength `<=4`, 2 at `<=8`, otherwise 0.
7. Clamp score to 0..19. If the shooter is damage-staggered, halve it. If the
   target left the aimed tile, halve it again.
8. Hit when `(rng & 255) < LIVE_FIRE_HIT_THRESHOLDS[score]`.
9. On hit, roll direct damage and apply cover/distance adjustments above.
```

Every successful damage application assigns the target a `1..4` firing-action
stagger count (`(game RNG & 3) + 1`). Each later firing action consumes one
count and halves every bullet's hit score for that action. This is original
robot field `+0x1E`; it is not an ammunition counter. Shooter posture has no
independent score or damage modifier beyond endpoint/LoS legality. ✅

### Two firing modes

- **Aim & Fire** (tile-targeted): hit and damage lock when the fire command
  resolves. If the target has already left the aimed tile, the score is halved.
  Later projectile flight does not reroll or enable in-flight dodging. ✅
- **Scan & Fire** (enemy-targeted, reacquires): remains active for
  `seconds × 60`, filters eligible enemies by the player-set maximum distance,
  chooses the nearest adjusted-distance candidate, fires, then reacquires at
  the weapon's Scan repeat interval. Equal adjusted distances prefer the higher
  scan-sight strength, then retain canonical Home-slot/roster order. ✅

The acquisition adjustment is exact: a candidate on the inclusive cone boundary
adds 2 to its floored-Euclidean distance; other candidates use raw distance.
Equal adjusted distances prefer higher scan-sight strength, then retain
Home-slot/roster candidate order. The same exact 0..16 sight strength feeds the
live-fire penalty bands: it starts at 16, each endpoint-inclusive Low Wall or
Bush sample subtracts 3, and a Wall reduces it to 0. Aim & Fire passes 16. ✅

#### Stationary scanner versus a moving target

Scan & Fire is sampled at deterministic firing opportunities, not continuously
at every sub-tile instant. At each opportunity, movement due at that same tick
has already completed; the scanner filters enemies at their resulting tile,
applies cone/range/LoS/current-terrain cover, and chooses the nearest eligible
candidate. A target that crosses the cone entirely between opportunities is
not acquired. A target acquired at an opportunity is aimed at on its current
tile and the hit/damage rolls lock then; target speed has no separate numeric
modifier. Movement only changes which opportunities expose the target and the
distance, scan-sight strength, terrain, cover, and tile occupancy seen at that
boundary.

DOS shortcut: **Ctrl+Shift+click** on a target tile for repeat-fire (Amiga uses Alt). ✅

### No collision

Robots **pass through each other** and **can stack on the same tile**. ✅
Bullets pass through robots without hitting them — only the target tile takes damage. ✅
Friendly bodies do **not** block bullets and do not take damage from friendly bullets. ✅

---

## 7. Visibility

Per-team visibility is semantically current every tick and is recomputed at each
boundary that can change position, posture, heading, or survival. A team sees:
- All robots on its Side (allies are always visible)
- Tiles within any of its own robots' scan cone × range with unobstructed LoS
- Enemy robots in those visible tiles (with caveats below)

Enemy sensor contacts are **not pooled across allied Teams**. The original
initializes each observing Team's visible-robot mask with all same-Side robots
(`seg95:0x0952`), then updates enemy-contact masks in the specific observing
Team slot (`seg96:0x0AAC`) without propagating them to other same-Side slots.
Accordingly, ordinary visible-enemy sets and last-known-X markers remain per
Team, even in a 2v2 or 3v1 alliance. ✅

Ordinary visibility and Scan & Fire share the exact scan-grid sight strength:
- Clear sight starts at 16; a target is visible while the result is greater than 0. ✅
- A Wall or Outer Wall sample immediately returns 0. ✅
- Every Low Wall or Bush sample subtracts 3, including shooter and target
  endpoints; one partial obstacle therefore reduces strength to 13 rather than
  blocking sight. Six partial samples exhaust the value. ✅
- Crevices, Rough Ground, and Open Ground do not reduce sight strength. ✅

This path is terrain-based. Posture does not independently alter ordinary
visibility; it remains part of endpoint cover and live-fire resolution. ✅

### Deferred Stealth rule

Stealth is deliberately outside the main-game visibility resolver. Its
historical move-or-adjacent visibility rule remains research input for the
post-main-game Stealth phase, not a Phase 4 requirement.

### Last-known-X markers

At end of each turn, for every team, record tiles where they last saw any enemy that's no longer visible. Renderer draws X glyphs on those tiles during the next Edit phase. ✅

---

## 8. Timeline & tick model

| Quantity | Value |
|---|---|
| Tick rate | **60 ticks/second** ✅ |
| Movie playback | **12 fps default**; choices 20/15/12/10/6/5/4/3 ✅ |
| Default turn duration | 15.0 s = 900 ticks ✅ |
| Configurable turn range | 1-40 s = 60-2400 ticks ✅ |

### The three clocks in v1

- **Program horizon**: the 900-tick tactical budget represented by commands.
- **Simulation time**: authoritative deterministic 60 Hz event ordering.
- **Presentation time**: local movie playback controlled independently by each
  player.

Presentation never changes simulation. Each client may pause, step, run at
0.5×/1×/2×/4×, or skip event-free spans. Playback is asynchronous per player:
acknowledging/skipping turn N unlocks that player's turn N+1 planner but does
not gate caught-up opponents. An “Original 12 fps” preset remains available.

Time is integer ticks throughout the engine. Conversions to/from seconds happen at UI boundaries only.

### Resolver boundary order

`resolveTurn({ state, orders, seed })` is a pure completion-driven simulation.
At each integer boundary it applies deploy/movement, then posture/scan changes,
then resolves Aim & Fire in canonical Home-slot/roster order, and finally
batches direct/blast damage and deaths. Robots may stack; same-boundary mutual kills are
allowed. Events carry stable, gap-free `{ tick, seq }` values. Malformed or
Phase-ineligible imported orders return a discriminated `MalformedOrders`
result without mutating inputs.

Direct-fire hit/damage and explosive blast center/damage are locked when the
command fires; later projectile motion cannot reroll the result or enable
in-flight dodging. RoboArena applies the state change at the fire boundary and
emits `projectile-launched` / `projectile-impacted` renderer cues;
exact on-screen travel duration is presentation tuning, not an unresolved
business-rule gate. Scan & Fire uses the same fire-boundary result authority.

Strict impact timing is a separate product decision from result locking. The
current MVP rule above is fire-boundary state mutation. A proposed fidelity
upgrade would store the already-rolled result as an immutable pending impact,
apply it at a deterministic impact tick, and drive the projectile animation
from the same event. Do not introduce impact-time rerolls, tracking, or renderer
authority under either model. Exact original projectile travel ticks remain
unverified, so adopting strict timing also requires either a focused trace or
explicit RoboArena travel constants.

---

## 9. Arena structure

```
┌──────────────────────────────────────────┐
│  Dock                                    │  ← robots wait pre-deploy;
│                                          │    return here when destroyed
├──────────────────────────────────────────┤
│  Playing Field                           │
│   ┌─────────┐              ┌─────────┐   │
│   │ Home NW │              │ Home NE │   │  ← 4 corners, assigned
│   └─────────┘              └─────────┘   │    clockwise by team list
│                                          │    position
│                                          │
│   ┌─────────┐              ┌─────────┐   │  First move out of Dock
│   │ Home SW │              │ Home SE │   │  must enter the team's
│   └─────────┘              └─────────┘   │  Home Area.
└──────────────────────────────────────────┘
```

The original MAP payload uses `body[y * width + x]` with no transpose or axis
flip; the runtime display adds an 8-tile screen border only. INF supplies arena
dimensions/names/flags, not home or dock coordinates. ✅

Home rectangles are derived independently per axis: size `<20 → 6`, `20..31 →
8`, `32..47 → 12`, `48+ → 16`. Team Name boxes map clockwise to NW, NE, SE,
SW; empty boxes do not compact that assignment. Dock is outside the playing
field and is represented as the robot's `"dock"` state; it needs no terrain
coordinate. ✅ original and clone engine model

### Survival completion and ceremony score

- A side wins when it is the last side with any surviving robot. Teams sharing
  a side are allies. ✅
- Each Team first contributes `existing Team score + 150 × surviving robots +
  400 if that Team has at least one survivor`. The executable then sums every
  allied Team contribution by Side and copies that same Side total into every
  allied Team's ceremony row. Extra 100-point objective terms in the same
  function are non-Survival-only. ✅
- Existing score is match score rather than a hidden Survival combat modifier.
  For main-game Survival it starts at zero; winner identity is determined by
  last Side standing, not by ceremony points.

---

## 10. Replay format

A complete match is reconstructible from:

```ts
ReplayLog = {
  formatVersion: 1,
  initialState: MatchState, // arena, teams, robots, config
  turns: {
    seed: string,             // authoritative seed for this turn
    orders: TurnOrders,
    events: ResolutionEvent[], // derived movie output, not authority
    eventDigest: string,
    nextStateDigest: string,
  }[],
}
```

`createReplayLog` records each resolved turn with the seed chosen for that turn.
`verifyReplay` re-runs the authoritative initial state and ordered
`{ seed, orders }` entries and requires byte-identical event streams plus
matching event and complete next-state digests. Divergence ticks are absolute
across the match rather than resetting at each turn. The JSON codec validates
the complete nested replay structure and explicitly preserves
`lastKnownMarkers` maps. Version 1 embeds the arena in `initialState` so exports
are self-contained; a later format may migrate to named/checksummed arena
references after the Phase 6 arena library exists.

Determinism is enforced by:
- Seedable RNG (mulberry32) for every probabilistic decision
- Integer arithmetic on game-state values
- No authoritative mid-flight projectile state; launch/impact cues and outcomes lock at fire time
- No `Math.random`, no `Date.now`, no `setTimeout` in `src/engine/`

For v1 online matches, the server owns the canonical replay inputs and event
digest. Clients may export the completed replay, but cannot submit
authoritative state, RNG seeds, another player's orders, or turn outcomes.

### Adopted v1 usability improvements

RoboArena keeps original-compatible combat rules while modernizing the parts
that most improve comprehension and online play:

- exact route arrival/completion ticks, slow-tile command compression, remaining
  program horizon, and out-of-budget commands are visible while planning;
- timeline blocks support undo/redo and direct editing;
- Scan & Fire opportunity ticks and conditional cone/range coverage are shown
  without revealing hidden enemy orders;
- hit previews use only currently authorized information and label uncertainty
  rather than presenting future outcomes as certain;
- the movie/replay event log explains misses, cover, off-aimed-tile penalties,
  damage stagger, scan checks, damage, and destruction;
- returning later restores room phase, locked status, authorized state, unseen
  resolved turns, and playback position without revealing opponents' plans;
- the home/room status UI makes asynchronous state explicit: waiting, result
  ready, your next plan due, resigned, or finished.

Balance-changing redesigns—continuous Scan & Fire checks, reaction-delay stats,
strict pending-impact gameplay, and altered hit/damage tables—are not v1
improvements. They require a later explicit RoboArena ruleset. Alliance-enabled
and hot-seat modes are also deferred, but use the already-audited original rules
rather than being treated as balance redesigns.

---

## 11. Source-of-truth pointers

| Concern | Where |
|---|---|
| Locked numerical constants | `src/engine/constants.ts` |
| Weapon damage tables | `src/engine/catalog.ts` (`WEAPONS`) |
| Robot class stats | `src/engine/catalog.ts` (`ROBOT_DEFINITIONS`) |
| Combat resolution implementation | `src/engine/firing.ts`, `src/engine/blast.ts` |
| Movement implementation | `src/engine/movement.ts` |
| Turn scheduling and resolution | `src/engine/commandInterpreter.ts`, `src/engine/resolver.ts` |
| Empirical research log | `docs/priority-tests.md` |
| Implementation roadmap | `docs/implementation-plan.md` |
| Original-game research | `docs/priority-tests.md`; local ignored source captures |

If the spec and code diverge, **the code is correct** and this doc gets updated.
