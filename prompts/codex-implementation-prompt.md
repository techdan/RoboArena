# Codex Prompt: Implement RoboSport-Faithful Engine Skeleton

Build a deterministic simulation engine for a RoboSport-faithful clone.

Important constraints:

- Treat confirmed mechanics as requirements.
- Treat proposed resolution rules as implementation choices, not original-game facts.
- Keep the engine deterministic and testable.
- Use integer/fixed-tick simulation, not floating-point timing.
- Create tests for all conflict-resolution edge cases.

Core engine modules to create:

- GameState
- TurnTimeline
- RobotProgram
- MovementResolver
- CombatResolver
- VisibilityResolver
- ProjectileResolver
- ObjectiveResolver
- ReplayLog

Minimum test coverage:

- same-destination collision
- direct swap collision
- follow-the-leader movement
- blocked chain
- simultaneous mutual kill
- bullet no friendly damage
- explosive friendly damage
- death cleanup after tick

Do not build UI first. Build the deterministic engine and tests first.
