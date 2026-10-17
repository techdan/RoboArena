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

**v1 scope (Phases 1-12)**: 2-4 humans on separate devices join an online
room; one player controls one Team; every Team has a unique Side, so matches are
1v1, 1v1v1, or 1v1v1v1. v1 supports desktop mouse + keyboard and browser-based
iPad touch in landscape. The server is
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
  The catalog may reserve its original stats, and forward-compatible Stealth
  artwork may exist in the generic asset registry and renderer, but main-game
  setup, resolver, visibility, planner, and acceptance tests must not expose or
  depend on Stealth gameplay.
- Full Custom Game team builder and point-buy roster editing. v1 can start with Quick Start / preset rosters.
- Full original weapon-system parity. v1 uses the core weapon set currently represented in `catalog.ts`; do not add extra original weapon systems without a new phase.
- Production-scale database operations, accounts, observability, deployment
  automation, and full help/tutorial systems. Durable v1 room persistence is
  required; production uses managed Postgres without adding account features.

### Closed audit boundary and deferred content

The 2026-10-01 audit reopened two human live-fire interpretations: the alleged
target-terrain adjustment is an AI branch, and the human accuracy-add table is
indexed by Aim/selected Scan distance rather than weapon selector. Both were
corrected in the engine by the 2026-10-15 binary audit (PR #9); see
[`audit-2026-10-01.md`](./audit-2026-10-01.md), A01–A02.
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
- Active players have a non-resigned Team with at least one surviving robot.
  Eliminated players may watch and acknowledge their movies independently but
  never gate later turns. Required participation is public readiness metadata;
  it must be computed from authoritative state, not projected enemy contacts.
- Order validation uses only the submitting participant's robots and public
  map, checks the whole program, and reserves conditional finite ammunition.
  It never simulates hidden opponents to decide whether submission is valid.
  Legacy invalid pending orders reopen planning durably with private drafts
  preserved, locks cleared, and an explicit review notice. Replay corruption
  remains an error and must not be silently accepted.
- Observing a shooter does not authorize its hidden target. Acquisition events
  require both contacts; enemy shot/projectile coordinates require independent
  visibility of their destination. Own fire retains the participant's known
  target coordinates. Participant event sequences are contiguous so gaps do
  not reveal the number of hidden events.
- Successful saves acknowledge the submitted draft without reporting an
  external conflict. Newer edits made while a save is in flight remain dirty
  and retain their undo history. Read-only polling is not durably cached in the
  mutation-idempotency table.
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
- Rooms and canonical turn/replay data survive ordinary service restarts and
  are never automatically deleted; a player may return hours, days, or weeks
  later and find the room exactly as they left it. A player may explicitly
  resign a match; v1 never invents AI orders for an absent player and never
  silently auto-forfeits a stalled one.

### Game lengths

| Length   | Robots/team | Arena dimensions                                        | Default roster                            |
| -------- | ----------: | ------------------------------------------------------- | ----------------------------------------- |
| Skirmish |           2 | 16×16 source map available; not selectable in main game | post-main preset                          |
| Melee    |           4 | 24×24 (Rubble Two) ✅                                   | 1 Rifle / 1 Burst / 1 Auto / 1 Missile ✅ |
| Battle   |           6 | 32×32 (Rubble Three) ✅                                 | Beginner 2/2/1/1, Standard 2/1/2/1 ✅     |
| Campaign |           8 | 40×40 source map available; not selectable in main game | Beginner 3/2/2/1, Standard 2/2/2/2 ✅     |

Rosters are Rifle / Burst / Auto / Missile counts from the formation × length
table at DGROUP `0x162A` (`src/engine/formations.ts`).

### Formations

5 formations: Beginner / Standard / Fire Fight / Missile Fest / Beat the Clock. ✅
The lobby offers **Beginner** and **Standard** (default); the rest are deferred.
Matches created with rules revision 3 apply the formation's original setup
(`seg61:0x02A7..0x03A3`, re-map `setup.md` §1.3):

| Formation | Grenades/robot | Missiles | Zap | Time Bomb       | Enemy positions |
| --------- | -------------: | -------: | --- | --------------- | --------------- |
| Beginner  |              0 |        3 | off | off             | shown (no fog)  |
| Standard  |              3 |        3 | on  | one per Team ✅ | hidden          |

Every class carries the grenade launcher (weapon mask bit `0x10`), so Standard
grenades go to every robot. The Time Bomb goes to each Team's first robot
(`seg21:0x01E5`). Show Enemy Damage is on in both.

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
- Planner and authoritative server validation decrement finite ammo for fixed Aim & Fire shots. Repeat
  Aim & Fire and Scan & Fire conservatively reserve all remaining finite ammo,
  so hidden runtime acquisition cannot make a later finite-weapon command
  resolver-invalid.

---

## 3. Robot classes

Four combat classes participate in the main-game Survival roster. Point-buy by
**rating** and Stealth are reserved for post-main-game Custom Game/parity work.

| Class   | Primary weapon                        | Accuracy tier¹ | Armor (HP) | Rating | Special                  |
| ------- | ------------------------------------- | -------------- | ---------: | -----: | ------------------------ |
| Rifle   | Rifle                                 | High           |        140 |     40 | —                        |
| Burst   | Burst Gun                             | Medium         |        120 |     50 | —                        |
| Auto    | Auto Rifle²                           | Low            |        100 |     60 | —                        |
| Missile | Missile Launcher (+ Rifle secondary³) | Medium         |        100 |     80 | 3 missiles starting ammo |

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

| Posture           | Movement                  | Exposed / Bush / Low-wall cover class |
| ----------------- | ------------------------- | ------------------------------------- |
| Upright (default) | passable terrain          | 4 / 4 / 3 ✅                          |
| Ducking           | same traversal as Upright | 4 / 3 / 2 ✅                          |
| Crouching         | Open Ground only          | 3 / 2 / 1 ✅                          |

Posture commands set an absolute posture. Each level costs **10 ticks
(1/6 s)**, and Upright↔Crouching passes through Ducking (2 × 10 ticks,
`seg80:0x0352`); selecting the current posture is a no-op. ✅ Matches created
before rules revision 2 keep the legacy flat 10-tick cost.

---

## 4. Weapons

| Weapon           | Bullets/click | Engine firing interval | Max range | Ammo                                       |
| ---------------- | ------------: | ---------------------- | --------: | ------------------------------------------ |
| Rifle            |             1 | 30 ticks (0.50 s) ✅   |     18 ✅ | unlimited                                  |
| Burst Gun        |      **1** ✅ | 15 ticks (0.25 s) ✅   |     18 ✅ | unlimited                                  |
| Auto Rifle       |             1 | 10 ticks (0.17 s) ✅   |     18 ✅ | unlimited                                  |
| Missile Launcher | 1 (explosive) | 30 ticks (0.50 s) ✅   |     18 ✅ | 3                                          |
| Grenade Launcher | 1 (explosive) | 30 ticks (0.50 s) ✅   |     18 ✅ | formation: Beginner 0, Standard 3          |

Scan & Fire re-fire delays are Rifle/Burst/Auto/Missile/Grenade =
`30/15/10/70/80` ticks: the weapon's Aim duration, plus 40 for missiles and 50
for grenades (`seg6:0x3D79/0x3FA4/0x3F43`, corrected 2026-10-15). Aim & Fire
shoots on the command's first tick, then the interval elapses. A Missile Scan &
Fire holds fire while its acquired target is closer than 2 tiles. Every firing
action, Burst included, is one hit roll and one damage roll. Range uses
**floored Euclidean distance** and is uniform at 18. ✅

Finite ammunition is match-persistent in RoboArena v1. A Missile robot starts
the match with 3 missiles; every launch decrements that stored value and it does
not regenerate at a turn boundary. The starting count is observed, while the
no-regeneration policy is PROPOSED and enforced by the durable `MatchState`.

### Bullet weapon damage

Each direct-fire hit rolls `base + (random & mask)`, then applies cover and
distance adjustments. The roll families and labels are exact.

| Weapon     | Base roll per bullet                              |
| ---------- | ------------------------------------------------- |
| Rifle      | `10 + (random & 7)` → 10–17 ✅                    |
| Burst Gun  | `8 + (random & 15)` → 8–23, one roll per burst ✅ |
| Auto Rifle | `6 + (random & 15)` → 6–21 ✅                     |

Damage adjustment: cover class 1/2/3/4 adds `-4/0/0/+4`; distance `<5` adds
4 and distance `>12` subtracts 4. Clamp final damage to at least 0. ✅

### Explosive weapon damage (Missile)

Blast at impact tile; falloff by floored Euclidean radius:

| Radius         | Damage   |
| -------------- | -------- |
| 0 (direct hit) | 60-91 ✅ |
| 1              | 40-55 ✅ |
| 2              | 10-17 ✅ |
| 3+             | 0 ✅     |

**Blast radius = 2.** Friendly-fire rule: explosives damage all robots in radius regardless of team. ✅

Grenade category: radius 0/1/2 = `45-76 / 25-40 / 5-12`. Projectile type 1 is
created by the named Grenade handlers and dispatches to blast category 0. ✅

Cover class 1/2/3/4 reduces blast damage to `1/2`, `3/4`, `7/8`, or full using
integer shifts/truncation. ✅

### Zap (Standard)

Zap (selector 3, `seg6:0x2BD9`) runs for 1–40 s. On each 5-tick simulation step
while it runs, once at least 60 ticks have passed since its last zap, it zaps if
a live enemy-Side robot stands on the zapper's own tile. The zap lands 5 ticks
later and every live enemy-Side robot on that tile takes `60 + (random & 63)` =
60–123, with no cover, posture or distance terms (`seg6:0x602B`). Zapping
reveals the zapper like firing; between zaps the command refreshes spotting
activity every `30 + 5·(random & 15)` ticks (`seg6:0x4091`). ✅

### Time Bomb (Standard)

Place Bomb (selector 23, `seg6:0x2B08`) takes 60 ticks and arms the carried
bomb on the robot's tile with a 0–40 s fuse. It goes off `fuse × 60 + 60` ticks
after the command starts (`seg28:0x0D13`), through the shared blast loop with
category 2, hitting every Side (`seg6:0x542E`, `seg6:0x5D73`):

| Radius | 0       | 1      | 2     | 3     | 4     |
| ------ | ------- | ------ | ----- | ----- | ----- |
| Damage | 120–151 | 80–111 | 40–71 | 20–35 | 10–17 |

A bomb still armed at turn end carries over with its time reduced by the turn
length, never below 5 (`seg28:0x0C1A`). Only the placing Team sees an armed
bomb; everyone who can see the tile sees it explode. ✅

### Self Destruct

Self Destruct (selector 78) is offered only to a Team's last robot still
standing (`seg21:0x076C`, `seg77:0x0208`) and not in the dock. It takes 20
ticks; 10 ticks after it starts, a blast lands on the robot's own tile with the
Time Bomb's category 2 table above, hitting every Side (`seg6:0x3541`,
`seg6:0x5675`). The robot itself is at radius 0. A Self Destruct started in the
last 10 ticks of a turn still lands, and the turn's movie runs on until it does
(`seg6:0x6330`). Rules revision 3. ✅

