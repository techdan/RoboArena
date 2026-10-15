# RoboSport setup: Quick Start presets, game options, point-buy rating

Source: `ROBO.EXE` (NE, 101 segs). DGROUP = seg101, file `0x07D600`, so
DGROUP `X` is file `0x07D600+X`. Code is cited as `segN:0xOFF`. Code segment file bases used
here: seg10 `0x017400`, seg11 `0x019200`, seg18 `0x024C00`, seg21 `0x028600`,
seg26 `0x02EE00`, seg54 `0x051600`, seg61 `0x056200`, seg74 `0x061A00`.
Labels: **C** = Confirmed (disassembled and checked), **I** = Inferred, **U** = Unknown.
Tooling: `tools/re/ne_dis.py` (relocation-aware disassembler: `d`, `jt`, `callers`, `dumpall`) and `tools/re/dlg_ids.py` (dialog controls with ids).

## 0. Headline corrections to existing docs

1. **The class stat record starts at DGROUP `0x0CA6`, not `0x0CA8`.** Each class has 4 bytes
   `[weaponId, weaponMask, accuracy, armor]`. RE doc §5 reads `0x0CA8` as
   `[acc, armor, ?, ?]`, so its "byte 2/3" columns are really the *next* class's
   weaponId/mask. seg21:0x02C8 reads `[0x0CA6+4c]` into robot `+0x22`, and
   seg21:0x02DA reads `[0x0CA7+4c]` into robot `+0x20`. seg10:0x0AC9 prints
   `STR 1007+(weaponId-1)` as the "Weapon:" label (C). See §5.
2. **Turn Length does not depend on formation.** For every game it is 1–40 s,
   default 15 s (§2) (C). Formations change the extra weapons, the sight flags,
   and only for Beat the Clock the **Turn Clock**, which is the real-time limit
   on programming a turn. spec.md §2's statement that "formations change
   turn-time bounds" holds only in that Turn Clock sense.
3. **The Beginner preset turns Show Enemy Positions ON** (flags `|=7`) (C). This
   affects the remake's fog-of-war defaults.
4. **Campaign is not a multi-match mode.** It is the largest preset (§3) (C).
5. **The point-buy rating has no budget.** It is a display-only sum (§5) (C).

## 1. Quick Start per-formation × per-length table

### 1.1 State variables (Quick Start dialog DLG #35, template `QUICKSTART` at DGROUP 0x147B)

| DGROUP | Meaning | Default (seg61:0x000E..0x0026) |
|---|---|---|
| `0x4120` | Sport, 1..5 (combo id 200) | 1 Survival |
| `0x411C` | Formation, 1..5 (combo 201) | 1 Beginner |
| `0x411E` | Game length, 1..4 (combo 202) | **2 Melee** |
| `0x411A` | Arena type, 1-based combo index (combo 203) | 1 (RUBBLE) |
| `0x4118` | Map index in TWN = length−1 | 1, then recomputed |
| `0x4042/4040/403E/403C` | Rifle/Burst/Auto/Missile counts | from table |
| `0x4122..0x412E` | preset option staging, copied to game struct (§4) | |

The binding of combo id to variable is the pointer table at DGROUP `0x1432` (file
0x07EA32): `{0x4120, 0x411C, 0x411E, 0x411A}` for ids 200..203. The text-buffer
table at `0x143A` is `{0x4103, 0x40D9, 0x40EE, 0x40C4}`. Handler seg54:0x1015
stores `CB_GETCURSEL+1` through the pointer. When the combo is 201 or 202 it then calls the
preset builder seg61:0x02A7 (seg54:0x10DD..0x10EB) (C). The combos are filled
with STR 2001+i (seg54:0x07BA), STR 2011+i (seg54:0x081A) and STR 2021+i
(seg54:0x087A) (C).

### 1.2 Roster table — DGROUP `0x162A` (file `0x07EC2A`), 80 bytes (C)

Preset builder seg61:0x02A7:
`si = formation*16 + length*4 - 20` (1-based, so `(f-1)*16 + (l-1)*4`). Bytes
`[0x162A+si+0..3]` → Rifle `[4042]`, Burst `[4040]`, Auto `[403E]`, Missile
`[403C]` (seg61:0x02D0..0x0302). Alignment check: the bytes before `0x162A` are a word
table ending at `0x1629`, and `0x167A` (= 0x162A+80) is the empty string
used by seg61:0x0131, followed by `"COM2:"`.

