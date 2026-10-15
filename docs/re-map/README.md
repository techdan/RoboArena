# RoboSport reverse-engineering map

This folder is the full extraction map of the original `ROBO.EXE` (Windows 1.00)
and its arena files. It covers everything the 2026-10-15 audit listed as
unextracted. Combat and the Survival rules RoboArena already ships remain
documented in [`../reverse-engineering.md`](../reverse-engineering.md); this
folder is the rest. Nothing here except the arenas is implemented yet.

**Address conventions.** Code is `segN:0xOFF` (NE segment, segment-relative
offset). Data is DGROUP `0xXXXX`; DGROUP is segment 101 at file `0x07D600`, so
DGROUP `X` is file offset `0x07D600 + X`. Resources are `STR n`, `DLG #n`,
`MENU #n`. Arena data is `TAG id` inside a `.TWN` file. Every claim is tagged
**C** (confirmed by reading the code or bytes), **I** (inferred) or **U**
(unknown, with the best starting address).

**Reproduce.** The binary is Maxis content and is never committed. With the
original `ROBOWIN/` folder available locally:

```bash
python3 tools/re/ne_dis.py ROBO.EXE d 96 0x09AF 0x0AAC   # disassemble a range, far calls resolved
python3 tools/re/ne_dis.py ROBO.EXE jt 6 0x4E9C 76 3     # dump a jump table
python3 tools/re/ne_dis.py ROBO.EXE dumpall asm/         # whole-binary listing for grepping
python3 tools/re/xref.py   ROBO.EXE callers 96 0x09AF    # near and far callers
python3 tools/re/dlg_ids.py ROBO.EXE 46                  # dialog controls with ids
python3 tools/re/export_data.py ROBOWIN docs/extracted/robosport-data.json src/lib/arenas
```

## Files

| File | Covers |
|---|---|
| [commands.md](commands.md) | All 80 command selectors: producers, executors, payloads, timing. Zap, Time Bomb, Self Destruct, Grenade and Missile ammo, sport verbs |
| [sports.md](sports.md) | Treasure Hunt, Capture the Flag, Hostage, Baseball: state, placement, verbs, scoring, wipe-out rules, the full ceremony formula |
| [setup.md](setup.md) | Quick Start roster table, formation weapons and flags, game lengths, Campaign, game-options struct, turn and clock limits, point-buy rating |
| [stealth-fence-ceremony-ai-formats.md](stealth-fence-ceremony-ai-formats.md) | The visibility spotting roll and Stealth rule, Fence, ceremony counters, AI brain structure, TWN/PRS container format and chunk inventory |
| [resources.md](resources.md) | Index of all string blocks, dialogs and menus |
| [timing.md](timing.md) | The movie step loop, projectile queue, flight times, scatter, cooldowns, spotting refresh, Scan & Fire sight cache and delayed death |

## Original timing (rules revision 4)

[timing.md](timing.md) maps the original combat timing: the 5-tick movie
loop (`seg6:0x47DE`), the projectile queue (`seg6:0x556F`), bullet, missile
and grenade flight, the shared fire cooldown and seven-shot pause, the
spotting refresh and activity flags, the step-only Scan & Fire sight cache
and delayed death. RoboArena implements it as rules revision 4
(`ORIGINAL_TIMING_RULES_REVISION`); `docs/spec.md` documents the rules.

## Extraction list