---

## 5. Movement

### Step costs

Movement uses fixed selector costs; there is no stride parity:

| Move size                  |                 Cost |
| -------------------------- | -------------------: |
| Single tile (8 directions) | 30 ticks / 0.50 s ✅ |
| Double tile (16 offsets)   | 40 ticks / 0.67 s ✅ |

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

| Terrain      | Upright/Ducking                | Crouching                            |
| ------------ | ------------------------------ | ------------------------------------ |
| Open Ground  | yes                            | yes                                  |
| Rough Ground | yes                            | **no**                               |
| Low Walls    | yes                            | **no** to enter; may crouch in place |
| Walls        | **no**                         | **no**                               |
| Bushes       | yes                            | **no**                               |
| Crevices     | **no**                         | **no**                               |
| Outer Walls  | **no** except Dock transitions | **no**                               |

### Deployment

First action of each robot: deploy from Dock into Home Area. Cost:
**2.0 s = 120 ticks** ✅ (selector 74).
First move out of the Dock must enter the Home Area. ✅

The robot lands on its tile when Deploy **starts**, then stays busy for the
rest of the 120 ticks. Deploy does not set the re-dispatch bit, so its handler
`seg6:0x2ECF` runs once at the record's start and places the robot through
`seg6:0x11B3(x,y)` with FX 8 (`docs/re-map/timing.md` §0). Rules revision 5
(`ORIGINAL_DEPLOY_RULES_REVISION`) adopts this; revisions 4 and earlier keep
the robot in the Dock until tick 120. New matches start on revision 5.