Counts are per team (Rifle / Burst / Auto / Missile):

| Formation \ Length | Skirmish | Melee | Battle | Campaign |
|---|---|---|---|---|
| 1 Beginner | 1/0/1/0 (2) | 1/1/1/1 (4) | 2/2/1/1 (6) | 3/2/2/1 (8) |
| 2 Standard | 1/0/1/0 (2) | 1/1/1/1 (4) | 2/1/2/1 (6) | 2/2/2/2 (8) |
| 3 Fire Fight | 0/0/2/0 (2) | 2/1/1/0 (4) | 2/2/2/0 (6) | 3/2/3/0 (8) |
| 4 Missile Fest | 0/0/1/1 (2) | 1/0/1/2 (4) | 1/1/1/3 (6) | 2/1/2/3 (8) |
| 5 Beat the Clock | 1/0/1/0 (2) | 1/1/1/1 (4) | 2/1/1/2 (6) | 2/2/2/2 (8) |

The Beginner row matches the spec.md / playtest rosters (Melee 1/1/1/1, Battle 2/2/1/1,
Campaign 3/2/2/1, Skirmish 2 robots) (C). The roster size is always 2·length
robots per team (C, from the data).

The roster is instantiated by seg61:0x0643. It loops over each count and calls
seg21:0x0000(name, class, …) with class **0 Rifle, 1 Burst, 2 Auto, 3
Missile** (seg61:0x0904..0x0A58). Names come from STR 316..319 `" Rifle%d"`,
`" Burst%d"`, `" Auto%d"`, `" Missile%d"`, loaded into DGROUP 0x3FFC/0x400C/0x401C/0x402C
(seg61:0x0654..0x0697) (C). The preview text uses STR 314/313/312/311
(`"%d Rifle/Burst/Auto/Missile Robot"`) plus `"s"` (DGROUP 0x144A) when the count is not 1, and it
is shown in Quick Start static id 300 (seg54:0x0000..0x0158) (C).

### 1.3 Per-formation extra weapons and flags (seg61:0x02A7..0x03A3) (C)

Common to every formation: `[412E]=5` (turn clock minutes), `[412C]=2·length+2`
(coins/turn), `[412A]=0` (base pattern), `[4128]=0x38` (time limit off, score limit off,
turn clock off).

| Formation | Grenades `[4126]` | Missiles `[4124]` | Zap `[4123]` | Time Bomb `[4122]` | Flags |
|---|---|---|---|---|---|
| Beginner | 0 | 3 | off | off | `0x38\|7` = positions + damage + objects shown |
| Standard | 3 | 3 | on | on | `0x38\|2` (+4 if sport 2/4/5) |
| Fire Fight | **0** | **0** | on | on | as Standard |
| Missile Fest | **5** | **5** | on | on | as Standard |
| Beat the Clock | 3 | 3 | on | on | as Standard, then `^0x20` → **turn clock ON = 2·length+1 min** (3/5/7/9) |

Quick Start never enables the game Time Limit or the Score Limit (flags 0x08 and 0x10 stay set) (C).

### 1.4 AI brain assignment in Quick Start (seg61:0x08A8..0x08E0) (C)
A team with brain ≠ Human is rewritten as follows. Beginner → 1 Stupid. Otherwise team slot 0 or 3 →
3 Crafty, and slots 1 and 2 → 2 Ferocious. The default second team "Computers" (STR 2102) is created
with brain 1 in slot 2 (seg61:0x00CF..0x00D5). v1 does not use AI, so this is for reference only.

## 2. Turn time bounds

| Quantity | Value | Where |
|---|---|---|
| Turn Length default | **15 s** | schedule object `[42BE]` `+6` init, seg88:0x00E2 (C) |
| Turn Length range | **1..40 s** for every formation | DLG #55 OK handler seg26:0x0259..0x0260 (`di>0 && di<=0x28`), else STR 2213/2214 (C) |
| `%d` in "Turn Length (1-%d Seconds)" | `min(40, timeLimit − currentGameTime)` | seg88:0x05DC (si=0x28; with time limit on, the remaining time when <40; 0 if expired), printed at seg26:0x01B6..0x01DF (C) |
| Turn-length clamp | `turnLen = limit − now` if it would overrun | seg88:0x0544 (C) |
| Game clock advance | `turn++; sec += turnLen; normalise 60` | seg88:0x0200..0x0249 (C) |
| Turn Clock (real time to program) | minutes·60 per team | init seg88:0x0940 (`[game+0x32]*60` → schedule `+0x0A+2·team`) (C) |

