# ROBO.EXE command selectors — full map (RE pass 2026-10-15)

Scope: every program-command selector, its producer, executor, payload, timing and effect.
Evidence key: **C** = Confirmed (code read), **I** = Inferred, **U** = Unknown.
Addresses are `segN:0xOFF` (NE segment, offset). DGROUP `X` = file `0x7D600+X`.
Tooling: `tools/re/ne_dis.py` (relocation-aware disassembler: `d`, `jt`, `callers`, `dumpall`) and `tools/re/dlg_ids.py` (dialog controls with ids).

## 0. Headline corrections to existing docs

| # | Prior claim | Binary truth | Evidence | St |
|---|---|---|---|---|
| 1 | Descriptor table is 77 rows | **80 rows (0..79)**, DGROUP `0x07F4..0x0933` (file `0x7DDF4..0x7DF33`). It is immediately followed by an 80×6-byte per-selector draw table at `0x0934..0x0B13`, then the move-offset table at `0x0B14`. Rows 77/78/79 = `[2,0,0,0]`, `[1,20,32,0]`, `[3,5,72,0]`. | layout contiguity; `seg5:0x02AF` and `seg14:0x0496` switch on 1..78; `seg6:0x4CF8` on 3..78; selector 78 emitted by `seg74:0x08E2` | C |
| 2 | "Unnamed 4" | 4 is the **Rifle weapon-select** (already in RE §13 item 8). | `seg14:0x07B4` jt (4→weapon 4 = STR 608 Rifle), `seg77:0x03A5` | C |
| 3 | Zap = self-destruct | **Zap (sel 3) is the Prod weapon's contact attack** ("Zap Enemy...", STR 836). Self Destruct is a separate **sel 78**. | §3, §5 below | C |
| 4 | Scan heading / posture: fixed cost regardless of previous value | Execution is absolute (5 / 10 ticks per record), but **both the human planner and the AI emit one record per intermediate step**: heading changes walk the shortest way round one octant at a time (5 ticks each); Upright↔Crouching inserts Ducking (2 × 10 ticks). | `seg80:0x0352`, `seg80:0x0422`, `seg30:0x12DD`, `seg30:0x13A2` | C |
| 5 | Grab Coin / Capture Flag / Rescue Hostage / Tag Base are distinct selectors | **All four are selector 69** ("act on item here"); the executor branches on the sport. Place Flag (STR 830) creates **no** command. | §6 | C |

## 1. Command record and infrastructure

| Item | Detail | Evidence | St |
|---|---|---|---|
| Record bytes | `+8 sel`, `+9 p1`, `+0A p2`, `+0B p3` (bytes in the program buffer); descriptor col0 = byte count stored (1..4). | decode `seg13:0x060E` (jt `0x073F`: len1→p1=p2=0, len2→p1, len3/4→p1,p2), `seg13:0x07DB` (p3 only if len≥4) | C |
| Low-level append | `seg12:0x02A5(prog, sel, p1, p2, p3)`; writes len bytes (`0x0414`/`0x043F`), adds `seg13:0x08C5` duration to program time. | `seg12:0x02A5..0x040A` | C |
| Human planner append | `seg80:0x01F6(sel,p1,p2,p3,flag)`; rejects past 0xE10 (3600) ticks (`seg80:0x02FB`). Callers all in `seg74`. | `seg80:0x01F6..` | C |
| AI append wrappers | `seg30:0x0BE6..0x145D` (called from AI brain segs 31/32). | callers list, `seg32:0x0000` called from `seg30:0x030B` | C |
| Set p3 at run time | `seg12:0x0466(prog, v)` writes p3 of current record (len≥4 only). Used for ammo/shot counters. | `seg12:0x0466..0x04CE` | C |
| Duration | `seg13:0x08C5(sel,p1,p2)`: sel 3 → p1×60; 6/9/12/16/20 → p2×60; 32..40 and 76 → p1×60; else desc col1 (`DGROUP 0x07F5+4·sel`). | `seg13:0x08C5..0x0954`, jt `0x0955` | C |
| Live dispatcher | `seg6:0x4CF2` (`sub 3; cmp 4Bh` → 3..78, jt `seg6:0x4E9C`). Before dispatch it clears program `+1E/+1F` and stores now in `+18`. | dump of jt | C |
| Pose/animation per command | `seg5:0x024B`, jt `seg5:0x058D` (sel 1..78). | jt dump | C |
| Code-window glyph | far-ptr table DGROUP `0x0934 + 6·sel` (file `0x7DF34`) = {drawFn, bitmapSet, glyphIdx}; drawFn `seg14:0x0AFC` (blank), `0x0B18` (icon), `0x0CBA` (icon + params text). Called by `seg14:0x0A4B` (`call far [bx+934h]`). | DGROUP relocs at `0x934+6n` | C |
| Is-terminator | `seg13:0x0969` returns 1 when no record or `sel==0`. | `seg13:0x09AF` | C |