| # | Item | Status | Where in the binary | Doc |
|---|---|---|---|---|
| 1 | All 24 arenas | ✅ Extracted and shipped | `MAP 0–7` + `INF 0` in each `.TWN`; size ladder in `INF` +0x22/+0x32 | [`src/lib/arenas`](../../src/lib/arenas), [stealth…formats.md](stealth-fence-ceremony-ai-formats.md) §5 |
| 2 | Command selector table | ✅ C | DGROUP `0x07F4` (80 × 4 B), glyphs `0x0934`, moves `0x0B14`; executor `seg6:0x4CF2` | [commands.md](commands.md) §1–2 |
| 3 | The 19 unnamed selectors | ✅ C for 3, 4, 23, 69, 78; the rest are never produced | `seg74`, `seg80:0x01F6`, `seg12:0x02A5` callers | [commands.md](commands.md) §2, §10 |
| 4 | Zap (Prod contact attack) | ✅ C | sel 3, `seg6:0x2BD9`, damage `seg6:0x602B` | [commands.md](commands.md) §3 |
| 5 | Time Bomb | ✅ C | sel 23, `seg6:0x2B08`, detonation `seg6:0x542E`, blast cat 2 at DGROUP `0x1606` | [commands.md](commands.md) §4 |
| 6 | Self Destruct | ✅ C | sel 78, `seg6:0x3541`; enable `seg21:0x076C` | [commands.md](commands.md) §5 |
| 7 | Grenade and Missile counts | ✅ C | robot +0x54/+0x56; Aim/Scan tables DGROUP `0x0B52`/`0x0B46` | [commands.md](commands.md) §7, [setup.md](setup.md) §1.3 |
| 8 | Sport mode and objects | ✅ C | game struct handle DGROUP `0x2E3C` +0x18; object manager DGROUP `0x357A`; verb sel 69 → `seg6:0x2F36` | [sports.md](sports.md) §1–2 |
| 9 | Treasure Hunt | ✅ C (end rule U) | placement `seg28:0x1867`, grab `seg6:0x32DB` | [sports.md](sports.md) §3 |
| 10 | Capture the Flag | ✅ C | `seg6:0x2FC6`, capture `seg28:0x1544`, wipe-out `seg6:0x6200` | [sports.md](sports.md) §4 |
| 11 | Hostage | ✅ C (limit checks U) | rescue `seg6:0x33EB` | [sports.md](sports.md) §5 |
| 12 | Baseball | ✅ C | tag `seg6:0x30D8`, base patterns `seg28:0x19ED` | [sports.md](sports.md) §6 |
| 13 | Ceremony scoring (all sports) | ✅ C | `seg42:0x09D1` | [sports.md](sports.md) §7 |
| 14 | Formation × length rosters | ✅ C | DGROUP `0x162A` (80 B), reader `seg61:0x02A7` | [setup.md](setup.md) §1.2 |
| 15 | Formation extra weapons and flags | ✅ C | `seg61:0x02A7..0x03A3` | [setup.md](setup.md) §1.3 |
| 16 | Game length → map, Campaign | ✅ C | map index = length − 1; TWN list DGROUP `0x1442` | [setup.md](setup.md) §3 |
| 17 | Game options (limits, clock, shows) | ✅ C | options struct defaults `seg18:0x0000`; end check `seg18:0x0DE1`; clock `seg74:0x2519` | [setup.md](setup.md) §2, §4 |
| 18 | Point-buy rating | ✅ C | `seg21:0x0974` (40/50/60/80/100, no budget) | [setup.md](setup.md) §5 |
| 19 | Stealth rule | ✅ C | `seg96:0x0A48` inside spotting roll `seg96:0x09AF` | [stealth…formats.md](stealth-fence-ceremony-ai-formats.md) §1 |
| 20 | Stealth Alert | ✅ C | `seg19:0x036A`, dialog `STEALTHALERT` | same, §1.5 |
| 21 | Fence | ✅ C | tuple (3,0,1,*), `seg87:0x2838`; no shipped map uses it | same, §2 |
| 22 | Ceremony counters, Ows and Arghs | ✅ C | robot +0x5E..+0x76, apply-damage `seg6:0x5A2B`, stats `seg22:0x22D5` | same, §3 |
| 23 | MVP rule | ❓ U | STR 1419 unreferenced in ROBO.EXE; likely `PLAYER.EXE` | same, §3.3 |
| 24 | AI brains | 🟡 Outline (weights U) | `seg62:0x0766` → `seg30:0x0115` → `seg32:0x0000`; modes `seg34:0x1A2A` | same, §4 |
| 25 | TWN container and chunks | ✅ C | `seg53:0x0000`; 57 chunks per file | same, §5 |
| 26 | PRS sprite packs | ❓ U | files not in the staged folder; ids requested by code are listed | same, §5.4 |
| 27 | Strings, dialogs, menus | ✅ Indexed | resource table | [resources.md](resources.md) |

## Findings that affect the game RoboArena already ships

These came out of this pass. Items 1 and 2 were implemented as rules revision 2
(`src/engine/spotting.ts`, `src/engine/orientation.ts`). Rules revision 3 adds
items 3 and 5 and the Beginner/Standard formation setups, with Zap and Time
Bomb (`src/engine/formations.ts`). Item 4 is not implemented. Divergences we
keep on purpose are listed in
[../modernization-ideas.md](../modernization-ideas.md).

1. **Ordinary visibility is a per-tick spotting roll, not certain sight.** In
   the original, an enemy inside your cone with line of sight is seen only when
   a roll against DGROUP `0x213A` succeeds. The roll's index depends on the
   target's cover class, sight strength, distance and whether it moved or acted
   this tick (`seg96:0x09AF`, called only from the pair routine `seg96:0x060D`).
   Firing reveals the shooter automatically. Once seen, a robot stays seen while
   it stays in any enemy cone. Implemented under rules revision 2; matches
   created earlier still show every enemy in cone, range and line of sight. `reverse-engineering.md` §6 called this
   routine the planner hit preview; that was wrong.
2. **Turning and posture changes are charged per step.** Both the human planner
   and the AI emit one record per octant turned (5 ticks each, shortest way
   round) and route Upright↔Crouching through Ducking (2 × 10 ticks)
   (`seg80:0x0422`, `seg80:0x0352`). Implemented under rules revision 2.