Schedule object layout: `+0` turn #, `+2` minutes, `+4` seconds, `+6` turn
length (s), `+8` per-team flag bits, `+0x0A..` per-team turn-clock seconds (C).

Per formation, the only turn-time difference is that Beat the Clock enables the Turn
Clock at 2L+1 minutes. The other formations keep the Turn Clock off (C).

## 3. Game length → arena map, roster size, Campaign

* The arena map index is `[4118] = length−1` (seg61:0x02C9..0x02CD). It is passed as the map
  index to seg83:0x0111(townName `[40C4]`, idx, 1) from seg61:0x0B2A. seg83 appends
  `".TWN"` (DGROUP 0x1E7E) and stores idx at arena `+0xBA` if 0 ≤ idx < 16
  (seg83:0x01CF..0x01DB) (C).
  * Skirmish → map 0 (Rubble One 16×16), Melee → map 1 (Two 24×24),
    Battle → map 2 (Three 32×32), Campaign → map 3 (Rubble Four 40×40;
    Suburbs/Computer Four 44×44). The sizes come from RE doc §10. The mapping of the index
    to the TWN map ordinal is I, and it agrees with the playtests (Melee = Rubble Two, Battle = Rubble Three).
* Roster size = 2·length per team (table §1.2) (C).
* Coins/turn preset = 2·length+2. This is Treasure Hunt only (C).
* **Campaign has no multi-match logic.** `[411E]` is read only at seg54:0x08B5
  (combo init) and seg61:0x02B2/0x02C9/0x02D7/0x0372 (preset builder). A
  full displacement scan of all code segments found no other reader (C). Campaign
  is simply the largest map and roster, with Beat-the-Clock clock 9 min.
* **Turn count / match end** come from game options, not length (§4: Time
  Limit, Score Limit, elimination).

### Quick Start Arena Type → TWN (seg54:0x08C3..0x0A49) (C)
Combo 203 is filled from the DGROUP filename pointers at `0x1442/0x1444/0x1446` (file
0x07EA42) → `"RUBBLE.TWN"` (0x144C), `"SUBURBS.TWN"` (0x1457), `"COMPUTER.TWN"`
(0x1463). Each name has its extension cut at `'.'` (seg97:0x003B) and is lower-cased
(USER ord432). Then **any other `*.TWN`** found by the directory enumeration of
`"*.TWN"` (DGROUP 0x1470) that is not one of the three is appended, with `'_'`
shown as a space. Index 1/2/3 = RUBBLE/SUBURBS/COMPUTER. The selected text goes to
`[40C4]` (CB_GETLBTEXT at seg54:0x0A3D), and the map is that file's map
`length−1`.

Restricted (copy-protection/same-serial) mode (`[1486]`/`[1488]`) forces
combos 200/201/203 to index 0 and Game Length to index 1 (Melee). Warnings are
STR 2243/2245/2246 (seg54:0x104D..0x10AD) (C).

## 4. Game options struct

The game object is the handle at DGROUP `[2E3C]` (accessor seg18:0x00CC). Defaults
are set by seg18:0x0000 (Custom Game / fresh) (C). Quick Start then overwrites a subset
via seg61:0x0426 (C).

