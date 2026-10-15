# RoboSport RE: Stealth, Fence, ceremony, AI, and file formats

Scope: documentation only. Binary `ROBO.EXE` (NE, 101 segments, DGROUP = seg 101 at file
`0x07D600`, so DGROUP `X` = file `0x07D600+X`). All code addresses are `segN:0xOFF` from a
relocation-aware disassembly (`tools/re/ne_dis.py dumpall`). Every claim is tagged:

- **[C]** Confirmed: read directly from the disassembly or bytes.
- **[I]** Inferred: consistent reading, but the full producer/consumer chain was not traced.
- **[U]** Unknown: searched for and not found.

Common helpers used below: `KERNEL.ord18/19` = GlobalLock/GlobalUnlock; `seg55:0x0073` = game
RNG (returns state-1); `seg56:0x02A0` = tile distance; `seg21:0x06DF` = robot logical tile;
`seg18:0x00CC` = game-options handle.

---

## 0. Corrections to `docs/reverse-engineering.md` found on the way

| Doc claim | Binary truth | Evidence | Tag |
|---|---|---|---|
| §6: `seg96:0x09AF` + table `0x213A` is the **planner hit-preview** | It is the **per-tick visibility (spotting) roll**. Its only callers are `seg96:0x079D` and `0x0843`, inside the pairwise visibility routine `seg96:0x060D`. "bandArg" is the observed robot's **cover class**, "flagA" is its **moved-this-tick** flag, "flagB==1" is its **activity code 1**, and "weaponClass==4" is the observed robot's **class = Stealth** | xref `callers 96 0x09AF`; §1 below | C |
| §0b/§7b: AI accuracy add `{1:+2, 2:-1, 3:-3}` | `{Stupid(1): -3, Ferocious(2): +2, Crafty(3): -1, Paranoid(4)/other: 0}`. The adds are words of the fire-control table: `[0x15B2]`=idx14=-3, `[0x15A2]`=idx6=+2, `[0x15AA]`=idx10=-1 | `seg6:0x374F..0x3783`; DGROUP `0x1596` = `4,7,6,5,4,3,2,1,0,0,-1,-1,-2,-2,-3,-3,-4,-5,-6` | C |
| §5 projectile: `+0x0E` hit flag, `+0x0F` damage | `+0x0E` = **damage byte** (0 = miss) from `seg6:0x35D1`. `+0x0F` = a pass-through byte. `+0x02` = **damage-source kind** (1-3 explosive, 4 bullet, 5 zap), `+0x0A/+0x0C` = shooter/target **robot handles**, `+0x06/+0x08` = target tile (-1,-1 for bullets) | ctor `seg6:0x1A08`; bullet call `seg6:0x1E90→0x3CAE→0x3D52`; impact `seg6:0x5700..0x575A` | C |
| §9: tuple `(2,2,0,15)` (TIL 315) "most likely the Fence" | Fence is tuple **`(3,0,1,*)`**, defined only in code (§2). TIL 315 occupies tile bytes `0xF0..0xFF`, which the code writes as **runtime overlay markers** (home corners `0xF0..0xF7`, other markers `0xFA..0xFF`). The sight walk resolves those bytes back to the logical map | `seg87:0x2838`, `seg87:0x2A74`, `seg87:0x2ACF`, `seg87:0x1B2A` | C (Fence) / I (overlay use) |
| §18: Wall blocks sight because `TIL b2=2` | The walk blocks when **height `b0` ∈ {0,4}** and subtracts 3 per tile with `b2≠0`. For the shipped tuples this gives the same result | `seg87:0x1B67..0x1B95` | C |
| §10: DIB chunks are "Windows bitmaps for tile art" | DIB 300-315 are **1-bpp mono** 16×256 strips. DIB 350-365 are **4-bpp colour** 16×256 strips. The colour set is used when the display has ≥16 colours (`[0x3F30]=1`) | `seg71:0x0113..0x0122`, `seg58:0x0133..0x0196` | C |

---

## 1. Stealth (class 4)

### 1.1 Where class is stored