3. **The Beginner formation turns Show Enemy Positions on** (`seg61`, flags
   `|= 7`). Other formations show damage only. Implemented under rules
   revision 3; the lobby offers Beginner and Standard.
4. **Robots occupy their destination tile partway through a move** (15 ticks
   into a 1-tile move; midpoint then destination for a 2-tile move,
   `seg6:0x2D59`, `seg6:0x2E04`). This was already on the deferred list.
5. **The simulation runs in 5-tick steps.** The movie loop dispatches or
   continues every robot's command, runs the per-step updates and the
   spotting pass, then advances `now` by 5 (`seg6:0x4802..0x483E`). Every
   command duration is a multiple of 5, so only the spotting pass changes:
   revision 2 rolled every tick, five times too often. `now` restarts at 0
   each turn (`seg6:0x4599`); the turn's end is turn length + 150 ticks
   (`seg6:0x4790`), extended for late effects by `seg6:0x6330`.

## Corrections to earlier documents

| Earlier claim | Correction | Evidence |
|---|---|---|
| AI accuracy add `{Stupid +2, Ferocious −1, Crafty −3}` | Stupid −3, Ferocious +2, Crafty −1, Paranoid 0 (words of the fire-control table) | `seg6:0x374F..0x3783` |
| Class stats at `0x0CA8` = [accuracy, armor, ?, ?] | Records start at `0x0CA6`: [weapon id, weapon mask, accuracy, armor]. The old "bytes 2–3" belong to the next class. Accuracy and armor values are unchanged | `seg21:0x02C8`, `seg21:0x02DA` |
| `seg96:0x09AF` + table `0x213A` = planner hit preview | It is the visibility spotting roll (see above) | callers `seg96:0x079D`, `0x0843` |
| Robot +0x02 = robot id | Next-robot link in the Team list | [sports.md](sports.md) |
| Projectile +0x0E = hit flag, +0x0F = damage | +0x0E is the damage byte (0 = miss) | `seg6:0x1A08`, `seg6:0x5700` |
| Command table has 77 rows | 80 rows (0–79) | [commands.md](commands.md) §0 |
| Zap = self-destruct | Zap is the Prod contact attack (sel 3); Self Destruct is sel 78 | [commands.md](commands.md) §3, §5 |
| Sport verbs are separate selectors | All four are sel 69; Place Flag creates no command | [commands.md](commands.md) §6 |
| TIL (2,2,0,15) is probably Fence | Fence is (3,0,1,*) and appears in no TIL set; tile bytes 0xF0–0xFF are runtime overlay markers | `seg87:0x2838` |
| Fence: bullets have a chance to strike it | Bullets treat Fence like a Low Wall. Only missiles and grenades can stop on a height-3 tile (0 / 3.1 / 12.5 / 25 % by path position) | `seg87:0x2B77` |
| Formations change turn-time bounds | Turn Length is 1–40 s (default 15) for all; only Beat the Clock turns on the real-time Turn Clock | `seg26:0x025D`, `seg88:0x00E2` |
| Campaign is a multi-match mode | It is the largest preset (map index 3); no other reader of the length variable | [setup.md](setup.md) §3 |
| Ceremony uses STR 4006–4019 | ROBO.EXE uses STR 1431–1446; 4006–4019 are never referenced | `seg22:0x22D5` |
| STR 1869–1870 "Stealth Alert" | No such strings; the alert is static text in dialog `STEALTHALERT` | resource table |

## Still open

- The periodic spotting refresh `seg6:0x4091` (activity 2) is implemented
  for Zap only; five other callers (`seg6:0x1FCB`, `0x240C`, `0x28E1`,
  `0x2D49`, `0x4AB5`) are not yet identified, so Scan & Fire and
  scan-for-duration may also need it. RoboArena also checks Scan & Fire
  targets every tick rather than every 5-tick step while holding fire.

- MVP selection rule and the PRS chunk inventory need `PLAYER.EXE`,
  `ROBOCOLR.PRS` and `ROBOMONO.PRS`, which were not in the staged folder.
- AI target-score weights (`seg32:0x05D8`, `seg33`, `seg96:0x1B98`/`0x1D92`).
- Treasure Hunt and Hostage end conditions beyond the Score Limit; hostage
  give/take limits; whether bullets can hit a held hostage.
- The unidentified global DGROUP `0x14BA` (gates the Scan & Fire cooldown and the base inset).
- Fourteen unnamed command rows (2, 14, 18, 22, 40, 65–68, 73, 75–77, 79) and
  the Prod and Bomb select rows (1, 21) are never produced; the unnamed rows'
  intended verbs are guesses.
- Damage-stagger DOSBox check from the combat audit (`seg6:0x4CDA`).