| Offset | Option | Default (seg18) | Quick Start (seg61:0x0426) | Range / UI | Enforcement |
|---|---|---|---|---|---|
| `+0x18` | Sport 0..4 | 0 Survival | `[4120]−1` | DLG #3 radios 1400..1404 | sport logic (out of scope) |
| `+0x1A` bit 0x01 | Show Enemy Positions | off | on only for Beginner | DLG #9 id 400 (seg11:0x06D7) | I: fog bypass in seg96:0x075E/0x0806/0x110A (hit-preview grid), seg7:0x3714 (movie), seg5:0x085B, seg19:0x039E (start check → STEALTH ALERT DLG #48 via seg19:0x0134→seg11:0x117F) |
| `+0x1A` bit 0x02 | Show Enemy Damage | **on** | on | id 401 (seg11:0x0728) | I: robot info panel seg70:0x00D8/0x034A, compared against viewer Side `+0x28` |
| `+0x1A` bit 0x04 | Show sport objects (STR 410–413 Coins/Flags/Hostages/Bases) | off | Beginner, or sport 2/4/5 | id 402. For Survival it shows STR 409 "Error" and is disabled (seg11:0x0348..0x03A5) | seg96:0x0EB7, seg7:0x3819, seg5:0x08FF (I) |
| `+0x1A` bit 0x08 | **No** Time Limit (set = off) | off (limit off) | off | checkbox 101 | §4.1 |
| `+0x1A` bit 0x10 | **No** Score Limit | off | off | checkbox 201 | §4.1 |
| `+0x1A` bit 0x20 | **No** Turn Clock | off | off, except Beat the Clock | checkbox 301 | §4.1 |
| `+0x24` | Coins per turn | 4 | 2L+2 | SETCOINS seg10:0x00F0, scrollbar 0..12 (label "1-12") | Treasure Hunt |
| `+0x26` | Base pattern 0..3 | 0 | 0 | SETBASES radios 100..400 (seg10:0x075D) | Baseball |
| `+0x28` | Grenades per robot | 3 | formation | DLG #46 scrollbar 101, **0..9** (seg11:0x0D8B) | robot `+0x36` (seg21:0x0360) |
| `+0x2A` | Missiles per robot | 3 | formation | DLG #46 scrollbar 104, 0..9 | robot `+0x38` (seg21:0x036E); usable only with the missile weapon bit |
| `+0x2C` (byte) | Zap armed | 1 | formation | DLG #46 check 106 | robot weapon mask `+0x20 \|= 0x20` (seg21:0x0315) |
| `+0x2D` (byte) | Time Bomb armed | 0 | formation | DLG #46 check 108 | only the designated robot (robot `+0x78` bit 2): mask `\|=0x40`, bombs `+0x3A=1` (seg21:0x02E7..0x0301) |
| `+0x2E` | Score Limit | **1000** | unchanged | DLG #39 **50..10000** (seg11:0x0B01/0x0B07) | seg18:0x0E58 |
| `+0x30/+0x31` (bytes) | Time Limit min/sec | **2:00** | unchanged | DLG #50 scrollbars 0..59 / 0..59, **minimum 3 s** (STR 2207, seg11:0x09CE..0x09DE) | seg88:0x0544/0x05DC, seg18:0x0DE1 |
| `+0x32` | Turn Clock minutes | **5** | 5 or 2L+1 | DLG #53 scrollbar **1..15** (seg11:0x0C08..0x0C0E) | seg88:0x0940, seg74:0x2519 |

Dialog launchers (seg11) are: GAMEOPTIONS 0x10F3, TIMELIMIT 0x110F→proc 0x088B,
SCORELIMIT 0x112B→0x0A74, TURNCLOCK 0x1147→0x0BA2, SETWEAPONS 0x1163→0x0CE4,
STEALTHALERT 0x117F. The template names are at DGROUP 0x07B0..0x07E6 (C). The display
helpers are seg11:0x0000 (time, `"%d %s %d %s"`), 0x0087 (score), 0x00EF (clock,
STR 423/424 minute/minutes) and 0x0175 (weapons, STR 418/419 Armed/Disarmed) (C).

### 4.1 Enforcement details (C unless noted)
* **Game-end test seg18:0x0DE1(game, maxTurnLen)**, called once per turn from
  seg88:0x0296 with `maxTurnLen = seg88:0x05DC()`. The game ends unless *all* of these hold:
  (a) live teams span ≥2 Sides (`+0x28`); (b) maxTurnLen ≠ 0 (that is, the Time
  Limit is not exhausted); (c) Score Limit is off, or `limit > max(team +0x30 score)`.
  So the score limit triggers on `score >= limit`, which matches the DLG #39 text.
* **Time Limit** is a limit on *simulated game time*, not wall-clock time. It caps each turn
  length (seg88:0x0544) and ends the game when `now >= limit`.
