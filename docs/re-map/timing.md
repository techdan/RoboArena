# ROBO.EXE timing / projectile / spotting-refresh findings (RE pass 2026-10-15)

Tags: **C** = read in the code, **I** = inferred, **U** = unknown.
Addresses are `segN:0xOFF`; DGROUP X = file 0x7D600+X. Game RNG = `seg55:0x0073` (one LFSR stream, `r`).
Context: `ctx+8` = now, `ctx+0x0A` = movie end, `ctx+0x0C` = turn length, `ctx+2` = projectile queue.
Program object (0x28 bytes, robot `+0x5C`, created zeroed by `seg12:0x0000`, `+0x20 = -1`):
`+0x10` current record start (I), `+0x16` bit 2 = "re-dispatch every step", `+0x18` refresh timer,
`+0x1A` fire/zap cooldown, `+0x1C` Scan & Fire shot counter, `+0x1E` stagger, `+0x1F` unused-in-practice, `+0x20` death time.

## 0. The per-step loop (context for every answer)

`seg6:0x47DE..0x4853`: `while (now <= end) { 4892; 50D3; 556F(queue); 5898; now += 5 }` (C).
End = turn length + 150 (`0x4790`), extended by `0x6330(ctx,t)`: `if end - t <= 150: end += 150` (C, `0x6347..0x6356`).

Per robot, `seg6:0x4998` (C):
- if the program is at its terminator → idle path: `0x4091` periodic refresh (call at `0x4AB5`).
- else if current record end <= now → command-end path: `seg14:0x0472` applies the record's state, `0x4F34` end handler, advance (only while start < turn length).
- then `0x4C7F` (command dispatch) runs if `now == start` **or program `+0x16` bit 2 is set**, and start < turn length (`0x4ABB..0x4AE2`).
- `0x4C7F` **always** does `prog+0x1E = 0`, `prog+0x1F = 0`, `prog+0x18 = now` (`0x4CDA..0x4CEE`) before the jump table `0x4E9C`.
- Bit 2 is set (`0x4D3B..0x4E35`) for sel 3 (Zap), 6/9/12 (direct Scan&Fire `0x1F74`), 16 (missile scan `0x2876`), 20 (grenade scan `0x23A1`), 32-39 (scan-for-duration `0x2D20`), 41-48 / 49-64 (moves). These handlers run every 5-tick step for the whole command. Bit 2 is cleared at command end (`0x4A2C`).

At end of movie, `seg6:0x4639 → seg88:0x03CD` zeroes every program's `+0x14,+0x18,+0x1A,+0x1C,+0x1E,+0x1F` (C, `seg88:0x0410..0x0430`): **no cooldown, shot count, refresh timer or stagger carries into the next turn.**

---

## Q1. Bullet impact delay, locking, and the in-flight tail

**Projectile record** (`seg6:0x1A08(out, type, impactTime, x, y, shooter, target, damage, flags)`) (C, `0x1A3D..0x1A71`):
`+2` type, `+4` **impact time**, `+6/+8` tile (−1,−1 when a target robot is locked), `+0x0A` shooter handle, `+0x0C` target robot handle, `+0x0E` damage byte, `+0x0F` flags.
Queue insert `0x1AD3`: sorted by impact time, a new record goes **before** existing records with the same time (`0x1B31 cmp; jl` keeps walking only while `old < new`) → **LIFO among equal impact times** (C).

**Impact times by type** (C):

| Type | Created at | Impact time |
|---|---|---|
| 4 bullet | `0x3CAE` (`0x3D2B..0x3D32`: `mov ax,[ctx+8]; add ax,5`) | now + 5 |
| 5 zap | `0x2C9B..0x2CA2` | now + 5 |
| 3 self destruct | `0x3541` | now + 10 |
| 1 grenade | `0x2304..0x2317` | now + 5·dist + 20 (Q2) |
| 2 missile | `0x27DB..0x27EC` | now + 5·(dist>>1) + 10 (Q2) |