- Robot `+0x06` = class index (0 Rifle, 1 Burst, 2 Auto, 3 Missile, 4 Stealth). Accessor: `seg21:0x09B5`. The stat table at DGROUP `0x0CA8` is indexed `class*4` (`seg6:0x365F..0x366C`). **[C]**
- Inline `cmp word es:[bx+6],4` occurs exactly four times: `seg96:0x0A48` (visibility), `seg69:0x09BA` (team has Stealth), `seg10:0x0F87` (team-editor label STR 0x3F9=1017), and `seg28:0x0EE4` (a sport-object eligibility predicate that excludes Stealth). **[C]**

### 1.2 Visibility pipeline (per movie tick)

1. `seg6:0x5898` (called from `seg6:0x4832`) loops over Team pairs whose Side (`+0x28`) differs. If the pair is dirty (`seg96:0x03E0`), it calls `seg96:0x0484(ctx, teamA, teamB, idxA, idxB)`. **[C]**
2. `seg96:0x0484` clears the "newly seen" masks (`ctx+0x1A0`, `+0x1A8`). It sets the "to-remove" masks (`+0x1A4`, `+0x1AC`) to the full robot-bit mask of the other Team from DGROUP `0x2110` (`0xFF << 8*team`). Then, for every pair of live robots, it calls `seg96:0x060D`. Finally it calls `seg96:0x0AAC`. **[C]**
3. `seg96:0x060D(ctx, robotA, robotB, idxA, idxB)`:
   - It gets sight strength from `seg96:0x0900`. That routine recomputes `seg87:0x19E3` only when either robot's moved flag (`ctx+0x27C[idx]`) is set; otherwise it returns the cached pair value at `ctx+0x1B0`. If sight is 0, it stops. **[C]**
   - It gets cover classes from `seg87:0x1BF8`: `[bp-16h]` for A and `[bp-18h]` for B. If either is 0, it stops. **[C]**
   - **Activity gate:** if `27C[A]`, `27C[B]`, `29C[A]` and `29C[B]` are all 0, no new sighting occurs. Robots inside the cone keep their previous state (path `0x088F`). **[C]**
   - For each direction, when the target is in the observer's cone (`seg21:0x0B6A`): the target is **seen automatically** if `29C[target]==3` (fired this tick) **or** option bit `opts+0x1A & 1` (**Show Enemy Positions**) is set (`0x074F..0x0776`). Otherwise the result is the roll `seg96:0x09AF`. In every in-cone case, the target's bit is cleared from the to-remove mask (`0x07C1..0x07DA`). **[C]**
4. `seg96:0x0AAC` computes `visible[B] = (old & ~toRemove) | newlySeen` (`ctx+0x1D4[team]`). When it changes, it emits a visibility event (`seg96:0x0BC0 → seg95:0x067A`, event 9). **[C]** Consequence: **once seen, a robot stays seen while it remains inside any observer's cone.** It is dropped when it leaves every cone. **[I]** (The set and clear semantics are confirmed; that `0x1D4` is the displayed mask is inferred from the event emission.)
5. Activity flags are cleared every tick by `seg96:0x02C5` (`seg6:0x5A0E`). At turn start, `seg96:0x0267` (`seg6:0x467A`) sets every moved flag to 1, which forces a full recompute. **[C]**

### 1.3 Activity and moved flags (inputs to the rule)

| Writer | Effect | Source | Tag |
|---|---|---|---|
| `seg96:0x0324(ctx, idx)` | `27C[idx]=1` ("moved") | move-step tile change `seg6:0x2DEB`, `0x2EB6`; per-tick table `seg6:0x4FB2/0x4FDD/0x5008` for selectors 41-48, 49-64, 74 | C |
| `seg96:0x0366(ctx, idx, v)` | `29C[idx]=v` | v=**3** at fire sites `seg6:0x20B6`, `0x251E`, `0x29F3`, `0x2C93`. v=**2** from `seg6:0x4091`, which rearms a random 30+5·(rand&15) timer at program `+0x18`. v=**1** from the per-tick table `seg6:0x4F34` (default for any active command) | C (values) / U (meaning of v=2) |
| per-tick table `seg6:0x5041` (selector-2 index) | sets activity **0** for selectors 2, 3, 6, 9, 12, 16, 20, 22 and 32-39. Scan & Fire waiting and the unnamed 32-39 do not mark activity | `seg6:0x4F99..0x502B` | C |