* **Turn Clock** is wall-clock programming time. seg74:0x2519 skips if bit
  0x20 is set, and otherwise subtracts elapsed GetCurrentTime/1000 from the
  team's remaining seconds. At 0 it shows STR 2230 "Oops, you ran out of time…" and
  forces the turn closed (`[4156]=0`, `[4154]=-1`) (seg74:0x2676..0x268E). With
  the clock on, the team-selection rotation seg88:0x08F0 also skips teams whose
  time has run out.
* **Zap Duration (DLG #57)** and **Bomb Fuse (DLG #2)** are *per-command parameters*,
  not game options. ZAP proc seg26:0x1714: scrollbar **1..40 s**, initial value from a
  per-robot/program `+0x5C` (I: last-used). BOMB proc seg26:0x1852: scrollbar **0..40 s**,
  initial value from `+0x5A`. Both store the value in command `+0x24` (seg26:0x180F, 0x1936). They are
  launched by seg26:0x1B29/0x1B60 (template names "ZAP"/"BOMB" at DGROUP 0x0E7E/0x0E82).
  Seconds→ticks conversion (`×60`) is in seg13:0x08C5 (RE doc §19).

## 5. Class records and point-buy rating

### 5.1 Corrected class table — DGROUP `0x0CA6` (file `0x07E2A6`), 5 × 4 bytes (C)

| Class (index) | weaponId | weaponMask | accuracy | armor | rating |
|---|---|---|---|---|---|
| 0 Rifle | 4 Rifle | 0x18 | 2 High | 140 | 40 |
| 1 Burst | 3 Burst | 0x14 | 1 Medium | 120 | 50 |
| 2 Auto | 2 Auto | 0x12 | 0 Low | 100 | 60 |
| 3 Missile | 1 Missile | 0x19 | 1 Medium | 100 | 80 |
| 4 Stealth | 3 Burst | 0x14 | 1 Medium | 120 | 100 |

Raw bytes from 0x0CA6: `04 18 02 8C | 03 14 01 78 | 02 12 00 64 | 01 19 01 64 | 03 14 01 78`.
* weaponId → label is `STR 1007 + (id−1)` = Missile/Auto/Burst/Rifle (seg10:0x0AC9..0x0B23) (C).
  Stealth is a Burst-gun robot (C).
* Bits of weaponMask in robot `+0x20` (I): 0x01 Missile, 0x02 Auto, 0x04 Burst, 0x08
  Rifle, 0x10 Grenade. These follow STR 605–609 order. Zap 0x20 and Time Bomb 0x40 are ORed in by
  seg21:0x02FC/0x031F (C). Missile 0x19 = missile + rifle + grenade, which confirms the
  rifle secondary.
* "Certain robots carry… Time Bomb": robot `+0x78` bit 2 marks one robot per
  team. seg21:0x01E5..0x01F9 gives it to the first robot added if no robot has it. The team editor
  moves it (seg10:0x0E66/0x0E84) (C mechanism; I that this is a per-team "leader" designation).

### 5.2 Rating (C)
`seg21:0x0974(class)` is a jump table at seg21:0x09AB → **40, 50, 60, 80, 100**
for classes 0..4, and 0 otherwise. Robot rating (STR 1011) is shown in DLG #4 id 603
(seg10:0x0A16). Team rating (STR 1012) is the sum over the up-to-8 slots
(seg10:0x0BAE..0x0BDD → DGROUP `[2962]`, also seg69:0x068F). It is shown in DLG #4 id
500 and in the Custom Game "Rating" column (seg17:0x2BF7 → team `+0x22`).
**No budget or cap is enforced.** `[2962]` is never compared. The team-edit OK
handler (seg10:0x130E..0x14EF) validates only name present (STR 2205) and
≥1 robot (STR 2206), with a maximum of 8 robots (edit ids 300..307). The rating is advisory
balancing information (C).

## 6. Open items
* The exact player-visible effect of Show Enemy Positions/Damage is I. It needs a trace of seg96:0x0740 area and
  seg70.
* The Coins scrollbar range is 0..12 while the label says 1–12. seg10:0x0000 may clamp (U).
* Time Bomb holder semantics (robot `+0x78` bit 2) are I.