**Decided at fire time, applied at impact (C).** `0x1DCE` (Aim) and `0x1F74` (Scan) call `0x35D1` for hit+damage at fire time, then `0x3CAE` stores the damage in `+0x0E` (0 = miss). Impact is processed in `0x556F` (pops while head time <= now, `0x1CF6`), bullet branch `0x56CD`:
```
if dmg != 0: shooter+66++, shooter+68++, target+6C++; 0x5A2B(ctx, shooter, target, dmg, 1, 2, type, flags); 0x4060(target.program)  // stagger draw
else:        shooter+66++; miss FX at target's CURRENT occupied tile (seg21:0x06DF) or at stored tile
```
- **The target robot is locked, not the tile** (C): `+0x0C` is the robot handle; damage goes to that robot wherever it is at impact. Aim & Fire picks the robot on the aimed tile at the first tick (`seg18:0x03C0`, occupied tile `+48/+4A`, live check `seg21:0x0AB1`). If no robot was there, the shot is a miss with a cosmetic miss tile from `0x391A`.
- **Target dies before impact (C):** `0x5A2B` clamps damage to `armor − currentDamage` (`0x5B09..0x5B18`) and returns when it is ≤ 0. A bullet in flight at an already-dead (or killed-in-between) robot does nothing. The shot/hit counters still increment and `0x4060` still draws the stagger roll, since it is keyed on `+0x0E != 0`.
- **Shooter dies before impact:** no check. The bullet still lands (C, no shooter test in `0x56CD..0x576F`).
- **Within a step:** all robots dispatch (`0x4892`) before impacts (`0x556F`). A bullet fired at step t lands in step t+5 **after every robot's t+5 dispatch**. So the victim gets one more step of actions. For example, an Aim & Fire starting at t+5 still fires. (C, from the loop order.)
- **In-flight at turn length (C):** the loop runs to `end = turnLen + 150` (or later). Bullets fired at now < turnLen land at ≤ turnLen+5. Explosives call `0x6330` with their impact time (`0x2321`, `0x25F3`, `0x27F6`, `0x2A8C`). Zap calls it at `0x2CBF` and Self Destruct at `0x358A`. **Everything in flight lands in the tail.** New fire stops at turn length: every Scan/Zap handler gates `now < turnLen` (`0x1FDB`, `0x241C`, `0x28F1`, `0x2C54`), and dispatch requires start < turnLen.

**Engine difference:** `resolveFiringAction` applies direct-fire damage on the fire tick (`pendingDamage` → `applyPendingDamageAndDeaths` the same tick). There is no 5-tick flight and no LIFO ordering. Direct fire also re-checks `input.target.hp <= 0` at fire time, which is correct: the original also excludes doomed robots via `0x0AB1`. The resolver loop also stops at `turnDuration` (only Self Destruct is drained after it).

Engine change:
- Queue a `PendingBullet {shooterId, targetId, damage, score, impactsAt: tick+5}`. Apply it at `impactsAt` **after** command starts/fires of that step, clamped to remaining HP (0 if already dead). The stagger draw stays keyed on the rolled damage > 0.
- Same-impact-time ordering: newest first (LIFO). Matters for kill credit and RNG order.
- After `turnDuration`, keep stepping 5 ticks until no projectile is pending. Model end = turnLen+150 with the `0x6330` extension; at minimum, drain all pending projectiles in impact order. Run spotting on those steps too (see Q8).
- Keep the event split: "fired" at fire tick, "projectile-impacted"/"damaged" at impact tick.

---

## Q2. Missile/grenade flight time, scatter, and the path stop