---

## 6. Combat resolution

Hit chance is an integer score indexing the exact 20-word live-fire threshold
table. Damage is a separate wide roll plus cover/distance adjustments.

### Scan cone

Each robot has one of 8 scan headings. The hard firing gate is the **closed
forward ±90° semicircle**: exact perpendicular boundary rays are accepted and
the first tile behind either boundary is rejected. Implement as integer
`dot(headingVector, target-shooter) >= 0`. ✅

Scan headings are absolute commands. The robot turns one octant at a time the
shortest way round (a half turn goes clockwise), and each octant costs **5 ticks
(1/12 s)**, so N→S costs 20 ticks (`seg80:0x0422`, `seg30:0x13A2`). ✅ Matches
created before rules revision 2 keep the legacy flat 5-tick cost so their
replays still verify.

### Per-shot resolution pipeline

```
1. Angle gate: target tile must be inside the scan cone.
2. Sight gate: the original sub-tile sight walk rejects a Wall, or Bush/Low
   Wall samples that cut sight strength to 0.
3. Range gate: `floorEuclidean(shooter, targetTile) <= 18`.
   Cover: target cover samples the target,
   one neighbor toward the shooter on the major axis (distance ≥2), and a
   corner neighbor only when `abs(dx-dy)<2`; ties are y-major. This yields
   cover class 1..4.
4. Score starts from cover class `1/2/3/4 -> 4/8/12/18`.
5. Add the exact accuracy/distance ladder and the fire-control add from
   `0x1596` = `4,7,6,5,4,3,2,1,0,0,-1,-1,-2,-2,-3,-3,-4,-5,-6`, indexed by 0
   for Aim & Fire (+4) and by the Maximum Distance for Scan & Fire. Weapon and
   target terrain do not change the score.
6. Aim & Fire passes scan-sight strength 16, so no scan penalty applies.
   Scan & Fire subtracts 4 at sight strength `<=4`, 2 at `<=8`, otherwise 0.
7. Clamp score to 0..19. If the target is outside the closed ±45° front arc
   of the shooter's heading, halve it.
8. Hit when `(rng & 255) < LIVE_FIRE_HIT_THRESHOLDS[score]`.
9. On hit, roll direct damage and apply cover/distance adjustments above.
```

