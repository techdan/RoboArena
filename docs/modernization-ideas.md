# Modernization ideas

RoboArena matches the original RoboSport's rules for now. The original was
playtested for balance, so we keep its numbers and behaviour even where a
modern game might do something different. This page lists the places where we
know a change could improve the game later, so they are not lost. Nothing here
is scheduled; each item needs a playtest before it changes.

Binary references point into [re-map/](re-map/README.md).

## Kept as the original for balance

| Rule | Original behaviour (now in RoboArena) | Possible modern change |
| --- | --- | --- |
| Enemy spotting | Per-tick dice roll against DGROUP `0x213A`, indexed by cover, sight, distance and whether the target moved or acted (`seg96:0x09AF`). Firing reveals the shooter. Rules revision 2. | Deterministic sight (see everything in cone and line of sight), or a visible "spot chance" readout so the roll is less opaque. |
| Turning cost | 5 ticks per eighth of a turn, shortest way round (`seg80:0x0422`). A half turn costs 20 ticks. | A flat cost per turn, or a faster turn for some chassis. |
| Posture change | 10 ticks per level; Upright↔Crouching goes through Ducking (`seg80:0x0352`). | A direct Upright↔Crouching change. |

## Deliberate divergences already in RoboArena

- **Fog in Beginner games.** The original Beginner formation turns Show Enemy
  Positions on (`seg61`, options flags `|= 7`), so beginners see every enemy.
  RoboArena rooms always keep fog. We could offer it as a lobby option.

## Still to match, then reconsider

These original behaviours are not implemented yet. The plan is to match them
first and only then decide whether to modernize them.

- Robots occupy their destination tile partway through a move (`seg6:0x2D59`,
  `seg6:0x2E04`).
- The 5-tick bullet delay, projectile flight and scatter.
- The Scan & Fire seven-shot cooldown.

## New ideas

- **Clans or factions with different strengths.** The robot chassis designs
  considered for the 3D roster (strider, hound, crab, titan and alternatives)
  could become selectable options, each with trade-offs such as faster turning,
  better spotting, more armour or slower movement. This would move the game
  away from the original's balance, so it needs its own playtesting.