**Execution order, grenade Aim `0x218D`** (missile Aim `0x266F` is the same with the missile helpers) (C):
1. Ammo: if `+54` (grenades; missiles `+56`) == 0, write p3 = 0 and do nothing. Else p3 = ammo−1 (`seg12:0x0466`).
2. `dist(shooter logical tile, aim tile)`: computed and discarded (`0x2249`).
3. Scatter: `0x39C7` (grenade) / `0x3BA6` (missile)`(robot, targetRobot|0, stagger=prog+1E, &ox,&oy, aimX, aimY)`. Then `prog+1E = 0`.
4. `d2 = dist(shooter logical tile (seg21:0x05D0), final tile)` (`seg56:0x02A0`, floored Euclidean).
5. **Grenade impact = now + 5·d2 + 20** (`0x230C..0x2317`). **Missile impact = now + 5·(d2>>1) + 10** (`0x27DB..0x27EC`).
6. `0x6330(ctx, impact)`; projectile type 1/2 (target handle 0, damage 0); queued.
7. Cooldown: `0x3F43` (grenade: `+1A = now + 30 (+50 if scan)`) / `0x3FA4` (missile: `+1A = now + 30 (+40 if scan)`).

Scan versions (`0x23A1`, `0x2876`) do the same against the acquired robot. Its occupied tile replaces the aim point inside the scatter routine (`0x39EB`/`0x3BCA` → `seg21:0x06DF`). **Both grenade and missile Scan & Fire hold fire when the acquired target is closer than 2** (`0x24FA cmp cx,2` and `0x29CF cmp dx,2`) (C).

**Impact blast**: at impact time (`0x5629 → 0x5CB6` cat 0 grenade, `0x565D → 0x5CF5` cat 1 missile → `0x5D73`) at the stored tile, against robots' positions **at impact time** (C).

**Scatter, `T` = DGROUP 0x15CE words `[-1,0,0,1,-2,-1,1,2]`**. `inArc` = `seg21:0x0F0A(shooter, tx, ty)` (closed ±45°). `d` = dist(shooter logical tile, target point). `stagger` = `prog+1E`, which is always 0 here because `0x4C7F` clears it before the handler runs.

Grenade `0x39C7` (RNG draws in this order) (C):
```
if stagger==0 and inArc:
   d<=4 : f=16, ox=oy=0                                  (no draws)
   d<=8 : f=16, ox=T[r&3], oy=T[r&3]                     (2 draws)
   d<=12: f=13+(r&7), ox=T[r&7], oy=T[r&7]               (3 draws)
   else : f=(r&7)+(r&3)+10, ox=T[r&7], oy=T[r&7]         (4 draws: r&7 first, then r&3)
else:
   d<=12: f=13+(r&7), ox=T[r&3], oy=T[r&3]
   else : f=(r&7)+(r&3)+10, ox=T[r&7], oy=T[r&7]
px = sx + trunc(dx*f*16/256);  py = sy + trunc(dy*f*16/256)      // dx,dy = target − shooter; C idiv truncates toward 0
scattered = (px+ox, py+oy)
```
So f/16 is a 0.625..1.25 range factor (over/undershoot) plus a ±1/±2 jitter.

Missile `0x3BA6` (C):
```
if stagger==0 and inArc: d<=12 → ox=oy=0 ; else ox=T[r&3], oy=T[r&3]
else:                    d<=8  → ox=T[r&3], oy=T[r&3] ; else ox=T[r&7], oy=T[r&7]
scattered = (tx+ox, ty+oy)          // no range scaling
```

