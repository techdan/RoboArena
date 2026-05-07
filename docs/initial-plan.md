# RoboArena Pre-Implementation Specification Package — Plan

> **⚠️ HISTORICAL DOCUMENT** — preserved for provenance.
>
> This was the original session-by-session planning log that drove the
> pre-implementation research. It accreted spec content along the way and
> some sections are stale.
>
> For the **current canonical spec**, see [`docs/spec.md`](./spec.md).
> For the current execution roadmap, see [`docs/implementation-plan.md`](./implementation-plan.md).
> The actual locked numerical values live in `src/engine/constants.ts` and
> `src/engine/catalog.ts` — those files are the literal source of truth.

## Context

**Project**: RoboArena, a faithful modern clone of the 1991 Maxis tactical game *RoboSport*. Web-first, TypeScript, **Next.js 16 + React 19 + Tailwind v4 + PixiJS** renderer, deterministic pure-TS simulation engine, **Vitest** for engine tests. Audio deferred to post-MVP. Visual direction: **modernized top-down tile grid** (same camera as the original, modern art).

**v1 scope: human-vs-human only, no AI.** Two players connect via lobby/room links and play either hot-seat (single device, take turns) or online (separate devices, simultaneous planning + synced movie playback). AI ("Stupid" or higher tiers) is deferred to Phase 4. This shifts online multiplayer earlier than originally planned — it's now part of v1, not Phase 6.

**Decisions locked with the user**:
- PixiJS for the renderer (over Canvas 2D).
- Vitest for the engine test suite.
- Deferred audio.
- Modernized top-down tile grid.
- Original-game research happens via screenshots + online sources + user-captured video frames + user's working DOS install; **no DOSBox shipped** — the product is a modern web app.
- **v1 is human-vs-human only** (no AI). Hot-seat + online lobby both required for v1.
- Source canonicality: **DOS canonical**, Mac secondary, Amiga third (all are inspiration; modern UI/UX will exceed them).

**Why this work now**: The repo already contains a starter research bundle (4 docs in `/docs`, a source matrix, an empirical-test plan for the original game, two Codex prompts) and **31 captured Mac-version screenshots** in `/screenshots` (18 initial + 11 from the Custom Game/team-builder/setup screens + 1 Commands menu + room for more from upcoming captures). The screenshots are not yet indexed and most of their observations are not yet folded into the mechanics docs. The mechanics docs themselves stop short of a full game-design spec, resolution-engine spec, technical architecture, data model, UI/UX spec, roadmap, or test plan.

**Goal**: Finish the planning/specification package so the next session can begin Phase 1 (deterministic engine prototype) without re-deriving requirements. Every rule must carry a confidence label (CONFIRMED / INFERRED / PROPOSED / OPEN QUESTION) so unconfirmed original behavior cannot silently harden into a "fact" of the clone.

**Hard constraints carried forward**
- Don't promote unconfirmed mechanics to CONFIRMED.
- No copyrighted assets, sprites, audio, or the "RoboSport" name in shipped UI/branding — RoboSport is the inspiration; RoboArena is the product.
- No floating-point in core simulation; deterministic seedable RNG only when randomness is explicitly required.
- Engine independent of UI; renderer consumes a resolved event timeline.
- Replay = initial state + commands + seed.
- No game code yet beyond tiny illustrative pseudocode.

---

## Current state of the repo (what already exists)

```
RoboArena/
├── README.md
├── AGENTS.md                                      # Codex stack notes
├── CLAUDE.md                                      # Claude stack notes
├── docs/
│   ├── source-notes.md                            # Catalog of upstream sources
│   ├── confirmed-mechanics.md                     # Source-backed mechanics
│   ├── open-questions.md                          # Unresolved mechanics
│   └── resolution-rules-proposal.md               # Proposed deterministic rules
├── prompts/
│   ├── codex-research-prompt.md
│   └── codex-implementation-prompt.md
├── references/
│   ├── source-matrix.csv                          # Mechanic → status → source
│   └── screenshot-index.md                        # EMPTY TABLE
├── screenshots/
│   ├── README.md                                  # Naming convention
│   └── 18 .png files (UNINDEXED — see below)
└── tests/
    └── original-game-test-plan.md                 # DOSBox/Wine empirical plan
```

### Research findings consolidated during this planning pass

I read 11 of the 18 existing screenshots (the most informative ones) and fetched the Lemon Amiga manual + Wikipedia. The findings below upgrade many entries from PROPOSED/UNKNOWN to **CONFIRMED** or **INFERRED** for the next session.

**CONFIRMED from the Lemon Amiga manual transcription**
- 15-second turn budget is the **Beginner default**; other formations let players set turn time freely.
- Three postures: standing, ducking, crouching. Lower posture = harder to hit.
- Crouched robots cannot cross low walls, bushes, or rough ground.
- Five weapons: Rifle, Burst Gun, Automatic Rifle, Missile Launcher, Grenade Launcher.
- Bullet weapons have unlimited ammo; explosive weapons have limited shots.
- Bullets cannot harm friendlies; missiles/grenades can.
- Game lengths: Skirmish (2/team, tiny), Melee (4/team, small), Battle (6/team, large), Campaign (8/team, huge).
- Sport modes: Survival, Treasure, Hunt, Capture the Flag, Baseball (win conditions still partial).
- AI: at least one tier named "Stupid computer" (more tiers likely; not in fetched excerpt).

**Source canonicality** (locked by user; all three are *inspiration*, not strict reference — modern UI/UX will exceed them):
1. **DOS / Windows is the canonical source** (user has a working DOS install in `RoboSport (1991)/`). Empirical observations from playing the DOS build override anything else.
2. **Mac** is secondary.
3. **Amiga** is third / historical (the SKID ROW manual.txt = robo.txt).
The three versions are functionally similar for our purposes; pick the cleanest behavior when they diverge and document the choice.

**Source-version disambiguation across screenshots & docs**:
- **B&W Mac (older Mac)**: the `Robosport - *` setup-screen captures (Quick Start splash, Custom Game lobby, per-class stat dialogs, drop-downs, Turn Length dialog). UI is monochrome.
- **Color Mac (canonical)**: the in-game "Cyborgs" window captures (placement, programming, weapon dialogs, movie, menus File/Edit/Turn/Robots/Arena/Commands).
- **Amiga (oldest)**: `docs/manual.txt` and `RoboSport (1991)/games/RoboSpor/cd/robo.txt` (identical SKID ROW transcript). Covers Quick Start tutorial + keyboard reference.
- **Windows (DOS package)**: `RoboSport (1991)/` directory — `README.TXT` plus binary assets. Confirms cross-platform multiplayer and exact file shape.
- **Implication**: numerical values that come *only* from the B&W Mac setup screens (robot HP, ratings, accuracy tiers) are CONFIRMED as the clone baseline. They are likely consistent with the canonical color Mac (no contradicting evidence yet). The cross-version-parity question is now **lower priority** — Mac wins by fiat.

**Firing — CONFIRMED weapon timing & targeting model (DOS empirical)**

| Weapon | Per-shot cost (alternating) | Average | Notes |
|---|---|---|---|
| Rifle | **0.7 s / 0.3 s** | 0.5 s | Range-independent timing |
| Burst Gun | **0.15 s / 0.55 s** | 0.35 s | Possibly multi-bullet per "shot" — TBD |
| Auto (Machine Gun) | TBD | — | Test next |
| Missile | TBD | — | |
| Grenade | TBD | — | |