Every successful damage application assigns the target a `1..4` stagger count
(`(game RNG & 3) + 1`) on its program object (`+0x1E`). The original clears it
at every command dispatch (`seg6:0x4CDA`) before a fire handler reads it, so it
never halves a shot; RoboArena keeps the RNG draw and the counter but does not
apply the halving (corrected 2026-10-15; DOSBox confirmation recommended).
Shooter posture has no independent score or damage modifier beyond
endpoint/LoS legality. ✅

### Two firing modes

- **Aim & Fire** (tile-targeted): fires on the command's first tick at the
  enemy on the aimed tile then; with none there the shot is wasted. Hit and
  damage lock at that moment. Later projectile flight does not reroll or enable
  in-flight dodging. ✅
- **Scan & Fire** (enemy-targeted, reacquires): remains active for
  `seconds × 60`, filters eligible enemies by the player-set maximum distance,
  chooses the nearest adjusted-distance candidate, fires, then reacquires at
  the weapon's Scan repeat interval. Equal adjusted distances prefer the higher
  scan-sight strength, then retain canonical Home-slot/roster order. ✅

The acquisition adjustment is exact: a candidate outside the closed ±45° front
arc (or on the scanner's own tile) adds 2 to its floored-Euclidean distance;
candidates inside the front arc use raw distance.
Equal adjusted distances prefer higher scan-sight strength, then retain
Home-slot/roster candidate order. The same exact 0..16 sight strength feeds the
live-fire penalty bands: it starts at 16, each Low Wall or Bush sample on the
original sight walk subtracts 3, and a Wall reduces it to 0. Aim & Fire passes 16. ✅

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

### Planner targeting analysis

RoboArena exposes the combat model during planning so players can reason about
good positions without learning an unexplained engine score. For direct-fire
weapons, the board-wide targeting layer is a **final estimated hit-chance
heatmap**, not only a legal-range overlay. Each legal tile's percentage uses the
same inputs and operation order as the live resolver:

- the selected robot's accuracy tier and current damage-stagger state;
- Aim versus Scan weapon accuracy mapping;
- floored-Euclidean distance;
- endpoint cover resolved for the previewed target posture;
- target terrain and the weapon-property adjustment where applicable;
- Scan sight strength and its `0/-2/-4` score adjustment for Scan & Fire; and
- the exact 20-entry threshold table after clamping and any score halving.

The heatmap uses final probability bands: **Excellent 75-94%**, **Good
50-74%**, **Risky 25-49%**, and **Poor 1-24%**. Band, blocked-state, and
legend colors come from one shared palette module consumed by both the board
renderer and the bottom-of-map legend; the bands are strictly
luminance-ordered so their ranking survives grayscale and common color-vision deficiencies. A
zero-probability tile is not merged with an illegal tile. Outside-range,
outside-angle, and wall-blocked states use distinct non-color-only treatments
(heavy dim, tight hatch, and sparse reverse-diagonal hatch respectively).
Unrelated Home-area outlines are hidden while a firing tool is active. Exact
tile percentages remain in the cursor tooltip and Aim review card rather than
being printed on every tile, keeping the damage and range rings legible.

The board also draws shooter-centered structural guides. The confirmed firing
half-plane appears as two boundary rays plus an arc on the allowed side; the
arc doubles as the maximum-distance limit. Inner arcs mark the real
damage-ladder breakpoints — distance `<5` adds 4 damage and distance `>12`
subtracts 4 — with short labels, suppressed when they fall at or beyond the
selected maximum distance. Every guide radius is drawn at `(r + 1)` tile units
from the shooter center, the exact floored-Euclidean threshold, so the guides
always agree with the per-tile fills. Explosive tools draw only the range
limit. A hover tooltip beside the cursor shows the tile's percentage, distance,
adjusted on-hit damage range, assumed or observed target posture, local
target/adjacent cover source, target-terrain and range score contributions,
Scan sight strength and penalty where applicable, and score clamping when the
raw subtotal exceeds the lookup-table bounds. Aim tooltips explicitly state
that only cover on the target tile or its sampled adjacent tiles applies.

Cover depends on target posture. An empty tile therefore has no single
posture-independent chance. The planner defaults hypothetical tiles to an
explicit **Upright target** assumption and offers Upright/Ducking/Crouching
preview controls. It must never average the three postures into a synthetic
percentage. A currently authorized visible contact uses its observed posture
and is labeled as an observed-current-state estimate. Future movement, future
posture, hidden orders, and the server RNG remain unknown.

Firing controls live in the center of the stable board heading; activating Aim
or Scan never creates a side rail or changes arena width. The single equipped
weapon is read-only context. Scan exposes distance and duration while Aim
exposes target and finite **Fire time** in seconds. Fire time advances in the
weapon's exact Aim interval; the strip also shows the derived shot count, capped
by remaining turn budget and finite ammunition. Burst counts distinguish firing
actions from their total bullets; explosives are counted as missiles or grenades.
The planner materializes those
shots as consecutive ordinary Aim & Fire selectors, so later commands can
follow them. Ctrl+Shift starts the control at 2 firing intervals. The
reverse-engineering record confirms the repeat-fire shortcut and selector
intervals but does not prove that repeat must
consume the remainder of the turn; this bounded planner behavior is PROPOSED.
Legacy `repeat: true` commands remain replay-compatible. Hypothetical-target
posture is grouped with the larger chance/status legend overlay at the bottom
center of the arena because both control or explain the preview. Right-click
keeps the terrain/robot help contract.

Damage-breakpoint and maximum-range labels sit just inside whichever cone
boundary ray has the longest visible run to the arena edge. Each label keeps
its ring radius along that edge and clamps by its rendered bounds, avoiding
centerline overlap and map-edge clipping.

The posture/legend panel is separate interaction chrome above the arena. Its
entire bounds block board hover, click, drag, and touch behavior; entering it
clears any board tooltip, and board hover resumes only after leaving the panel.

Hover or keyboard focus presents exact tile information in the cursor tooltip.
Near the bottom edge, the tooltip opens upward to keep longer explanations visible.
In Scan mode, a desktop left-click has no effect and never programs movement; a
touch tap positions and leaves the same tooltip visible as the iPad replacement
for hover. Aim left-click selects or retargets the fixed tile. **Review Shot**
opens a temporary confirmation card with coordinate,
distance, fire time, derived shot count, and the 3 posture estimates for a
hypothetical target, or only the observed posture for an authorized contact.
Explosive reviews show the catalog's blast radius and base damage bands, with an
explicit reminder that blasts can damage allies and consume finite ammunition.
The internal reconciled
`0..19` lookup-table calculation remains verified by tests but is not persistent
planner chrome.

Aim & Fire labels the heatmap as the chance against a robot on that fixed tile
when the command starts and explains the outside-front-arc halving.
Scan & Fire labels it as the chance **if an eligible enemy is acquired on that
tile at an opportunity**; it uses the selected maximum distance, the Scan
accuracy mapping, and terrain-derived sight strength. Scan timing copy says
that acquisition checks immediately and then at the weapon's
`scanFiringIntervalTicks` for the chosen duration. The outside-front-arc `+2`
adjusted-distance acquisition rule is explained in the cursor
tooltip on hover/focus; the drawn wedge replaces both
per-tile boundary boxes and any footprint perimeter outline.

Heat color always represents hit chance, not damage. The cursor tooltip and Aim
review show adjusted on-hit bullet damage where applicable. Aim and Scan do not
change on-hit damage for the same weapon, distance, and resolved cover.
Explosive weapons do not use the direct-fire hit table, so
their board layer shows legal impact/acquisition coverage, blast radius, and
authorized radius-by-radius damage ranges instead of a fictitious hit-chance
heatmap.

DOS shortcut: **Ctrl+Shift+click** on a target tile for repeat-fire (Amiga uses Alt). ✅

### No collision

Robots **pass through each other** and **can stack on the same tile**. ✅
Bullets pass through robots without hitting them — only the target tile takes damage. ✅
Friendly bodies do **not** block bullets and do not take damage from friendly bullets. ✅

---

## 7. Visibility

A team sees:

- All robots on its Side (allies are always visible)
- Tiles within any of its own robots' scan cone × range with unobstructed LoS
- Enemy robots it has **spotted** (rules revision 2, below)

### Spotting roll (rules revisions 2 and 3) ✅

Rules revision 2 introduced the original's spotting (`src/engine/spotting.ts`;
re-map `stealth-fence-ceremony-ai-formats.md` §1). New matches use revision 3,
which runs the pass once per 5-tick simulation step, as the original movie loop
does (`seg6:0x4832`, `now += 5` at `seg6:0x483E`); revision 2 ran it every tick
and is kept only so its replays verify. On each pass, for each pair of
Teams on different Sides where either Team moved or acted (`seg6:0x5898`,
`seg96:0x03E0`), every pair of live robots with sight strength > 0 and cover on
both ends (`seg96:0x060D`) is checked in both directions. A target inside the
observer's scan cone is seen outright if it fired this tick; otherwise a roll
decides (`seg96:0x09AF`):