**Path stop `seg87:0x2B36(sx,sy, scX,scY, aimX,aimY, &out)`** (C):
1. `ok = 0x2B77(s → scattered)`. If `!ok`, `0x2B77(s → unscattered aim)` is run, and its output is used whatever it returns.
2. `0x2B77(s → t)`:
   - Clamp t into the map (`0x02E1`).
   - `d = dist(s,t)`.
   - Path = `seg87:0x09C0` mode 2 = **tile Bresenham `seg56:0x0509`**: excludes the start, includes the end, max(|dx|,|dy|) tiles, x-major only when |dx|>|dy|. It is **truncated before the first tile that fails `seg87:0x2901` mode 2**, i.e. b0 > 3 with b1 == 0 = **Wall**. Crevice (2,0,0) and Low Wall / Fence (b0=3) pass.
   - `out = s`, `passed = 0`. For each path tile k = 0,1,…:
     ```
     if height b0 == 3 (Low Wall or Fence, seg87:0x29A7):
         thr = k<=2 ? 256 : k<=4 ? 248 : k<=10 ? 224 : 192     // si = 2k: <=4, <=8, <=20
         if (r & 0xFF) < thr: out = tile, passed++           // one draw per height-3 tile, even when thr = 256
         else: stop                                          // lands on the PREVIOUS tile
     else: out = tile, passed++
     ```
     Stop chance: 0% / 3.1% / 12.5% / 25%.
   - Returns `passed >= 2 && !(passed < 4 && d > 10)`.

Consequences:
- A shot blocked by a Wall lands on the last tile before the Wall.
- If the scattered attempt is stopped too early, the shell is re-thrown at the exact aim point with fresh height-3 rolls.
- An aim at your own tile lands on your tile.

**Engine difference:** `resolveFiringAction` blasts at the exact aim tile on the fire tick. It does no scatter, no Wall truncation or height-3 stop, and no flight time. It also treats out-of-range / out-of-cone / sight-blocked as a **miss**. The original has no execution-time cone/sight/range check for explosives: it always launches, and walls only shorten the path. `blast.ts` also evaluates targets at fire time, whereas the original evaluates them at impact time. Grenade Scan & Fire lacks the <2 hold.

Engine change:
- At fire: run the scatter (exact draw order above, a `T` table, truncating division), then the path stop with a tile Bresenham (start excluded) and Wall truncation, then the 2-attempt rule.
- Compute the impact tick from the final tile (grenade 5·d+20, missile 5·(d>>1)+10). Queue it, and roll the blast at impact against the robots then on the arena.
- Drop the trajectoryFailure "miss" branch for explosives, or keep it only as a planner gate.
- Apply `MISSILE_SCAN_MIN_DISTANCE` to the grenade launcher too.
- Explosive cooldown after a scan shot: unchanged (70/80 already match `0x3FA4`/`0x3F43`).

---

## Q3. Scan & Fire seven-shot pause and DGROUP 0x14BA

**Rule** (C). Direct-fire cooldown `seg6:0x3D79(ctx, prog, sel, isScan)`:
```
prog+1A = now + dur(aimSel)          // aim sel 5/8/11 → 30/15/10 (jt 0x3E23; di = 4 rifle, 3 burst, 2 auto)
if isScan:
   prog+1C++                          // shot counter
   kind = ([0x14BA] == 0) ? -1 : di
   0x3E33(prog, kind):
     if prog+1C > 6:                  // the 7th consecutive scan shot
        kind 2 (Auto):  +1A += 30 + 5*(r&3);  +1C = r&1
        kind 3 (Burst): +1A += 40 + 5*(r&3);  +1C = r&3
        else (Rifle, or any weapon when 0x14BA==0): +1A += 50 + 5*(r&7);  +1C = r&3
```
(`0x3E4D..0x3ED8`; two draws: pause first, then the counter reset.)

- **Decay:** each step a direct Scan & Fire acquires no target, `0x3EE6` runs. If `now − +1A >= 20` and `+1C > 0`, `+1C--` (one per idle step) (C, `0x3F1B..0x3F27`).
- **Reset:** weapon select records (sel 4/7/10/13/17, `0x4D07`) set `+1A = now`, `+1C = 0`. Turn end zeroes both (§0).
- **Shared `+1A`:** Zap (`0x4005`: `+1A = now+60`), explosive scan/aim (`0x3F43`/`0x3FA4`) and direct aim (`0x3D79` isScan=0) all write the same `+1A`. A Scan & Fire command does **not** reset it at start. So a pause or cooldown left over from an earlier command carries into the next Scan & Fire **within the turn** (C).
- **Gate:** every scan handler checks `now >= +1A` before scanning (`0x1FE3`, `0x2424`, `0x28F9`; zap `0x2C5C`).

