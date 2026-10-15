# RoboSport non-Survival sports: binary rules extraction

Source: `ROBO.EXE` (NE, Win16). This file is documentation only. It holds no binary bytes.
Code is cited as `segN:0xOFF` (segment-relative). Data is cited as DGROUP `0xXXXX` (file `0x07D600+X`).
Confidence tags: **[C]** Confirmed (I read the disassembly), **[I]** Inferred (strong reading of the code or strings, not fully traced), **[U]** Unknown.
Tooling: `tools/re/ne_dis.py` (relocation-aware disassembler: `d`, `jt`, `callers`, `dumpall`) and `tools/re/dlg_ids.py` (dialog controls with ids).

## 0. Summary of answers

| Sport | Mode value (`game+0x18`) | Objects | Verb (selector 69) effect | Points | Terminal effect |
|---|---|---|---|---|---|
| Survival | 0 | none | none | ceremony only | last Side standing |
| Treasure Hunt | 1 | `game+0x24` coins (1-12, default 4) | grab every coin within 1 tile | 50/coin | none found **[U]** |
| Capture the Flag | 2 | 1 flag per Team, in its own Home | pick up a flag within 1 tile | 400 per capture; +100 ceremony Flag Bonus if your own flag was never captured | capturing a Team's flag **wipes that Team out** |
| Hostage | 3 | 1 hostage robot per giving Team, held in the taker's Home | rescue own-Side hostage within 1 tile | 400 per rescue; +100 ceremony Hostage Bonus per hostage still held | none found **[U]** |
| Baseball | 4 | 4 or 5 bases (pattern `game+0x26`) | tag every untagged base within 1 tile | 100/100/200/400/400 by your tag count | tagging all bases **wipes out every enemy-Side Team** |

The four sport verbs (Grab Coin, Capture Flag, Rescue Hostage, Tag Base) all queue the same command, **selector 69** (15 ticks, see [commands.md](commands.md)). The resolver dispatches on the sport mode.

## 1. Where state lives

### 1.1 Game/scenario struct (handle at DGROUP `0x2E3C`, file `0x080A3C`)
- `seg18:0x00CC` returns the handle from `[2E3Ch]`, and `seg18:0x00F4` allocates 0x34 bytes. **[C]**
- Defaults are set in `seg18:0x001D..0x00B3`: `+0x18`=0 (Survival), `+0x24`=4 coins, `+0x26`=0 (Four Cross), `+0x2D`=0 (time bomb off), `+0x1C..+0x23` = 0xFFFF (no hostages). **[C]**

