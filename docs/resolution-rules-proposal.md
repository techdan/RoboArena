# Proposed Deterministic Resolution Rules

Status: PROPOSED, not confirmed exact original behavior.

Purpose: provide a clean implementation model for a RoboSport-faithful clone while leaving room to update once the original rules are verified.

## Core model

Use a deterministic fixed-tick simulation.

Each 15-second turn is divided into small ticks, for example:

- 10 ticks/second = 150 ticks per turn, or
- 15 ticks/second = 225 ticks per turn if matching movie playback frame rate.

At each tick:

1. Read each robot's current timeline command.
2. Generate movement, facing, posture, scan, and fire intents.
3. Resolve movement conflicts.
4. Commit movement.
5. Update posture/facing/scan state.
6. Resolve shots/projectiles/explosions.
7. Apply damage simultaneously.
8. Cleanup destroyed robots.

## Movement invariant

At the end of each tick, no two live robots may occupy the same logical position/tile.

## Proposed collision rules

### Same destination

If two or more robots attempt to enter the same empty destination in the same tick, all such moves fail.

### Occupied destination

A robot may move into an occupied destination only if the occupying robot successfully moves out during the same tick.

### Swap

If two robots attempt to swap positions directly, both moves fail.

### Chain movement

Following is allowed only if the whole chain resolves into an empty destination.

Example allowed:

A B .
A moves into B's tile; B moves right into empty tile.
Result: . A B

Example blocked:

A B C
A moves into B; B moves into C; C holds.
Result: A B C

### Cycles

Closed movement cycles with no empty destination fail.

## Combat timing

Damage from all valid attacks in the same tick should be applied simultaneously.

If A and B kill each other in the same tick, both are destroyed.

## Death timing

Death cleanup occurs after movement and firing for that tick.

A robot killed during the firing step does not vacate its tile early enough for another robot to move into that tile during the same tick.

## Explosives

Projectiles should have launch time and impact time.
At impact, explosion affects robots currently in blast radius.

Open item: exact projectile speed, arc, blast radius, damage, and obstacle rules.

## Friendly fire

Based on manual notes:

- Bullets should not damage friendly robots.
- Explosives should damage friendly robots.

Open item: whether friendly robots block bullets even if not damaged.
