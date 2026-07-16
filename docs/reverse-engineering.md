# RoboSport reverse-engineering findings

**Status:** living document. Records everything extracted from the original
*RoboSport for Windows* (1991) binary and data files, with exact byte offsets so
any of it can be re-derived or audited.

**Why this exists:** the game-logic constants (damage, hit chance, ranges,
terrain) were previously only *estimated* from manual DOS playtests (Match 1–7,
see `priority-tests.md`). Those playtests are internally consistent but slow and
noisy. This work instead reads the mechanics **directly out of the shipped
program**, which is the ground truth the playtests were approximating.

**Coverage map** (what's documented, and confidence):

| System | Section | State |
|---|---|---|
| RNG, distance metric | §3, §4 | ✅ exact |
| Robot stats (armor, accuracy) | §5 | ✅ exact |
| Hit chance (live-fire + preview tables) | §6, §7b | ✅ exact |
| Bullet damage | §7b | ✅ exact, including named weapon labels |
| Explosive/blast damage | §7 | ✅ exact |
| **Postures — 3 poses & cover-class mapping** | **§14–15** | ✅ stored enum + final terrain/posture table |
| **Cover / movement / terrain / armor → damage** | **§15** | ✅ model + tables (moving-target confirmed) |
| Terrain properties, arenas | §9, §10 | ✅ exact / extracted |
| **Sport modes (all 5)** | **§16** | ✅ inventory; Survival ceremony values exact |
| **Bot types & availability** | **§17** | ✅ identified & answered |
| Scan / line-of-sight / visibility | §18 | ✅ exact hard cone boundary + LoS model |
| **Timeline clock (60 Hz)** | **§19** | ✅ unit confirmed (was assumed 20 Hz) |
| **Named fire selectors and cadence** | **§19** | ✅ Aim + Scan selectors for all named weapons |
| Move / deploy / scan / posture costs | §8, §19 | ✅ exact command table + live dispatch |
| Diagonal endpoint cover sampling | §15 | ✅ exact major/corner sampling rule |
| **Outstanding-items master list** | **§20** | 📋 every assumption/TBD, prioritized |

All mechanics required by the main-game Survival combat/resolution core now
have a version-locked binary path or an explicit RoboArena presentation/data
boundary. The focused multiplayer trace also closes 2-4 Team Survival Side,
visibility, scoring, Home-slot, and ordering semantics. Stealth and
non-Survival logic are intentionally excluded and remain post-main-game
research inventory.

**How to reproduce:** all scripts live in `tools/re/`. They are plain-Python
(needs `pip install iced-x86` for the disassembler ones). The machine-readable
extract is `docs/extracted/robosport-data.json`; rendered arena maps are
`docs/extracted/arenas.txt`.

```bash
# regenerate the JSON data extract (robot stats, damage/hit tables, arenas)
python tools/re/export_data.py "RoboSport (1991)/games/RoboSpor/ROBOWIN" docs/extracted/robosport-data.json
# render all arena terrain grids
python tools/re/render_maps.py "RoboSport (1991)/games/RoboSpor/ROBOWIN/RUBBLE.TWN"
# disassemble around an offset (segment, offset, +/- N instrs), with call targets resolved
python tools/re/ne_reloc.py  ".../ROBO.EXE" ctxr 6 0x5F7E 30
# find ALL callers of a function (near + far + movable-entry indirection)
python tools/re/xref.py      ".../ROBO.EXE" callers 6 0x35D1
```

---

## 0. Executive summary — what this changes

| Area | Old spec (from playtests) | Binary truth | Action |
|---|---|---|---|
| **Distance metric** | Chebyshev (king-move) | **Floored Euclidean** `floor(√(dx²+dy²))` via a 32×32 lookup table | **Correct the engine.** Only matters on diagonals; row/column tests couldn't tell them apart. |
| **Rubble Two size** | 25×25 | **24×24** | Correct `constants.ts` + spec. |
| **Rubble Three size** | 32×32 | 32×32 ✅ | No change. |
| **Hit chance** | 2 zones (BLACK 1.0 / GREY 0.2) | **Score→probability tables** (two: a 20-step live-fire table `0x156E`, a 14-step planner-preview table `0x213A`) | Adopt the live-fire table; the 2-zone model is a coarse sampling of it. |
| **Bullet damage** (Rifle/Burst/Auto) | Empirical full/partial brackets | **Fully decoded** (this pass): rolled at *fire* time in `seg6:0x35D1`, `weaponRoll + posture± + distance±`, carried on the projectile, applied at impact | Replace the bracket model with the exact rolls (§7b). |
| **Robot armor** | 140/120/100/100/120 (from dialog) | **Confirmed byte-exact** in a stat table at DGROUP `0x0CA8` | Locks the values; also yields accuracy tiers. |
| **Explosive damage** | Estimated curve | **Exact base+random tables** at DGROUP `0x15EE`–`0x161A`; 3 weapon categories | Replace estimates. |
| **Weapon max range** | 18 (cursor probe) | **18, string-confirmed** ("Maximum range is 18") + code `cmp dx,0x12` | Locked. |
| **RNG** | mulberry32 (our choice) | Original is a 16-bit LFSR, **two independent streams** (game vs. effects) | Keep mulberry32 for *our* determinism; note the two-stream idea (below). |
| **Timeline clock** | 20 ticks/s (assumed) | **60 units/s** — time counted in 60ths of a second (RE §19) | Correct the tick rate; turn budget 15 s = 900 units. |
| **Terrain types** | 6 (+outer wall) | **7**: Ground, Rough, Low Wall, Wall, Bush, **Fence**, Crevice | Add Fence to the model (or consciously drop it). |
| **Postures** | drop Ducking → keep Standing/Crouching | 3 poses form a **mobility⇄cover dial**; Ducking = *mobile + partial cover* (Upright≡Ducking for movement, differ only in height/cover) | **Reconsider the 2-pose trim** — Ducking is not redundant (§14). Cheap to keep all 3 if cover is height-LoS (§15). |
| **Cover model** | flat per-terrain cover % | **Height-based line-of-sight** (`seg87:0x1CE0`): terrain heights (TIL `b0`) vs posture-derived robot height | Adopt the height model; it unifies posture + terrain cover (§15). |
| **Armor** | (HP pool) | Confirmed = HP pool, subtracted by shared `seg6:0x5A2B`; no damage-type interaction | No change; now confirmed. |
| **Arenas available** | Rubble Two/Three | **8 Rubble maps + Suburbs + Computer Town**, all extracted to terrain grids | Bank them; ship a subset. |

The MAP payload orientation is resolved: raw cells are `body[y*width+x]`, with
no transpose or flip. The runtime display adds an 8-tile border. The earlier
playtest mismatch was a coordinate/probe mismatch, not a file transform (§12).

---

## 1. The binary and its layout

Directory: `RoboSport (1991)/games/RoboSpor/ROBOWIN/`

| File | What it is |
|---|---|
| `ROBO.EXE` | The game. **NE (Win16 “New Executable”)**, 883,712 bytes, 101 segments. All game logic + the AI. |
| `PLAYER.EXE` | The stand-alone “RoboPlayer” movie viewer. Not needed for rules. |
| `RUBBLE.TWN`, `SUBURBS.TWN`, `COMPUTER.TWN` | Arena sets. Custom “RoboSport Resources” chunked format (see §10). Each holds 8 maps + tile art + tile-property tables. |
| `ROBOCOLR.PRS`, `ROBOMONO.PRS` | Color / monochrome sprite resource packs (same chunk format; robot & UI art). |
| `README.TXT` | Install notes; confirms cross-platform (Mac/Amiga/Windows) net play and the file list. |

**Title string** (file `0x8BAE9` area): `RoboSport for Windows (C) 1991 Edward Kilham, Maxis`. Version `1.00` (STR 3031).

### NE structure quick-reference (for the disassembly scripts)
- NE header at file `0x250`. 101 segments; segment table at header+`0x22`; sector-align shift = 9 (segments are 512-byte aligned).
- **Segment 101 is the sole DATA segment** (`flags 0x0D51`), file image at **`0x07D600`**. It maps to `DS:0` = **DGROUP**. Therefore any `DS`-relative offset `X` in the code (e.g. `[bx+0CA8h]`, `[3CD8h]`) lives at file **`0x07D600 + X`**. This is the single most important fact for reading data tables.
- Code segments are near-called internally (E8 rel16, *not* relocated) and far-called across segments (9A seg:off, *relocated*). `tools/re/ne_reloc.py` reads the per-segment relocation records so cross-segment `call 0:FFFF` placeholders resolve to `segN:offset`.

### Segment role map (corrected after the fire-resolution trace)
| Segment | Role (verified unless noted) |
|---|---|
| `seg6` | **Core combat resolution** — the bullet hit+damage resolver (`0x35D1`), projectile constructor (`0x1A08`), projectile-impact handler (`~0x5600`), the shared apply-damage-to-robot routine (`0x5A2B`), and the explosive-damage roller (`0x5F7E`) + blast loop (`0x5D73`). Also holds AI move-gen/scoring (its heavy RNG use). *Earlier draft mislabeled this "AI brain only" and called `0x35D1` "AI scoring" — both wrong; `0x35D1` is the live bullet resolver.* |
| `seg22` | **Movie playback / turn resolution + scoreboard** — steps the programmed turn, drives impacts, tallies the end-of-game stats ("Ows/Arghs", "shots hit for damage"). Uses the **second RNG stream** for cosmetic bits. *Earlier draft called this "effects/animation only" — it's the resolution driver.* |
| `seg7` | **Projectile animation interpolator** — per-frame sprite/position, with FX-stream jitter (cosmetic). *Not gameplay damage.* |
| `seg9` | Startup: allocates & fills the distance table and other globals. |
| `seg55` | **RNG** primitives (both streams). |
| `seg56` | **Distance** function (Euclidean). |
| `seg76` | **Targeting validator** — the pre-fire "out of range / angle blocked / sight blocked" statuses. |
| `seg87` | Combat geometry — LoS/path-trace + cover-flag classifier (`0x1BF8`), tile queries. |
| `seg96` | **Planner/AI hit-preview** grid builder (`0x09AF` + table `0x213A`). Builds a per-tile "can my shot land here?" map for targeting feedback — *not* the live fire roll. |
| `seg1` | Team-editor / stats display (`Armor: 140`, `Robot Rating of …`). |

---

## 2. Resource strings & dialogs (design enumerations)

Extracted with `tools/re/dump_res.py ROBO.EXE strings|dialogs|menus`. These pin
down every menu enumeration without guesswork.

**Sports** (STR 2001–2005): Survival · Treasure Hunt · Capture the Flag · Hostage · Baseball.
**Formations** (STR 2011–2015): Beginner · Standard · Fire Fight · Missile Fest · Beat the Clock.
**Game lengths** (STR 2021–2024): Skirmish · Melee · Battle · Campaign.
**Brains** (STR 329–333): Human · **Stupid · Ferocious · Crafty · Paranoid** (4 AI personalities).
**Robot classes** (STR 305–309 / 1013–1017): Rifle · Burst · Auto · Missile · Stealth.
**Weapon labels** (STR 605–609): Missile · Automatic · Burst · Rifle · Grenade. Also “Prod”, “Bomb”, “Zap” (self-destruct), “Time Bomb”.
**Postures** — height buttons “Tall” ×3 (DLG #52 “Tools”); STR 1640: *“Bushes slow movement of upright or ducking Robots, but stop movement of crouching Robots.”* ⇒ three heights: **Upright / Ducking / Crouching**.
**Scan directions** (STR/data `SCAN_U, SCAN_UR, SCAN_R, SCAN_DR, SCAN_D, SCAN_DL, SCAN_L, SCAN_UL`): **8 compass directions**.
**Terrain types** (STR 644–650): Ground · Rough Ground · Low Wall · Wall · Bush · **Fence** · Crevice (**7 types**).
**Targeting statuses** (STR 630–637): out of bounds · out of home · out of range · blocked · angle blocked · sight blocked · distance · Dock. (These are exactly the return codes of the seg76 validator — §6.)
**Max range** (STR 641): *“Target out of range. Maximum range is 18.”*

**Terrain help text (verbatim, authoritative semantics):**
- *Ground:* “provides no protection from enemy weapons or cover from scanning.”
- *Rough Ground:* “causes robots to move slowly. Crouching robots cannot move onto Rough ground.” + “makes a robot **vulnerable** to attack … offers no protection.”
- *Low Wall:* “Robots can cross over low walls in upright or duck position, but slowly. Robots cannot cross walls in crouch position.” + “provide **excellent** weapon and scanner cover.”
- *Wall:* “provide **complete** cover from scanning and **total** protection from weapons.” (impassable)
- *Bush:* “slow movement of upright/ducking, stop crouching” + “provide visual cover and weapon protection to Robots directly **on or behind** them.”
- *Fence:* “Robots cannot cross Fences. All weapons pass through fences, but have a **chance of striking the fence**. Fences provide **slight** cover.” (⇐ Fence is a partial in-transit blocker — new vs our spec.)
- *Crevice:* impassable, but LoS-transparent (robots sight across; consistent with our spec).

**Turn / time UI:** “Turn Length (1-%d Seconds)”, “Turn Clock”, “Time Limit”, “Score Limit”. **Damage bubbles:** “Ow”, “Argh” (STR 1422/1423) — the visual damage tells the playtests used. **Scan & Fire dialog** (DLG #38): fields *“Maximum Distance”* and *“Seconds”* (this is the Scan-and-Fire engagement cap, **not** weapon range — matches the range-correction note in `priority-tests.md`).

---

## 3. Random number generator

Two independent generators in `seg55`, each a 32-bit state treated as a
shift register with a fixed XOR tap.

| Stream | Function | State (DGROUP) | Purpose |
|---|---|---|---|
| **Game** | `seg55:0x0073` | `0x3CD8` (lo), `0x3CDA` (hi) | All gameplay randomness (damage, hit, AI). |
| **FX** | `seg55:0x00B5` | `0x3CD4`, `0x3CD6` | Cosmetic effects/animation only (`seg22`). |

Algorithm (game stream, verbatim from disassembly):

```
result = state       # returns 16-bit-ish decremented state (used as-is by callers)
if (state & 1):
    state = (state >> 1) ^ 0xA300_0000-style tap   # XOR 0xA300 into the high word after a 32-bit shift-right
else:
    state = state >> 1
```

Precisely: the 32-bit state in `(hi:lo)=(0x3CDA:0x3CD8)` is shifted right one bit
(`shr ax,1; rcr dx,1`), and when the pre-shift low bit was set, `0xA300` is XORed
into the high word. Callers take `AX = state-1` as the random value and then mask
it (`and ax, 2^n-1`) or reduce it (`% N`) to a range.

**Why two streams matters for us:** the original deliberately draws cosmetic
randomness from a separate generator so that visual effects can’t desync the
deterministic game simulation across networked machines. **We already get this
for free** by only ever calling our RNG inside the engine and never for
rendering — but it’s worth a comment in the renderer: *never* pull from the
engine RNG for particles/animation. Keep our mulberry32; we don’t need to match
their exact sequence (we’re not wire-compatible with 1991 saves).

Helper mask table at DGROUP **`0x2130`** = `[0,1,3,7,15,31,63,127,255]` (i.e.
`2ⁿ−1`), used for “random in `[0, 2ⁿ)`”.

---

## 4. Distance metric — **Euclidean, not Chebyshev**

Function **`seg56:0x02A0`** `dist(x1,y1,x2,y2)`:

1. `dx=|x2−x1|`, `dy=|y2−y1|`.
2. If either is 0 → return the other (axis-aligned fast path; here Euclidean==Chebyshev).
3. If both ≤ 32 → look up a **precomputed 32×32 byte table**: `table[(dy−1)*32 + (dx−1)] = floor(√(dx²+dy²))`.
4. If a coordinate exceeds 32 (large arenas), halve both and double the result (cheap scaling); if >63, clamp to 64.

The table is built once at startup in **`seg9:0x0485`**: a `GlobalAlloc(1024)`
then a double loop storing `isqrt((i+1)² + (j+1)²)` symmetrically. `isqrt`
(binary search, `seg9:0x0530`) returns **floor**.

**Consequence:** the “distance” the UI shows and the range check both use floored
Euclidean. Examples: (dx13,dy13) → `floor(√338)=18` (in range); (dx18,dy18) →
`floor(√648)=25` (out of range, >18); (dx18,dy0) → 18. Our engine must switch
`chebyshev()` → `floorEuclidean()` for range and for the damage-distance term.
The Match 1–7 data used straight rows (dy=0) so it never exercised the
difference — the empirical damage-vs-distance curve is still valid *as a function
of this distance*.

Callers of `seg56:0x02A0` (53 sites) include the targeting validator (§6), the
blast damage loop (§7), AI scoring, and visibility — confirming it’s **the**
distance primitive.

---

## 5. Robot class stats — table at DGROUP `0x0CA8`

5 classes × 4 bytes. **Column 0 (accuracy tier) and column 1 (armor) are
confirmed**; the armor column matches the known dialog values byte-for-byte.

| Class | Byte 0 = accuracy tier | Byte 1 = **armor (HP)** | Byte 2 | Byte 3 |
|---|---:|---:|---:|---:|
| Rifle   | 2 | **140** | 3 | 20 |
| Burst   | 1 | **120** | 2 | 18 |
| Auto    | 0 | **100** | 1 | 25 |
| Missile | 1 | **100** | 3 | 20 |
| Stealth | 1 | **120** | 0 | 0 |

- **Accuracy tier** feeds the hit model (§6): higher = more accurate. Ordering
  Rifle(2) > Burst/Missile/Stealth(1) > Auto(0) matches the manual’s
  High/Medium/Low and our spec’s accuracy tiers.
- **Armor** locks 140/120/100/100/120 — no change needed, now *confirmed* not
  *assumed*.
- **Bytes 2 & 3 — confirmed NOT used at runtime.** A full displacement scan of
  every code segment shows `0x0CAA` (col 2) and `0x0CAB` (col 3) are **never
  read**. Only col 0 (`0x0CA8`, accuracy) and col 1 (`0x0CA9`, armor) are
  referenced. So the earlier guess that byte 3 = per-shot damage is **wrong** —
  bullet damage comes from the weapon jump table (§7b), not this stat table.
  Bytes 2–3 are display/point-buy bookkeeping at most (col 1 armor is read by
  `seg1` for the "Armor: 140" label and by many segments for HP init/heal caps).
  *Resolves the previous §13 item #10.*

The point-buy **rating** (40/50/60/80/100) is *not* in this table — it’s either
computed or held elsewhere; not yet located. Our catalog already has ratings, so
this is low priority.

### Struct field offsets discovered during the trace

Partial, but enough to navigate. These are *heap struct* offsets (the game
`GlobalAlloc`s each robot and projectile and passes far pointers around).

**Robot struct** (fields referenced by combat code):
| Offset | Meaning (confidence) |
|---|---|
| `+0x02` | robot id / handle (confirmed) |
| `+0x08` | HP / armor current — read for compares (likely) |
| `+0x14` | robot count in a team list (context-dependent) |
| `+0x1A`, `+0x1C` | pixel/subtile position x, y (confirmed; movement scatter writes these) |
| `+0x1E` | damage-stagger firing count: damage sets 1–4; firing consumes one and halves hit score while nonzero |
| `+0x28` | **zero-based Side/alliance index (0..3)** — counted into a four-word Side array by `seg42:0x0A5E`, and compared by direct fire, Scan & Fire, blast attribution, visibility, and ceremony aggregation |
| `+0x2A`, `+0x2C` | tile row, col (confirmed — the targeting validator reads these) |
| `+0x2E` | terrain type under the robot (1/2/3), used in the accuracy score (confirmed) |
| `+0x5C` | sound/effect id (passed to `seg6:0x4060` after a hit) — *not* the weapon selector (earlier draft was wrong) |
| `+0x66`, `+0x68`, `+0x6C` | per-turn stat counters (shots fired / hit / damage) incremented at impact |

The equipped-weapon damage selector is *not* a single robot field; it flows
through the weapon-inventory lookup `seg13:0x060E` + the selector table at
DGROUP `0x7F4` (see §7b). Live-fire selectors occupy values **5..12**.

**Projectile struct** (16 bytes, built by `seg6:0x1A08`):
| Offset | Meaning |
|---|---|
| `+0x02` | owner/shooter id |
| `+0x04` | weapon/projectile **type** (drives the `seg7` animation switch) |
| `+0x06`, `+0x08` | origin tile x, y |
| `+0x0A`, `+0x0C` | target tile x, y |
| `+0x0E` | **hit flag** (byte) — did it connect? |
| `+0x0F` | **damage** (byte) — pre-rolled at fire time; applied at impact |

---

## 6. Hit-chance model (planner preview) — additive index + table

> **Heads-up: there are _two_ hit systems, and this section is the *preview* one.**
> `seg96:0x09AF` (below) builds the planner's "where can my shots land?" grid and
> feeds the AI. The **authoritative live-fire hit roll** used during movie
> playback is a *different* function with a *different, finer* table — see
> **[§7b](#7b-bullet-fire-hit--damage--fully-decoded)**. They share the same
> shape (a 0–N accuracy score indexing a probability table) but the numbers
> differ (preview: 14 steps, max 255 at `0x213A`; live: 20 steps, max 240 at
> `0x156E`). Implement combat from §7b; this section explains the preview/UI.

The preview accuracy roll lives in **`seg96:0x09AF`**. Instead of our 2-zone
(BLACK/GREY) model, it computes an **integer “accuracy index” 0–13**, then rolls
against a probability table.

**Probability table** — DGROUP **`0x213A`**, 14 bytes (thresholds out of 256):

| index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /256 | 0 | 8 | 16 | 24 | 32 | 40 | 48 | 56 | 64 | 96 | 128 | 160 | 208 | 255 |
| ≈ % | 0 | 3 | 6 | 9 | 12.5 | 15.6 | 18.75 | 21.9 | 25 | 37.5 | 50 | 62.5 | 81.25 | ~100 |

Roll: `hit = (game_rand() & 0xFF) < table[index]`.

**Index computation** (decoded; variable names are my interpretation, bp-offsets
are exact so a reviewer can re-trace):

The two arguments are, by bp-offset: `bandArg = [bp+0Ah]` (a small discrete
scan-band selector) and `sightArg = [bp+16h]` (the exact 0..16 scan-grid sight
strength from `seg87:0x19E3`).

```
# guards (both scan inputs must be nonzero, i.e. target is within the cone)
if bandArg == 0:   return MISS      # → "angle blocked"
if sightArg == 0:  return MISS

# base index from the scan band (jump table seg96:0x09D2, selector = bandArg)
index = { 1:2, 2:4, 3:6 }.get(bandArg, 10)     # ≥4 (dead-center) → 10

index -= (4 - sightArg/4)      # terrain sight strength: partial blockers subtract
if targetTileFlagA != 0:  index += 4          # target on exposed/rough tile → easier hit
elif targetTileFlagB == 1: index += 2
index -= (dist/4 - 2)          # closer = higher index (dist is the §4 Euclidean distance)
index  = clamp(index, 0, 13)

# indirect-weapon (class 4) penalty:
if weaponClass == 4:
    if targetTileFlagA == 0 and dist > 1: return MISS
    index = max(0, index - 4)

return (game_rand() & 0xFF) < table[index]
```

**What’s solid:** the table (exact), the clamp `[0,13]`, the roll
`rand&0xFF < table[idx]`, the distance term `−(dist/4−2)`, and that **two**
scan inputs feed it — a discrete band `bandArg` ∈ {0..≥4} and the integer
terrain sight strength `sightArg` ∈ {0..16}.

**What still needs one trace or a calibration playtest:** the exact source and
meaning of `bandArg`, and which robot field is
`weaponClass==4`
(candidate: Missile/Grenade indirect fire — consistent with the “can only hit
the exact tile at range” behavior we already flagged for Aim & Fire). Callers of
`seg96` will resolve this; noted in [§13](#13-for-the-reviewer-fable-checklist).

**Reconciliation with playtests:** a Rifle (tier 2) at point-blank with clear
sight can land near index 12–13 → 81–100% (matching “BLACK = 1.0”). Partial
sight terrain lowers `sightArg` and therefore the preview index. This corrects
the earlier geometric-alignment interpretation; compass bearing feeds the
separate `bandArg`, while terrain feeds `sightArg`. The preview/UI table remains
separate from the authoritative live-fire table in §7b.

**Targeting validator** (`seg76`, the pre-fire check that returns the status
strings) runs in this order, returning the STR id shown to the player:
`out-of-bounds (630)` → `out-of-home (631)` → compute distance → `out-of-range
(632)` if `dist > 18` (`cmp dx,0x12; jg`) → `blocked (633)` → `angle blocked
(634)` → `sight blocked (635)`. This confirms **range is checked on the
Euclidean distance with the literal cap 18**.

---

## 7. Explosive (blast) damage — exact tables

Shared roller **`seg6:0x5F7E`** `rollDamage(index, postureCut, category)`:

```
raw = base[category][index] + (game_rand() & mask[category][index])   # index beyond the table length → 0
switch postureCut:            # applied after the roll
    1: raw >>= 1              # ×0.5
    2: raw -= raw>>2          # ×0.75
    3: raw -= raw>>3          # ×0.875
    else: unchanged
return raw
```

Called from the blast-application loop **`seg6:0x5D73`**, which iterates robots,
computes `index = dist(blastCenter, robot)` (§4 Euclidean), reads the target’s
`postureCut` from the cover/posture classifier (`seg87:0x1BF8`), and applies
damage. `index` = **radius**, so these tables *are* the blast falloff.

**Tables (DGROUP), `min = base`, `max = base + mask`:**

| Category | radius 0 | radius 1 | radius 2 | radius 3 | radius 4 | offsets (mask / base) |
|---|---|---|---|---|---|---|
| **0 “small”** (grenade?) | 45–76 | 25–40 | 5–12 | — | — | `0x15EE` / `0x15F4` |
| **1 “missile”** | 60–91 | 40–55 | 10–17 | — | — | `0x15FA` / `0x1600` |
| **2 “large”** (time bomb / self-destruct?) | 120–151 | 80–111 | 40–71 | 20–35 | 10–17 | `0x1606` / `0x1610` |

- Masks are `2ⁿ−1`: cat0/1 use `[31,15,7]`; cat2 uses `[31,31,31,15,7]`.
- **Category 1 matches the Match 2 missile playtest** (r0≈70, r1≈50, r2≈13–17,
  r3=0) essentially exactly — strong confidence this is the **Missile** curve and
  our `catalog.ts` blast numbers should move to `{r0:60–91, r1:40–55, r2:10–17}`
  with `radius = 2`.
- **Category 2 (radius 4, 120–151 at centre)** is a much bigger explosion — the
  best fit is the **Time Bomb / Self-Destruct (“Zap”)**, both of which exist in
  the original (STR 611 “Bomb”, 1430 “zap”, DLG #46 “Time Bomb”). Deferred in v1,
  but the numbers are here when we add them.
- **Category 0** is the smaller explosive — most likely the **Grenade**
  (STR 609/621). Our current 0.8×-missile grenade estimate is close-ish; replace
  with `{r0:45–76, r1:25–40, r2:5–12}` if we ship grenades.
- **`postureCut`** is the target’s posture/cover reduction (½, ¾, ⅞). It comes
  from `seg87:0x1BF8`; mapping posture→cut needs the same trace as §6’s cover
  flags. For v1’s Standing/Crouching, treat Standing = full and Crouching =
  one of these cuts (playtest to pick; ¾ is the safe default).

---

## 7b. Bullet fire (hit + damage) — **fully decoded**

This was the previous pass's biggest open item; it is now traced end-to-end.

### The architecture that matters (surprising, and it drives everything)

**A bullet's hit and damage are decided the instant you fire, not when the
sprite lands.** When a fire command executes during movie playback, the game:
1. rolls **hit-or-miss** and, on a hit, **rolls the damage amount** — both in one
   function, `seg6:0x35D1`;
2. **spawns a projectile** (`seg6:0x1A08`, a 16-byte struct) that *carries the
   pre-computed result*: field `+0x0E` = hit flag, field **`+0x0F` = damage**;
3. animates it flying (that's `seg7`, cosmetic);
4. at impact, the handler (`seg6:~0x56CD`) just **reads back `+0x0F`** and calls
   the shared **apply-damage** routine `seg6:0x5A2B`, which subtracts it from the
   target robot's HP.

Consequence for us (our Gate A, refined): the outcome is locked when the fire
command **resolves** (at its tick in the movie), and the flying projectile is
just a visual — so there's no *in-flight* dodging. **But** the resolver checks
whether the target is on the exact aimed tile *at that moment* and **halves the
hit chance if not** (§15). So moving *does* matter — you dodge by not being where
the shot was aimed, not by outrunning the bullet. Match this (it's both faithful
and tactically rich); no separate projectile-collision system needed.

### Call/offset map (for the reviewer)

| Role | Location |
|---|---|
| Fire-time **hit + damage resolver** (returns damage; 0 = miss) | `seg6:0x35D1` |
| Projectile **constructor** (writes `+0x0E` hit, `+0x0F` damage) | `seg6:0x1A08` |
| Projectile **impact** handler (reads `+0x0F`, branches bullet vs. blast) | `seg6:~0x56CD` (explosive branch calls `seg6:0x5D73` at `0x56A8`) |
| Shared **apply-damage-to-robot** (decrements HP) | `seg6:0x5A2B` |
| Live-fire **hit table** (score→prob) | DGROUP `0x156E` |
| **Weapon-damage** jump table | code `seg6:0x38C5` |
| **Posture** damage-adjust jump table | code `seg6:0x38BD` |
| **Weapon accuracy** add table | DGROUP `0x1596` = `[4,7,6,5,4,3,2,1]` |

### Hit roll (live fire)

```
score = accuracyScore(...)          # integer, clamped to [0, 19] — see below
threshold = hitTable[score]         # DGROUP 0x156E, /256
hit = (game_rand() & 0xFF) < threshold
```

**Live-fire hit table** `0x156E`, indexed by score 0–19 (thresholds /256):

| score | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /256 | 0 | 4 | 8 | 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 112 | 128 | 144 | 160 | 176 | 192 | 208 | 224 | 240 |
| ≈% | 0 | 1.6 | 3 | 6 | 9 | 12.5 | 15.6 | 18.75 | 25 | 31 | 37.5 | 44 | 50 | 56 | 62.5 | 69 | 75 | 81 | 87.5 | 94 |

**Accuracy score** (`seg6:0x35D1`, before the hit roll):

```
base = robot.accuracyTier + 4                 # stat table col0 (§5): Rifle 2, Burst/Missile/Stealth 1, Auto 0
score = { 1:4, 2:8, 3:12, 4:18 }[coverClass]  # coverClass from seg87:0x1BF8 path-trace (see below); default 0
# distance weighting (dist = §4 Euclidean, in di):
if dist > 12:      score += base/2 - 4
elif dist >= 7:    score += base - 2
elif dist >= 3:    score += base/2 + (6 - dist)
else:              score += base + 2*(3 - dist) + 2      # point-blank bonus
# target-terrain add by the tile the target stands on (field +0x2E = terrain type 1/2/3):
score += { 1:+2, 2:-1, 3:-3 }[terrainType]    # else (open) adds weaponAccTable[weapon] from 0x1596
score -= (scanSightPenalty)                   # <=4: -4, <=8: -2, else 0; Aim passes 16
score = clamp(score, 0, 19)
if damageStaggerCount: score >>= 1             # damage assigned 1–4 future actions
if targetLeftAimedTile: score >>= 1
```

Everything in that block is exact from the disassembly and both halving inputs
are now named from their producers. The important, hard facts: **closer = much
higher score** (a big point-blank bonus), **rough ground on the target adds +2**
(vulnerable, matches the help text), and the score saturates at 19 → 94%.

### Damage roll (live fire, on a hit)

```
si  = weaponRoll[ robot.weaponField_0x5C - 5 ]   # jump table seg6:0x38C5, see below
si += postureAdjust[coverClass]                  # jump table seg6:0x38BD: {1:-4, 2:0, 3:0, 4:+4}
if dist > 12: si -= 4
if dist < 5:  si += 4                             # point-blank bonus (again)
if si < 1: si = 0                                 # floor
return si                                          # -> projectile +0x0F
```

**Weapon-damage jump table** `seg6:0x38C5` (selector − 5 → slot 0–7; the selector
is the weapon-class value returned by the weapon-property lookup `seg13:0x060E`,
*not* a raw robot field — see the mapping note below):

| slot / selector | roll | range | named command |
|---|---|---|---|
| 0, 1 / 5, 6 | `(rand&7)+10` | **10–17** | Rifle Aim / Scan |
| 2 / 7 | `0` | — | Burst group header (not a fired command) |
| 3, 4 / 8, 9 | `(rand&0xF)+8` | **8–23** | Burst Aim / Scan |
| 5 / 10 | `0` | — | Automatic group header (not a fired command) |
| 6, 7 / 11, 12 | `(rand&0xF)+6` | **6–21** | Automatic Aim / Scan |

So each direct-fire weapon has **one wide damage roll**, then ±4 for
posture/cover and ±4 for distance. There is **no "full/partial bracket"** in the
code — what the Match 1/3/4 playtests bucketed as "full vs partial" is really
this single wide roll shifted by the ±4 point-blank/long-range terms. A rifle-ish
`8–23` roll at point-blank (`+4`) on an exposed target (`+4`) spans ~16–31,
which is exactly the "full 18–25" range the playtests reported; at long range
(`−4`) it sags to ~4–19 ("partial 10–17"). The empirical brackets were a
reasonable approximation of a continuous distribution.

**Named mapping is confirmed.** `seg14:0x07B4` maps the command groups to the
numeric weapon IDs whose resource strings are 605–611: Missile, Automatic,
Burst, Rifle, Grenade, Prod, and Bomb. The live dispatcher at `seg6:0x4CF2`
then routes selectors 5/8/11 to direct Aim & Fire and 6/9/12 to direct Scan &
Fire. This proves Rifle = `10–17`, Burst = `8–23`, and Automatic = `6–21`.
Selectors 7 and 10 are group headers, explaining their structural zero slots.
The descriptor's first byte is **encoded command-record length**, not a
direct/explosive category; the earlier category interpretation was false.

### Where this leaves the empirical numbers

The Match 1/3/4 bullet table is now **superseded** by the rolls above for the
engine. Keep the playtests as a cross-check (they should fall inside
`weaponRoll ± 8`), but implement from the binary: the roll + the two ±4 terms +
the `0x156E` hit curve. Byte 3 of the stat table is **not** the damage source
(see §5 correction).

---

## 8. Movement, postures, timing (cross-checked)

> **See §14 (postures) and §15 (cover/movement/armor→damage) for the full,
> updated models — those supersede the one-liners here.**

Nothing here contradicts the current spec; recording what the binary/strings
*confirm* vs. leave to playtest:

- **8 scan directions**, **8-direction movement** (the `15CE` direction-delta
  table in `seg6` holds the 8 `(dx,dy)` unit steps: `(-1,0),(0,1),(-2,-1),(1,2),…`
  — used by AI pathing/scatter).
- **3 postures** confirmed (Upright/Ducking/Crouching) — and the middle pose is
  *meaningful*, not redundant (§14). Crouch cannot enter Rough/Bush/Low-wall;
  upright & duck cross low walls slowly. (Terrain help text, §2.)
- **Timeline clock = 60 Hz (confirmed, §19)** — corrects the 20-tick/s
  assumption. Time is counted in 60ths of a second; turn budget 15 s = 900 units.
- **Move-cost alternation, deploy cost, posture-step cost, scan-rotation cost:**
  the *values* are still the Match-3 playtest numbers, but they're all clean
  integers in 60ths (§19), which corroborates them. Exact binary cost table not
  yet read (the parity flag on the logic struct is a separate trace from the
  path-render parity that shares its offsets).

---

## 9. Terrain property tables (TIL chunks)

Each `.TWN` has 16 `TIL` chunks (ids 300–315), one per tile-set. Each is 16
variants × **4 property bytes**. Across all sets there are exactly **7 distinct
property tuples**, matching the 7 named terrain types. Decoded meaning
(`tools/re/decode_til.py`):

| Tuple `(b0,b1,b2,b3)` | Terrain | b0 = height/block | b1 = passability | b2 = sight-block | b3 = flag |
|---|---|---|---|---|---|
| `(2,2,0,0)` | **Open** | 2 | 2 = free | 0 = clear | 0 |
| `(2,1,0,0)` | **Rough** | 2 | 1 = conditional (no crouch), vulnerable | 0 = clear | 0 |
| `(2,1,1,0)` | **Bush** | 2 | 1 = conditional | 1 = partial | 0 |
| `(3,1,1,0)` | **Low Wall** | 3 | 1 = conditional (cross slowly) | 1 = partial | 0 |
| `(4,0,2,0)` | **Wall** | 4 | 0 = impassable | 2 = opaque | 0 |
| `(2,0,0,0)` | **Crevice** | 2 | 0 = impassable | 0 = clear (sight across ✓) | 0 |
| `(2,2,0,15)` | **Special** (Fence?/home) | 2 | 2 = free | 0 = clear | 15 |

Interpretation of columns is inferred from cross-referencing the help text
(Wall impassable+opaque; Crevice impassable+transparent; Low Wall/Bush partial
sight cover; Rough vulnerable) — it fits all 7 cleanly. The 7th tuple
`(2,2,0,15)` is a uniform tile-set (TIL 315) that behaves like open ground with a
flag; **most likely the Fence** (named in STR 649 and DLG #16). It is not a
Home/Dock marker, and no decoded shipped MAP uses it. The `export_data.py`
mapper conservatively labels the unused tuple `"special"`.

A **map cell byte** = `(tileset << 4) | variant`: high nibble picks the TIL set
(300+hi), low nibble the variant, then the variant’s 4-byte tuple gives the
terrain. That’s how the arena grids below are derived.

---

## 10. Arena maps — all extracted

`.TWN` format: 32-byte signature `"RoboSport Resources …\r\n\x1a"`, then chunks:
`[4-byte tag][u16 id][16-byte name][u32 size][payload]`. Tags: `TIL` (tile
props), `MAP` (grid, 1 byte/cell), `INF` (set metadata: count, per-map width/
height at INF+`0x22`/`+0x32`, names from INF+`0x52` stride 22), `DIB` (Windows
bitmaps for tile art).

**Every map decoded to a terrain grid** in `docs/extracted/arenas.txt` and as
nested arrays in `robosport-data.json`. Dimensions (⚠️ note Rubble Two):

| Set | Maps (name → size) |
|---|---|
| **Rubble Town** | One 16×16 · **Two 24×24** · Three 32×32 · Four 40×40 · Five 48×48 · Six 44×44 · Seven 40×20 · Eight 32×32 |
| **Suburbs** | 8 maps, same size ladder |
| **Computer Town** | 8 maps, same size ladder |

Game-length → default arena (from `priority-tests.md`, now with corrected sizes):
Melee → **Rubble Two (24×24)**, Battle → **Rubble Three (32×32)**.

Rendering legend: `.`=open `R`=rough `B`=bush `L`=low-wall `W`=wall `C`=crevice
`H`=special/fence. (Example: `render_maps.py RUBBLE.TWN 2` prints Rubble Three.)

---

## 11. Machine-readable extract

`docs/extracted/robosport-data.json` (regenerate with `tools/re/export_data.py`;
**git-ignored** — a research artifact, not a shipped data file; transcribe the
numbers into the engine’s own catalog/spec) bundles:
- `rng` — algorithm + state offsets (reference only).
- `distance_metric` — Euclidean, max range 18.
- `robot_stats` — the `0x0CA8` table per class.
- `hit_chance_fire` — the **authoritative** 20-entry live-fire table (`0x156E`) + score formula.
- `hit_chance_preview` — the 14-entry planner/AI preview table (`0x213A`).
- `bullet_damage` — the weapon-roll jump table (`0x38C5`) + posture/distance adjusts (§7b).
- `explosive_damage` — the three category tables with `min/max/base/mask` per radius.
- `explosive_posture_multiplier` — {0:1.0, 1:0.5, 2:0.75, 3:0.875}.
- `arenas` — every Rubble/Suburbs/Computer map as a `terrain[y][x]` class grid.

---

## 12. Coordinate system and Home/Dock metadata — resolved boundary

`seg81:0x092F` writes the logical map at `y*64+x` and the screen buffer at
`(y+8)*80+(x+8)`. `seg81:0x09F2` reads the same logical orientation. Therefore
`.TWN` MAP cells import directly as `tiles[y][x]`; there is no y flip or x/y
transpose. The 8-tile offset is display padding only.

INF's 434-byte body contains count, width/height arrays, flags, and 16 name
records. Its repeated tail bytes are not per-map Home/Dock coordinates, and no
decoded MAP uses hidden special cells for those regions.

The runtime derives each Home rectangle in `seg87:0x1F32`. For each axis its
span is 6 when size `<20`, 8 at `20..31`, 12 at `32..47`, and 16 at `48+`.
Home indices 0..3 map clockwise to NW, NE, SE, SW by subtracting the span from
the corresponding far edge. Dock is off-field state/display, not a MAP tile.

---

## 12b. Original art — extracted, and what it means for our assets

The sprite packs `ROBOCOLR.PRS` (color) and `ROBOMONO.PRS` (mono) use the same
chunk format as the `.TWN` files; the payloads are **complete Windows `.BMP`
files** (4-bpp, 16-color) starting with `BM`. Decoder: `tools/re/dib_dump.py`.
Reference PNGs render to `docs/extracted/sprites/` — **git-ignored** (original
Maxis art; regenerate locally, don’t commit or ship).

What the packs contain (relevant chunks):

| Chunk id | Size | Content |
|---|---|---|
| `1010`–`1013` | 95–96 × 289 | **The four robot classes**, stacked vertically, one pose each: a chunky **oblique-top-down biped**. Rifle ≈ red, Auto ≈ blue, Burst ≈ purple, Missile ≈ green. The 4 near-identical sheets are hop/color frames. |
| `24` | 107 × 374 | **Missile projectile** in flight with a fire trail — several animation frames, each paired with a **black silhouette mask**. |
| `170`, `171` | — | **Explosion / “Zap” / “KA-BOOM” effect** frames (blast animation), also color+mask pairs. |
| `150`, `20`–`22` | — | Title / “ROBOSPORT” / “Robot Battle Zone” TV-frame UI chrome. |
| `30`–`36`, `201`–`204`, `96x` | small | HUD glyphs, cursors, direction/indicator icons. |

**Key takeaways for RoboArena’s asset & animation plan:**
1. **Robots are drawn in a single oblique pose**, not 8 hand-rotated bodies. So
   our plan to show **8 turret directions is a faithful enhancement, not a
   regression** — do it by rotating a separate turret/gun layer over a fixed
   body (exactly the split in the current `rifle-standing-modern-oblique.svg`).
2. **“Hopping” movement** in the original is a small **vertical bob** (a couple of
   frames), not a walk cycle. A 2–4 frame bob (or a sine-based transform in
   PixiJS) reproduces the feel cheaply.
3. **Sprites carry an explicit black AND-mask** for transparent blitting — that’s
   a 1991 GDI constraint we don’t have; our SVG/PixiJS assets just use alpha.
4. The four class silhouettes are visually distinct by **body shape + color**
   *in the resource sheets* — but **in-game, body color encodes TEAM, not
   class** (2026-07-08, confirmed by an in-game home-area capture: all four
   classes on one team render in identical team red). The per-class hues in
   chunks 1010–1013 are palette variants the engine re-maps per team.
   Consequence for our assets: class identity must read from **turret /
   head-gear silhouette** alone; team identity is a body/plate recolor.
5. Effects (muzzle flash, projectile trail, blast, “Zap”) are first-class
   animated sprites in the original; budget renderer work for them.

These are **reference only** (original Maxis art, not for redistribution in a
public release — they live under the git-ignored research folder’s decoded
output; keep them out of shipped assets). Use them to guide freshly-drawn art.

---

## 13. For the reviewer (Fable) — verification checklist

> **For the complete, prioritized list of every open item, see [§20 — Master
> list](#20-master-list--every-outstanding-assumption--tbd).** This section is
> the original reviewer checklist (verification-focused); §20 is the
> build-planning superset.

Hand this section, plus the JSON and the `tools/re/` scripts, to the second-pass
reviewer. Each item is independently checkable.

**Confirmed — spot-check only:**
1. Robot armor table `0x0CA8`: re-read bytes, confirm `140/120/100/100/120`;
   confirm cols 2–3 are never read (displacement scan) → byte 3 ≠ damage.
2. Live-fire hit table `0x156E` = `[0,4,8,16,24,32,40,48,64,80,96,112,128,144,160,176,192,208,224,240]`
   (score 0–19). Preview table `0x213A` (14 entries) is the planner/AI one.
3. Explosive tables `0x15EE–0x161A`; verify Category 1 ≈ Match-2 missile data.
4. Distance = floored Euclidean (`seg56:0x02A0` + startup fill `seg9:0x0485`).
5. Max range 18 (STR 641 + `seg76` `cmp dx,0x12`).
6. Rubble Two = 24×24 (INF width/height arrays).
7. ✅ **Bullet damage — DONE this pass (§7b).** Resolver `seg6:0x35D1` → projectile
   `+0x0F` → apply `seg6:0x5A2B`. Damage = weapon-roll (`seg6:0x38C5`:
   10–17 / 8–23 / 6–21 / 0) + posture± (`seg6:0x38BD`) + distance±, floored.
   Hit & damage are locked at **fire time**, not impact. Spot-check the jump
   tables and the `10–17/8–23/6–21` rolls.
10. ✅ **Robot-stat bytes 2 & 3 — DONE.** Never read at runtime (displacement
    scan); not damage/ammo. Only col 0 (accuracy) + col 1 (armor) are used.

**Resolved in the 2026-07-15 completion pass:**
8. ✅ **Weapon-id → selector/damage labels.** `seg14:0x07B4`, resource strings
   605–611, and `seg6:0x4CF2` prove Rifle 4/5/6, Burst 7/8/9, Automatic
   10/11/12, Missile 13/15/16, Grenade 17/19/20, Prod 1/2/3, Bomb 21/22/23.
9. ✅ **Cover endpoint sampling.** `seg87:0x1BF8` computes major axis and
   `abs(dx-dy)<2`; `0x1CE0` samples the endpoint, one major-axis neighbor for
   distance ≥2, and one diagonal corner only in that near-diagonal band.
11. **Fence** (`(2,2,0,15)`): confirm the 7th terrain is Fence and model its
    “weapons pass through with a chance to strike it” rule (a probabilistic
    in-transit blocker — new mechanic).
12. ✅ **Two hit tables — DONE.** `0x156E`/`seg6:0x35D1` is live fire.
    `0x213A` is read only through `seg96:0x09AF`, whose callers are planner/AI
    preview paths; the movie/live resolver has no caller.
13. ✅ **Posture values + final cover table — DONE.** `seg87:0x1CE0` reads
    robot `+0x50` as Upright/Duck/Crouch = 1/2/3 and maps those values with
    sampled obstruction height to cover classes (§15).
14. ✅ **Hit-score halvings — DONE.** `0x380A` is target no longer on the aimed
    tile. `0x37F4` is damage stagger: `seg6:0x4060` assigns `(gameRng&3)+1`
    after damage; later firing consumes the counter and halves hit score.
15. **Formation roster table** (§17): dump the per-formation Quick Start roster
    counts (the data behind "%d Rifle Robot" etc.). Needed only for faithful
    presets; Custom Game already covers all 5 bots.
16. ✅ **Survival scoring — DONE.** `seg42:0x09D1` computes base score + 150 per
    survivor + 400 if any survive. Its 100-point objective branches are gated
    to non-Survival modes.
17. ✅ **Exact per-action cost table.** Descriptor rows and live dispatch prove
    scan heading 5, one-tile move 30, two-tile move 40, posture 10, deploy 120,
    plus the named fire timings in §19. No stride-parity state exists.

**Design decisions this surfaces (for the human, not the reviewer):**
- Adopt the exact live-fire model (§7b) now, or keep a simpler bracket model for
  v1? (Recommend: adopt §7b — it’s not much more code and it’s *correct*, and it
  gives the point-blank/long-range feel for free.)
- **Fire-time resolution vs. moving-target dodging:** the original locks the
  outcome when you fire (the projectile is cosmetic). Match it (simpler) or add
  dodging as a deliberate new mechanic? (Recommend: match it for v1.)
- Switch engine distance to Euclidean now (small, correct, low-risk) — recommend
  yes.
- Ship Grenade/Time-Bomb/Zap later using the Category 0/2 tables already found.

---

## 14. Postures — the three poses, and what the middle one is *for*

**Answer up front:** the original has **Upright / Ducking / Crouching**, and the
middle pose (Ducking) is *not* redundant. Upright and Ducking move **identically**;
they differ only in **height**, which drives **cover**. Crouching trades away
mobility for maximum cover. So the three poses are really a **mobility ⇄ cover**
dial:

| Pose | Move onto Rough / Bush / Low-wall | Cross low walls | Height (cover profile) | Role |
|---|---|---|---|---|
| **Upright** | yes (slowly) | yes (slowly) | **tallest** — exposed over low walls | fast, but easy to hit |
| **Ducking** | yes (slowly) | yes (slowly) | **medium** — partial cover behind low walls | **advance while harder to hit** |
| **Crouching** | **no** | **no** (also can’t cross walls) | **shortest** — full cover behind low walls | hunker down; can’t relocate through cover terrain |

Movement rules are **authoritative** — verbatim from the in-game help (§2):
*“Bushes slow movement of upright or ducking Robots, but stop movement of
crouching Robots.”* / *“Robots can cross over low walls in upright or duck
position, but slowly. Robots cannot cross walls in crouch position.”* /
*“Crouching robots cannot move onto Rough ground.”*

So **Upright ≡ Ducking for movement**; the only mechanical difference between
them is the **height used in the cover calculation** (§15). That is the entire
point of the middle pose: *keep full movement, but present a smaller target.*

### Implication for our "Standing + Crouching only" v1 trim

Dropping Ducking is a **real** simplification, not a free one. It removes the
"move at reduced hit-risk behind low cover" option — the one stance that is both
mobile *and* defended. If v1 keeps only Standing (=Upright) and Crouching, the
game becomes "fast+exposed *or* safe+stuck," losing the interesting middle.
**Recommendation:** cheap to keep all three if we implement cover as height-LoS
(§15) anyway — the poses are just three height values. Keep the 3-pose model;
it's less special-casing than a 2-pose trim, and it's what makes cover tactical.

**Posture-change cost:** selectors 70/71/72 set Upright/Ducking/Crouching
absolutely and each costs 10 ticks. Any different posture therefore costs
1/6 second; there is no two-step Upright→Crouching charge (§19).

> **Resolved 2026-07-12:** `seg87:0x1CE0` reads robot field `+0x50` and compares
> it directly with `1/2/3`: `1=Upright`, `2=Ducking`, `3=Crouching`. The final
> cover-class table is decoded in §15. The earlier proposed synthetic heights
> `4/3/2` should not be used.

---

## 15. Combat consolidated — how cover, movement, terrain & armor shape damage

This ties the pieces together into the single pipeline a builder needs.

### Cover is height-based line-of-sight — **the key model**

`seg87:0x1BF8` → `seg87:0x1CE0` classify cover from a small, exact set of tiles
at each endpoint and read a **height map**: each tile's height is the terrain's
**TIL `b0`** byte (§9) — **Open/Rough/Bush = 2, Low Wall = 3, Wall = 4,
Crevice = 2**. Full centerline LoS blocking is a separate predicate.

For target-side cover, let `dx/dy` be absolute deltas, `distance=max(dx,dy)`,
and take steps from the target toward the shooter:

1. Always sample the target tile.
2. At distance ≥2, sample one neighbor along the major axis. `dx>dy` is
   x-major; ties are y-major.
3. If `abs(dx-dy)<2` and distance >1, also sample the diagonal corner neighbor.

Thus exact diagonals and slopes one tile off diagonal get a corner sample;
shallower/steeper lines do not. A remote low wall on the center path does not
become cover merely because the bullet crosses it (complete walls still fail
the separate LoS gate). Concretely:
- Target **crouching (short) behind a low wall (3)** → covered (wall taller than it).
- Target **ducking (medium) behind a low wall** → partial.
- Target **upright (tall) behind a low wall** → exposed (it pokes over).
- **Wall (4)** blocks everyone (and it's impassable + opaque anyway).
- **Bush (2)** gives cover only when the target is *on or behind* it (help text),
  and it blocks sight partially (TIL `b2`=1).

This unifies posture and terrain: there's **no separate posture damage
multiplier** — posture and the sampled terrain produce a cover class.

The final `seg87:0x1CE0` mapping is now decoded:

| sampled obstruction | Upright (1) | Ducking (2) | Crouching (3) |
|---|---:|---:|---:|
| exposed/open | 4 | 4 | 3 |
| bush / partial height 2 | 4 | 3 | 2 |
| low wall / height 3 | 3 | 2 | 1 |

Walls remain complete blockers through the separate LoS gate. The endpoint,
major-axis, near-diagonal condition, and y-major tie-break are all path-confirmed.

### The cover result feeds two dials (both confirmed tables)

The trace yields a **cover class 1–4** (1 = heavy cover … 4 = fully exposed),
used in the live-fire resolver `seg6:0x35D1`:

| cover class | hit-score init (`seg6` jump `0x38D5`) | bullet damage adjust (`seg6:0x38BD`) | explosive cut (`seg6:0x5FFD`) |
|---|---|---|---|
| 1 (heavy cover) | **4** (hard to hit) | **−4** | ×0.5 |
| 2 | 8 | 0 | ×0.75 |
| 3 | 12 | 0 | ×0.875 |
| 4 (exposed) | **18** (easy to hit) | **+4** | ×1.0 |

So **being in cover both lowers the chance you're hit and reduces the damage when
you are** — a double benefit, cleanly table-driven. Exposed (class 4) is the
worst place to stand: highest hit chance *and* +4 damage.

### Distance

Two point-blank/long-range terms, both in `seg6:0x35D1` (dist = §4 Euclidean):
- **Hit:** big score bonus up close, tapering with range (the `if dist<3 …`
  ladder in §7b), so closer ⇒ much likelier to hit.
- **Damage:** `+4` if `dist<5`, `−4` if `dist>12` (§7b).

### Terrain the *target stands on*

Independently of the path, the target's own tile adds to the hit score
(`+2` on the "type-1" terrain — Rough, matching *"rough ground makes a robot
vulnerable"*; `−1`/`−3` on cover tiles). Rough ground is a **damage/hit
liability**, not cover.

### Movement and damage stagger — both hit-score halvings confirmed

The hit-score has **two optional halvings** (`seg6:0x35D1` at `0x37F4` and
`0x380A`). One is now **confirmed**: the flag at `0x380A` comes from
`seg21:0x0F0A(target, aimedTile)`, which returns **1 iff the target is still on
the exact tile you aimed at**. When it's *not* (the target has moved off that
tile by the time the fire command resolves), the shooter's score is **halved** —
so a moving target is materially harder to hit. This is the mechanism behind the
COMPUTE! "target speed" remark and our Gate A: the original doesn't let a robot
dodge a bullet *in flight*, but firing at a tile the target has **vacated cuts
accuracy in half** (and if it fully leaves LoS, it's a clean miss). The second
halving input (`0x37F4`, resolver arg `[bp+10h]`) is traced to equipped command
object `+0x1E`, which the fire handlers decrement after firing.

`seg6:0x4060` writes `(game RNG & 3)+1` to that field after successful damage.
Thus damage assigns **1–4 future firing actions at half hit score**. Each direct
fire action consumes one count; a burst shares the action's penalty across its
bullets. This is damage stagger/flinch, not missile ammunition.

**Design consequence:** movement *is* a defense, and **Aim & Fire leads are
punished** — you want to aim where the target will be, and mispredicting halves
you. This makes the plan-then-resolve loop tactical without needing in-flight
dodging.

### Armor

**Armor = the HP pool**, not a damage reducer. Stat table col 1 (§5): Rifle 140,
Burst/Stealth 120, Auto/Missile 100. Damage (bullet or blast) is subtracted from
current HP by the shared `seg6:0x5A2B`; at ≤ 0 the robot is destroyed and returns
to the Dock ("arrggghhh"). There is no armor-vs-damage-type interaction.

### Full per-shot pipeline (build to this)

```
1. Range gate:      dist = floorEuclid(shooter, targetTile);  if dist > 18 → "out of range"
2. Angle gate:      target must be within the scan cone → else "angle blocked"
3. LoS/cover:       walk path (seg87) → coverClass 1..4 (terrain sample + posture enum)
                    if a Wall fully blocks → no hit
4. Hit roll:        score = coverInit[coverClass] + distanceBonus + targetTerrainAdd
                            + weaponAccAdd - scanSightPenalty ; clamp 0..19
                    if damage-staggered: score >>= 1
                    if target left aimed tile: score >>= 1
                    hit = (rand&0xFF) < hitTable_0x156E[score]
5. Damage (on hit): dmg = weaponRoll[slot] + postureAdjust[coverClass] + distanceAdjust
                    dmg = max(0, dmg)
6. Apply:           targetHP -= dmg   (seg6:0x5A2B); if HP<=0 → destroyed
   (Explosive: skip 3–5; at impact tile run the blast loop seg6:0x5D73 over all
    robots in radius, dmg = blastTable[category][radius] then ×coverCut.)
```

---

## 16. Sport modes — all five, objectives & where the logic lives

All five are real in the binary (STR 2001–2005, menu accelerators). v1 ships
**Survival** only, but here is the full set so nothing is guessed later.

| Mode | Objective (from strings/UI) | Per-turn/​setup pieces | Scoring bonus (STR) |
|---|---|---|---|
| **Survival** | Destroy all enemies; last side standing. | — | Robot Bonus (surviving bots), Survival Bonus, Side Bonus (1412–1414) |
| **Treasure Hunt** | Collect **coins** that spawn each turn. | "Set Coins" (1–12/turn), "Grab Coin", "Show Coins" | coins collected (4009) |
| **Capture the Flag** | Take enemy **flags** back home. | "Place Flag" (in home area), "Capture Flag", flags can be **dropped** | Flag Bonus (1415); "%d flags captured, %d dropped" (4010) |
| **Hostage** | **Rescue hostages** (min. 1 required, STR 2204). | "Set Hostages", "Rescue Hostage"; hostages can be **killed** | Hostage Bonus (1416); "%d saved, %d killed" (4013) |
| **Baseball** | **Tag bases** in sequence. | "Set Bases", "Tag Base"; base layouts **Four/Five Cross**, **Four/Five Corner** (STR 336–339) | "%d bases tagged" (4012) |

- **Sport-specific commands** exist as menu items (STR 826–831): Grab Coin,
  Capture Flag, Rescue Hostage, Tag Base, Place Flag — these are extra planner
  verbs only enabled in the matching mode.
- **Survival scoring** is exact in `seg42:0x09D1`. It first computes each Team's
  contribution from existing score (`+0x30`) + **150 per surviving robot** +
  **400 if that Team has any survivor**. At `0x0C25..0x0CB6` it sums those
  contributions into a four-entry array indexed by `+0x28` Side, then copies
  the Side total back into every allied Team row. Two further 100-point
  objective terms are enabled only for sport modes 2/3, not Survival.
- The end-game ceremony renders the computed struct with the
  Robot/Survival/Side/Flag/Hostage Bonus labels. Survival victory itself is
  last side standing; ceremony points do not replace that condition.
- **Final "Ows & Arghs"** damage tallies and MVP are also in that ceremony
  (STR 4006–4019).

---

## 17. Bot types & availability

**Five classes**, all defined by the stat table at DGROUP `0x0CA8` (§5):
Rifle, Burst, Auto, Missile, Stealth (STR 305–309 / 1013–1017).

### Availability

- **Custom Game team editor** (DLG #4) exposes **all five** — Rifle, Burst, Auto,
  Missile, **Stealth** — as build-your-team options. So no bot is *mode*-locked;
  they're **build-mode**-gated: you need the full Custom Game (not Quick Start) to
  place Stealth (consistent with `priority-tests.md`).
- **Quick Start** uses **preset rosters** by Game Length (Skirmish/Melee/Battle/
  Campaign) and **Formation** (Beginner/Standard/Fire Fight/Missile Fest/Beat the
  Clock). Formations change roster composition and turn-time bounds. The exact
  per-formation roster counts are a **data table not yet dumped** (the UI builds
  strings like "%d Rifle Robot" from it, STR 311–319) — a straightforward
  follow-up extraction if we want faithful presets.
- **Stealth is not gated by *sport mode***, but its *effectiveness* is gated by a
  **game option**: if "Show Enemy Positions / Sighting" is on, Stealth robots are
  useless and the game warns you (STR 1869–1870 "STEALTH ALERT!", DLG). Stealth's
  invisibility rule (invisible unless it moved this tick, or an enemy is adjacent
  with LoS) is already in `spec.md` §7 from the Compute! review.
- **Weapons per class** (stat table + strings): Rifle→Rifle, Burst→Burst Gun,
  Auto→"Automatic"/Machine Gun, Missile→Missile Launcher (+ rifle secondary),
  Stealth→Burst Gun. Missile starts with three missiles in the observed preset;
  robot/command field `+0x1E` is **not ammo**—it is the damage-stagger counter
  described in §15. Grenades/Time-Bomb/Zap are **extra weapons** granted
  by certain formations/options (STR 605–611, DLG #46 "Every robot carries…
  Grenades (0-9) / Missiles (0-9) / Time Bomb"), not class-inherent.

### AI brains (for completeness; v1 is human-only)

Four AI personalities exist: **Stupid, Ferocious, Crafty, Paranoid** (STR
330–333), plus **Human**. The AI lives in `seg6` (shares the combat resolver).
Out of v1 scope but documented so the enum is known.

---

## 18. Scan, line-of-sight & visibility

### The three firing gates (in the validator `seg76`, statuses in §6)

A shot is legal only if all three pass, checked in order:
1. **Range** — `floorEuclid ≤ 18` (else "out of range").
2. **Scan cone (angle)** — `seg76:0x0775` calls `seg21:0x0CCF` before LoS
   and range. The predicate is the **closed forward semicircle**: exact ±90°
   boundary rays and same-tile are accepted; a negative heading dot product is
   rejected as "angle blocked". This is exactly
   `dot(headingVector, target-shooter) >= 0` for all eight headings. The exact
   boundary also adds 2 to Scan & Fire candidate rank distance.
3. **Line of sight** — a clear line must exist (else "sight blocked").

### Scan-grid sight strength = endpoint-inclusive Bresenham

`seg87:0x19E3` traces shooter→target through `seg56:0x0360` and returns an
integer sight strength. Same-tile and clear sight return 16. The sampled path
includes both endpoints:
- **Wall / Outer Wall** (`TIL b2=2`) returns 0 immediately.
- Every **Low Wall / Bush** (`TIL b2=1`) subtracts 3, clamped at 0.
- **Crevice / Rough / Open** (`TIL b2=0`) do not reduce the value.

The scan-grid builder `seg96:0x0900..0x09AE` stores this pairwise value and
`seg96:0x1FC5` returns it. A value of 0 rejects ordinary visibility and Scan &
Fire acquisition; a positive value is also passed into live fire, where the
`<=4` and `<=8` penalty bands apply. This path does **not** read posture. Posture
still affects the separate endpoint-cover path (`seg87:0x1BF8`).

### Team visibility (fog of war)

For the main-game ordinary visibility rule, each team
sees its own robots, plus tiles inside any of its robots' **scan cone × range**
with clear LoS, plus enemies standing on those tiles. Stealth's reviewed
move-or-adjacent exception is intentionally deferred to post-main-game parity
and is not a Phase 4 requirement. The scan-preview grid builder
`seg96:0x09AF` (§6) is what computes, per robot, which tiles it can see/hit — the
same machinery powers the planner's targeting feedback and the AI.

The 2-4 Team alliance trace distinguishes friendly visibility from sensor
sharing:

- `seg95:0x0952` iterates all Teams and builds each observer's initial robot
  mask from every Team whose `+0x28` Side matches. Allied robots are therefore
  always visible to one another.
- `seg96:0x0AAC..0x0BBF` updates enemy-contact masks at the two explicit Team
  indices involved in a scan/visibility relation. It does not iterate or copy
  those contacts into the other same-Side Team slots.
- Ordinary enemy contacts and last-known information are consequently
  **per Team, not pooled by Side**. A2 always sees A1's robots, but A2 does not
  automatically see an enemy merely because A1's scan sees it.

Combat uses the same Side field consistently. Scan & Fire acquisition
(`seg18:0x0777..0x08B4`) skips candidate Teams with the shooter's Side. Direct
tile fire (`seg6:0x3261..0x327C`) skips same-Side robots before the damage call.
The blast loop (`seg6:0x5DC8..0x5F07`) records whether source and target Sides
differ but calls the shared damage routine in both branches: explosives damage
same-Side allies.

### Scan as a command

Setting scan heading is an absolute planner command. Selectors 24..31 map the
eight directions and each costs **5 ticks (1/12 s)** regardless of the previous
heading. Scan heading persists across the turn.
`Scan & Fire` (auto-fire when an enemy enters the cone) and `Aim & Fire`
(tile-targeted) are the two fire modes; the DLG #38 "Scan and Fire … Maximum
Distance / Seconds" fields are the auto-fire engagement cap, **not** weapon range
(§2).

---

## 19. Timeline & action costs — **clock is 60 Hz, not 20**

**Confirmed correction.** The internal time unit is **1/60 second (60 units per
second)**, not the 20 ticks/s our spec assumed. Proof: the turn-timer formatter
`seg76:0x1027` reads the robot's accumulated turn-time (field `+0x52` → a handle →
`+0x10`) and extracts three **base-60** digits — `T%60`, `(T/60)%60`, `T/3600` —
and prints them as `M:SS.ss` (`"%d:%d.%d"` at DGROUP `0x1D90`, with zero-padded
variants `0x1D99/0x1DA3/0x1DAD`). The middle digit being *seconds* forces the
base unit to be **1/60 s**; the fractional field is **60ths of a second**. So the
simulation counts time in 60ths and the turn budget of 15 s = **900 units**
(1–40 s = 60–2400 units).

### Exact non-fire command timing

The complete 77-row descriptor table begins at DGROUP `0x07F4`. `seg13:0x060E`
proves column 0 is encoded command-record length (1–4), not a weapon category;
column 1 is default duration/repeat interval, column 2 is presentation width,
and column 3 is a flag. Live dispatch and enum helpers give:

| Command | Selectors | Duration |
|---|---:|---:|
| Set scan heading (8 absolute headings) | 24..31 | **5 ticks** |
| Move one tile (8 directions) | 41..48 | **30 ticks** |
| Move two tiles (16 offsets) | 49..64 | **40 ticks** |
| Set Upright / Ducking / Crouching | 70 / 71 / 72 | **10 ticks** |
| Deploy | 74 | **120 ticks** |

This disproves the old playtest-derived stride alternation (`18/42`, `24/48`),
the 6-tick posture-step model, and the 3-tick scan-unit model. Posture and scan
commands set absolute states with one fixed cost; no stride-parity state exists.

### Fire rate — **confirmed: table-driven per-selector interval**

The command-duration function **`seg13:0x08C5`** (called from seg5/6/7 as the
canonical "how many clock units does this command take?") resolves a fire
selector's cost to its **`b1` column** at DGROUP **`0x7F5`** — read at
`seg13:0x094E`. The 2026-07-12 audit corrected the indexed range: live fire uses
selectors **5..12**, not rows 0..7.

| selectors | command | Aim duration / Scan repeat |
|---|---|---:|
| 5 / 6 | Rifle Aim / Scan | 30 / 30 |
| 8 / 9 | Burst Aim / Scan | 15 / 20 |
| 11 / 12 | Automatic Aim / Scan | 10 / 10 |
| 15 / 16 | Missile Aim / Scan | 30 / 20 |
| 19 / 20 | Grenade Aim / Scan | 30 / 20 |

The named map is proved by `seg14:0x07B4` plus weapon strings 605–611, and the
handlers by `seg6:0x4CF2`. Scan commands remain active for the player's
`seconds × 60` duration and use the listed interval between acquisitions/shots.
Timed parameters (including Scan & Fire duration, zap, and bomb fuse) are
multiplied by 60 in `seg13:0x08C5`.

### Movie playback rate

The eight 16-bit frame-decimation divisors at DGROUP `0x1028` are
`3,4,5,6,10,12,15,20`. `seg7:0x26B1` displays `60/divisor` with string 1701,
yielding choices **20, 15, 12, 10, 6, 5, 4, 3 fps**. `seg7:0x2A26` initializes
choice index 2, so the exact original default is **12 fps**. This is renderer
presentation over the 60 Hz simulation; it does not change engine command time.

---

## 20. Master closure list — Survival complete; deferred parity explicit

The single place to check that nothing falls through the cracks. All
main-game Survival business-rule rows are closed below. Rows explicitly marked
post-main-game are not Phase 1–11 requirements.

**Priority key:** **P1** = needed to build/play v1 correctly · **P2** = needed for
faithful combat feel · **P3** = post-v1 content (other sports, formations, AI).

**Confidence key:** 🟥 assumption (playtest/review, not in binary) · 🟨 mechanism
confirmed, exact constant provisional · 🟩 confirmed (listed only where a small
sub-part remains).

### Combat — damage & hit

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 1 | **Weapon → damage-slot labels** | Rifle `10–17`, Burst `8–23`, Automatic `6–21` | `seg14:0x07B4`; strings 605–611; `seg6:0x4CF2` | 🟩 | P2 |
| 2 | **First hit-score halving input** `[bp+10h]` | damage assigns 1–4 staggered firing actions; each firing consumes one | `seg6:0x4060`; `0x1DCE/0x1F74` → `0x35D1` | 🟩 | P1 |
| 3 | **Diagonal/adjacent cover path sampling** | endpoint + major neighbor + near-diagonal corner; y-major ties | `seg87:0x1BF8/0x1CE0` | 🟩 | P2 |
| 4 | **Explosive cover cut** | resolved by cover class: 1/2/3/4 → ×0.5/0.75/0.875/1 | `seg87:0x1BF8` → `seg6:0x5FFD` | 🟩 | P2 |
| 5 | **Live vs preview hit table** | `0x156E` live; `0x213A` only planner/AI callers | caller graph for `seg96:0x09AF` | 🟩 | P1 |

### Postures & cover

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 6 | **Posture values / cover mapping** | **resolved:** field `+0x50` = Upright 1 / Duck 2 / Crouch 3; final table in §15 | `seg87:0x1CE0` | 🟩 | P1 |
| 7 | **Shooter posture affects own fire?** | no independent hit/damage term; only symmetric endpoint/LoS legality | `seg6:0x35D1` argument/data flow | 🟩 | P1 |
| 8 | **Keep 3 poses or trim to 2?** (design) | RE says keep all 3 — Ducking is meaningful (§14) | design call | 🟩 | P1 |

### Timing

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 9 | **Clock rate** | **60 units/s — CONFIRMED** (§19) | — | 🟩 | P1 |
| 10 | **Fire interval per named weapon** | Rifle 30/30, Burst 15/20, Auto 10/10, Missile 30/20, Grenade 30/20 (Aim/Scan) | `seg14:0x07B4`; `seg6:0x4CF2`; `seg13:0x08C5` | 🟩 | P1 |
| 11 | **Move cost & slow terrain** | fixed one-tile 30 / two-tile 40; no parity; TIL movement `2` permits path pairing, `1` forces single waypoints | selectors 41..64; `seg87:0x2901`, `0x0BF6..0x0D3D` | 🟩 | P1 |
| 12 | **Deploy / posture / scan-heading costs** | 120 / 10 / 5; absolute posture/heading commands | selectors 24..31, 70..74 | 🟩 | P1 |
| 13 | **Descriptor column 2** | presentation/path width (16/24/…/112), not a mechanic range | readers in `seg13/seg76` | 🟩 | P3 |

### Weapons & bots

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 14 | **Weapon max range — per-weapon or uniform?** | uniform **18** (string "Maximum range is 18" + `seg76 cmp 0x12`) | confirm no per-weapon range table | 🟩 | P1 |
| 15 | **Point-buy rating values** (40/50/60/80/100) | from B&W team-builder dialog; **not** in stat table `0x0CA8` | locate rating table/formula | 🟥 | P3 |
| 16 | **Formation roster table** (per-formation Quick Start rosters) | Beginner rosters from playtest; others unknown | data table behind "%d Rifle Robot" (STR 311–319) | 🟥 | P3 |
| 17 | **Grenade / Time-Bomb blast assignment** | projectile type 1→Grenade/category 0; type 2→Missile/category 1; type 3→Time Bomb/category 2 | named create handlers + `seg6:0x55BF` dispatch | 🟩 | P3 |
| 18 | **Ammo mechanics** | Missile starts at 3 in preset; custom extra Grenade/Missile counts accept 0–9; `+0x1E` is stagger, not ammo | UI/manual + damage trace | 🟩 boundary | P3 |
| 19 | **Stealth invisibility rule** | **POST-MAIN-GAME PHASE 14**; review rule retained, binary internals intentionally not audited now | later Stealth audit | deferred | post-main |

### Modes & scoring

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 20 | **Survival win/scoring** | last Side standing; per-Team contribution = existing score + 150/survivor + 400 if any survive, then contributions aggregate by Side and every allied row receives that total | `seg42:0x09D1`, especially `0x0C25..0x0CB6` | 🟩 | P1 |
| 21 | **Other sports' exact rules** | **POST-MAIN-GAME PHASE 15** | later sport-mode audits | deferred | post-main |

### Visibility, scan & arenas

| # | Item | Working value & source | Where to confirm | Conf | Pri |
|---|---|---|---|---|---|
| 22 | **Scan cone hard boundary** | closed ±90° forward semicircle; boundary included | `seg76:0x0775` → `seg21:0x0CCF` | 🟩 | P1 |
| 23 | **Scan & Fire acquisition** | duration=`seconds×60`; reacquire at named interval; max-distance filter; exact cone-boundary distance adjustment `+2`; equal adjusted candidates prefer higher scan-grid sight strength, then canonical candidate order; the same strength feeds live-fire penalties | `seg6:0x1F74`; `seg18:0x072C..0x0919`; `seg21:0x0CCF`; `seg87:0x19E3`; `seg96:0x0900..0x09AE/0x1FC5`; `seg6:0x3D79` | 🟩 | P1 |
| 24 | **Aim & Fire moving-target** | **confirmed**: off-aimed-tile halves hit (§15, `seg21:0x0F0A`) | — | 🟩 | P1 |
| 25 | **Arena coordinate reconciliation** | MAP=`body[y*width+x]`; no flip/transpose; display border +8 | `seg81:0x092F/0x09F2` | 🟩 | P1 |
| 26 | **Home Area / Dock positions per arena** | homes use exact 6/8/12/16 dimension thresholds at NW/NE/SE/SW; Team Name box fixes home slot without compaction; Dock is off-field | `seg87:0x1F32`; manual; complete INF/MAP parse | 🟩 | P1 |
| 27 | **Deploy timing** | selector 74 costs 120; no stride parity to reset | duration table + deploy handler `seg6:0x2ECF` | 🟩 | P1 |
| 28 | **Movie playback fps** | choices 20/15/12/10/6/5/4/3; default 12 | DGROUP `0x1028`; `seg7:0x26B1/0x2A26` | 🟩 | P2 |
| 29 | **3-/4-team same-Side semantics** | `+0x28` is Side; direct/Scan fire excludes allies; blast damages allies; allied robots are always visible but enemy contacts/last-known data stay per Team; ceremony totals aggregate by Side; Home slots and Team-box order do not compact | `seg18:0x0777`; `seg6:0x3261/0x5DC8`; `seg42:0x0C25`; `seg95:0x0952`; `seg96:0x0AAC`; manual | 🟩 | post-v1 alliance implementation |

### Already resolved this pass (so they're not re-opened)

- ✅ Distance = floored Euclidean · ✅ Robot armor/accuracy (`0x0CA8`) · ✅ Stat
  bytes 2–3 unused · ✅ Bullet damage rolls · ✅ Explosive blast tables · ✅ RNG
  (dual-stream LFSR) · ✅ Clock = 60 Hz · ✅ named selectors/timing · ✅ Terrain
  properties + all arenas · ✅ Moving-target = off-tile halving · ✅ Cover =
  height-LoS + exact endpoint sampling · ✅ closed scan boundary · ✅ 5 sports & 5 bots identified · ✅ Bot availability
  (build-mode, not sport-mode gated).

The original four provisional mechanics, the additional two-team main-game
Survival gaps (#2, #5, #7, #20, #25/#26, #28), and the 2-4 Team alliance
semantics (#29) are closed. Phase 11.6 now has implementation/integration work,
not a remaining original-code research dependency. Stealth (#19) and the four
other sports (#21) are post-main-game phases. Formation rosters, point-buy, and
extra weapons remain later parity/content choices and do not alter the
four-class Beginner Survival rules.