| Offset | Meaning | Evidence |
|---|---|---|
| `+0x00..+0x07` | Team handles (4) | loops in `seg42:0x0A46`, `seg28:0x030E` **[C]** |
| `+0x14` | Team count | every Team loop **[C]** |
| `+0x18` | **Sport mode**: 0 Survival, 1 Treasure Hunt, 2 Capture the Flag, 3 Hostage, 4 Baseball | written in `seg17:0x20F8` as `ctrlId-0x578` (Custom Game radio buttons 1400..1404, DLG #3). The setup dispatch is `seg28:0x024B` (table `seg28:0x02FF`: 1→coins, 2→flags, 3→hostages, 4→bases) **[C]** |
| `+0x1C+2*i` | Hostage target: index of the Team that takes Team *i*'s hostage, or 0xFFFF for none (DLG #45) | `seg28:0x03ED`, `seg21:0x0263`, `seg18:0x19D3` **[C]** |
| `+0x24` | Coins per turn (DLG #44, "Coins (1-12)") | `seg28:0x03A8`, `seg28:0x0A31` **[C]** |
| `+0x26` | Base pattern 0..3 = Four Cross, Five Cross, Four Corner, Five Corner (STR 336-339, DLG #43) | `seg18:0x1D4A` returns (count, cross): 0→(4,1), 1→(5,1), 2→(4,0), 3→(5,0) **[C]** |
| `+0x2D` (byte) | "Time Bomb" option (DLG #46). It creates the type-4 objects | `seg28:0x0577` **[C]** (option ↔ checkbox mapping is **[I]**) |

### 1.2 Team fields used by sports
- `+0x28` Side; `+0x2A` **Home index 0..3** (DLG #3 "Home" column). `seg18:0x097D(game, homeIdx, &side)` and `seg18:0x0A09(game, &team, homeIdx)` look a Team up by Home. **[C]**
- `seg18:0x091A(team)` returns the Team's index in the game list. Scores and base-tag bits use this index. **[C]**

### 1.3 Robot fields used by sports
- `+0x78` flags: bit0 marks the **designated hostage robot**. `seg21:0x0203` sets it on the first robot added to a Team that has none. Bit1 marks the special-item carrier (`seg21:0x01EA`, `seg69:0x0150`). Bit4 (0x10) means **currently held hostage**. `seg21:0x022B` sets it when mode==3, bit0 is set and the Team gives a hostage. The rescue path clears it (`seg28:0x0B92`). **[C]**
- Per-robot counters are summed per Team into the ceremony record (`seg42:0x0D92..0x0E52`). **[C]** (labels are **[I]**)
  - `+0x60`: kills. `seg6:0x62B6` increments it when a sport wipe-out kills a robot.
  - `+0x62`: primary objective count. Coins collected (`seg6:0x334E`), bases tagged (`0x3153`), hostages rescued (`0x34C5`) and flags captured (`0x535D`).
  - `+0x64`: secondary objective count. Flags dropped (`seg6:0x53EE`) and hostages killed (`seg28:0x23E3`).
  - These counters match ceremony STR 4009-4014 and 1433-1438.
- Program object `+0x20`: death tick (0xFFFF = alive). `seg14:0x0951` reports "dead at or before tick t". **[C]** (the "death tick" reading is **[I]**, consistent with `seg14:0x071C` use)

### 1.4 Sport-object manager (handle at DGROUP `0x357A`, file `0x080B7A`)
`seg28:0x001E` reads `[357Ah]`, and `seg28:0x0046` allocates 0xA0 bytes. **[C]** Layout:
- `+0x00..+0x1F`: **16 object slots** (handles). Slots 0-11 hold flags, coins, hostages and bases. Slots 12-15 hold type-4 time bombs. `seg28:0x0E15` computes slot = `param` for types 0-3 and `param+12` for type 4. **[C]**
- `+0x20 + 6*k`: per-turn **event log** of {word tick, byte type, byte slot, byte p1, byte p2}. `+0x9A` holds the count (**max 20**, `seg28:0x0CB0 cmp 14h`), `+0x98` the replay cursor, `+0x9C` the last replayed tick, and `+0x9E` bit0 = "no sport". **[C]**
- The manager is saved and loaded as 0x190 bytes (`seg28:0x2425`/`0x24A4`). `seg28:0x2551` serializes the 12 start positions. **[C]**

### 1.5 Sport object (0x22 bytes, `seg28:0x0081`)

| Off | Field | Evidence |
|---|---|---|
| `+0x02` | Hostage: **taker** Team handle | `seg28:0x0481` **[C]** |
| `+0x04` | Hostage: taker Team index | `seg28:0x048E` **[C]** |
| `+0x06` | **Type**: 0 flag, 1 coin, 2 hostage, 3 base, 4 time bomb | creators `0x030E`/`0x039C`/`0x03ED`/`0x050C`/`0x056B` **[C]** |
| `+0x08` | Param: flag→owner Home idx; coin/base→index; hostage→giver Home idx; bomb→Team index | same **[C]** |
| `+0x0A` | Event tick (rescued/killed) or bomb fuse tick | `seg28:0x0776`, `0x0D9F` **[C]** |
| `+0x0C` | Hostage "cry" countdown (32+rand&15, then 64+rand&63). Cosmetic | `seg28:0x046C`, `seg6:0x51B1` **[C]** |
| `+0x10` | Flags: 1 = placed or reset this turn, 2 = bomb armed, 4 = rescued, 8 = killed | `0x035C`, `0x0DB1`, `0x0776`, `0x0790` **[C]** |
| `+0x12`/`+0x14` | Carrier robot, turn-start and current (hostage: the hostage robot; bomb: its carrier) | `seg28:0x0843`/`0x08BD` **[C]** |
| `+0x16,+0x18`/`+0x1A,+0x1C` | Tile x,y, turn-start and current | same **[C]** |
| `+0x1E`/`+0x1F` | Base tag bitmask by Team index, turn-start and current | `0x0723`, `0x12CE` **[C]** |
| `+0x20`/`+0x21` | State, turn-start and current: 0 = live, 1 = gone (collected, captured, rescued or killed) | `0x073C`, `0x0BDB` **[C]** |

Every turn-start/current pair is double-buffered. `seg28:0x0843` rewinds current to start for movie replay, and `seg28:0x08BD` commits current to start at turn end. **[C]**

### 1.6 Event types (applied by `seg28:0x066A`, table `seg28:0x07F8`; recorded by `seg28:0x0C92`)
| Type | Effect | Recorded by |
|---|---|---|
| 0 pickup | carrier = robot from `seg18:0x0356(p1)` | CTF verb `seg6:0x3031` |
| 1 tag | `+0x1F |= 1<<p1` | Baseball verb `seg6:0x3169` |
| 2 remove | state=1, carrier=0 | coin grab `seg6:0x3332`, flag capture `seg6:0x52F2`, bomb burst `seg6:0x552B` |
| 3 drop | state=0, carrier=0, pos=(p1,p2) | flag drop `seg6:0x53E3` |
| 4 rescued | `+0x10|=4`, `+0x0A`=tick | `seg6:0x3465` |
| 5 killed | `+0x10|=8`, `+0x0A`=tick | `seg28:0x2392` |

All six are **[C]**. `0x0C92` applies an event only when it records it. **A 21st sport event in one turn is silently dropped**: no pickup, no score change. **[C]** (`seg28:0x0CB0..0x0D0E`; the score call in the verb handlers still runs, see §7)

## 2. Lifecycle (all sports)

- **Game setup** `seg28:0x01F2` (called from `seg62:0x0048`): it frees all 16 slots and dispatches on mode to the creators. If mode is outside 1..4 it sets manager `+0x9E` bit0. It then always runs `0x056B` (time bombs if `game+0x2D`). **[C]**
- **Per tick** `seg6:0x50D3` runs from the turn loop (`seg6:0x4812`). Mode 2 runs the CTF capture/drop check `seg6:0x5242`; mode 3 runs the hostage cry `seg6:0x5135`. Every mode runs the bomb check `seg6:0x542E`. **[C]** That the call runs once per tick is **[I]**.
- **Turn end** `seg28:0x0909` (from `seg7:0x2FE7`): it replays events to the end tick and commits. It clears the log. Mode 1 runs **coin respawn** `0x09F3`. `0x0AA9` handles flag returns and hostage completion, and `0x0C1A` decrements armed bomb timers by the turn length (min 5). **[C]**
- **Interaction range**: `seg28:0x1C78` yields every available object in slots 0-11 whose current tile satisfies `|dx|<=1 && |dy|<=1` from the robot's current tile (`seg21:0x05D0`). That is the 3×3 block, same tile included. **[C]**
  - "Available" is defined in `seg28:0x0ED3`: state 0, type != 4, and either the object is a hostage or it has no carrier. **[C]**
- **Verb queueing** `seg74:0x08F6`: if the robot's planned tile is off-map (in the Dock), it shows STR 2228 ("Thanks for keeping the Dock clean…nothing to pick up here"). Otherwise it appends command selector `0x45`=69 with zero params. **[C]**
- **Verb dispatch**: in `seg6:0x4C7F`'s selector table (`seg6:0x4E9C`), selector 69 → `0x4E68` → `seg6:0x2F36`, which switches on `game+0x18` (table `0x2FBE`). 1→`0x32DB`, 2→`0x2FC6`, 3→`0x33EB`, 4→`0x30D8`. **[C]**
- **Menu**: `seg79:0x102D` adds the mode's verb to the Commands menu. TH gets STR 826 (id 0x2DE). CTF gets STR 827 (0x2DF) and, when `si==1`, STR 830 "Place Flag". Hostage gets STR 828 (0x2E2) and, when `si==1`, one "Place <Team>" entry per hostage pair (STR 831). Baseball gets STR 829 (0x2E1). **[C]** That `si==1` means the setup/placement turn is **[I]**.
- **Scoring** goes through `seg96:0x1EEF(movie, teamIdx, points, tick-5)`. It adds to the per-Team score word at movie-record `+0x1F4+2*team` and logs record type 7. **[C]**
  - The floating "+N" sprite comes from `seg6:0x15BB`, which maps 50/100/150/200/400/600 to frames 0x0B..0x10. It is cosmetic. **[C]**
  - How `+0x1F4` feeds Team `+0x30` (the "existing score" in the ceremony) is **[U]** (start at `seg96:0x1EEF` writers/readers of `+0x1F4`).

## 3. Treasure Hunt (mode 1)

**Setup** `seg28:0x039C`: it creates `game+0x24` coins (type 1, param = index 0..N-1) and places each with `seg28:0x1867`. **[C]** The count range 1-12 comes from DLG #44, and slots 0-11 cap it at 12. **[C]**

**Placement** `seg28:0x1867` **[C]**. Let `sx`,`sy` be the Home spans from `seg87:0x1F32` (6/8/12/16 by map size, §12 of reverse-engineering.md).
- The function first takes a band from `seg87:0x2067`. An odd index takes the horizontal band `x∈[0,W)`, `y∈[sy, H-sy)`. An even index takes the vertical band `x∈[sx, W-sx)`, `y∈[0,H)`.
- It then halves the band. An odd index halves the width; an even index halves the height. For index&2 it keeps the first half. Otherwise it keeps the second half: `x+=w` or `y+=h`, at `0x18DC..0x18ED`.
- So index mod 4 picks the region: 0 = bottom half of the vertical band, 1 = right half of the horizontal band, 2 = top half of the vertical band, 3 = left half of the horizontal band.
- `seg87:0x2393` then picks `x = x0 + (rand&0xFFF) % w` and `y = y0 + (rand&0xFFF) % h`. It retries until `seg87:0x28A3` accepts the tile (terrain check, **[I]** "passable") and no other object's start tile equals it.
- Coins never spawn inside the four corner Home rectangles, because both bands exclude them. **[C]**

**Grab Coin** `seg6:0x32DB` **[C]**:
- Each coin within the 3×3 block is collected: event 2 (state=1), robot `+0x62`++, and 50 points accumulated.
- The total goes to the robot's Team via `seg96:0x1EEF` (points=50×n). Sound 0x0C plays via `seg68:0x07AA`.

**Respawn** `seg28:0x09F3` (turn end, mode 1 only) **[C]**: every coin in slots `0..game+0x24-1` with state≠0 resets to state 0 and is re-placed by `0x1867`. The field therefore holds exactly N coins at every turn start.

**End condition**: no Treasure-Hunt-specific end or bonus was found. The ceremony adds only the generic terms. **[U]** The best lead is the Score Limit (DLG #39, "game will end when a team has a score >= limit", game `+0x2E` default 1000 at `seg18:0x0066` **[I]**). Trace readers of game `+0x2E`, e.g. `seg17:0x2B68`, `seg18:0x0E9C`.

## 4. Capture the Flag (mode 2)

**Setup** `seg28:0x030E` **[C]**: for each Team it creates a type-0 flag with param = Team `+0x2A` (Home index). The slot equals the Home index. Flag `+0x10|=1`.
- `seg28:0x1A76` places the flag at a random accepted tile inside the **owner's Home rectangle** (`seg87:0x1EF6` + `0x2393`).
- Players can then move it with "Place Flag" (STR 830) and "Select flag position in Home Area of map" (STR 626). The UI path is **[I]**; start at `seg74`/`seg30` callers of `seg28:0x13E7`/`0x14F4`.

**Capture Flag verb** `seg6:0x2FC6` **[C]**: for each available flag in the 3×3 block where `seg28:0x0F0D(flag, robot)` is true, the robot picks it up (event 0, carrier = robot).
- `0x0F0D` rule: pickup is allowed unless the robot's Side equals the flag owner's Side **and** the flag sits inside its owner's Home (`seg87:0x0383`). Enemies may lift a flag anywhere. Its own Side may lift it only when it is outside its Home.
- A carried flag is not "available" (`0x0ED3`), so a flag cannot be stolen from its carrier.
- The cosmetic effect differs for own-Side (`seg6:0x1544`, sprite 0x1F) and enemy pickup (`0x16B7`, sprite 0x1E). No points are awarded on pickup.

**Per-tick check** `seg6:0x5242` (every carried object) **[C]**:
- **Capture**: `seg28:0x0FCD` is true when the carrier's Side ≠ flag owner's Side and the carrier's current tile is inside **the carrier's own Team Home** (`+0x2A` rect). The game then:
  - records event 2 (flag state=1, gone);
  - awards **400** to the carrier's Team (`seg96:0x1EEF`) and increments carrier `+0x62` (flags captured);
  - finds the flag owner by Home index (`seg18:0x0A09`) and calls `seg6:0x6200(ctx, ownerTeam, carrier)`.
- **Wipe-out** `seg6:0x6200` **[C]**: every living robot of that Team (`seg21:0x0AB1`==0) takes damage = class armor (`DGROUP 0x0CA9+4*class`) − damage so far (`seg96:0x0231`). That is lethal.
  - The death is logged at tick-5 (`seg14:0x071C`, `seg96:0x1F5A`), and the carrier gets `+0x60`++ per kill.
  - `seg6:0x6330` then extends the turn end (ctx `+0x0A`) by 150 ticks if 150 or fewer remain. **[I]** (lets the movie show it)
- **Drop**: when the check is not a capture and the carrier's program death tick ≤ now (`seg14:0x091B`), the game records event 3 at the carrier's tile (flag back on the ground, state 0) and increments carrier `+0x64` (flags dropped).

**Turn end** `seg28:0x0AA9` **[C]**: if a flag's carrier is on the **flag owner's Side**, the carrier is cleared and the flag is re-placed at a random tile in its owner's Home (`0x1A76`). This is "returning" your own flag; it happens only at turn end, not on contact. An enemy carrier keeps the flag across turns.

**Ceremony Flag Bonus** `seg42:0x0AA9..0x0AE6` **[C]**: for each Team, `seg28:0x1B35` finds the flag whose param equals the Team's Home index. If that flag's state is 0 (never captured; dropped or carried still counts as 0), the Team gets **+100** (STR 1415 "Flag Bonus"). `seg22:0x034F` builds the same display flags (DGROUP `0x2FA0[team]`, `0x2FA8`).

**End condition**: CTF has no explicit win test. Capture wipes the flag owner, so the game reduces to last Side standing. **[I]** (Survival's end check was not re-traced here.)

## 5. Hostage (mode 3)

**Who is the hostage** **[C]**: the hostage is the **designated hostage robot** of the *giving* Team (robot `+0x78` bit0, the first robot created, `seg21:0x0203`). It is not a neutral prop. `seg21:0x022B` marks it held (bit 0x10) at robot init when mode==3 and `game+0x1C+2*team`≠0xFFFF.

**Pairs**: DLG #45 says to select the giving Team first, then the taking Team. A Team gives at most one hostage and takes at most three, and at least one hostage is required (STR 2204). That text is **[C]** (strings). Where the limits are enforced is **[U]**; start at the DLG #45 handler, `seg30:0x07F3`/`0x0879`.

**Setup** `seg28:0x03ED` **[C]**: for each giver *i* with a target, it creates a type-2 object.
- Fields: param = giver Home idx, `+0x02` = taker Team, `+0x04` = taker index, `+0x0C` = 32+rand&15, and `+0x12/+0x14` = the hostage robot (`seg69:0x0204`).
- Position: `0x1A76` puts hostage objects at a random tile in the **taker's Home** (`seg87:0x1EF6` with taker `+0x2A`).
- `seg18:0x19A2` places the hostage robot the same way, and parks it at (-64,-64) in another call mode.
- Players can then reposition it ("Select Hostage position in Home Area", STR 627). **[I]**
- STR 2209 warns when the positions change.

**Rescue Hostage verb** `seg6:0x33EB` **[C]**: for each hostage object in the 3×3 block where `seg28:0x11CA(obj, robot)` is true, the game records event 4 (rescued flag and tick), awards **400** to the rescuer's Team, increments rescuer `+0x62`, and plays sound 0x0E.
- `0x11CA` requires a hostage robot that is not yet flagged 4 or 8, and the hostage robot's Team on the **same Side** as the rescuer. You rescue your own (or an ally's) robot. The taker cannot "rescue".

**Killing hostages** `seg28:0x20FA` is called from the blast loop `seg6:0x5F43` only when mode==3 **[C]**:
- Which hostages are eligible: every hostage that is not killed and not already rescued before now.
- The blast must reach it through `seg87:0x2D07`: Euclidean distance < 3 for blast kind 2, < 2 for kind < 2, no effect for kind > 2.
- `0x22C6` kills the hostage robot, records event 5 (killed) and adds blaster `+0x64`++.
- **Score quirk**: `seg96:0x1EEF` credits the **hostage robot's own Team index** with **+600** if the blaster is on a different Side from it, else **−75** (`0x23BF..0x23D8`). This reads oddly but is literal. **[C]**
- Whether bullets can hit a held hostage robot is **[U]**. Start at the `seg76` validator and `seg21:0x0A78` (bit 0x10 test) callers.

**Turn end** `seg28:0x0AA9` **[C]**: a hostage with state 0 and flag 4 or 8 gets robot bit 0x10 cleared and is moved to its Team's **Dock** slot (`seg18:0x1239`: Home index → DGROUP `0x0D06`/`0x0D26` offset tables, then `seg21:0x0637`/`0x0594`). Visibility is updated (`0x1F40`), and state becomes 1. **[C]** That a rescued robot rejoins play from the Dock is **[I]**.

**Ceremony Hostage Bonus** `seg42:0x0AF5..0x0B21` **[C]**: for each Team, `seg28:0x1BD9` counts hostages whose `+0x02` (taker) is this Team and whose state is 0, meaning still held. The Team gets **+100** per held hostage (STR 1416). The display copy is at `seg22:0x039C` (DGROUP `0x2FA4[team]`, `0x2FA9`).

**Hostage cry** `seg6:0x5135`, per tick: it is cosmetic. Note that it draws from `seg55:0x0073` every 64-127 ticks per hostage. Which RNG stream that is was **[U]**, and it matters for replay determinism.

**End condition**: none sport-specific was found. **[U]** (same leads as §3)

## 6. Baseball (mode 4)

**Setup** `seg28:0x050C` **[C]**: it reads (count, cross) from `seg18:0x1D4A` and creates `count` type-3 bases with param = index. Each base is placed by `seg28:0x199F` → `seg87:0x210E` rectangle → inset → random tile.
- DLG #43 calls the field "the Dome". Whether a specific arena is forced is **[U]**.

**Base rectangles** `seg87:0x210E` (tables `0x2296` cross and `0x228C` corner) **[C]**. Let `w0=W-2sx` and `h0=H-2sy`.
- Cross:
  - 0 = top strip `(sx, 0, w0, h0/2)`;
  - 1 = right strip `(W-w0/2, sy, w0/2, h0)`;
  - 2 = bottom strip `(sx, H-h0/2, w0, h0/2)`;
  - 3 = left strip `(0, sy, w0/2, h0)`;
  - 4 = centre `(sx, sy, w0, h0)`.
- Corner: size `(w0/2, h0/2)` at 0 = NW `(0,0)`, 1 = NE `(W-w,0)`, 2 = SE `(W-w,H-h)`, 3 = SW `(0,H-h)`, and 4 = centred `(sx+w/2, sy+h/2)`.
- Inset (`seg28:0x19ED`): when global DGROUP `[0x14BA]`==0, any dimension > 5 is inset by 2 per side (x+=2, w-=4). Otherwise the threshold is 7. `[0x14BA]` is the same unidentified global that gates the Scan & Fire cooldown in reverse-engineering.md §0b. **[U]**

**Tag Base verb** `seg6:0x30D8` **[C]**: for each base in the 3×3 block not yet tagged by this Team (`seg28:0x1282`: bit `teamIdx` clear in `+0x1F`), the game:
- records event 1 (sets the bit) and increments `+0x62`;
- counts this Team's tagged bases with `seg28:0x1340`;
- awards **100** if the count is < 3, **200** if it equals 3, and **400** if it is > 3.

**Order is not enforced.** There is no sequence check: any untagged base counts, and several bases can be tagged in one action if adjacent. **[C]**

**Home run** `seg6:0x3228..0x3298` **[C]**: when the Team's tagged count equals the base count (4 or 5), `seg6:0x6200` wipes out **every Team on a different Side**, as in §4. The tags are per Team, so allies do not share progress.

**Ceremony**: no Baseball bonus term in `seg42`. "%d bases were tagged" (STR 4012) reports `+0x62`. **[C]**

## 7. Ceremony scoring: `seg42:0x09D1` fully decoded **[C]**

Inputs: movie handle (`seg88:0x001E`), game (`seg18:0x00CC`), sport manager (`seg28:0x001E`). For each Team *t*:
```
survivors[t] = seg21:0x076C(team)                       ; 0x0A71
flagBonus[t] = (mode==2 && ownFlag(t).state==0) ? 1 : 0  ; 0x0AA9..0x0AE6, global anyFlag=[bp-40h]
held[t]      = (mode==3) ? #hostages{taker==t, state==0} : 0 ; 0x0AF5..0x0B21, global anyHostage=[bp-42h]
contrib[t]   = team+0x30 + 150*survivors[t] + (survivors[t]>0 ? 400 : 0)
             + (anyFlag ? 100*flagBonus[t] : 0) + (anyHostage ? 100*held[t] : 0)   ; 0x0B89..0x0BE9
sideSum[team.Side] += contrib[t]                         ; 0x0C25..0x0C66
final[t] = sideSum[team.Side]                            ; 0x0C75..0x0CB6
```
Output record (far ptr arg):
- `+0..+5`: movie header words, with word 0 decremented when the second arg ≠ 0.
- `+6+2t`: `final[t]`.
- `+0x0E+8k+2t`: Σ robot counter `+0x5E+2k` over Team *t*'s robots, for k=0..12. So `+0x1E` holds objective-1 counts (coins, flags, bases, hostages saved) and `+0x26` holds objective-2 counts (flags dropped, hostages killed).

Note: the earlier text "two 100-point terms only for sport modes 2/3" is correct. They are exactly the CTF Flag Bonus (+100) and the Hostage Bonus (+100 per held hostage). In-game objective points (50/100/200/400/600/−75) arrive through Team `+0x30` (**[I]**, via `seg96:0x1EEF`).

## 8. Home-area interactions (consolidated)
- Home rectangle: `seg87:0x1F32`. Index 0 NW, 1 NE, 2 SE, 3 SW; span 6/8/12/16 by size. The point-in-Home test is `seg87:0x0383`. **[C]**
- CTF: flags spawn in and return to the owner's Home. You cannot pick up your own flag while it is in its Home. **A capture happens when an enemy carrier stands in the carrier's own Home** (not the flag owner's). **[C]**
- Hostage: hostages spawn in the taker's Home. Rescued or killed hostages go to the owner's Dock at turn end. **[C]**
- Treasure Hunt: coin regions exclude all four corner Homes. **[C]**
- Baseball: corner bases 0-3 overlap the Home corners before the 2-tile inset. Cross bases sit between Homes. **[C]**
- All sport verbs are refused in the Dock (STR 2228). **[C]**

## 9. Time bomb (type 4, mode-independent; for completeness)
- One bomb per Team when `game+0x2D`, carried by the Team's bit1 robot (`seg28:0x056B`). Its position is −10000 while carried. **[C]**
- Place Bomb (selector 23 → `seg6:0x2B08` → `seg28:0x0D13`) drops it on the robot's tile and arms it. The fuse is `60*seconds + now + seg13:0x08C5(0x17,0,0)` (DLG #2 "Fuse length after placement"). **[C]**
- `seg6:0x542E` detonates it when the fuse falls within the tick window: a blast of kind 3 via `seg6:0x5D34`, plus event 2. Armed fuses carry over between turns, reduced by the turn length with a minimum of 5. **[C]**

## 10. Open items (best starting addresses)
1. How the `seg96` `+0x1F4` score words become Team `+0x30`; Score Limit/Time Limit end checks (game `+0x2E`, DLG #39). **[U]**
2. Treasure Hunt and Hostage end conditions, if any beyond the generic limits. **[U]**
3. Hostage limits enforcement (one give, three take, at least one): the DLG #45 proc in `seg30`. **[U]**
4. Whether bullets and Scan & Fire can target a held hostage robot (bit 0x10): `seg76`, `seg21:0x0A78` callers. **[U]**
5. The setup-turn placement UI for flag and hostage ("Place", `si==1` in `seg79:0x1078`): `seg28:0x13E7`/`0x14F4`/`0x1D5D`/`0x1EB2` with callers in `seg29`/`seg30`/`seg34`. **[U]**
6. `[0x14BA]` meaning, and which RNG stream `seg55:0x0073` is (sport placement and the hostage cry both use it). **[U]**
7. The "Dome" wording: whether Baseball forces an arena. **[U]**