### 1.4 The spotting roll and the Stealth rule: `seg96:0x09AF`

Arguments: target robot, target index, cover class `c`, distance `d`, `&27C`, `&29C`, sight `s`. **[C]**

```
if c == 0 or s == 0: not seen
i = {1:2, 2:4, 3:6}.get(c, 10)          # jump table seg96:0x0AA4; c=4 (exposed) -> 10
i -= 4 - (s >> 2)                        # s=16 -> -0, s=4 -> -3
if moved[target]:        i += 4          # 27C
elif activity[target]==1: i += 2         # 29C
i -= (d >> 2) - 2
i = clamp(i, 0, 13)
if target.class == 4:                    # STEALTH, seg96:0x0A48
    if not moved[target] and d > 1: not seen
    i = max(i - 4, 0)
seen = (rand & 0xFF) < DGROUP_0x213A[i]  # 0,8,16,24,32,40,48,56,64,96,128,160,208,255
```

**Stealth rule [C]:** an enemy can spot a Stealth robot by roll only if the Stealth robot moved this tick, or the observer is within distance ≤1. Even then the roll takes a −4 index penalty. Two automatic paths **bypass** this and reveal it anyway:

- the Stealth robot fired this tick (`29C==3`);
- **Show Enemy Positions** is on.

The cone, LoS (sight > 0) and cover > 0 prerequisites always apply. Retention (§1.2.4) keeps an already-seen Stealth robot visible while it stays in a cone. **[I]**

### 1.5 Stealth Alert / Show Enemy Positions