**DGROUP 0x14BA = negotiated network protocol/compatibility level** (C):
- Static value 2 (file bytes); `[0x14B8]` = 2 is this build's own level.
- `seg48:0x0BAA` copies 14B8 → 14BA. The network handshake then sends `[14BA]` (byte-swapped by `seg49:0x28F0`) in message 0x38 via `seg45:0x009A`, and lowers 14BA to `min(own, peer)` (`seg48:0x0C90..0x0C9C`, `0x0D64..0x0D70`, `0x0E56`). It is set to 0 on a failed exchange (`0x0CA6`).
- `seg49:0x0797` writes it into a saved/transfer header `+0x26`, and `seg49:0x08F5` lowers it from one.
- Readers: `seg6:0x3DF2` (this pause), `seg28:0x19ED` (base inset), `seg64:0x009E` (`>= 2` enables an extra network step `seg48:0x0E71`).
- It is **not** a difficulty, option or sport flag.

In any local or same-version game (including Beginner/Standard Survival) it is 2 → the **per-weapon pause is active**. The flat 50–85 pause for all weapons only applies when connected to an older (level-0) peer. The 7-shot rule applies to direct-fire Scan & Fire only; explosive scans have no counter.

**Engine difference:** no shot counter, no pause and no decay. `nextScanAt` is reset to the command start, so `+1A` does not carry across commands. There are no weapon-select records or resets.

Engine change:
- Per-robot (not per-command) `cooldownUntil` and `scanShotCount`, reset at turn start.
- On each direct scan shot: `cooldownUntil = now + aimInterval; count++`. If count > 6: add the per-weapon pause (Auto 30+5·(r&3), Burst 40+5·(r&3), Rifle 50+5·(r&7)) and reset count (Auto r&1, Burst/Rifle r&3).
- Steps with no target and `now − cooldownUntil >= 20`: decrement count.
- Aim & Fire, explosive scan/aim and Zap write the same `cooldownUntil`. Scan & Fire start must not reset it.
- If the engine models weapon switching, reset both on switch (the original charges a 20-tick select record).

---

## Q4. Periodic refresh `seg6:0x4091` and its callers

`0x4091(ctx, ctx0, prog, turnLen, robotIdx)` (C, `0x40BB..0x40FD`):
```
if now < turnLen and now >= prog+18:
    prog+18 = now + 30 + 5*(r & 15)      // one game-RNG draw
    activity[robotIdx] = 2               // seg96:0x0366(…, 2)
```

| Call site | Function | Command | Selectors (jt 0x4E9C) |
|---|---|---|---|
| `0x1FCB` | `0x1F74` direct Scan & Fire | Rifle/Burst/Auto Scan & Fire | 6, 9, 12 |
| `0x240C` | `0x23A1` | Grenade Scan & Fire | 20 |
| `0x28E1` | `0x2876` | Missile Scan & Fire | 16 |
| `0x2C44` | `0x2BD9` | Zap | 3 |
| `0x2D49` | `0x2D20` (wrapper, nothing else) | Scan current direction for N s | 32..39 |
| `0x4AB5` | `0x4998` idle path | **program finished / empty** (no command left) | terminator |

Moves, Aim & Fire, posture, heading, deploy, bomb and self destruct never call it.