- index = cover base {1:2, 2:4, 3:6, 4:10} − (4 − sight≫2), +4 if it moved
  this tick or else +2 if it ran any other command, − (distance≫2 − 2),
  clamped to 0..13;
- seen when `rng & 0xFF` < `[0,8,16,24,32,40,48,56,64,96,128,160,208,255][index]`
  (DGROUP `0x213A`).

An enemy already seen stays seen while it remains inside any cone of the
observing Team with sight and cover; an enemy outside every such cone is
dropped (`seg96:0x0AAC`). When neither robot of a pair moved or acted, only
that retention applies. At turn start every robot counts as moved
(`seg96:0x0267`). The spotted set carries across turns in
`MatchState.spottedEnemies` (authority-only; never sent to clients). Rolls use
the authoritative turn RNG. Matches without the revision keep the legacy rule:
every enemy in a visible tile is seen.

The Beginner formation turns Show Enemy Positions on, which removes fog
entirely: every Team sees every live enemy on the arena (options `+0x1A` bit
`0x01`). Standard keeps fog.

Enemy sensor contacts are **not pooled across allied Teams**. The original
initializes each observing Team's visible-robot mask with all same-Side robots
(`seg95:0x0952`), then updates enemy-contact masks in the specific observing
Team slot (`seg96:0x0AAC`) without propagating them to other same-Side slots.
Accordingly, ordinary visible-enemy sets and last-known-X markers remain per
Team, even in a 2v2 or 3v1 alliance. ✅