- The Game Options dialog (`GAMEOPTIONS`, dump DLG #9) has control 400 "Show Enemy &Positions" = `opts+0x1A` bit 0 and control 401 "Show Enemy &Damage" = bit 1 (402 = bit 2, blank label). Bits 3/4/5 (`0x08/0x10/0x20`) drive controls 101/201/301. Evidence: `seg11:0x02F5..0x0343`; toggles `seg11:0x0602` etc. **[C]**
- "DLG #48" is the dialog **named `STEALTHALERT`** (name string at DGROUP `0x07E6`, file `0x07DDE6`). Its controls are OK(1), Cancel(2) and the static alert text. It is opened by `seg11:0x117F → seg58:0x05D5` (DialogBox wrapper) with proc `seg11:0x10C5`. That proc ends the dialog with the clicked id on `WM_COMMAND` (0x111). **[C]**
- Trigger: game start validation `seg19:0x0000` calls `seg19:0x036A`. That routine returns 0 when **any team has a Stealth robot** (`seg69:0x098A`, which scans the robot list for class 4) **and** `opts+0x1A & 1`. On 0, `seg19:0x0134` shows STEALTHALERT. Cancel (2) aborts the start (`0x0140..0x0151`); OK continues. **[C]**
- STR 1869/1870 do not exist in the string table. The alert text is static text inside the dialog template. **[C]** (searched `strings.txt`)

---

## 2. Fence

### 2.1 Identity

`seg87` has seven terrain predicates that compare the property planes for a tile byte. The planes are b0 = `+0x000`, b1 = `+0x100`, b2 = `+0x200` (b3 = `+0x300` is never read). The identify-terrain routine `seg76:0x0427..0x04B1` maps each predicate to its help STR id **[C]**:

| predicate | (b0,b1,b2) | STR | terrain |
|---|---|---|---|
| `0x25B6` | (2,2,0) | 644 | Ground |
| `0x2621` | (2,1,0) | 645 | Rough |
| `0x26F7` | (3,1,1) | 646 | Low Wall |
| `0x2762` | (4,0,2) | 647 | Wall |
| `0x268C` | (2,1,1) | 648 | Bush |
| **`0x2838`** | **(3,0,1)** | **649** | **Fence** |
| `0x27CD` | (2,0,0) | 650 | Crevice |

- Fence = **height 3, impassable, partial sight**. No TIL set in any `.TWN` contains `(3,0,1,x)`, so no shipped map can contain Fence (verified over all 3×16×16 tuples). **[C]**
- b3 is loaded (`seg71:0x01AB`) but never read anywhere in the code. The `(2,2,0,15)` tuple is therefore Ground to every rule. **[C]**
- `seg87:0x24A9` (called from seg7/74/92) maps terrain class to effect id: 0xDC Ground, 0xDD Low Wall, 0xDE Wall, 0xDF Bush, **0xE0 Fence**, 0xE1 Rough, 0xE2 Crevice. **[C]** (That these ids are impact sound/sprite ids is **[I]**.)

### 2.2 "Chance of striking the fence" in transit

- **Bullets:** there is no per-bullet strike roll. A Fence acts exactly like a Low Wall:
  - sight walk `seg87:0x19E3`: −3 sight;
  - endpoint cover `seg87:0x1CE0`: height 3;
  - bullets still pass, because only b0 ∈ {0,4} blocks.

  The Fence's effect on bullets is therefore the sight penalty in the live-fire score (`<=8: −2`, `<=4: −4`) plus height-3 cover. **[C]** (structural: the planes read are identical for Fence and Low Wall; only b1 differs)
- **Explosives (missile/grenade path):** after scatter (`seg6:0x39C7`/`0x3BA6`, offsets from DGROUP `0x15CE`), `seg6:0x3B99`/`0x3CA1` call `seg87:0x2B36`. That routine walks the path (`seg87:0x2B77`, path from `0x09C0`). For each path tile k (0-based) whose **height == 3** (Low Wall *or* Fence, read via `seg87:0x29A7`), it rolls `rand&0xFF < pass` **[C]**:

  | path index k | pass threshold | stop chance |
  |---|---|---|
  | 0-2 | 256 | 0 |
  | 3-4 | 248 | 3.1% |
  | 5-10 | 224 | 12.5% |
  | ≥11 | 192 | 25% |

  On a stop, the projectile lands on the last tile it passed. The walk fails if fewer than 2 tiles were passed, or fewer than 4 with distance > 10. `0x2B36` then retries with the second endpoint argument. **[C]** That the two endpoints are the scattered point and the aimed point is **[I]**.

  This is the only stochastic "strike an obstacle in flight" code found, and it treats Fence identically to Low Wall. **[I]** This matches the help text "chance of striking the fence".

---

## 3. Ceremony, counters and MVP

### 3.1 Per-robot counters

All of robot `+0x5E..+0x76` is reset by `seg21:0x0275..0x02BD`. **[C]**

| field | increment site | meaning | ceremony string | Tag |
|---|---|---|---|---|
| `+0x5E` | attacker, `seg6:0x5AD5` | **Ows caused**: the target's damage first reaches ≥ armor/2 | 1432 (Ow/Argh 1422/1423) | C |
| `+0x60` | attacker, `seg6:0x5BB9`; zap `0x62B6` | **Arghs caused** (kills: damage reaches armor) | 1432 | C |
| `+0x62` | `seg6:0x3153/0x334E/0x34C5/0x535D` | sport objective count (coins/flags/bases/hostages) | 1433-1438 | I |
| `+0x64` | `seg6:0x53EE` | secondary objective (dropped/killed) | 1434/1437 | I |
| `+0x66` | shooter at impact, `seg6:0x570D/0x5775` | bullets fired (hit or miss) | 1439 | C |
| `+0x68` | shooter, `seg6:0x5711` | bullet hits | 1439 | C |
| `+0x6A` | apply-damage kind 4 | bullet damage dealt | 1439 | C |
| `+0x6C` | target, `seg6:0x5724` | times hit by bullets (not shown) | n/a | C |
| `+0x6E` | `seg6:0x55EC` | explosives landed | 1440 | C |
| `+0x70` / `+0x72` | apply-damage kinds 1-3, enemy / friendly | explosive damage to enemies / friends | 1440 / 1441 | C |
| `+0x74` / `+0x76` | `seg6:0x57E7` / kind 5 | zaps / zap damage | 1442 | C |

**Apply-damage `seg6:0x5A2B`** has the signature `(ctx, attacker, target, dmg, enemyFlag, ?, kind, byte)`. **[C]** It works as follows:

- The target's damage-so-far comes from `ctx+0x23C[idx]` (`seg96:0x0231`).
- Armor comes from the stat table at `0x0CA9` (`seg6:0x5A99`).
- Crossing half armor: **+50 points**, Ow.
- The damage is clamped to the remaining armor.
- A kill adds **+100 points**, Argh, and the kill bookkeeping `seg14:0x071C`.
- The points go to the attacker's team (`seg18:0x091A` → `seg96:0x1EEF`). If `enemyFlag==0` (friendly fire) the team gets **−points/2** instead.
- Kind switch: jump table `seg6:0x5C5B` = `[k1,k2,k3 → +0x70/+0x72 by enemyFlag; k4 → +0x6A; k5 → +0x76]`. The bullet impact passes kind = projectile `+0x02` = 4 (`seg6:0x3D4A`).

### 3.2 Display

- `seg22:0x22D5` "Stats for <team>" sums every counter over the team's robot list (`0x2340..0x238B`). It prints with the format strings **STR 1431-1442** (with 1443-1446 for plurals and verbs), not 4006-4019 **[C]**:
  - 1439 is called with `(+0x68 sum, +0x66 sum, "shot", +0x6A sum)` (`0x27B2..0x27FC`);
  - 1440 with `(+0x6E, "explosive", +0x70)`;
  - 1441 with `(+0x72)`;
  - 1442 with `(+0x74, "zap", +0x76)`.
- Bonus labels 1412-1416 are loaded in `seg22:0x2113..0x2186`. The animated bonus tally `seg22:0x2D6C` adds 150 / 400 / 100 / 100 (`0x2DC7`, `0x2DF0`, `0x2E1B`, `0x2E3E`) into a per-Team array at ceremony `+0x64`. **[C]** Which bonus is which follows the doc §16 Survival formula. **[I]**
- **STR 4006-4019** (the STRN_PLAY block) are never referenced by an immediate in any ROBO.EXE code segment. I searched push/mov/add of `0xFA6..0xFB3` and found only unrelated DS addresses. **[C]** They are probably RoboPlayer (`PLAYER.EXE`) strings **[I]**; that file is not present in this environment.

### 3.3 MVP

**[U]** STR 1419 "Most Valuable Player" (and 1417/1418) have no immediate or computed reference: no `0x589/0x58A/0x58B` operand, and the only computed base is `seg22:0x23F9 add ax,0x57E` (sport name 1406-1410). No robot-max selection loop over the `+0x5E..+0x76` counters was found in seg22. The MVP rule may live in PLAYER.EXE or be unimplemented in v1.00. Next step: dump PLAYER.EXE and search for STR 4019 usage.

---

## 4. AI brains (outline)

### 4.1 Brain field and predicates

Team `+0x2E`: 0 Human, 1 Stupid, 2 Ferocious, 3 Crafty, 4 Paranoid (STR 329-333).

| predicate | test | callers | Tag |
|---|---|---|---|
| `seg69:0x07A8` | `!= 0` (computer) | many | C |
| `seg69:0x07E0` | Stupid | seg30, seg31 | C |
| `seg69:0x0818` | Ferocious | seg32 | C |
| `seg69:0x0850` | Crafty | seg30, seg31 | C |
| `seg69:0x0888` | Paranoid | **none** | C |
| `seg69:0x08C0` | `== 5` | seg29, seg34 | C |

Value 5 has no string; its meaning is **[U]**.

- Quick-Start auto-assignment `seg61:0x08AB..0x08E0`: if `[0x411C]==1`, a computer team gets **Stupid**; else if team `+0x2A` ∈ {0,3} it gets **Crafty**, otherwise **Ferocious**. Paranoid is never auto-assigned. **[C]** (`[0x411C]` = formation/level index is **[I]**)

### 4.2 Entry and structure

- Turn generation `seg62:0x0766`:
  1. If any computer team exists (`seg18:0x0EB2`), call `seg34:0x0000` (AI global/per-turn setup), then **`seg30:0x0115`** (AI planner).
  2. Then `seg42:0x007C` and resolution `seg6:0x4609/0x46AF/0x4257` → movie. **[C]**
- `seg30:0x0115` iterates the teams. For each computer team (`seg69:0x07A8`) it shows "Generating Turn" and runs `seg6:0x43F8`/`0x4116`, then `seg30:0x0231(team)`. **[C]**
- `seg30:0x0231` (per team):
  1. Sport-object scan (`0x09B7` → `0x0A11`/`0x0AE6` for sport modes 2/3).
  2. Threat/target table build (`0x043D`, `0x06FA`; 12 slots at scratch `+0xC0/+0xD8/+0xF0/+0x108`).
  3. For each live robot, `seg32:0x0000(aiCtx, team, robot, scratch, idx)`. **[C]**
- `seg32:0x0000` dispatches on the per-robot **AI mode** `aiCtx+0x16[idx]` (1-4) through jump table `seg32:0x00B6` **[C]**:

  | mode | handler | own branch | Tag |
  |---|---|---|---|
  | 1 | `seg32:0x00BE` | `seg31:0x0000` | C |
  | 2 | `seg32:0x021D` | `seg31:0x00D6` | C |
  | 3 | `seg32:0x033E` | `seg31:0x01AC` | C |
  | 4 | `seg32:0x049D` | `seg31:0x026F` (+ `seg28:0x108E` sport object) | C |

  Each handler first builds candidate targets (`seg32:0x0C9F` / `0x0DDA` → seg33) and a fire plan (`seg32:0x05D8`). Then it emits movement (`seg32:0x071E` → path `seg30:0x0C57`, `seg87:0x0332/0x0383`, steps `seg30:0x0F39/0x0D3A`). **[C]** (function roles **[I]**)
- Mode assignment: `seg34:0x1A2A(aiTeam, team, idx, mode, param, target)` writes `+0x16/+0x26/+0x36[idx]`. Brain 5 forces mode 2 (param 0x40, target = robot `+0x2A`) unless the mode is 2 or 5. **[C]**
- Target scoring inputs:
  - the visibility grids `seg96:0x1B98` / `0x1D92` (called in `seg32:0x05D8`);
  - the threat table;
  - RNG choices (`seg55:0x0073` at `seg32:0x067B`, `0x0692`, `0x06CF`, `0x06F6`).

  The exact weights are **[U]** (not decompiled).

### 4.3 Per-brain differences found

| brain | behaviour difference | evidence | Tag |
|---|---|---|---|
| all computers | live-fire score add: Stupid −3, Ferocious +2, Crafty −1, Paranoid 0. Humans add `fireControl[param]` instead | `seg6:0x372B..0x37A0` | C |
| Ferocious | mode 1/3: takes the aggressive branch (`seg31:0x0000`/`0x01AC`) **always**. Other brains take it only when `rand&1==0` and the condition flag is set | `seg32:0x0146..0x017C`, `0x03CF..0x03FC` | C (code) / I (meaning) |
| Crafty | when sizing targets (`seg30:0x0639`) it uses exact target coordinates with weight 4 instead of the generic estimator `0x091E`. In `seg31:0x06FA` it skips a mode-2 guard | `seg30:0x0643..0x0656`, `seg31:0x0704` | C / I |
| Stupid | ignores the "special" `0xFF80` threat marker in `seg30:0x0679`/`0x0828`. In `seg31:0x18DF`/`0x195A` it skips the "nearby object within 5 tiles" checks (scratch `+0x2BA/+0x2B0`) | as cited | C / I |
| Paranoid | **no brain-specific branch anywhere** (predicate `0x0888` has no callers; accuracy add 0). Behaves as the default path | xref | C |

---

## 5. File formats

### 5.1 Container ("RoboSport Resources") **[C]**

- **Header:** 32 bytes = `"RoboSport Resources"` + 10 spaces + `"\r\n\x1a"`. The signature is checked by `seg53:0x06E0` against DGROUP `0x1404` (pointer at `[0x1402]`); failure gives error `0x45C`.
- **Chunks:** then a contiguous sequence of chunks. Each chunk header is 26 bytes:

  | off | size | field |
  |---|---|---|
  | 0 | 4 | tag, ASCII NUL-padded (`TIL\0`, `MAP\0`, `INF\0`, `DIB\0`) |
  | 4 | 2 | id (u16 LE) |
  | 6 | 16 | name, NUL-padded |
  | 22 | 4 | total chunk size **including** the 26-byte header (u32 LE) |

- **Reading:** opener `seg53:0x0000` reads the header, then reads 0x1A bytes per chunk and stores the 13 header words plus the file offset in a directory. It skips `size−26` (`0x00D9..0x01B9`). Lookup is by tag pointer + id (`seg53:0x0255 → 0x0659`). Load is `seg53:0x0322`/`0x0352`.
- **Tag strings (DGROUP):** `TIL` `0x1D40`, `MAP` `0x1E9E`, `INF` `0x1EA2` (also `0x0F2D`), `DIB` `0x1426`.
- **Files:** TWN names at `0x1452..0x146B`. PRS: `ROBOCOLR.PRS` `0x14D2` if display colours ≥16 (`[0x3F30]=1`), else `ROBOMONO.PRS` `0x14DF` (`[0x3F30]=0`), selected by `seg58:0x0155..0x0196`.

### 5.2 TWN payloads

- **TIL** (id 300-315, name "Tile Data", 64 B): 16 variants × 4 bytes `(b0 height, b1 passability, b2 sight, b3 unused)`. `seg71:0x00F0` transposes them into planes `+0x000/+0x100/+0x200/+0x300`, indexed by **tile byte = (id−300)<<4 | variant**. **[C]**
- **MAP** (id 0-7 = map index, name "Map Data"): `width×height` bytes, row-major (verified `len == w*h` for all 24). `seg83:0x0417` copies them into a 64-stride logical map (mode 1). Mode 0 copies a raw 4096-byte 64×64 map. **[C]** (mode 0 is likely the saved-game path **[I]**)
- **INF** (id 0, name "Info", 434 B). Read by `seg83:0x0566` (and `seg38:0x084A`) **[C]**:

  | off | type | content |
  |---|---|---|
  | 0x00 | u16 | map count (8) |
  | 0x02 | u16[16] | per-map flag word (0x1D in all files). `0x1D|8` → arena `+0xB8`. Runtime bits 2/3 are tested at `seg19:0x01E8`, `seg76:0x0321`, `seg87:0x0020`; semantics **[U]** |
  | 0x22 | u8[16] | width |
  | 0x32 | u8[16] | height |
  | 0x42 | u8[16] | per-map enabled flag (1 for maps 0-7). Returned by `seg83:0x0566` |
  | 0x52 | 16 × 22 B | record: NUL-terminated name (≤16 B, copied by lstrcpy to arena `+0x06`) + 6 constant tail bytes `00 1a 0d 2c 00 10` (unused, compiler residue **[I]**). Slots 8-15 are filler "Rubble Cross" |

  **No Home/Dock metadata** exists in INF: Home rectangles come from `seg87:0x1F32` (doc §12). **[C]**
- **DIB** (name = decimal id string): each payload is a complete `.BMP` (`BM` + BITMAPINFOHEADER), 16 px wide × 256 tall = 16 tiles of 16×16. 300-315 are 1-bpp (mono), 350-365 are 4-bpp (colour). `seg71:0x01C7` loads set `n` from id 300+n or 350+n. **[C]**

### 5.3 Chunk inventory (offsets are file offsets of the chunk header) **[C]**

| File (bytes) | TIL | MAP | INF | DIB mono | DIB colour |
|---|---|---|---|---|---|
| RUBBLE.TWN (64,524) | 300-315 @0x00020-0x005C0, 90 B each | 0-7 @0x005C0-0x02BC0; payload 256, 576, 1024, 1600, 2304, 1936, 800, 1024 | 0 @0x02BC0, 460 B | 300-315 @0x02D8C-0x0730C, 1112 B | 350-365 @0x0730C-0x0FC0C, 2192 B |
| SUBURBS.TWN (64,380) | 300-315 @0x00020 | 0-7 @0x005C0-0x02B30; 256, 576, 1024, 1936, 1040, 1296, 960, 2288 | 0 @0x02B30 | 300-315 @0x0605C-0x0A5DC | 350-355 @0x02CFC, 356-365 @0x0A5DC-0x0FB7C (split order) |
| COMPUTER.TWN (62,048) | 300-315 @0x00020 | 0-7 @0x005C0-0x02210; 256, 576, 1024, 1936, 800, 784, 864, 800 | 0 @0x02210 | 300-315 @0x023DC-0x06960. **309 is 17×257, 311 is 16×255**: off-size art | 350-365 @0x06960-0x0F260 |

No other tags occur in any TWN. Every file has 57 chunks and ends exactly at EOF.

- **TIL tuples present:** all files use the same seven tuples, minus Low Wall in Suburbs' maps: (2,2,0,0), (2,1,0,0), (2,1,1,0), (3,1,1,0), (4,0,2,0), (2,0,0,0), plus (2,2,0,15) in set 15 only.
- **Tuples used by MAP cells:** Rubble uses all but special. Suburbs: no Low Wall and no Crevice. Computer: no Crevice. No map uses set 15. **[C]**

### 5.4 PRS

**ROBOCOLR.PRS / ROBOMONO.PRS are not present** in the staged `ROBOWIN/` folder used for this pass, so their chunk table cannot be produced here. **[U]**

From the code **[C]**:

- PRS uses the same container (opened by `seg53:0x0000` into handle `0x3F32`, `seg66:0x0034`).
- Only **DIB** chunks are requested from it: `seg67:0x0000 → seg53:0x0D12`, and `seg66 → seg53:0x116D`.
- DIB ids requested by code:

  | ids | requested at |
  |---|---|
  | 1, 2 | `seg2:0x0764/0x0771`, `seg54:0x124D` |
  | 20-24 | `seg90:0x11DF..0x1220`, and 21 at `seg22:0x1515` |
  | 110 | `seg11:0x03E7`, `seg17:0x152D` |
  | 150, 151, 155, 156, 160, 165, 166, 170, 171 | `seg66:0x006A..0x0227` |
  | 200-204 | `seg10:0x112C..0x1164` |
  | 250-253 | `seg11:0x0E01..0x0E2B` |
  | 940, 941 | `seg17`, `seg26`, `seg54` |
  | 960-963 | `seg10:0x0781` (`0x3C0+i`) |
  | 1000 | `seg22:0x00A5` |
  | 1010-1013 | `seg22:0x00BA..0x0100` |
  | variable | `[0x42C2]` at `seg89:0x003D`, `[0x290C]`-driven at `seg7:0x0006` |

  This matches the doc §12b list (robot sheets 1010-1013, effects 170/171, title 150/20-22). PRS content descriptions remain **[I]** from that section.

---

## 6. Open items

1. Meaning of activity value 2 (`seg6:0x4091` random timer) and brain value 5. **[U]**
2. MVP rule and STR 4006-4019 consumer: needs PLAYER.EXE. **[U]**
3. INF flag word bits and the 6-byte record tail. **[U]**
4. Whether the `seg87:0x2B36` endpoints are scatter vs aimed tile. **[I]**
5. Exact AI target-score weights (`seg32:0x05D8`, `seg33`, `seg96:0x1B98/0x1D92`). **[U]**
6. PRS chunk inventory: needs the two `.PRS` files. **[U]**