**When activity 2 is actually set (C):**
- **Active scan-type commands (first five rows): every 5-tick step while now < turnLen.** All five run with `+0x16` bit 2 set, so `0x4C7F` re-dispatches them each step. `0x4C7F` writes `prog+18 = now` (`0x4CEE`) just before the handler calls `0x4091`, so `now >= prog+18` always holds. The random interval is drawn but overwritten on the next step. Net effect: **activity 2 plus one RNG draw on every step** of Scan & Fire (all weapons), Zap and Scan-for-duration, including steps where it fires (activity 3 then overwrites 2 at `0x20B6`/`0x251E`/`0x29F3`/`0x2C93`). This includes the dispatch step.
- **Idle robots (program exhausted):**
  - Program ended at t0: the first refresh is at t0+5. Before that, `0x4C7F` ran on the terminator at t0 and set +18 = t0.
  - Then every 30 + 5·(r&15) ticks (30..105), while now < turnLen.
  - A robot with an empty program refreshes at tick 0 (`0x4A91..0x4A9F` sets +18 = now when start == now), then every 30..105.
- RNG order: the draw happens at the robot's position in roster-order dispatch, before any other draw that robot's handler makes in that step (scan acquisition and fire rolls, scatter, etc.).

What activity 2 does (`seg96:0x060D`/`0x09AF`): it opens the pair "activity gate", so spotting rolls happen. It adds **no** index bonus (only activity 1 gives +2; moved gives +4).

**Engine difference:**
- `refreshedThisStep` is only set for Zap, with the 30+5·(r&15) timer actually honoured.
- Scan & Fire gets activity 0 while waiting.
- Idle robots get 0 forever.
- Scan-for-duration (32..39) is not a command kind at all.

So in the engine, two idle or scanning robots never roll to spot each other. In the original, scanners roll every step, and idle robots roll every 30..105 ticks.

Engine change:
- Activity 2 every step for Scan & Fire (all weapons) and Zap while tick < turnDuration. Drop the Zap timer, but keep one RNG draw per step if RNG parity is wanted.
- Idle robots (no active command, timeline exhausted): per-robot `nextRefreshAt`. Initialise it to the step the program ran out, plus 5, or to 0 for an empty program. When `tick >= nextRefreshAt && tick < turnDuration`: activity 2 and `nextRefreshAt = tick + 30 + 5*(r&15)`.
- Optional: add "Scan for N seconds" (sel 32..39; duration p1×60, 5..? ticks per record) as a command that only refreshes.

---

## Q5. Scan & Fire checks happen only on 5-tick steps; other per-step differences

**C.** `0x1F74`/`0x23A1`/`0x2876`/`0x2BD9` are reached only through `0x4C7F` from the step loop (`now += 5`). Each step does, in this order:
1. Refresh (Q4).
2. Gate: `now < turnLen && now >= +1A`.
3. Acquisition `seg18:0x072C`.
4. Fire, or the no-target decay `0x3EE6`.

With no target, the next check is the next step (+5), not +1. Since every duration and cooldown is a multiple of 5, fire times are otherwise unchanged.

Other per-step differences found:
1. **Acquisition requires the target to be currently spotted by the shooter's Team** (C). `seg96:0x1FC5(ctx0, shooterIdx, targetIdx)` tests the target's bit in the Team visibility mask `ctx+0x1D4[team]` (via `0x0186`) and returns 0 (not a candidate) when it is not set. That mask is the result of the previous step's spotting pass (Show Enemy Positions sets all bits). The engine's `findScanAndFireTarget` ignores visibility.
2. **Sight strength is the cached pair value** `ctx+0x1B0[shooter][target]` from the last spotting pass (Q7), not a fresh walk.
3. Rank: `+2` outside the inner arc (`seg18:0x0854`), ties → larger sight, else first in global order. The engine already matches this.
4. No fire at `now >= turnLen` (`0x1FDB`). The engine's `resolveScanOpportunities(tick)` runs at `tick == turnDuration` too and can fire there.
5. The grenade <2 hold (Q2).
6. Zap target `seg18:0x05F3` and Aim target `seg18:0x03C0` do **not** use visibility (C).

Engine change:
- Evaluate scans only on `tick % 5 == 0`; with no target, `nextScanAt = tick + 5`.
- Skip candidates not in the shooter Team's current spotted set (or all, with Show Enemy Positions). Use the spotting pass's cached sight value (Q7).
- Forbid scan fire at `tick >= turnDuration`.