Ordinary visibility and Scan & Fire share the exact scan-grid sight strength:

- Clear sight starts at 16; a target is visible while the result is greater than 0. ✅
- A Wall or Outer Wall sample immediately returns 0. ✅
- Samples come from the original sight walk (`seg56:0x0360`): Bresenham on
  5× sub-tile centres, each newly entered tile once, shooter tile excluded,
  target tile included, and an intermediate tile equal to the scaled end point
  skipped (original bug). ✅
- Every Low Wall or Bush sample subtracts 3; one partial obstacle therefore
  reduces strength to 13 rather than blocking sight. Six partial samples
  exhaust the value. ✅
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

| Quantity                | Value                                              |
| ----------------------- | -------------------------------------------------- |
| Tick rate               | **60 ticks/second** ✅                             |
| Movie playback          | **12 fps default**; choices 20/15/12/10/6/5/4/3 ✅ |
| Default turn duration   | 15.0 s = 900 ticks ✅                              |
| Configurable turn range | 1-40 s = 60-2400 ticks ✅                          |

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
fire-boundary state mutation above remains the rule for matches on rules
revisions 3 and earlier. Rules revision 4 adopts the original timing below.
Neither model rerolls at impact or lets the renderer decide anything.

### Rules revision 4: original combat timing

Rules revision 4 (`ORIGINAL_TIMING_RULES_REVISION`) keeps revision 3 and
replays the original movie loop (`seg6:0x47DE..0x4853`). The findings, with
addresses and confidence tags, are in `docs/re-map/timing.md`. Revision 5
adds the deploy placement described under Deployment.

**The step loop.** Time advances in 5-tick steps from tick 0. Each step:

1. dispatches every robot in global (Home-slot, roster) order
   (`seg6:0x4892` → `seg6:0x4998`): a finished command applies its end state
   and the next one starts on the same step, then the active command's handler
   runs (fire, scan, zap, mid-move tile switch);
2. checks Time Bombs (`seg6:0x50D3`);
3. lands every projectile due by now (`seg6:0x556F`);
4. runs the spotting pass (`seg6:0x5898`).

A robot moving one tile occupies its destination 15 ticks into the step; a
two-tile step occupies the floored midpoint at 15 and the destination at 25
(`seg6:0x2D59`, `seg6:0x2E04`).

**The tail.** The movie keeps stepping after turn length, to turn length +
150 ticks, and an impact due within 150 ticks of that end pushes it out by
another 150 (`seg6:0x4790`, `seg6:0x6330`). In the tail:

- no command record starts, and nothing fires, scans or zaps
  (`seg6:0x4ABB..0x4AE2`, `seg6:0x1FDB`);
- projectiles in flight land, Time Bombs do not go off (`seg6:0x54B9`);
- a record that started before turn length finishes and applies its end
  state, so a move completes the step it is on, but the next record does not
  start (`seg6:0x4A60..0x4A8B`);
- the spotting pass runs on every step.

The rest of a robot's orders is dropped. The original appears to carry the
unexecuted records into the next turn (`seg14:0x00A2`, not traced); RoboArena
does not, because the next turn's orders are planned from scratch
(**inferred**, conservative). RoboArena also stops the tail early, on the
first step at or after turn length with no projectile in flight and no
command running except Scan & Fire or Zap: after that nothing can change. The
`turn-end` event is on the last step processed.

**Spotting flags.** Each step's spotting pass reads two flags per robot,
written during that step and cleared after the pass (`seg96:0x02C5`). The
activity code keeps the last value written (`seg96:0x0366`):

- **3** when a Scan & Fire shot or a zap goes off (`seg6:0x20B6`,
  `seg6:0x251E`, `seg6:0x29F3`, `seg6:0x2C93`). Aim & Fire writes no 3, so an
  Aim & Fire shot does not reveal the shooter outright.