- **Aim & Fire targets a TILE, not a robot**: if the target moves between command-time and impact-time, the bullet hits the original tile (which may now be empty — that's the "shot went past" case observed).
- **Firing has an arc — "angle blocked" outside the scan cone (CONFIRMED via DOS)**: each robot has a scan direction (heading), and Aim & Fire only succeeds when the target tile is inside the robot's scan cone. The targeting cursor shows the firing arc visually (black/grey area = targetable, white area = "angle blocked"). The status bar surfaces "**angle blocked**" when the player tries to target outside the cone.
  - Engine implication: every robot has a `scanHeading` (one of 8 directions). The hit-test for a tile target is `distance ≤ weaponMaxRange AND tileWithinScanCone(robot, target) AND lineOfSight(robot, target)`.
  - Rotation cost: 0.05 s per directional unit (already CONFIRMED).
  - **OPEN**: exact cone angle. The Scan indicator in the Tools panel is a circle with a partially-filled arc — width looks roughly 180° (forward semicircle) but could be narrower. Test by aiming gradually toward edges and noting where "angle blocked" kicks in.
- **Repeat firing**: hold **Ctrl+Shift** while clicking (DOS) or **Alt** (Amiga manual) to fire repeatedly at the same tile. Confirmed via DOS status-bar text: *"Select target (control+shift for repeated firing)"*.
- **Damage is RNG-driven** (qualitatively confirmed): same shooter, same target, same range can produce different damage values. Engine uses seedable RNG against `(baseDamage ± variance)` per hit.
- **Match 1 + 2 + 3 measurements (validated on confirmed open ground)**:
  - Rifle point-blank: 20-25 dmg, avg ~22. Mid-range (d=6): 14-21 dmg, avg ~17.
  - Burst point-blank: 21-30 dmg, avg ~24 (Match 1 bush taint turned out to be minor). Mid-range (d=6): 12-42 dmg per click — **wide spread strongly suggests 3 bullets per click** (a real "burst"); when all 3 hit, click damage spikes to 30-42. Per-bullet damage ~12-15.
  - Auto point-blank: 14-31 dmg, avg ~22. Wide RNG variance, single bullet per click.
  - Missile (Match 2): blast falloff CONFIRMED clean — radius 0 ≈ 55-80 (avg 70), radius 1 ≈ 40-60 (avg 50), radius 2 ≈ 13-17 (avg 15), radius 3+ = 0. **blastRadius = 2**.
  - All bullet weapons: max range 18 tiles (CONFIRMED via DOS cursor probe).
  - Posture × hit-rate: hard to disambiguate from small samples — Rifle vs ducking and Burst vs crouching at d=6 both took 6-9 hits over a turn, similar to standing. Engine ships with **default posture multipliers** (standing 1.0, ducking 0.7, crouching 0.5) per the manual hint "lower = harder to hit", tunable in playtest.
- **Movement model (validated user-side)**:
  - Single move alternates **0.3 / 0.7** seconds (parity-based, persists across non-move commands).
  - Double move (path interpolated to 2 tiles in one command) alternates **0.4 / 0.8** seconds.
  - Some quirks observed (3 doubles in a row went .4/.8/.8 instead of .4/.8/.4; .3 followed by double .8) — engine ships with strict alternation and accepts the small fidelity gap.
  - Terrain does NOT affect movement at standing posture (re-confirmed). Crouching is the only posture with terrain restrictions.
- **Distance affects accuracy** (qualitatively confirmed): Burst at distance 8 missed all observed shots; Auto at distance 4 hit consistently. Quantitative hit-rate curve still TBD via systematic test.
- **Bullets pass through friendlies (CONFIRMED, closes Q7)**: friendly Auto at (24,12) did NOT block Rifle shot from (24,15) hitting enemy at (24,9). Friendly bodies are not LoS or projectile blockers.
- **Stacked-tile firing**: if multiple robots occupy the same tile, an Aim & Fire shot at that tile **does damage** (Rifle + Burst pair did 22 then 24 damage on a stacked tile). Whether *all* robots on the tile take damage per shot, or only one (and which one): TBD — see test T9f.

**Combat speech-bubble strings — CONFIRMED**:
- "Ha!" — non-fatal hit (light damage).
- "Ow!" — non-fatal hit (heavier damage; fired after 3 Auto shots dropped HP from 140 → 64).
- "Aaargh!" — destruction.
- May be more strings; renderer treats them as a `damage-feedback` event with discriminated kind.

---

**CONFIRMED from in-game screenshots (Color Mac version, window title "Cyborgs")**
- Mac menu bar: **File / Edit / Turn / Robots / Arena / Commands**.
- Turn menu has **End Turn ⌘E** and **Team Data ⌘D** (more entries likely).
- Robots menu: **Next Robot ⌘A** + per-robot list ("Rifle1 [Rifle]", "Burst1 [Burst]", "Auto1 [Auto]", "Missile1 [Missile]" — current robot checkmarked).
- Robot HP/armor values shown next to class:
  - **Rifle: 140** · **Burst: 120** · **Auto: 100** · **Missile: 100**
- Missile ammo count shown as "Missile (3)" — consumable count tracked per robot.
- Movie playback runs at **12 frames/sec** (visible in transport bar). 12 fps × 15.25 s = **183 frames/turn** — natural deterministic tick rate.
- Turn timeline budget shown as **0:15.25** (Mac, Beginner).
- Deployment consumes **2 s** of timeline.
- Coordinate system is **integer (x, y) tile grid** (visible "x 17, y 4" cursor readout).
- Movement command shows distance + duration pair on toolbar (e.g., "18, 0:05" = 18 tiles in 5 s) → speed depends on posture/weapon.
- Path validity is checked at **command-edit time**: "Unable to reach position. Please avoid walls."
- Placement is constrained: "Select robot position in **Home Area** of map."
- Two firing dialogs:
  - **"Scan and Fire Rifle Weapon"** — params: Maximum Distance slider, Seconds slider, OK/Cancel.
  - **Missile targeting** — status bar: "Select target (option for repeated firing)" with live "distance N" readout.
- Two firing modes per weapon (icons in robot panel: "←─ T" and "T─→"): targeted-fire vs scan-and-fire (matches Wikipedia: "fire at a particular location, or scan for enemy players and fire if they are seen").
- Time-limit warning: "Code has reached time limit for this turn."

**CONFIRMED from menu screenshots (Color Mac version, added after initial pass)**
- **Commands menu** lists robot commands; in the standard-battle screenshot, only **Scan** is enabled. The other three (**Zap Enemy / Place Bomb / Self Destruct**) are **greyed out** and apparently belong to non-standard sport modes (Treasure Hunt / Hostage / etc.). **Decision: out of scope for v1.** The v1 command vocabulary is **Move / Set Posture / Set Scan Direction / Scan / Fire (targeted) / Fire (scan-and-fire)**. Re-evaluate the other four when those sport modes are scheduled.
- **File menu**:
  - Scenario operations (New / Open / Save Scenario) — **scenarios are a first-class concept distinct from saved games** (likely level/arena definitions authored separately).
  - Game save/load: **Open Game ⌘O / Close Game ⌘W / Save Game ⌘S**.
  - **Print Map ⌘P** + Page Setup → paper output, useful for play-by-mail / hot-seat planning notes.
  - Quit ⌘Q.
- **Edit menu**:
  - Undo ⌘Z, Cut/Copy/Paste/Clear — likely operate on selected command segments in the timeline editor (to verify in clone UX).
  - **Multiplayer transports** (now CONFIRMED): **Open Serial Link / Open Modem Link / Open AppleTalk**. Modern web equivalents: WebRTC peer-to-peer / WebSocket relay / LAN-via-server.
  - Remove Secondary... (probably tears down a secondary connection).
  - Preferences...
- **End Turn confirmation dialog**: "Are you sure you want to generate the turn?" with OK/Cancel — explicit turn-commit gate before the simulation runs.
- **Quick Start defaults** (start screen "RoboSport"): 2 teams ("Cyborgs" / "Computers"), **Side 1 / Side 2** (alliance axis separate from team identity), Sport Type Survival, Formation Beginner, Game Length Melee, Arena Type Rubble. Original docs say up to 4 teams; the Quick Start screen has unfilled team-name slots below the two defaults.
- **Per-weapon Max Distance** in the Scan-and-Fire dialog is the **player's auto-engagement cap** for that scan-and-fire mode (how far an enemy must enter scan range before firing), **not the weapon's actual max range**. Confirmed via DOS testing: Aim & Fire allows distances well past the dialog's stated max.
- **All weapons share the same Aim & Fire max range = 18 tiles** (CONFIRMED via DOS cursor probe — Rifle / Burst / Auto / Missile all cap at 18). Data model: a single `weapon.maxRange = 18` for v1; `weapon.scanFireMaxDistance` is the dialog slider cap (per-weapon: Rifle 17, Missile 6, others TBD but capped ≤ maxRange).
- **Save Movie**: file format is "**Robosport (16 color only)**". Movies persist at fixed 16-color depth in the original. Clone equivalent: a serialized event-log JSON, not a video file.

**Arena element correction** (user-confirmed; supersedes earlier door inference)
- The blue squares on the open arena are **obstacles** (crates / cover) — they block movement and likely block bullets/LoS.
- The blue rectangles attached to walls are **decorative wall fixtures** (security cameras / mounted tanks) — non-interactive set dressing. **There are no doors.** Earlier inference removed.

**Combat & projectile feedback (CONFIRMED from movie screenshots)**
- Hit/destruction is signalled by a **speech-bubble overlay** on the targeted robot: "**Ha!**" on a non-fatal hit, "**Aaargh!**" on destruction. Clone equivalent: timed text overlays in the renderer event stream.
- **Missiles are animated multi-tick projectiles**: launch frame → smoke trail along travel path → impact explosion → settled rubble. Blast effect is a circular puff sprite. Implies the projectile occupies multiple ticks between launch and impact (data model: `Projectile { launchTick, impactTick, path }`).
- One screenshot title indicates **3 missile shots in a single 15.25 s turn** (using the full 3-missile inventory). Per-shot cost on the timeline can be back-calculated from the dialog Seconds value (~3–5 s typical).

**Movement, posture, and scan timing — CONFIRMED via DOS empirical test (user-run)**

| Action | Cost | Notes |
|---|---|---|
| **Movement step (any direction, any terrain)** | **alternates 0.3 s / 0.7 s** per step (avg 0.5 s) | First step from rest = 0.3 s; pairs sum to 1.0 s |
| **Deployment** (Dock → Home Area) | **2.0 s** | Once per robot per match |
| **Posture change** | **0.1 s per height step** | Standing↔ducking 0.1 s; standing↔crouching 0.2 s |
| **Scan rotation (Shift+click)** | **0.05 s per directional unit** | 8 directions; rotates through intermediates. Down→up = 5 steps = 0.25 s |
| **Turn budget** | **15.0 s hard cutoff** | Planner permits commands past 15 s but they're greyed out and not executed. Beginner default; configurable 1–40 s in other formations |
| **Aim & Fire** | TBD (test case below) | |
| **Scan & Fire** | player-set "Seconds" (1 to remaining-budget) | Fires automatically when enemy enters scan range |

**Canonical terrain table (CONFIRMED via DOS in-game help dialogs)**

Terrain affects BOTH movement speed AND cover. The 0.3/0.7 stride alternation applies to **open ground** only; other passable terrains slow movement (exact multipliers TBD by test).

| Terrain | Movement | Cover from weapons | Cover from scanning |
|---|---|---|---|
| **Open Ground** | full speed (0.3/0.7 alt) in any posture | None | None |
| **Rough Ground** | slow (TBD) for standing/duck; crouch **blocked** | None + **vulnerable to attack** (extra damage taken) | None |
| **Low Walls** | slow (TBD) when crossing for standing/duck; crouch **blocked** | "Excellent" | "Excellent" |
| **Walls** | **impassable** in any posture | "Total protection" | "Complete cover" |
| **Bushes** | slow (TBD) for standing/duck; crouch **blocked** | "Weapon protection when on or behind" | "Visual cover when on or behind" |
| **Outer Wall** | **impassable** except Dock↔Playing-Field transitions | — | — |
| **Crevice** | **impassable in any posture** (CONFIRMED via in-game help dialog: "Robots are unable to move across a crevice") | None for shooter/target | **None — LoS passes across** ("but can sight across them"). Distinct from walls (which block sight). |
| **Fences** | help dialog not yet captured; treat as crevice-like (impassable but LoS-transparent) until verified | TBD | TBD |

**Stride parity persists across non-movement commands** (CONFIRMED via T1):
- Engine maintains `robot.strideParity: 0 | 1`. Each movement step on **open ground** costs `parity === 0 ? 6 ticks : 14 ticks` (0.3 s / 0.7 s) and flips parity.
- Posture change, scan rotation, fire, idle wait → parity **does not reset**.
- Parity is reset to 0 only at deployment (or per-turn? — to verify).

**Multi-tile move interpolation (CONFIRMED)**: clicking a destination 2+ tiles away can be encoded as a **single double-step** command. Cost pattern is **alternating 0.4 s / 0.8 s** for 2-step doubles (vs 0.3/0.7 for singles). Per-tile this is 0.3 s/tile (40% faster than single steps at 0.5 s/tile). The planner's pathfinder should chunk runs into doubles wherever the path is straight. Triple+ chunks: TBD.

**No robot-vs-robot collision (CONFIRMED, MAJOR SIMPLIFICATION)**:
- **Robots pass through each other freely**.
- **Robots can stack on the same tile** (multiple robots simultaneously occupying one position is a normal state).
- All my earlier same-destination / swap / follow-leader / chain / cycle rules are **moot**. Engine resolves each robot's program **independently**; there is no movement-conflict resolver.
- Implication for the engine spec: drop the entire `MovementConflictResolver` module. Per-tick phase order collapses to: read intents → advance each robot independently → resolve fire → apply damage → cleanup deaths → emit events.
- The only movement gates are **terrain** (impassable walls / posture-blocked terrain) and **arena boundary** (Outer Wall).

**Engine tick rate revised: 20 ticks/second (0.05 s per tick)** — the smallest observed cost (scan rotation = 0.05 s) is exactly 1 tick. Earlier 12 fps proposal was wrong; 12 fps is the **movie playback rate**, not the simulation rate.
- 20 tps × 15.0 s = **300 ticks per turn** (Beginner default).
- Movement step pair (1.0 s) = 20 ticks.
- Posture step (0.1 s) = 2 ticks.
- Scan rotation step (0.05 s) = 1 tick.
- Deployment (2.0 s) = 40 ticks.
- Movie playback decimates from 20 fps simulation to 12 fps display (every 5 sim ticks ≈ 3 movie frames; or just sample every other tick).

**Step-cost alternation (0.3 / 0.7) — engine model**
- The clone tracks `robot.strideParity: 0 | 1` per robot. Each movement step costs `parity === 0 ? 6 : 14` ticks (0.3 s / 0.7 s). Parity flips after each step.
- Parity resets to 0 after a non-movement command (posture change, scan, fire) or after deployment.
- This is the simplest model that reproduces the observed timeline display. **OPEN**: confirm parity reset rule (test cases below).

**View controls (Arena menu — CONFIRMED)**
The Arena menu in standard battle exposes a rich set of view-state toggles that affect only the planning UI, not engine state:
- **Reduce Map** — zoomed-out overview / minimap mode (a separate "Reduced Map" screenshot confirms).
- **Hide Position / Hide Home** — hide robot positions or home areas during planning (useful in hot-seat to avoid spoilers between players).
- **Hide Team ⌘?** / **Hide Other Teams ⌘T** — fog-of-war toggles for the planner.
- **Lock Team ⌘L** — lock view to current team's perspective.
- **Manual Center** — recenter viewport.
- **Show Paths** / **Reduce Paths** — display planned movement paths overlaid on the arena.
- The clone's planner UI should provide equivalents; these belong in `ui-ux-spec.md`, not in the engine.

**Distance-vs-accuracy rule (CONFIRMED — user-supplied)**
- **Longer shooting distance reduces accuracy.** This makes the "Maximum Distance" slider in the Scan-and-Fire dialog a real tactical tradeoff (commit to a longer range and accept a worse hit chance, or hold fire until the target is closer).
- Affects the resolution-engine spec: the hit-check at fire time must factor distance into the accuracy roll.
- **PROPOSED hit formula** (deterministic, data-driven, falsifiable):
  - `baseHit = accuracyTier(robot.accuracy)` → e.g., High = 0.90, Medium = 0.70, Low = 0.50.
  - `distanceFactor = max(0, 1 − (distance / weapon.maxScanDistance) × falloff)` → at point-blank the multiplier is 1.0; at max range it's `1 − falloff`.
  - `postureFactor = postureModifier(target.posture)` → standing 1.0, ducking 0.7, crouching 0.5.
  - `hitChance = clamp01(baseHit × distanceFactor × postureFactor)`
  - Resolved with the seedable RNG against `hitChance` at fire time. Engine emits `Hit` or `Miss` events.
  - Numeric tuning is OPEN; the *shape* (multiplicative, distance-falloff, posture-modifier) is the v1 commitment.

**Side 1 / Side 2** is an alliance/team axis separate from team identity — multiple teams may share a Side (free-for-all vs 2v2 etc.).

---

**MAJOR new source**: `docs/manual.txt` — partial Amiga RoboSport manual transcription (SKID ROW dump). Covers Quick Start, Custom Game, Movie/Edit/Setup keyboard reference, and the full beginner tutorial. Resolves a dozen prior open questions:

**CONFIRMED from `docs/manual.txt` (Amiga version)**

- **Two firing modes — semantics now fully resolved** (closes Q20):
  - **Aim & Fire**: direct one-shot at a clicked target. Fired at command time, hits the location regardless of whether an enemy is there.
  - **Scan & Fire**: robot waits in scan direction; **fires automatically when an enemy enters scan range**. Settings: Maximum Distance (range cap) + Seconds (how long to wait).
  - **Alt key + Aim & Fire = repeat firing** on the same target — confirms the missile dialog's "option for repeated firing".
  - Bullet weapons (Rifle, Burst, Auto) are unlimited; explosives show remaining ammo count next to the weapon name.
  - Robots can have 1–3 weapons depending on formation (Missile robots also carry rifles per tutorial).
- **Distance-vs-accuracy is shown live in the planner UX**:
  - **Dark target sight** = optimum range, **light target sight** = "in range but very low accuracy" (manual quote).
  - Status: "out of range" / "blocked" / "out of bounds".
  - Engine hit formula belongs in the resolution-engine spec; this UX hint belongs in `ui-ux-spec.md`.
- **Arena anatomy** (closes Q26 partially):
  - **Dock**: where robots wait pre-deploy and **return to when destroyed**.
  - **Playing Field**: the main combat area.
  - **Home Areas**: 4 corners of the Playing Field, assigned **clockwise** by team-list position. **First move out of the Dock must be into the Home Area.**
- **Canonical terrain list** (replaces my placeholder list):
  walls, low walls, open ground, rough ground, crevices, bushes, fences. Different terrain gives different protection from sight and weapons; the in-game help cursor explains each.
- **Last-known enemy markers**: "**Xs on the Playing Field** mark the location of enemy Robots at the end of the last turn." Engine emits a `LastKnownEnemy` annotation per turn-end; renderer draws an X. **CONFIRMED visible in Edit Mode** (DOS screenshot shows two Xs during planning).
- **Team Data dialog** (Turn menu): canonical layout (CONFIRMED via DOS screenshot):
  - Top section per-team: **Health** (sum of all live robots' armor) + **Score**. Example: Cyborgs 460 = 140+120+100+100 (Rifle+Burst+Auto+Missile).
  - Bottom section per-robot: **Name / Type / Health / Position** where Position is `"x, y"` or the literal string `"Dock"` for stowed robots.
  - **Modern clone change**: this becomes a **persistent side-panel**, not a modal — we have screen real estate the original didn't.
- **Final Ceremony** (end of match): scoring screen with points + bonus points, Start Ceremony / Show Stats (cycles teams) / Return to Start buttons.
- **Three persistence kinds now fully confirmed**:
  - **Team file** — reusable named team (roster + classes + colors). Custom Game shortcuts: Delete / Edit / New / Open Team.
  - **Game save** — in-progress match.
  - **Scenario file** — separate concept, mentioned in the Mac File menu (manual coverage thin here).
- **Sides — alliance axis confirmed** (closes Q22 partially): "if you have more than two Teams, two or three can work together as long as there are at least two Sides". Exact friendly-fire / shared-vision rules per side: still PROPOSED.
- **Editing existing program**: click on the Program Bar → highlights from click to end → **Delete** removes highlighted segments. Confirms Edit-menu Cut/Copy/Paste likely targets program-bar selections (closes Q24).
- **Posture and traversal** (closes Q9 baseline): "Crouched Robots cannot cross certain types of terrain (low walls, bushes, rough ground) that Robots at other heights can." Standing/ducking/crouching: lower = harder to hit; crouch is the only posture with traversal restrictions called out.
- **Sport modes — version drift acknowledged**: Amiga manual lists **Survival / Treasure / Hunt / Capture the Flag / Baseball**; B&W Mac shows **Survival / Treasure Hunt / Capture the Flag / Hostage / Baseball**. Likely Amiga "Hunt" → Mac "Hostage" (the manual's tutorial mentions "rescuing Hostages" as a game-specific action) and Amiga "Treasure" → Mac "Treasure Hunt". v1 will adopt the **Mac names** as canonical to match the screenshots.
- **AI**: "In Beginner formation you will always play a Stupid computer" → confirms more sophisticated AI tiers exist in higher formations (closes Q13 directionally; tier names still OPEN).
- **Programming Control Panel** (CONFIRMED layout): Robot name + main weapon + armor (HP), Height Box (3 postures), Scan Box (look/aim direction with circular indicator), Weapons Box (5 weapon icons; black=available, ghosted=unavailable), Fire Box (active weapon + Aim & Fire / Scan & Fire buttons).
- **Multi-robot timeline preview (CONFIRMED via DOS)**: while planning a robot at time `t`, the planner renders **every other robot's projected position at the same `t`** based on programs already committed this turn. As you commit each robot, subsequent robots see all earlier ones live. Engine-state-neutral (a render-side concern), but critical for coordinated tactics. The clone's planner UI must replicate this.
- **Title bar formats** (CONFIRMED):
  - Window: `"{TeamName} in {ArenaName}"` e.g. `"Cyborgs in Rubble Two"` — arena names are `"{Type} {SizeName}"`.
  - Robot panel: `"Code for {RobotName} (health is {HP})"`.
- **Coordinate range** (CONFIRMED via DOS Team Data showing position 24,8): playing-field indices appear to reach **0–24 inclusive** (25×25 grid for the Melee Rubble Town arena), even though we describe it as "24×24" colloquially. **Test T16d below** confirms the exact extent.
- **Edit Mode keyboard reference** (Amiga; Mac equivalents already in screenshots): Next Robot ⌘A, End Turn ⌘E, Hide/Show Position/Home/Items/Team/Other Teams, Lock/Unlock Team, Auto Center, Print Map ⌘P, Reduce/Enlarge Map, Hide/Show Paths, Redraw Paths.
- **Movie Mode keyboard reference**: Play / Stop / Rewind / Forward Step / Backward Step / Auto vs Manual Center / Show/Hide Sighting / Start/Stop Tracking / Play Slower (`,`) / Play Faster (`.`). **Frame-by-frame stepping is supported** in the original — the clone's replay viewer should match.
- **Robot select via `1`–`8`** keys (alongside menu and click selection).
- **Modifier keys**:
  - **Shift** = scanning-mode cursor.
  - **Alt** = targeting mode + repeat-firing toggle for Aim & Fire.
  - **Control** = pan/scroll arena (hand cursor).
  - **Spacebar** = toggle viewport center between active robot and active robot's scanning range.
- **Multiplayer details** are in **Appendix B** of the manual ("Multi-player and Multi-machine Games") — **not included in the SKID ROW dump**. Some architectural facts are recovered from the Windows `README.TXT`:
- **Transports**: Serial / Modem / **NetBIOS** (network multiplayer beyond just dial-up).
- **Architecture**: **Primary + Secondary** (host-and-client model). Up to **4 sessions**, **2 pending datagrams**, group-and-player names per Secondary.
- **Cross-platform**: Windows / Mac / Amiga can serial-or-modem-link with each other. Saved files (games, movies, scenarios, teams) are **not** cross-platform compatible.
- **Clone equivalent**: a single TypeScript engine package shared between client and server, with a `NetworkAdapter` interface fronting WebRTC (peer) / WebSocket (relay) / LAN-via-server. Primary = match host, Secondaries = remote players. Cross-platform compatibility is automatic since there's only one platform (web).

---

**CONFIRMED from the DOS Windows distribution (`RoboSport (1991)/`)**

- **Exactly 3 arena types** (closes Q14): **Rubble Town / Suburbs / Computer Town**. Distributed as `*.TWN` files (`RUBBLE.TWN`, `SUBURBS.TWN`, `COMPUTER.TWN`). The manual confirms each type comes in multiple sizes (one size per Game Length × type).
- **Standalone replay viewer (`PLAYER.EXE`, "RoboPlayer")**: a separate executable that plays movie files without the full game. Implies the original treated movies as a sharable artifact independent of the simulator.
  - **Clone implication**: the replay format (engine event log + initial state + seed) deserves its own deserialization path, and the planner UI's movie viewer should be reachable as a standalone route (`/replay/:id`) usable by people without an active match.
- **Asset shape** (CONFIRMED): `ROBO.EXE` (engine + UI), `PLAYER.EXE` (replay viewer), `ROBOCOLR.PRS` and `ROBOMONO.PRS` (sprite packs — color and mono variants), `*.TWN` (arena packs), `ROBO.REG` (registration), `ROBOTCRK.EXE` (copy-protection check, irrelevant to the clone).
- **Renderer hint**: the original ships **two sprite packs** (color and monochrome) so the renderer can swap art at runtime. v1 ships color only; mono is a possible later accessibility/perf option.
- **`MONO` and `LOWMEM` command-line flags** existed for memory-tight systems. Not applicable to the clone but explain why mono assets exist as a separate pack.

**Stealth — IN v1** (user decision; reinstated after confirmation that Stealth ships in the PC version)
- The B&W Mac team-builder lists Stealth as a 5th class: **Cost 100, Armor 120, Weapon Burst Gun, Accuracy Medium**. The Amiga manual.txt is silent on Stealth.
- **Canonical Stealth mechanic** (Compute! review of RoboSport for Windows):
  > "The stealth robot is unique in that it cannot be seen unless moving or scanned from an adjacent square."
  - **Standing still / not moving** → hidden from normal view and from scan.
  - **Moving** → visible to anyone whose scan or LoS includes the stealth's tile.
  - **Enemy scans from an adjacent square** (orthogonal or diagonal, distance ≤ 1) → visible regardless of motion.
  - **Enemy farther away** → not visible, even if the stealth is within their scan range.
- **Engine implication**: visibility resolution becomes per-observer-per-target-per-tick:
  - For non-stealth target: standard scan-cone + LoS check.
  - For stealth target: standard check **AND** (`target.movedThisTick` OR `chebyshevDistance(observer, target) ≤ 1`).
- **Last-known X markers** still apply to stealth — once seen and then lost, an X is left at the last-seen tile.
- **v1 robot classes (final)**: **Rifle / Burst / Auto / Missile / Stealth** (5 classes). Default Quick Start rosters do NOT include Stealth (only Custom Game can pick it).

**INFERRED from screenshots (one Windows/Mac playthrough; not yet cross-version)**
- Tile types visible: grass (passable), rough/dirt (slows or blocks crouch), low walls (red), bushes (block crouch?), rubble.
- **Arena dimensions** (CONFIRMED via DOS):
  - **Melee = 25 × 25** tiles (indices 0-24 inclusive). Canonical arena: **Rubble Two**.
  - **Battle = 32 × 32** tiles. Canonical arena: **Rubble Three**.
  - Skirmish / Campaign: still TBD; Skirmish smaller, Campaign larger.
- **Canonical arenas to reproduce**: the clone should ship hand-authored arenas matching the look and tactical layout of Rubble Two and Rubble Three. Reference screenshots exist in `/screenshots/` (overview + edit-mode views). **TODO post-MVP**: a tile-by-tile transcription of each canonical arena into a `.json` (or similar) format the engine consumes.
- Two team colors visible: red and blue. Up to 4 teams confirmed in original docs.
- Start time of day is shown (e.g., "7:39 PM") — purely cosmetic clock from the Mac OS, not gameplay time.

**Pending — user will capture screenshots**
- Video `gM2dTNLRUfU`: simultaneous-movement frames, missile launch/impact frames, rifle shot frame, destruction frame, any HP/damage UI changes during the kill.
- Tools constraint: I cannot extract YouTube frames; user has agreed to capture and drop into `/screenshots/`.

**CONFIRMED from the Robosport-* setup screenshots — B&W Mac version (added by user this session)**

> **Caveat**: these values come from the older B&W Mac version. They are CONFIRMED for that build and adopted as the clone baseline, but may have been retuned in the color Mac, Amiga, or Windows releases. Treat as PROPOSED for cross-version parity until verified.


Robot point-buy table (Custom Game team builder):

| Class    | Accuracy | Weapon       | Armor (HP) | Rating |
|----------|----------|--------------|-----------:|-------:|
| Rifle    | High     | Rifle        | 140        | 40     |
| Burst    | Medium   | Burst Gun    | 120        | 50     |
| Auto     | Low      | Machine Gun  | 100        | 60     |
| Missile  | Medium   | Missile      | 100        | 80     |
| Stealth  | Medium   | Burst Gun    | 120        | 100    |

- A team's **Team Rating = sum of its robots' Ratings** (Rifle+Burst+Auto+Missile = 40+50+60+80 = **230** ✓).
- Custom Game enforces a per-team Rating shown beside each team in the lobby. Players pick robot classes/loadouts that hit that budget.
- **5 robot classes** total (was previously assumed 4): Rifle, Burst, Auto, Missile, **Stealth**.
- Stealth shares weapon/armor/accuracy with Burst at 2× the cost; premium is the **stealth visibility rule** (CONFIRMED via Compute! review): invisible unless moving or scanned from an adjacent square.
- Naming inconsistency: the team-builder shows the Auto class's weapon as **"Machine Gun"**, while the Lemon manual calls it **"Automatic Rifle"**. Spec will use "Auto Rifle" as the canonical clone name and document the alias.

Setup flow (Quick Start / Custom Game) — CONFIRMED:
- **Sport types** (5): Survival / Treasure Hunt / Capture the Flag / **Hostage** / Baseball. *("Hostage" replaces the source-notes ambiguity around "Hunt"; Treasure carries the "Hunt" suffix.)*
- **Formations** (5): Beginner / Standard / Fire Fight / Missile Fest / Beat the Clock.
- **Game lengths** (4): Skirmish / Melee / Battle / Campaign.
- **Arena types** (3 visible): Rubble / Suburbs / Computer. (More may exist; flag as INFERRED-only-three-confirmed.)
- **Brain options** visible: Human / Stupid. Other AI tiers may exist (OPEN QUESTION).
- **Turn length** dialog: configurable **1 to 40 seconds**, 15 is the Beginner default.
- **Quick Start** uses formation-default rosters ("Team Roster: 1 Missile Robot, 1 Auto Robot, 1 Burst Robot, 1 Rifle Robot" for Melee).
- **Custom Game** exposes per-robot class assignment + naming + roster size up to 8 (matches Campaign).
- **Team setup fields**: Team Name, Color, Side, Brain, Home (home-area selector with map preview).
- Survival shows "Settings: No Settings"; other sport modes likely have mode-specific configs.
- Buttons: "Return To Quick Start", "Start Game", "Options", "View Arena".

Product naming clarification:
- **The product was sold as "RoboSport"**; the Mac engine's window title was **"Cyborgs"** (codename). RoboArena (this clone) is distinct from both.

**Existing 18 screenshots — encoded observations**:

| Screenshot                                                  | Observation                                                         | Affects                          |
|-------------------------------------------------------------|---------------------------------------------------------------------|----------------------------------|
| `Reach Time limit message and timeline at 15.25.png`        | Turn timeline budget is **15.25 s** (not exactly 15)                | Timing model; tick rate          |
| `Dropping Robot Takes 2 seconds.png`                        | Deployment/placement consumes **2 s** of the timeline               | Command budgeting; placement     |
| `Scan and Fire Rifle Weapon Dialog - max time is remaining timeline.png` | Action max-duration is bounded by remaining timeline budget | All actions consume budget       |
| `Fire Missile Select Target - option for repeated firing.png` | Missile fire dialog supports a **repeated-firing** option         | Weapon command model             |
| `Unable to Reach Position error.png`                        | Path validity is checked at **command-edit time**, not runtime      | Planner UX; A* preview           |
| `Move Robot - See timeline and x y coordinates.png`         | Visible **(x, y)** coords during planning → tile-based grid         | Movement model                   |
| `Movie Controls.png`                                        | Movie playback has dedicated transport controls                     | UI/UX; replay                    |
| `Save Movie.png`                                            | Movies can be **saved** (replay export)                             | Replay model                     |
| `End Turn Dialog.png`                                       | Explicit end-turn confirmation step                                 | Turn loop                        |
| `Opening Screen - Shows Top Menu timeline controls upper left map.png` | Layout: top menu / timeline upper-left / map dominant     | UI/UX layout                     |
| `Menu - File.png` / `Edit.png` / `Robots.png` / `Turn.png`  | Menu structure: **File / Edit / Robots / Turn**                     | UI/UX; IA                        |
| `Movie Showing both robots and more map.png`                | Movie viewport spans the arena (camera follows action)              | Renderer                         |
| `Select Robot Placement.png` / `…in Home Area.png`          | Placement is constrained to a **home area** at deploy time          | Match setup                      |
| `Scan and Fire Missile Weapon.png`                          | Scan + fire are presented as a combined action dialog               | Command model                    |

These will be entered into `references/screenshot-index.md` and the mechanics docs as part of the deliverables below.

---

## Engine constants — v1 canonical stats (folded from empirical tests)

This block is the single source of truth for the engine's data tables. `data-model.md` and `resolution-engine-spec.md` should consume these values verbatim.

### Robot classes (point-buy)

| Class | Primary weapon | Accuracy | Armor (HP) | Rating | Special |
|---|---|---|---|---:|---|
| Rifle | Rifle | High | 140 | 40 | — |
| Burst | Burst Gun | Medium | 120 | 50 | — |
| Auto | Auto Rifle (in-game label "Machine Gun") | Low | 100 | 60 | — |
| Missile | Missile Launcher (+ Rifle secondary per manual) | Medium | 100 | 80 | 3 missiles ammo |
| Stealth | Burst Gun | Medium | 120 | 100 | **Invisible unless moving or scanned from an adjacent square** (Compute! review) |

Team Rating (Custom Game) = sum of robot ratings, ≤ team's rating cap (budget cap).

### Combat resolution model (revised, two independent dials)

The original game has two **independent** combat dials, not one:

1. **Scan-cone position → hit chance** (where the target sits within the firing arc)
2. **Distance → damage bracket** (full vs partial damage)

Plus a **posture modifier on damage range** (lower posture = lower damage end-to-end).

#### Scan cone geometry (CONFIRMED via Tools-panel scan icon)

The icon shows a **180° forward semicircle**, sub-divided:
- **Inner 90° (BLACK)**: optimum aim. **Hit chance = 1.0** for stationary standing targets (Match 5: 5/5 hits).
- **Outer 45° each side (GREY)**: peripheral aim. **Hit chance = 0.2** (Match 5: 1/5 + prior 1/6 = 2/11 = 18%).
- **Outside 180°**: angle blocked, cannot fire.

Match 5 also confirmed: **damage values are identical between black and grey zones** (grey hit landed for 26 dmg, same magnitude as black hits at the same distance). Scan position is purely a hit-chance dial.

#### Damage bracket by distance

Each on-tile hit rolls full or partial damage:

```
P(full)(d) = clamp01(1 − d / 17)
   d=1  → 0.94
   d=6  → 0.65
   d=10 → 0.41
   d=17 → 0.00
```

Brackets are weapon × posture specific.

#### Posture as damage modifier (NOT hit-chance)

Posture lowers the damage range — both ends shift down. Lower posture = smaller hit, smaller damage. (This replaces the earlier "85% / 70% hit-chance multiplier" idea.)

| Posture | Damage shift |
|---|---|
| Standing | baseline range |
| Ducking | both bracket ends shift **−2 to −3** |
| Crouching | both bracket ends shift **−4 to −6** |

#### Per-weapon damage table

| Weapon | Full bracket (standing) | Partial bracket (standing) | Bullets/click | Firing interval | Max range | Ammo |
|---|---|---|---:|---|---:|---|
| Rifle | **18-25** | **10-17** | 1 | 0.7 / 0.3 s alt | 18 | unlimited |
| Burst Gun | per-bullet ~7-10 full / ~3-6 partial (×3 bullets, each independent hit + bracket roll) | (per-bullet) | **3** | 0.15 / 0.55 s alt | 18 | unlimited |
| Auto Rifle | ~18-25 full / ~10-17 partial | (similar to Rifle, single bullet) | 1 | TBD | 18 | unlimited |
| Missile | r=0: 55-80 · r=1: 40-60 · r=2: 13-17 · r≥3: 0 (no full/partial split for explosives) | — | n/a | TBD | 18 | 3 |
| Grenade | ~80% of Missile damages, tunable | — | n/a | TBD | 18 | limited |

#### Hit/miss reality

- **Standing target on tile + black reticle = ~100% hit** (the "shot went past" cases were the target moving out of the tile, not a true miss).
- **Ducking / crouching targets** still get full hit chance from black reticle, but their damage range is smaller (above).
- **Misses** come from: target left the tile (Aim & Fire), grey reticle, or "angle blocked" outside the cone.

#### Two firing modes (manual-confirmed)

- **Aim & Fire** (tile-targeted): `TileProjectile { targetTile, impactTick }`. No tracking — bullet hits the original tile regardless of whether the target moved. Used for static positions, predicted intercepts, area denial.
- **Scan & Fire** (enemy-targeted): `TrackingProjectile { targetRobotId }`. Robot waits in scan mode; when an enemy enters scan cone × range, fires **at the enemy** and the bullet tracks the target's tile each tick until impact. Acquires moving targets.

### Postures

**v1 ships 2 postures, not 3.** The original had Standing / Ducking / Crouching, but DOS testing showed Ducking has no movement penalty, no fire-time penalty, and gets bush-cover miss chance that Standing doesn't. Ducking strictly dominates Standing — keeping it would be a cluttered choice. The clone collapses Standing+Ducking into a single default "Standing" posture and keeps Crouching as the meaningful tradeoff.

| Posture | Movement | Damage taken |
|---|---|---|
| **Standing** (default) | full speed on all passable terrain | baseline brackets (full 18-25 / partial 10-17 for Rifle) |
| **Crouching** | **only flat/grass** — blocked by walls, low walls, bushes, rough, crevices, fences | **shifted-down brackets** (full ~14-21 / partial ~7-13 for Rifle) — ~25% lower across the board |

**Damage reduction comes from posture, not from cover terrain.** A crouching target on open ground takes the same damage as a crouching target behind a bush (Match 7 confirmed: 10-13 in both cases at d=6-7). The "behind cover" mechanic from the manual doesn't materialize empirically; engine ignores it.

### Cover terrain — what it actually does

Cover splits into two effects:
- **Target-tile cover**: target IS standing/crouching on the cover tile.
- **In-transit cover**: cover tile sits between shooter and target (in the bullet path).

Cover effects only apply when the target is **CROUCHING**. Standing targets ignore cover entirely.

| Terrain | Target ON the tile (target-tile cover) | In bullet path (in-transit cover) |
|---|---|---|
| **Bush** | **~30% miss chance** (Match 6 confirmed: 1/3 missed at d=5) | **None** — bushes don't shield robots behind them (Match 7 confirmed) |
| **Low wall** | **~50% miss chance** (Match 7: 4/8 missed when ON low wall) | **~90% miss chance** when crouched target is behind (Match 7: 1/10 hit) — the strongest non-wall cover effect |
| **Wall** | (unreachable — bullets are blocked before arriving) | **Bullet blocked entirely** — bullets fired through a wall never reach the target tile. Engine traces tile-by-tile; first wall in path absorbs the bullet. |
| **Crevice** | None | None — **bullets pass through cleanly** (manual: "robots can sight across them"). |
| **Rough Ground** | **+20% damage taken** (vulnerable, all postures) | None |
| **Open Ground** | None | None |

**Combining target-tile and in-transit cover**: take the **stronger** of the two miss chances (max), don't stack. So a crouched target on a bush behind a low wall gets the 90% behind-low-wall effect, not 30 + 90.

**Crouching on low walls is allowed** (occupancy), even though crouched robots can't *walk onto* a low wall (traversal). Placement-time positioning or in-place posture change from standing can put a crouched robot on a low wall.

### Combined firing resolution

```
function resolveShot(shooter, targetTile, projectile):
  // 1. Angle check
  if scanAngle(shooter.heading, targetTile) > 90°: return ANGLE_BLOCKED

  // 2. LoS / wall blocking + in-transit cover detection — bullet path tile-by-tile
  pathHasLowWall = false
  for tile in straightLine(shooter.tile, targetTile, exclusiveOfEndpoints):
    if tile.terrain === WALL: return BLOCKED_BY_WALL  // bullet absorbed mid-flight
    if tile.terrain === LOW_WALL: pathHasLowWall = true

  // 3. Hit chance from scan zone
  hitChance = (scanAngle ≤ 45°) ? 1.0 : 0.2  // BLACK vs GREY zones
  if random() ≥ hitChance: return MISS

  // 4. Cover miss chance — only applies if target is crouching
  coverMissChance = 0
  if target.posture === CROUCHING:
    targetTileMiss = {
      bush: 0.30,
      lowWall: 0.50,
      other: 0.0
    }[targetTile.terrain]
    // In-transit: low wall in path = strong behind cover (90%). Bushes/crevices = no transit effect.
    inTransitMiss = pathHasLowWall ? 0.90 : 0.0
    coverMissChance = max(targetTileMiss, inTransitMiss)
  if random() < coverMissChance: return MISS

  // 5. Damage roll
  P_full = clamp01(1 − distance / 17)
  bracket = (random() < P_full) ? FULL : PARTIAL
  range = weapon.brackets[bracket][target.posture]   // standing or crouching range
  damage = uniform(range.min, range.max)

  // 6. Rough-ground vulnerability
  if targetTile.terrain === ROUGH: damage *= 1.2

  return HIT { damage }
```

### Ducking — deferred to v2 (kept here for completeness)

The original game has a Ducking posture between Standing and Crouching. We're omitting it from v1 because every measurable axis (movement speed, fire-time, terrain restrictions) is identical to Standing, except that Ducking-on-bush gets bush's miss-chance cover. That's the only differentiator, and it doesn't justify a third posture in modern UX terms.

**To restore Ducking in v2**:
1. Change `RobotState.posture` from `'standing' | 'crouching'` to `'standing' | 'ducking' | 'crouching'`.
2. Mid-tier brackets: Ducking damage range = Standing minus ~10% (e.g., Rifle full 16-22, partial 8-15).
3. Ducking gets cover miss-chance from bush/low-wall (same as crouching).
4. Ducking has no movement restrictions (same as standing).
5. Posture-change cost stays 0.1 s per height step → standing↔ducking 0.1s, ducking↔crouching 0.1s, standing↔crouching 0.2s (already specced).
6. UI: re-add the middle posture icon to the Tools panel.

The engine code paths for cover-effect and damage-bracket modifier work the same way — Ducking just slots in as another posture key in the lookup tables. Low-cost reintroduction.

Posture change cost: **0.1 s per height step** (standing→crouching = 0.2 s).

### Terrain

| Terrain | Movement (standing) | Movement (crouching, traversal) | Crouched-target ON tile | In bullet path (target behind it) |
|---|---|---|---|---|
| Open Ground | full speed (0.3/0.7 alt) | full speed (0.3/0.7 alt) | none | none |
| Rough Ground | full speed | **blocked** | +20% damage taken (vulnerable, all postures) | none |
| Low Walls | full speed when crossing | **blocked from walking onto**, but **occupancy allowed** (placement / in-place posture change) | **~50% miss chance** when crouching | **~90% miss chance** when target crouching behind it — strongest non-wall cover |
| Walls | **impassable** | **impassable** | (unreachable — bullets blocked first) | **bullet blocked entirely** in transit |
| Bushes | full speed | **blocked** | **~30% miss chance** when crouching | none — bushes don't shield from behind |
| Crevice | **impassable** | **impassable** | none | none — bullets and LoS pass through |
| Outer Wall | impassable except Dock↔Field | same | — | — |

**Movement step costs do NOT vary by terrain for standing posture** (DOS-confirmed). Crouching can only walk onto Open Ground.

**Cover effects only apply when target is CROUCHING.** Standing targets ignore all cover terrain. Take the **max** of target-tile and in-transit miss chances (don't stack). Bushes have no in-transit effect; low walls have a strong in-transit effect.

### Movement and timing

| Quantity | Value | Notes |
|---|---|---|
| Internal tick rate | 20 ticks/s (0.05 s/tick) | Smallest observed cost = 1 tick |
| Movie playback | 12 fps | Decimated from sim ticks |
| Turn budget (Beginner default) | 15.0 s = 300 ticks | Hard cutoff; planner shows overflow greyed out |
| Turn budget (other formations) | configurable 1–40 s | Per Turn Length dialog |
| Deployment cost | 2.0 s = 40 ticks | One-time per robot per match |
| Single-tile move (open ground) | **0.3 / 0.7 s alternating** | Stride parity per robot, persists across non-move commands |
| Double-tile move (open ground) | **0.4 / 0.8 s alternating** | Pathfinder chunks runs into doubles |
| Scan rotation per direction | 0.05 s = 1 tick | 8 cardinal+diagonal directions |
| Aim & Fire timeline cost | per-weapon firing intervals (above) | Repeat-fire = Ctrl+Shift on DOS |

### Combat resolution

| Rule | Value |
|---|---|
| **Robot-vs-robot collision** | **None.** Robots pass through and can stack |
| **Bullet path** | Hits **only the target tile**; passes through any robots and rough/bush/crevice tiles in between |
| **Friendly fire (bullets)** | No damage; no LoS block — friendlies are transparent to bullets |
| **Friendly fire (explosives)** | Damage all robots in blast radius regardless of team |
| **Hit chance** | scan-zone based: BLACK (inner 90°) = 1.0 · GREY (outer 45° each) = 0.2 · outside 180° = "angle blocked" |
| **Cover miss-chance** (only when target is CROUCHING) | target-tile: bush 30% · low wall 50% · other 0% · in-transit: low wall 90% (target behind) · max of the two applies |
| **Wall blocking** | bullets traced tile-by-tile; first wall in path stops the bullet entirely |
| **Damage formula** | `bracket = (random() < clamp01(1 − d / 17)) ? FULL : PARTIAL; damage = uniform(weapon.brackets[bracket][posture])` |
| Distance damage falloff | `P(full)(d) = clamp01(1 − d / 17)` — full bracket at d=1, partial at d=17 |
| Posture damage shift | Standing = baseline brackets · Crouching = brackets shifted ~25% lower |
| Rough-ground vulnerability | target on rough ground takes **+20%** damage |
| Missile blast distance metric | **Chebyshev** (king-move; default until Match 5 says otherwise) |
| Missile blast radius | 2 (no damage at radius ≥ 3) |
| Stacked-tile firing | All robots on target tile take a damage roll (default) |
| Firing arc | 180° forward semicircle from scan heading (default; tunable) |

### Damage feedback

Engine emits structured events; renderer shows visuals.

| Event | Renderer treatment |
|---|---|
| `Hit { damage }` | small **explosion sprite** at impact tile (2-3 tick burst). Replaces the original game's "Ha!"/"Ow!" speech bubbles — those were charming gimmicks, modern clone uses a tighter visual cue |
| `Destroyed { robot }` | larger **destruction sprite** + robot returns to Dock (engine removes from playing field) |
| `Miss { reason: 'targetMoved' \| 'greyReticle' \| 'angleBlocked' }` | optional small puff at target tile (purely cosmetic) |

### Arena

| Length | Tiles | Robots/team | Default formation roster |
|---|---|---:|---|
| Skirmish | TBD | 2 | TBD |
| Melee | 25×25 (Rubble Two) | 4 | 1 Rifle / 1 Burst / 1 Auto / 1 Missile |
| Battle | 32×32 (Rubble Three) | 6 | 2 Rifle / 2 Burst / 1 Auto / 1 Missile |
| Campaign | TBD | 8 | 3 Rifle / 2 Burst / 2 Auto / 1 Missile |

Arena types: Rubble Town, Suburbs, Computer Town. Each has multiple sizes (one per Game Length).

Arena anatomy: **Dock** (pre-deploy + destroyed-robot return) + **Playing Field** + **4 Home Areas** (assigned clockwise by team list order). First move from Dock must enter Home Area.

---

## Approach

Three workstreams, executed in order when plan mode exits:

1. **Ingest screenshot evidence** into `references/screenshot-index.md`, `references/source-matrix.csv`, and the mechanics docs (as INFERRED) so all docs downstream reference one source of truth.
2. **Produce the 12 specification documents** listed below. Every rule labeled with a confidence tag. Anything not in the existing docs and not in the screenshot evidence is either PROPOSED (a design choice for the clone) or OPEN QUESTION (needs research or empirical testing).
3. **Reconcile overlaps**: the existing `docs/confirmed-mechanics.md` is narrower than the requested `docs/original-mechanics.md`. Plan: keep `confirmed-mechanics.md` for the source-backed-only subset, and let `original-mechanics.md` be the comprehensive labeled view. Same for `open-questions.md` → `open-research-questions.md` (broader, prioritized P0/P1/P2).

---

## Deliverables

### `/docs/product-vision.md` (NEW)
- Plain-English description of RoboArena: who it's for, what makes it RoboSport-like, the player fantasy (program → watch → adapt).
- Explicit non-goals: not a copyright/asset/name clone of RoboSport; not real-time twitch combat; not a roguelike; no monetization at launch.
- Pillars: simultaneous-turn programming, 15-second movie, deterministic playback, hot-seat first, web-deliverable.

### `/docs/original-mechanics.md` (NEW; supersedes scope of `confirmed-mechanics.md`)
- Full catalog of original-game mechanics with every entry labeled CONFIRMED / INFERRED / PROPOSED / OPEN QUESTION.
- Sections: structure, teams/players, game lengths, modes, formations, postures, scan/aim, weapons, friendly fire, visibility, placement/deployment, turn cadence, end-turn flow.
- Includes the new INFERRED rows from the screenshot table above.
- `confirmed-mechanics.md` retained as the strict subset (CONFIRMED only) and cross-linked.

### `/docs/open-research-questions.md` (NEW; supersedes scope of `open-questions.md`)
- Same questions plus new ones implied by screenshot ingest (e.g., "Is 15.25 s the canonical Windows turn budget across modes?").
- Prioritized:
  - **P0 — blocks architecture**: tick rate, collision rules, swap, follow-the-leader, action budget arithmetic, projectile timing, simultaneity.
  - **P1 — affects fidelity**: damage formulas, scan geometry, posture-vs-terrain table, weapon firing rates, friendly-bullet-blocking.
  - **P2 — tunable later**: scoring details for Treasure/Hunt/CTF/Baseball, AI difficulty curves, formation balance.
- Each item lists resolution path: manual lookup (RoboSport-Reference.7z, ROBO.TXT), screenshot/video analysis, or empirical test in DOSBox/Wine.

### `/docs/game-design-spec.md` (NEW — main GDD)
Sections required by the prompt:
- Game loop (program → resolve → movie → next turn)
- Match setup, teams, robots, formations, objective modes
- Robot command programming + 15-second movie
- Movement, posture, scanning/visibility, weapons
- Damage/destruction, victory/scoring
- Hot-seat play, AI, replay
- Every rule carries a confidence label.

### `/docs/resolution-engine-spec.md` (NEW — most important file)
- Tick model: **20 ticks/s (0.05 s/tick)** — the finest observed cost (scan rotation = 0.05 s) is exactly 1 tick. 20 tps × 15.0 s = **300 ticks/turn** (Beginner default). Movie playback at 12 fps for original feel, decimated from the 20 fps simulation. Custom-time formations scale ticks proportionally (max 40 s = 800 ticks).
- Robot command timeline as ordered `RobotCommandSegment[]` with start/end ticks.
- Per-tick phase order: read intents → resolve movement → commit → update facing/posture/scan → resolve fire/projectiles → apply damage simultaneously → cleanup deaths → update visibility → emit events.
- **No movement-conflict resolution** (CONFIRMED via DOS empirical test): robots pass through each other and can stack on the same tile. The engine resolves each robot's program independently per tick. Drop the entire conflict-resolver module.
- Terrain blocking via canonical terrain table (CONFIRMED via in-game help dialogs); posture-vs-terrain rules locked.
- Projectile model: launch tick, travel ticks, impact tick, blast radius, falloff (all PROPOSED).
- Determinism contract: integer math, seedable RNG, no `Date.now()`, no Math.random in engine.
- ~25 unit-test scenarios enumerated (see test-plan.md cross-reference).

### `/docs/technical-architecture.md` (NEW)
- Stack: TypeScript everywhere; Next.js 16 + React 19 + Tailwind v4 (already pinned by `AGENTS.md`/`CLAUDE.md`); **PixiJS** for the arena renderer (locked in with the user); Vitest for engine tests.
- Monorepo-style layout inside one Next.js app:
  ```
  src/
    engine/           # pure-TS deterministic sim (no React, no DOM)
      state/, commands/, resolvers/, events/, rng/, index.ts
    planner/          # turn-programming UI logic (still framework-free where possible)
    renderer/         # Canvas2D draw layer; consumes EventTimeline
    ai/               # bot players; consumes engine snapshots only
    app/              # Next.js routes (menu, setup, match, replay)
    components/       # React UI
  ```
- Hard rules: `engine/` imports nothing from `app/`, `components/`, `renderer/`. Renderer subscribes to immutable event frames.
- State model = `MatchState` (immutable per tick, structurally shared).
- Replay = `{ matchConfig, seed, turnOrders[] }`.
- Multiplayer (Phase 6): server-authoritative, client submits `TurnOrders`, server runs the same engine and broadcasts the resolved timeline. The pure engine package is the shared core.

### `/docs/data-model.md` (NEW)
TypeScript interfaces for: `GameConfig`, `MatchState`, `TeamState`, `RobotState`, `RobotDefinition`, `Formation`, `WeaponDefinition`, `CommandTimeline`, `RobotCommandSegment`, `TurnOrders`, `SimulationTick`, `ResolutionEvent` (discriminated union), `VisibilityState`, `ReplayLog`. Field-by-field with units (ticks, tiles) and confidence annotations on enum members.

`RobotDefinition` will encode the confirmed point-buy table (v1 = 5 classes including Stealth):
- `class: 'rifle' | 'burst' | 'auto' | 'missile' | 'stealth'`
- `accuracy: 'high' | 'medium' | 'low'` (descriptive only; engine uses scan-zone hit chance, not accuracy tiers)
- `weapon: WeaponId` (auto class uses `weapon = 'auto-rifle'`, displayed as "Machine Gun")
- `armor: number` (HP, integer)
- `rating: number` (point cost)
- `stealthVisibility?: 'standard' | 'stealth'` — Stealth class sets `'stealth'`, which triggers the move-or-adjacent visibility rule in the engine's visibility resolver.
- Some formations grant secondary weapons (Missile robots also carry rifles per manual): `secondaryWeapons?: WeaponId[]`.

**`RobotState.posture: 'standing' | 'crouching'`** — 2-value enum (v1 simplification, see Posture section above).

`RobotCommandSegment` (v1 vocabulary — standard battle mode only; manual-aligned naming):
- `{ kind: 'move'; path: TileCoord[]; posture: Posture }`
- `{ kind: 'set-posture'; posture: 'standing' | 'ducking' | 'crouching' }`
- `{ kind: 'set-scan-direction'; direction: Heading }`
- `{ kind: 'aim-and-fire'; target: TileCoord; weapon: WeaponId; repeat: boolean }` — direct shot at target; `repeat=true` for the Alt-key repeat-firing variant.
- `{ kind: 'scan-and-fire'; maxDistance: number; seconds: number; weapon: WeaponId }` — wait-and-shoot in current scan direction; fires automatically when an enemy enters range.

**Deferred (other sport modes, not v1)**: zap-enemy, place-bomb, self-destruct, hostage-rescue, treasure-pickup, base-tag, baseball-specific commands. Re-evaluate when those modes are scheduled.

`ArenaTile` (v1, manual-aligned terrain list):
- `terrain: 'wall' | 'low-wall' | 'open-ground' | 'rough-ground' | 'crevice' | 'bush' | 'fence'`
- Per-terrain effects: blocks-movement (yes/no by posture), blocks-LoS, accuracy-modifier-when-occupant.
- `obstacle?: 'crate'` — placeable cover that blocks movement and bullets.
- **No door field.** Wall-mounted blue fixtures are decorative; they live in `decoration` if at all and have no engine effect.

`Arena` top-level structure (CONFIRMED from manual):
- `dock: TileCoord[]` — robots wait here pre-deploy and **return here when destroyed** (engine emits a `RobotReturnedToDock` event).
- `playingField: TileGrid` — the main combat area.
- `homeAreas: HomeArea[4]` — four corner regions, assigned clockwise by team-list position. First move from Dock must be into the team's Home Area.

`GameConfig` will encode the confirmed setup-axis enums:
- `sportType: 'survival' | 'treasure-hunt' | 'capture-the-flag' | 'hostage' | 'baseball'` *(v1 ships Survival only; the others are stubs that map to mode-specific commands deferred from v1)*
- `formation: 'beginner' | 'standard' | 'fire-fight' | 'missile-fest' | 'beat-the-clock'`
- `length: 'skirmish' | 'melee' | 'battle' | 'campaign'` → maps to robotsPerTeam {2, 4, 6, 8}
- `arenaType: 'rubble' | 'suburbs' | 'computer'` (more types OPEN QUESTION)
- `turnLengthSeconds: number` (1–40, default 15)
- `brain: 'human' | 'stupid'` per team (more tiers OPEN QUESTION)
- `teamRating: number` (Custom Game; constraint: sum of robots' ratings ≤ teamRating)
- `side: 1 | 2 | 3 | 4` per team — **alliance axis** distinct from team identity (CONFIRMED via "Side 1 / Side 2" labels on Quick Start). Multiple teams may share a Side.

Multiplayer transport (Phase 6, derived from Edit menu evidence):
- Original supported **Serial / Modem / AppleTalk**. Clone targets: WebRTC peer-to-peer (replaces Serial), WebSocket relay (replaces Modem dial-up), and LAN-via-server (replaces AppleTalk). The engine is transport-agnostic; a `NetworkAdapter` interface fronts all three.

Persistence formats:
- **Scenario file** (CONFIRMED concept): authored content — arena layout, default rosters, objective settings. Editable in a Scenario editor (post-MVP).
- **Game save** (CONFIRMED concept): in-progress match state including completed turns and pending orders.
- **Replay/Movie**: serialized event log (clone-only; replaces the original "16-color movie" format).

### `/docs/ui-ux-spec.md` (NEW)
Screen-by-screen: main menu, new game setup, team setup, formation selection, arena selection, placement/deployment, turn programming (timeline editor with the 15.25-s ruler observed in screenshots), scan/facing/aim controls, weapon controls, movie playback (with Movie Controls observed), replay browser, results screen. Layout cues taken from the indexed screenshots (top menu / timeline upper-left / map-dominant). All clickable elements get `cursor-pointer` per `CLAUDE.md`.

### `/docs/research-video-analysis-guide.md` (NEW)
- Naming convention: `screenshots/video-{source}-{timestamp}-{description}.png` (the existing `youtube-0123-…` style is folded in as a special case).
- Per-screenshot record template: video URL, timestamp, UI/state shown, visible labels, inferred mechanics, confidence.
- Priority capture list (game setup, team setup, formation, arena, placement, command edit, timeline bar, scan/aim, weapon fire, movie playback, fog/visibility, damage, scoring screen).
- Workflow: capture → name → add row to `references/screenshot-index.md` → if it changes a mechanic, update `original-mechanics.md` and `source-matrix.csv`.

### `/docs/implementation-roadmap.md` (NEW)
**Updated for human-vs-human v1**:
- Phase 0 — spec completion (current).
- Phase 1 — deterministic engine prototype (pure TS, no UI, ~10 unit tests).
- Phase 2 — hot-seat playable (single-device, both players take turns, full UI for setup → planning → movie).
- Phase 3 — online lobby + sync (room links, two-player WebRTC or WebSocket relay, server-authoritative resolution using the same engine package). **Required for v1** since there's no AI.
- Phase 4 — replay system (save + share movie URLs, standalone replay viewer route).
- Phase 5 — UI polish + accessibility.
- Phase 6 — AI (Stupid first, later tiers post-v1).
- Phase 7 — content/balance + sport modes beyond Survival.

Each phase: deliverables, acceptance criteria, risks, dependencies.

### `/docs/test-plan.md` (NEW — engine + integration; distinct from the existing original-game empirical plan)
- Engine unit tests covering every scenario in resolution-engine-spec.md (movement/swap/follow/chain/cycle/terrain/posture/LoS/scan/fire timing/sim damage/death cleanup/explosion/replay determinism/visibility).
- Integration tests: full-turn playback, replay byte-equality across seeds, multi-team objective scoring.
- Manual playtest scripts cross-referenced to `tests/original-game-test-plan.md` for parity checks.
- Tooling: Vitest (lighter than Jest for pure TS) — final tooling decision noted as a small OPEN QUESTION but Vitest recommended.

### `/planning/codex-next-steps.md` (NEW)
Final handoff for the next coding session:
- What's decided · what's still unknown · exact first implementation tasks (engine package skeleton, `MatchState` types, `MovementResolver` first, golden-frame test harness) · first files to create · first tests to write (same-destination, swap, follow-leader, chain, mutual-kill, bullet-friendly, explosive-friendly, death-cleanup) · what NOT to do yet (no UI, no networking, no AI, no Pixi).

### Cross-cutting updates
- `references/screenshot-index.md` — fill the table with all 18 captured screenshots.
- `references/source-matrix.csv` — add INFERRED rows for 15.25-s budget, 2-s deploy, action-budget arithmetic, missile repeat-fire option, command-time path validation, tile-based (x,y).
- `docs/confirmed-mechanics.md` — link to `original-mechanics.md` as the canonical comprehensive view; keep this file as the CONFIRMED-only subset.
- `docs/open-questions.md` — link to `open-research-questions.md` as the prioritized successor.

---

## Implementation-ready checklist (the closing artifact in `planning/codex-next-steps.md`)

- [ ] All 12 spec docs land with confidence labels on every rule.
- [ ] `references/screenshot-index.md` lists all current screenshots.
- [ ] P0 open questions either resolved or have a labeled PROPOSED default the engine can run on.
- [ ] Tick rate, turn duration, and command-budget arithmetic are concrete numbers in `resolution-engine-spec.md`.
- [ ] Engine package boundary (`src/engine/` imports nothing UI-side) is documented in `technical-architecture.md` and enforced by ESLint boundary rule (planned, not yet wired).
- [ ] Determinism contract (no `Date.now()`, no `Math.random` in engine, integer math, seedable RNG) stated and testable.
- [ ] First-PR scope defined in `planning/codex-next-steps.md` (engine skeleton + 8 unit tests, no UI).

---

## Files to be created or updated

**New (12)**: `docs/product-vision.md`, `docs/original-mechanics.md`, `docs/open-research-questions.md`, `docs/game-design-spec.md`, `docs/resolution-engine-spec.md`, `docs/technical-architecture.md`, `docs/data-model.md`, `docs/ui-ux-spec.md`, `docs/research-video-analysis-guide.md`, `docs/implementation-roadmap.md`, `docs/test-plan.md`, `planning/codex-next-steps.md`.

**Updated (4)**: `docs/confirmed-mechanics.md` (add cross-link), `docs/open-questions.md` (add cross-link), `references/screenshot-index.md` (fill table), `references/source-matrix.csv` (add INFERRED rows from screenshots).

**Untouched**: `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/source-notes.md`, `docs/resolution-rules-proposal.md` (kept as historical proposal; superseded content moves into `resolution-engine-spec.md` with cross-link), `prompts/*`, `tests/original-game-test-plan.md`, `screenshots/*.png`, `screenshots/README.md`.

**No code is written.** Tiny illustrative TypeScript snippets only inside `data-model.md` and `resolution-engine-spec.md`.

---

## Top unresolved questions to surface in `open-research-questions.md`

(Several earlier P0/P1 items are now CONFIRMED; the remaining gaps are listed here.)

~~1. Same-tile collision rule~~ — **RESOLVED**: NO collision system. Robots pass through each other and can stack on a tile. Engine has no movement-conflict resolver.
~~2. Direct-swap behavior~~ — **RESOLVED**: same as Q1. No swap logic needed.
~~3. Movement speed per posture/weapon class~~ — **PARTIALLY RESOLVED**: 0.3/0.7 alternating on **open ground**, posture/class-independent. Slow-terrain (rough ground, low walls, bushes) multipliers still **OPEN** — see test T22.
~~4. Per-action time costs~~ — **MOSTLY RESOLVED**: deployment 2.0 s, movement 0.3/0.7 alternating, posture 0.1 s/step, scan rotation 0.05 s/step. **Aim & Fire and Scan & Fire timeline costs still OPEN** — test cases below.
~~5. Stealth class behavior~~ — **RESOLVED** (per Compute! review of Windows version): "invisible unless moving or scanned from an adjacent square." **Stealth is in v1** as the 5th class. Engine visibility resolver gets a per-target `stealthVisibility` check.
6. **P0** — How "Accuracy: High/Medium/Low" translates to hit math (deterministic falloff curve? RNG-driven? interaction with posture and distance?).
~~7. Friendly-bullet LoS blocking~~ — **RESOLVED**: friendly bodies are NOT LoS blockers. Bullets pass through friendlies cleanly (no damage, no block).
~~8. Scan geometry — arc shape~~ — **PARTIALLY RESOLVED**: it's a **directional cone** centered on the robot's scan heading. Targeting cursor visually shows the cone (black/grey = inside, white = "angle blocked"). The cone gates **firing** (Aim & Fire), not just visibility. Exact cone angle still OPEN — test by sweeping target position around the cone edge and noting where the "angle blocked" message kicks in. Range is per-weapon (Rifle 17, Missile 6 already CONFIRMED).
~~9. Posture-vs-terrain matrix~~ — **RESOLVED** (DOS test): standing and ducking cross all non-wall terrain identically. Crouch can only cross flat/grass — not low walls, bushes, rough ground, crevices, fences.
10. **P1** — Damage values per weapon and missile blast radius / falloff.
11. **P1** — Weapon firing rates and missile flight times.
12. **P1** — Sport-mode win conditions and scoring for Treasure Hunt, Hostage, Capture the Flag, and Baseball.
13. **P1** — AI tiers beyond "Stupid" (does the original have Smart / Aggressive / etc.?).
~~14. Full arena-type list~~ — **RESOLVED** by Windows DOS distribution: exactly 3 types (Rubble Town / Suburbs / Computer Town). Each comes in multiple sizes (one size per Game Length × type).
15. **P2** — Multiplayer/play-by-mail format and protocol.
~~16. Team Rating constraint semantics~~ — **RESOLVED**: budget cap (sum ≤ team rating). Locked before plan exit.
~~17–19. Zap Enemy / Place Bomb / Self Destruct mechanics~~ — **DEFERRED**: out of scope for v1 (other sport modes only).
~~20. Scan command vs scan-state~~ — **RESOLVED** by manual: there are two firing modes — **Aim & Fire** (direct one-shot, with Alt-key repeat-firing variant) and **Scan & Fire** (wait-and-shoot in current scan direction with maxDistance + seconds). No separate "scan" command in v1.
~~21. Door mechanics~~ — **RESOLVED**: there are no doors. Blue squares are crates (obstacles); wall-mounted blue fixtures are decoration only.
22. **P1** — **Side** alliance axis: confirmed as alliance with ≥2 sides required and 2–3 teams allowed per side. Still OPEN: do allied teams share visibility? friendly-fire across same-side teams? share scoring?
~~23. Scenarios vs Games~~ — **PARTIALLY RESOLVED**: three persistence kinds (Team file, Game save, Scenario file). Manual covers Team and Game; Scenario contents still inferred (arena + objective + default rosters).
~~24. Edit-menu Cut/Copy/Paste~~ — **RESOLVED**: targets are program-bar segments (manual confirms click-to-end + Delete on the Program Bar). Cut/Copy/Paste should operate on the same selection.
~~25. Cross-version parity~~ — **DOWNGRADED to P2**: per user, **Mac (color) is canonical**, Windows is secondary, Amiga is oldest/historical. Use B&W Mac stat tables as the baseline; resolve any future conflict by deferring to Mac.
~~26. Exact arena dimensions per Game Length~~ — **PARTIAL**: Melee = **24×24** (CONFIRMED via DOS). Skirmish/Battle/Campaign still OPEN — test below.
~~27. Step-cost formula~~ — **RESOLVED**: 0.3 s / 0.7 s alternating per step (avg 0.5 s), independent of direction and terrain. Engine tracks `strideParity` per robot; reset rules still need a test.
28. **P0** — **Hit formula**: confirmed that distance reduces accuracy and that there are three accuracy tiers (High/Medium/Low). Exact base hit-rates, distance falloff curve, and posture multipliers are PROPOSED in the engine spec — empirical retuning needed.
29. **P1** — **Missile flight time** in ticks vs distance: animation shows multi-frame travel; per-tile travel cost is OPEN.
30. **P1** — **Combat dialog text** ("Ha!" / "Aaargh!"): are there other strings (e.g. spotted, surrendered, low health)? Affects the renderer's text-overlay event taxonomy.
31. **P1** — **Sport-mode naming**: Amiga manual uses "Treasure / Hunt"; Mac UI uses "Treasure Hunt / Hostage". Are these renames or distinct modes between versions? v1 adopts Mac names; manual hint that Hostage involves "rescuing Hostages".
32. **P0** — **Sides semantics in the engine**: do allied teams (same Side) share visibility? share scoring? bullet friendly-fire across same-Side teams? (Manual confirms Sides are alliances; gameplay rules per Side still OPEN.)
33. **P1** — **Multiplayer protocol details** are in **Manual Appendix B** (not in the SKID ROW dump). Locating Appendix B is the unblocker for Q15.
34. **P0** — **Stealth interaction with Scan & Fire**: does a Scan & Fire weapon auto-fire on a stealth that becomes visible mid-turn (because it moved or the firer became adjacent)? PROPOSED: yes — Scan & Fire sees the same `effectiveVisibility` set as the planner. Confirm post-empirical-tests.
34a. **P1** — **Stealth + missile blast**: a stealth in a missile blast radius takes damage normally even if invisible. PROPOSED: yes (damage is positional, not vision-based).
~~35. Aim & Fire timeline cost~~ — **PARTIALLY RESOLVED**: per-weapon alternating intervals confirmed for Rifle (0.7/0.3 s) and Burst (0.15/0.55 s). Auto / Missile / Grenade still pending; same alternating pattern expected.
36. **P1** — **Robot weapon loadouts per formation**: manual says 1–3 weapons depending on formation; Missile robots also carry Rifles. Need full per-formation loadout matrix.
37. **P0** — **Slow-terrain step-cost multipliers**: rough ground, low wall crossing, bushes — what's the exact 0.3/0.7-equivalent timing? See test T22.
38. **P0** — **Rough-ground "vulnerable to attack" modifier**: the help text explicitly says rough ground makes robots more vulnerable. Quantify the damage / hit-chance multiplier.
39. **P1** — **Cover stacking**: standing on a bush behind a low wall — does cover compose, max-out, or only the closest layer count?
40. **P1** — **Bush "on or behind" cover**: is the cover the same when occupying the bush tile vs being one tile beyond it from the shooter's perspective? Is "behind" defined by LoS or by adjacency?
41. **P0** — **Stacked-tile firing**: when multiple robots occupy a single tile and a shot lands there, does damage apply to all robots on the tile, only one (which?), or random? Test T9f (new).
42. **P0** — **Multi-tile move chunking**: 2-tile doubles cost 0.4/0.8 alt. Does the planner emit triples / quads? Cost? Or are doubles the only chunking?
43. **P0** — **Damage RNG variance**: Rifle did 21 then 14 damage at the same range; Auto did 28/25/23. Need a `damageMin / damageMax` per weapon. Test T4 expanded to record the full distribution.
44. **P1** — **Per-weapon firing intervals** for Auto, Missile, Grenade — same alternating pattern expected; record values.
45. **P1** — **Hit-chance curve vs distance**: Burst missed 6/6 at distance 8; Auto hit 3/3 at distance 4. Need 3-point distance × posture data per weapon to fit a falloff curve.
46. **P1** — **Scan cone width**: directional firing cone confirmed but exact angle (90° / 120° / 180°?) unknown. Quick test: target a tile directly behind the robot (180° from scan heading) — definitely "angle blocked". Sweep around to find the boundary. Default if skipped: **180° forward semicircle**.

---

## Verification (when plan exits)

- `ls docs/` shows the 11 new docs alongside the existing 4.
- `ls planning/` shows `codex-next-steps.md`.
- `references/screenshot-index.md` table has 18 rows.
- Spot-check: pick 5 random rules across the new docs; each has a confidence label and (where applicable) a source citation.
- Read `planning/codex-next-steps.md` end-to-end. A cold engineer can identify the first 8 unit tests to write without re-reading the GDD.
- No source files under `src/` exist yet (engine implementation is Phase 1, not part of this plan).

## Decisions locked (resolved before plan exit)

| Question | Decision |
|---|---|
| 2D renderer | **PixiJS** (WebGL-accelerated; tech-architecture doc commits to it) |
| Engine test runner | **Vitest** (replaces the Jest example in AGENTS.md) |
| P0 research method | **Multi-source**: screenshot deep-reads + online refs + user-captured video frames. **No emulator** — RoboArena is a modern web app, not a DOS wrapper |
| Visual direction | **Modernized top-down tile grid** (same camera as original) |
| Audio | **Deferred to post-MVP** |
| Team Rating constraint | **Budget cap** — sum of robot ratings ≤ team's Rating cap shown in Custom Game. Validation lives in setup UI; engine receives a finalized roster |