---

## Q6. "10/5 tick cost for a no-op posture/heading command"

**Not reproducible from any producer (C).**
- Executor side: sel 70–72 / 24–31 records cost their descriptor duration (10 / 5) whatever the current value, since dispatch does nothing for them (jt → `0x4E88`). The state change is applied at the end (`seg14:0x0472`).
- No producer ever emits a no-op record. The human planner guards every call:
  - posture `seg74:0x0CB2 cmp ax,si; je` (skip if planned posture == target);
  - heading `seg74:0x0E18` and `seg74:0x1D09` (`cmp [robot+42], target; je`).
- The AI guards too (`seg30:0x0CA0`, `seg30:0x0D07`).
- Inside the emitters, Δ=0 would emit one record: posture `seg80:0x0384..0x03AA` (`|Δ|<2` → one record), heading `seg80:0x04B6..0x04D1` (the loop is skipped, but the final record is still emitted). This is only reachable without the guard.
- Edge case: a current value of 0 ("unset" heading/posture) emits a single record to the target with no stepping (`seg80:0x0384`, `0x0431`). That is 5 ticks for any heading from unset (I: when +42 can be 0 for a deployed robot is not traced).

**Engine:** `scanRotationCostTicks`/`postureChangeCostTicks` return 0 and the resolver skips the record. **This matches the original.**

Engine change:
- None for v1. Optional: if the engine ever has an "unset" initial heading, the first heading set should cost one 5-tick record regardless of octants.

---

## Q7. "Cached scan-grid staleness"

What it is (C):
- `seg96:0x0900` (called from the pair routine `0x060D` inside the spotting pass `0x5898`) recomputes sight strength `seg87:0x19E3(occupied tiles A,B)` **only if either robot's moved flag (`ctx+0x27C`) is set this step**. Otherwise it returns the cached `ctx+0x1B0[a][b]`. The cache is written symmetrically at `0x0952..0x0981`.
- The moved flag is set by `seg96:0x0324` on every occupied-tile change (`0x2DEB`, `0x2EB6`), at move/deploy command end (`0x4FB2`, `0x4FDD`, `0x5008`), at death removal (`0x4C62`), and for everyone at turn start (`seg96:0x0267`).
- Flags are cleared each step (`seg96:0x02C5` via `seg6:0x5A0E`).
- Sight depends only on the two tiles (posture is in the separate cover call `seg87:0x1BF8`, computed fresh). So **inside the spotting pass the cache is never stale**.

Where staleness does affect outcomes (C):
- Scan & Fire reads the same cache (`seg96:0x1FC5` → `+0x1B0`) during `0x4892` dispatch, i.e. **before** this step's spotting pass. The value reflects positions at the end of the previous step.
- If the target (or another robot dispatched earlier in roster order this step) changed occupied tile during this step's dispatch, acquisition uses its new tile for distance/cone (`seg21:0x06DF`), but the sight strength of the old tile. This happens with moves at elapsed 15/25/end.
- That sight value feeds both the tie-break and the hit score's sight penalty (`0x2075` → `0x35D1`: ≤4 → −4, ≤8 → −2).
- The visibility-mask requirement (Q5.1) is the same one-step lag.

It also lags by one step in a Team-pair the pass did not evaluate (pair not dirty). That is harmless, because nothing in it moved.

Engine change:
- Keep `sightCache[a][b]` updated only in the spotting pass (for pairs where either robot moved). Have Scan & Fire read it and the spotted set as of the previous step's pass, instead of calling `scanSightStrength` live.
- Effect size: small. It only differs on the step a robot's occupied tile changes before the shooter's dispatch.

---

## Q8. Other per-step behaviour that affects Survival outcomes