- **2** from the periodic refresh (`seg6:0x4091`): before turn length, when
  the robot's refresh timer is due, the timer is redrawn `30 + 5·(r&15)`
  ticks ahead. Scan & Fire and Zap run it first thing on every step, and it is
  always due there because dispatch has just reset the timer, so they draw
  once and write 2 every step. A robot with no orders left runs it from the
  idle path: first on the step after its orders ran out (or at ticks 0 and 5
  with no orders), then every 30 to 105 ticks. Moves, Aim & Fire, posture,
  heading, deploy, bomb and Self Destruct never refresh.
- **1** when a record ends (`seg6:0x4F34`, `seg6:0x502B`): every record except
  Scan & Fire and Zap, so a move gives 1 at the end of each step and a turn
  or posture change at the end of each record, not while it runs.

The moved flag is set when a moving robot switches its occupied tile
(`seg6:0x2DEB`, `seg6:0x2EB6`) and when a move step or deploy ends
(`seg6:0x4FB4..0x500A`); at turn start every robot is moved and every Team
dirty (`seg96:0x0267`). A Team is dirty when any of its robots has a flag,
including a robot still in the dock, which refreshes like any robot with no
orders but is not on the map to spot or be spotted (**inferred**).
The refresh draw comes at the robot's place in dispatch order, before any
other draw its handler makes. With Show Enemy Positions the pass still runs
and draws its rolls before every enemy is marked seen again (**inferred**).

**Scan & Fire acquisition** (`seg18:0x072C`). Scan & Fire looks for a target
only on its 5-tick steps, during dispatch, before that step's spotting pass:

- a candidate must be an enemy its Team saw in the last spotting pass (every
  enemy with Show Enemy Positions); others are skipped (`seg96:0x1FC5`);
- its sight value is the spotting pass's cached pair value (`ctx+0x1B0`),
  recomputed in the pass only for pairs where either robot moved
  (`seg96:0x0900`), so a robot that switched tiles earlier in this step's
  dispatch is ranked and scored with the sight of its old tile;
- the cache is zeroed when the movie starts (`seg39:0x0354`), so nothing can
  be acquired on tick 0; the earliest Scan & Fire shot is on tick 5.

Range, cone, the +2 rank outside the inner arc and the sight tie-break are as
in §6. The cached sight also feeds the hit score's sight penalty.

**Projectiles.** Every shot is a queued projectile with an impact tick. The
queue is sorted by impact tick and a new projectile goes before others due on
the same tick, so equal impacts land newest first (`seg6:0x1AD3`). Because
step 1 runs before step 3, every robot acts on a step before that step's
impacts land.

- **Bullets** (Rifle, Burst Gun, Auto Rifle): hit and damage are rolled when
  the shot fires and land 5 ticks later (`seg6:0x3D2B`) on the robot it was
  fired at, wherever that robot is then. An Aim & Fire at a tile with no live
  enemy is a miss.
- **Grenades and missiles** are scattered, stopped on their path, and fly for
  a time that grows with distance; the blast is rolled when they land, against
  the robots near the landing tile then (`seg6:0x5629`, `seg6:0x565D`).
  - There is no range, cone or sight check when they fire. Aim & Fire throws
    at the aim tile; Scan & Fire throws at the acquired robot's tile.
  - Grenade scatter (`seg6:0x39C7`): inside the closed ±45° front arc, up to
    4 tiles the shell goes exactly where aimed; up to 8 it is jittered by
    `T[r&3]` on each axis; up to 12 the throw is scaled by `(13+(r&7))/16`
    and jittered by `T[r&7]`; beyond 12 it is scaled by
    `((r&7)+(r&3)+10)/16` and jittered by `T[r&7]`. Outside the front arc
    the up-to-12 case uses `T[r&3]`. `T = [-1,0,0,1,-2,-1,1,2]`
    (DGROUP `0x15CE`); the scaling truncates toward zero.
  - Missile scatter (`seg6:0x3BA6`): no range scaling. Inside the front arc
    it is exact up to 12 tiles and `T[r&3]` beyond; outside it is `T[r&3]`
    up to 8 and `T[r&7]` beyond.
  - Path stop (`seg87:0x2B36`): the shell follows a tile line that skips the
    shooter's tile, stops on the tile before the first Wall, and each Low
    Wall on the line draws `r & 0xFF` and stops the shell on the tile before
    it unless the roll is under 256, 248, 224 or 192 for path index ≤ 2, ≤ 4,
    ≤ 10 and beyond. A throw that passed fewer than 2 tiles, or fewer than 4
    when the target is over 10 tiles away, is thrown again at the exact aim
    point, and that second throw stands. Off-arena points are clamped first.
  - Flight: a grenade lands `5·d + 20` ticks after it fires and a missile
    `5·(d >> 1) + 10`, with d the floored distance to the landing tile.
  - Grenade and missile Scan & Fire both hold fire while the target is closer
    than 2 tiles (`seg6:0x24FA`, `seg6:0x29CF`).