## 2. Full selector table (0..79)

Desc = `[len, ticks, width, flag]` at DGROUP `0x07F4+4·sel`. Glyph = `set:idx` from `0x0934` table (`—` = none).
"Exec" = `seg6:0x4CF2` target. "Anim" = `seg5` case. Producer H = human planner, A = AI (`seg30`).

| Sel | Desc | Name | Producer | Exec (seg6) | Payload | Timing | St |
|---|---|---|---|---|---|---|---|
| 0 | 1,0,16,0 | END / empty (terminator) | none (sentinel) | none | — | 0 | I (`seg13:0x0969`) |
| 1 | 1,20,28,0 | Select **Prod** (weapon id 6, STR 610) | **none** (weapon picker only maps ids 1..5) | none (sel<3) | — | 20 | C (vestigial) |
| 2 | 1,30,50,0 | Prod family op, glyph 111:18 | none | none | — | 30 | U (vestigial) |
| 3 | 3,20,80,1 | **Zap Enemy** (Prod attack) | H `seg74:0x07BA` (menu 731 "Zap...", DLG #57, STR 836); A `seg30:0x0FE8` | `0x2BD9` | p1 = seconds (1..40) | p1×60 | C |
| 4 | 1,20,28,0 | Select **Rifle** | H `seg74:0x0F27`; A `seg30:0x0D3A` | `0x4D07` | — | 20 | C |
| 5 | 3,30,96,0 | Rifle Aim & Fire | H `seg74:0x1F99` (table `0x0B52`) | `0x1DCE` | p1=x, p2=y | 30 | C |
| 6 | 3,30,112,0 | Rifle Scan & Fire | H `seg74:0x1E04` (table `0x0B46`); A `seg30:0x0F39` | `0x1F74` | p1=max dist (0..18), p2=seconds | p2×60 | C |
| 7 | 1,20,28,0 | Select **Burst** | as 4 | `0x4D07` | — | 20 | C |
| 8 / 9 | 3,15,96 / 3,20,112 | Burst Aim / Scan | as 5 / 6 | `0x1DCE` / `0x1F74` | as 5 / 6 | 15 / p2×60 | C |
| 10 | 1,20,32,0 | Select **Automatic** | as 4 | `0x4D07` | — | 20 | C |
| 11 / 12 | 3,10,96 / 3,10,112 | Auto Aim / Scan | as 5 / 6 | `0x1DCE` / `0x1F74` | as 5 / 6 | 10 / p2×60 | C |
| 13 | 1,20,32,0 | Select **Missile** (needs `+56`>0) | as 4 | `0x4D07` | — | 20 | C |
| 14 | 1,30,50,0 | Missile family op, no glyph | none | none | — | 30 | U (vestigial) |
| 15 | 4,30,96,0 | Missile Aim & Fire | H `seg74:0x1F99` | `0x266F` | x, y, p3 = missiles left after this shot | 30 | C |
| 16 | 4,20,112,1 | Missile Scan & Fire | H `seg74:0x1E04`; A `seg30:0x0F39` | `0x2876` | dist, seconds, p3 = shot budget (63 = "all ammo") | p2×60 | C |
| 17 | 1,20,32,0 | Select **Grenade** (needs `+54`>0) | as 4 | `0x4D07` | — | 20 | C |
| 18 | 1,30,50,0 | Grenade family op, no glyph | none | none | — | 30 | U (vestigial) |
| 19 | 4,30,96,0 | Grenade Aim & Fire | as 15 | `0x218D` | as 15 (grenades) | 30 | C |
| 20 | 4,20,112,1 | Grenade Scan & Fire | as 16 | `0x23A1` | as 16 | p2×60 | C |
| 21 | 1,20,20,0 | Select **Bomb** (weapon id 7, STR 611) | none | none | — | 20 | C (vestigial) |
| 22 | 2,30,80,0 | Bomb family op, glyph 111:20, 1 param | none | none | p1 | 30 | U (vestigial) |
| 23 | 4,60,80,1 | **Place (Time) Bomb** | H `seg74:0x06C6` (menu 732, DLG #2, STR 825); A `seg30:0x104A` | `0x2B08` | p1 = fuse s (0..40), p2=0, p3 = bombs left | 60 | C |
| 24..31 | 1,5,16,0 | Set scan heading 1..8 (sel = h+23) | H `seg80:0x0422`; A `seg30:0x13A2` | none (state via `seg5:0x0313`, `+1A = sel-24`) | — | 5 per step | C |
| 32..39 | 2,5,64,0 | **Scan current direction for N s** (sel = heading+31) | H `seg74:0x0607` (menu 730 "Scan...", DLG #37, STR 823) | `0x2D20` | p1 = seconds (1..40) | p1×60 | C |
| 40 | 3,5,72,0 | Rotating scan sweep (anim steps heading every 5 ticks from p2) | none found | none | p1 = seconds, p2 = start heading | p1×60 | I (anim `seg5:0x0322`) |
| 41..48 | 3,30,16,0 | Move 1 tile (N,NE,E,SE,S,SW,W,NW) | H `seg74:0x1C53/0x1C66`; A `seg30:0x11AD` via table `0x0B14` | `0x2D59` | p1=x, p2=y | 30 | C |
| 49..64 | 3,40,24,0 | Move 2 tiles (ring from (0,-2) clockwise) | same | `0x2E04` | x, y | 40 | C |
| 65..68 | 2,20,40,0 | unnamed, text glyph `%d, %d` | none | none | p1 | 20 | U |
| 69 | 1,15,16,1 | **Act on item here** = Grab Coin / Capture Flag / Rescue Hostage / Tag Base | H `seg74:0x08F6` (menu 734/735/737/738); A `seg30:0x127C` | `0x2F36` | — | 15 | C |
| 70/71/72 | 1,10,20(24),0 | Set Upright / Ducking / Crouching | H `seg80:0x0352`; A `seg30:0x12DD` (sel = posture+69, `seg77:0x0452`) | none (anim `seg5:0x0487..0x04E3`) | — | 10 per step | C |
| 73 | 2,120,0,0 | unnamed, no glyph, text drawFn | none | none | p1 | 120 | U |
| 74 | 3,120,72,0 | Deploy from Dock | H `seg74:0x19D2`; A `seg30:0x0BE6` | `0x2ECF` | x, y | 120 | C |
| 75 | 1,120,0,0 | unnamed, blank drawFn | none | none | — | 120 | U |
| 76 | 2,0,0,0 | unnamed, blank; duration p1×60 (special-cased) | none | none | p1 = seconds | p1×60 | U (a "wait"? ) |
| 77 | 2,0,0,0 | unnamed, blank | none | none | p1 | 0 | U |
| 78 | 1,20,32,0 | **Self Destruct** (glyph 110:32) | H `seg74:0x0873` (menu 733, confirm STR 2227) | `0x3541` | — | 20 | C |
| 79 | 3,5,72,0 | unnamed (glyph 110:27; same shape as 40) | none | none (outside every switch) | p1,p2 | 5 | U |

Note: selectors 1/2, 14, 18, 21/22, 40, 65-68, 73, 75-77, 79 have **no producer** in the human
planner (`seg74`/`seg80`) or AI emitter (`seg30`): all 13 `seg12:0x02A5` callers and 11
`seg80:0x01F6` callers were read. Only 3, 23, 69, 78 among the "unnamed" ones are live.

## 3. Prod / Zap (selector 3)

| Aspect | Value | Evidence | St |
|---|---|---|---|
| Menu | Commands → "Zap..." id 731 (`0x2DB`) → `seg79:0x089D` → `seg74:0x07BA` | jt `seg79:0x0D08` | C |
| Dialog | DLG #57 "Zap for how many seconds?", proc `seg26:0x1714`, scrollbar range 1..40 | `seg26:0x178C..0x1794` | C |
| Enabled when | game-options byte `+2C` ≠ 0 (DLG #46 "Zap" checkbox) | `seg77:0x01D2..0x01E7` | C (field) / I (checkbox link) |
| Dock rule | refused in dock: STR 2201 "No firing of weapons in the dock!" (`0x899`) | `seg74:0x07D4..0x07E3` | C |
| Record | `[3, seconds]`, duration seconds×60 | `seg74:0x0842..0x084B`, `seg13:0x0928` | C |
| Execute | `seg6:0x2BD9`: each tick calls `0x4091` (periodic scan refresh: next scan = now+30+5·(rand&15), `seg96:0x0366` mode 2). If now < end and now ≥ program `+1A` (cooldown) and `seg18:0x05F3` finds a **live enemy-Side robot whose occupied tile (`+48/+4A`) equals the zapper's logical tile (`+44/+46`)**: creates projectile **type 5** at the zapper's tile, impact now+5 (`seg6:0x1A08`), extends movie end (`0x6330`), sets cooldown `+1A = now + 0 + 60` (`0x4005`). | `seg6:0x2BD9..0x2D1F`, `seg18:0x05F3..0x072B`, `seg6:0x4005` | C |
| Range | **Same tile only** (contact weapon). No cone/LoS/range test. | `seg18:0x06A1..0x06AF` | C |
| Impact | type 5 → `seg6:0x57CF`: shooter `+74`++ (zap counter, STR 4018 "%d zaps did %d damage"), FX 9, then `seg6:0x602B`: every live enemy-Side robot on that tile takes **60 + (rand & 63) = 60..123** via `seg6:0x5A2B` (damage kind 3), then stagger `0x4060`. No posture/cover/distance terms. | `seg6:0x57CF..0x583E`, `seg6:0x60EE..0x6135` | C |
| Rate | at most one zap per 60 ticks while the command lasts | `seg6:0x4032..0x404A` | C |
| Ammo | none found | — | I |

## 4. Time Bomb (selector 23) and Bomb family (21/22)

| Aspect | Value | Evidence | St |
|---|---|---|---|
| Menu | "Place Bomb..." id 732 → `seg74:0x06C6` | `seg79:0x08BD` | C |
| Dialog | DLG #2 "Bomb Fuse and Placement / Fuse length after placement:", proc `seg26:0x1852`, range **0..40 s** | `seg26:0x18B2..0x18BB` | C |
| Enabled when | current robot `+3A` ≠ 0 | `seg77:0x01ED..0x0202` | C (field) / I ("carries Time Bomb", DLG #46) |
| Plan side | robot `+5A = fuse×60`; robot `+58` (bombs carried) decremented; record `[23, fuse, 0, bombsLeft]` | `seg74:0x074A..0x0791`, AI `seg30:0x104A` | C |
| Execute | `seg6:0x2B08`: if robot `+58`==0 → write p3=0, nothing placed. Else p3=`+58`−1 and `seg28:0x0D13` arms the bomb item carried by this robot (item slots 12..15 of the item list, `+14`=carrier, flag `+10` bit 2 = armed), sets item pos `+16..+1C` = robot tile and detonation time `+0A = now + fuse×60 + dur(23)=60`. | `seg6:0x2B45..0x2BB8`, `seg28:0x0D13..0x0DB6` | C |
| Detonation | per-tick scan `seg6:0x542E`: armed bomb with `+0A ≤ now` (and < turn end) → disarm, `seg6:0x5D34` → blast `0x5D73` **category 2** (DGROUP `0x1606/0x1610`: r0 120–151, r1 80–111, r2 40–71, r3 20–35, r4 10–17) at item tile, owner = carrier, kind 3; FX 15; extends movie (`0x6330`). | `seg6:0x549C..0x553F`, `seg6:0x5D34..0x5D72` | C |
| Friendly fire | blast loop damages all Sides (RE §18) | `seg6:0x5DC8..0x5F07` | C (prior) |
| Sels 21/22 | Bomb weapon-select / one-param op; never produced; no dispatch. | §2 note | C |

## 5. Self Destruct (selector 78)

| Aspect | Value | Evidence | St |
|---|---|---|---|
| Menu | "Self Destruct..." id 733 (STR 824) → `seg74:0x0873`; confirm STR 2227; refused in dock | `seg74:0x08CA..0x08E4` | C |
| Enabled when | The Team has **exactly one robot left alive**. `seg21:0x076C(team)` counts robots whose damage `+0x34` has not reached the class armor byte `0x0CA9 + class×4` and whose `+0x78` bit `0x10` is clear; `EnableMenuItem(733, count == 1 ? MF_ENABLED : MF_GRAYED)`. `+0x34` is accumulated damage (copied from `seg96:0x0231` at `seg95:0x0636`, clamped to armor in `seg6:0x5B09`). Bit `0x10` is set only when the sport type `+0x18` is 3 (`seg21:0x026D`), so it never applies in Survival. | `seg77:0x0208..0x0223`, `seg21:0x076C..0x07DB` | C |
| Record | `[78]`, 20 ticks (desc row 78) | `seg74:0x08E2` | C |
| Execute | Called from the command-start switch (`seg6:0x4C7F`, `0x4E80`). `seg6:0x3541`: projectile **type 3** at own tile, impact now+10; type 3 → `seg6:0x5675` → blast `0x5D73` **category 2** at that tile (same table as Time Bomb). | `seg6:0x3579..0x35C3`, `seg6:0x5694..0x56A8` | C |
| Self-damage | robot is at radius 0 → 120–151 before posture cut; usually fatal (armor ≤140) | blast loop includes all robots | I |

## 6. Sport verbs (STR 826-831) → selector 69

| STR | Menu id | Sport (`game+18`) | Command | Executor branch (`seg6:0x2F36`, jt `0x2FBE`) | St |
|---|---|---|---|---|---|
| 826 Grab Coin | 734 `0x2DE` | 1 Treasure Hunt | sel 69 | `0x32DB` (item log kind 2, FX 12) | C |
| 827 Capture Flag | 735 `0x2DF` | 2 CTF | sel 69 | `0x2FC6` (items on tile, `seg28:0x0F0D` eligibility, capture `0x1544` / pick up `0x16B7`, FX 13) | C |
| 830 Place Flag | 736 `0x2E0` (only when `si==1`, i.e. placement turn) | 2 | **no command**; `seg74:0x0A00` enters placement mode (`seg77:0x0FDA`, mode 2) | — | C |
| 828 Rescue Hostage | 738 `0x2E2` | 3 Hostage | sel 69 | `0x33EB` (kind 4, value 400 `0x190`, FX 14) | C |
| 829 Tag Base | 737 `0x2E1` | 4 Baseball | sel 69 | `0x30D8` (kind 1, FX 12) | C |
| 831 Place | 739.. `0x2E3+n` | 3 (hostage placement) | no command; `seg74:0x0940` (mode 3) | — | C |

Menu build `seg79:0x1044..0x10B5` (jt `0x11B3`); WM_COMMAND routing `seg79:0x04C4..0x04FC`
(734/735/737/738 → `0x08FD` → `seg74:0x08F6`). `seg74:0x08F6` refuses in the dock with STR 2228
("nothing to pick up here"). Item pickup/scoring internals (`seg28`) are **not** decoded here.

## 7. Weapon selection, ammo, Aim/Scan mapping

| Table / fn | Content | Location | St |
|---|---|---|---|
| Weapon id → select sel | 1 Missile→13, 2 Auto→10, 3 Burst→7, 4 Rifle→4, 5 Grenade→17 | `seg77:0x03A5`, `seg30:0x0D8E..0x0DDF` | C |
| Weapon id → Aim sel | 0,15,11,8,5,19 | DGROUP `0x0B52` (file `0x7E152`), `seg77:0x03E7` | C |
| Weapon id → Scan sel | 0,16,12,9,6,20 | DGROUP `0x0B46` (file `0x7E146`), `seg30:0x0F8C..0x0FA0` | C |
| Select sel → weapon id (icon/STR 604+id) | 1→6 Prod, 4→4, 7→3, 10→2, 13→1, 17→5, 21→7 Bomb | `seg14:0x07B4`, jt `0x07EF` | C |
| Carried mask robot `+3E` | bit1 Missile, 2 Auto, 4 Burst, 8 Rifle, 0x10 Grenade; current weapon `+40` | `seg30:0x0D6D..0x0DD8` | C |
| Ammo | Missiles `+56`, Grenades `+54`; Aim decrements at plan time (`seg74:0x1F26..0x1F69`) and stores remaining in p3; out-of-ammo blocks with STR 2202 (`seg74:0x1D75`); AI auto-switches to Auto/Burst/Rifle (`seg30:0x0E2E`) | — | C |
| Scan&Fire shot budget | p3 = 63 means "current ammo"; executor replaces with `+56/+54`, decrements per shot, `seg12:0x0466` | `seg6:0x2967..0x29E3` | C |
| Projectile types | 1 Grenade (blast cat 0), 2 Missile (cat 1), 3 Self Destruct (cat 2), 4 bullet, 5 Zap. Time Bomb uses item path, cat 2. | `seg6:0x2339`, `0x280E`, `0x35A2`, `0x2CD7`; impact jt `seg6:0x588E` | C |
| Weapon-select exec | `seg6:0x4D07`: program `+1A = now`, `+1C = 0` (resets Scan&Fire cooldown/shot count) | `seg6:0x4D07..0x4D1B` | C / I (field meaning) |
| Weapon-select pose | pose 5→6→5 then weapon pose at 15 ticks | `seg5:0x02BE..0x030C` | C |

## 8. Scan-for-duration (32..39) and moves

| Sel | Detail | Evidence | St |
|---|---|---|---|
| 32..39 | Exec `seg6:0x2D20` calls the same periodic scan refresher as Zap (`0x4091`): re-scans the current heading every 30–105 ticks (`30+5·(rand&15)`) until the command ends. Code window prints `%d, %d` (p1+1, p2+1) via `seg14:0x0CBA` default case — a presentation quirk; an unreferenced older formatter `seg14:0x0B74` prints `m:ss` for 22 and 32..39. | `seg6:0x2D20..0x2D58`, `seg6:0x40C2..0x4102` | C |
| 41..48 | Exec `seg6:0x2D59`: occupied tile switches to destination at elapsed ≥15. | `seg6:0x2D8E..0x2DDE` | C |
| 49..64 | Exec `seg6:0x2E04`: occupied tile = start until 15, midpoint `(start+dest)/2` until 25, then destination. | `seg6:0x2E41..0x2EA9` | C |
| Move offsets | DGROUP `0x0B14` 5×5 words, index `(dy+2)·5+(dx+2)`: row −2 `63 64 49 50 51`; −1 `62 48 41 42 52`; 0 `61 47 0 43 53`; +1 `60 46 45 44 54`; +2 `59 58 57 56 55`. | `seg14:0x0788` | C |
| 74 Deploy | `seg6:0x2ECF` → `seg6:0x11B3(x,y)` + FX 8. | | C |

Deploy placement: sel 74 is not in the re-dispatch set (`0x4D3B..0x4E35`), so `0x2ECF` runs once at the
record's start. The robot is on the board from tick 0 and stays busy until tick 120 (engine rules revision 5). **C**

## 9. Stepped heading/posture emission (planner + AI)

- Heading (`seg80:0x0422`, `seg30:0x13A2`): if current heading is 0 (unset) emit `23+target` once.
  Otherwise step `si += dir` (dir = +1 if `0 ≤ Δ ≤ 4` or `Δ ≤ −4`, else −1; wraps 1..8) emitting
  `23+si` for each intermediate octant and the target. Cost = 5 ticks × octants turned. **C**
- Posture (`seg80:0x0352`, `seg30:0x12DD`): if current is 0 or `|Δ|<2` emit `69+target`; otherwise
  emit the intermediate posture first. Upright↔Crouching = 71 then 72 (or 71 then 70) = 20 ticks. **C**

## 10. Still unknown

| Item | Why open |
|---|---|
| Sels 2, 14, 18, 22 (`[1,30,50]` / `[2,30,80]`) | No producer, no executor, no animation; glyphs 111:18/111:20 exist for 2 and 22 only. Likely cut "fire Prod" / "reload" / "throw bomb" designs. |
| Sels 40, 79 (rotating scan?) | Animation for 40 rotates heading every 5 ticks; 79 is outside every switch. No producer. |
| Sels 65-68, 73, 75, 76, 77 | No producer/executor. 76's duration is p1×60 (special-cased in `seg13:0x08C5`), suggesting a "wait N s" verb never wired up. |
| Initial `+58` bomb count and `+3A` / `+2C` option wiring | Fields confirmed; the setup code that copies DLG #46 checkboxes into them not traced. |
| Sport item rules | Pickup/capture/scoring inside `seg28` (`0x0F0D`, `0x1140`, `0x11CA`, `0x1282`, `0x0C92`) not decoded. |
| Icon art | Bitmap sets 110/111 glyph indices listed; images not dumped. |