1. **Damage stagger is dead code (C).** `0x4060` sets `prog+1E = (r&3)+1` at impact (`0x5769`, zap/blast loops). But `0x4C7F` zeroes `+1E` at every dispatch, including each continuing Scan & Fire step, before any reader (`0x1E7B`, `0x207B`, `0x2277`, `0x254A`, `0x2759`, `0x2A1F`). No code path reads `+1E` without passing `0x4CDA` first in the same call. The halving and the scatter "stagger" branches are therefore unreachable. Only the RNG draw remains.
   - **Engine:** already passes `damageStaggered:false`. But `damageStaggerActionsRemaining` and its decrement are vestigial: keep the draw (for parity) and drop the counter.
2. **`0x50D3` in Survival = Time Bomb check only (C).** Hostage `0x5135` and CTF `0x5242` are gated by sport type 3/2. Bombs go off only if `detonate <= now` and `detonate < turnLen` (`0x54B9`). **Engine matches.**
3. **Activity 1 is written only on the step a command ends (C).** `0x4F34` is called only from `0x4A5A`, the command-end path. It writes 1 for every command except sel 2/3/6/9/12/16/20/22 and 32–39 (end jt `0x5041`). The moved flag comes only from occupied-tile switches and move/deploy end.
   - So a single move sets moved on steps start+15 and start+30; a double move on +15, +25 and +40. Posture/heading/aim records give activity 1 only on their final step.
   - **Engine:** gives moved for *every* step of a move/deploy, and activity 1 for every step any non-scan command is active. That makes robots much easier to spot (+4 / +2 index, and the gate is opened every step).
   - **Change:** moved only on occupied-tile-change steps (15 / 15,25) plus the end step. Activity 1 only on the completion step of non-scan commands, plus the Q4 refresh rules.
4. **Lethal damage → delayed death (C).** `0x5A2B` → `seg14:0x071C`: death time `+20 = now+5`. If the current record is a move (sel 41..64) whose end is later, the death time is the move's end. The robot keeps dispatching (finishing its move, occupied-tile switches) until `now >= +20` (`seg14:0x0951`). However, `seg21:0x0AB1` treats it as dead immediately for targeting, Zap and Scan. It is removed from the map 60 ticks after death (`0x4C37..0x4C62`, activity 1 + moved).
   - **Engine:** docks it instantly. This changes presentation more than outcomes. I: verify that no blast/visibility path still counts the robot during the delay.
5. **Commands that cross turn length (C/I).** A command starting before turnLen keeps executing in the 150-tick tail (moves keep switching tiles; ends are applied). A record whose end is ≥ turnLen is not advanced past (`0x4A60..0x4A8B`, `prog+12 = end`), and records starting at ≥ turnLen never dispatch. The planner limit is 3600 ticks (`seg80:0x02FB`), not turn length, so the original apparently carries unexecuted records into the next turn (`seg14:0x00A2` at turn end; I, not traced). The engine stops at `turnDuration` and silently drops the remainder.
6. **Spotting runs on every step of the tail (C),** up to the extended end, so sightings can change after turn length. The engine's spotting loop stops at `turnDuration`.
7. **Bullet/explosive impacts happen after all dispatch in a step (C).** See Q1. Same-time impacts are LIFO.
8. **Zap** (C):
   - fires only while now < turnLen;
   - its cooldown is the shared `+1A` (`now + 60`);
   - its refresh happens every step (Q4).
   - **Engine:** keeps a separate `nextZapAt` (fine within one command, but not shared with Scan & Fire).

## Confidence summary
- Q1: C (fire-time locking, +5, robot lock, clamp on dead target, LIFO, tail landing).
- Q2: C (formulas, draw order, path rule). "Path excludes the start tile" is C from `seg56:0x0509`.
- Q3: C (rule). C that 0x14BA is the negotiated protocol level, = 2 locally.
- Q4: C. This is a correction: the refresh fires every step for active scan commands; the random interval only matters for idle robots.
- Q5: C.
- Q6: C (no producer emits no-ops; the engine matches).
- Q7: C (mechanism); impact is small.
- Q8: C, except the carry-over of commands past turn length (I).
