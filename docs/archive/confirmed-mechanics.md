# Confirmed / High-Confidence RoboSport Mechanics

This file summarizes mechanics we have discussed and should treat as source-backed or high-confidence. Exact formulas may still be unknown.

## Game structure

- RoboSport is a turn-based tactical robot combat game with simultaneous execution.
- Players program robot actions ahead of time.
- The computer then generates/plays a movie of the turn.
- Turns are represented as a timed interval. Windows screenshots/video indicate a 15-second turn window.

## Teams and players

- Up to 4 teams/players.
- Teams have color, side/alliance, brain/human/computer assignment, and home area/depot.

## Game lengths / robot counts

Known length presets:

- Skirmish: 2 robots/team, tiny arena
- Melee: 4 robots/team, small arena
- Battle: 6 robots/team, large arena
- Campaign: 8 robots/team, huge arena

Do not hard-code “4 robots per team” as universal; that is only one game length.

## Game modes / sports

Known modes include:

- Survival
- Treasure / Treasure Hunt
- Hunt or Hostage mode (source wording needs reconciliation)
- Capture the Flag
- Baseball

Open item: reconcile exact names and objectives from full manual/reference.

## Formations

Known formations:

- Beginner
- Standard
- Fire Fight
- Missile Fest
- Beat the Clock

Formations appear to define robot roster, weapons, and perhaps scenario constraints.

## Robot postures

Robots may be:

- Standing
- Ducking
- Crouching

Posture affects hit difficulty and terrain traversal. Crouched robots cannot cross some terrain such as low walls, bushes, or rough ground.

## Scan / aim

Robots have a Scan Box / scan direction.

Important implications:

- Robots do not simply see/shoot omnidirectionally.
- Aim direction and scan direction matter.
- Advanced games hide enemies outside scanning range.

## Weapons

Known weapon categories:

- Rifle
- Burst Gun
- Automatic Rifle
- Missile Launcher
- Grenade Launcher

Bullet weapons have unlimited ammunition.
Explosive weapons have limited ammunition.

Important friendly-fire distinction:

- Bullets do not harm your own robots.
- Missiles/explosives can harm your own robots.

## Visibility

Beginner formation appears to show all robots during the movie.
Advanced formations limit visibility to your team plus enemy robots in scanning range.

Open item: exact scan range, line-of-sight, and last-known marker behavior.