- **One cooldown per robot.** Every shot and zap sets the robot's cooldown
  (program `+1A`), which lasts for the rest of the turn across commands:
  direct fire the weapon's Aim duration (`seg6:0x3D79`), a grenade 30 (+50
  after a scan shot, `seg6:0x3F43`), a missile 30 (+40, `seg6:0x3FA4`), a zap
  60 (`seg6:0x4005`). Scan & Fire and Zap check it every step and act only
  once it has run out. Aim & Fire fires when its record starts and does not
  check it.
- **Seven-shot pause** (`seg6:0x3E33`). Each direct-fire Scan & Fire shot
  adds one to the robot's shot counter. On the seventh the cooldown gets an
  extra `30 + 5·(r&3)` (Auto Rifle), `40 + 5·(r&3)` (Burst Gun) or
  `50 + 5·(r&7)` (Rifle), then the counter restarts at `r&1` (Auto) or `r&3`
  (Burst, Rifle). A Scan & Fire step with no target, 20 or more ticks after
  the cooldown ran out, takes one off the counter (`seg6:0x3EE6`). The
  counter and cooldown start at 0 each turn. Explosive scans have no counter.
  The original also resets both when a weapon-select record runs
  (`seg6:0x4D07`); RoboArena has no such records.
- **Damage is cut to the armor the target has left** (`seg6:0x5B09`). A robot
  already destroyed takes nothing from later impacts; the shooter's own death
  does not stop a shot in flight.
- **Zap** lands 5 ticks after it fires and **Self Destruct** 10 ticks after it
  starts, through the same queue.
- Each damaged robot draws the stagger roll `(rand & 3) + 1` right after its
  damage, as part of the same impact (`seg6:0x4060`). The value is never read.
- Blasts and zaps roll each robot's damage in global order, applying it and
  drawing its stagger roll before the next robot (`seg6:0x5D73`,
  `seg6:0x602B`).

**Delayed death** (`seg14:0x071C`, `seg6:0x4B05`). Damage that reaches a
robot's armor sets its death time to the next step, or to the end of the move
step it is on when that is later.

- From the lethal hit the robot is dead to targeting: Aim & Fire, Scan & Fire,
  Zap and blasts skip it (`seg21:0x0AB1`), and later damage does nothing.
- Until its death time a robot in a move keeps moving and switching tiles; it
  starts nothing new.
- At the death time the movie end is extended as for an impact
  (`seg6:0x4B49`), the record in progress takes effect (a turn or posture
  record completes, `seg14:0x0472`), the robot is `destroyed` and its orders
  are aborted.
- It stays on its tile, and still takes part in the spotting pass as observer
  and target (the pair routine `seg96:0x0484` does not check
  `seg21:0x0AB1`), until it leaves the map 60 ticks after its death time with
  activity 1 and moved set (`seg6:0x4C37..0x4C62`). The movie runs until
  every removal is done.

The death and explosion sprites draw from the game RNG in the original
(`seg6:0x10F3`, `seg6:0x13E1`); RoboArena does not replicate those visual
draws.

Events keep their split: `fired` and `projectile-launched` on the fire tick,
`projectile-impacted`, `shot-missed` and `damaged` on the impact tick. A
`damaged` event carries the damage actually taken. The movie flies each
projectile until its impact tick.

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

### Arena library

All 24 original maps are playable: eight each from `RUBBLE.TWN`,
`SUBURBS.TWN` and `COMPUTER.TWN`, exported by `tools/re/export_data.py` to
`src/lib/arenas/original-arenas.json` (one character per MAP cell). The room
host picks any map for either game length. Melee defaults to Rubble Two and
Battle to Rubble Three. Sizes range from 16×16 to 52×44, including long,
thin maps such as Suburb Five (52×20) and Suburb Seven (20×48). ✅

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
are self-contained. The Phase 6 named/checksummed arena library is now
available, but switching replay storage to references still requires an
explicit later format migration.

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

| Concern                          | Where                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| Locked numerical constants       | `src/engine/constants.ts`                                    |
| Weapon damage tables             | `src/engine/catalog.ts` (`WEAPONS`)                          |
| Robot class stats                | `src/engine/catalog.ts` (`ROBOT_DEFINITIONS`)                |
| Combat resolution implementation | `src/engine/firing.ts`, `src/engine/blast.ts`                |
| Movement implementation          | `src/engine/movement.ts`                                     |
| Turn scheduling and resolution   | `src/engine/commandInterpreter.ts`, `src/engine/resolver.ts` |
| Empirical research log           | `docs/priority-tests.md`                                     |
| Implementation roadmap           | `docs/implementation-plan.md`                                |
| Original-game research           | `docs/priority-tests.md`; local ignored source captures      |

If the spec and code diverge, **the code is correct** and this doc gets updated.
