# Original Game Empirical Test Plan

Goal: determine exact RoboSport resolution rules by running the original game in controlled scenarios.

## Setup

Use the Windows 3.x, Mac, or Amiga version in an emulator/VM.
Prefer the Windows version if it is easiest to record video and repeat tests.

Record each test with screen capture.
Capture before/after screenshots and note exact commands.

## Test 1: Same destination

Scenario:
- Place two robots equidistant from a single open destination.
- Program both to arrive at the same destination at the same time.

Observe:
- Do both stop?
- Does one win?
- Do they overlap?
- Is result dependent on team/player order or robot name?

## Test 2: Direct swap

Scenario:
- Place two robots adjacent.
- Program A into B's start position and B into A's start position at the same time.

Observe:
- Swap, block, pass through, or one wins?

## Test 3: Follow-the-leader

Scenario:
- A behind B.
- B moves forward.
- A moves into B's starting position at matching timing.

Observe:
- Can A enter B's vacated position?
- Is there a minimum delay?

## Test 4: Chain movement

Scenario:
- A behind B behind C.
- A and B try to move forward; C holds.

Observe:
- Are A and B both blocked?
- Does B bump and A bump?

## Test 5: Bullet friendly fire

Scenario:
- Friendly robot stands between shooter and enemy.
- Fire bullet weapon toward enemy.

Observe:
- Does shot pass through friend?
- Does friend block line of sight?
- Does friend take no damage but stop bullet?

## Test 6: Explosive friendly fire

Scenario:
- Fire missile/grenade near friendly robot.

Observe:
- Confirm friendly damage.
- Estimate radius and damage.

## Test 7: Scan visibility

Scenario:
- Use non-Beginner formation.
- Move enemy in/out of scan direction and range.

Observe:
- When does enemy become visible?
- Are last-known markers shown?
- Is visibility symmetric?

## Test 8: Posture and hit/movement

Scenario:
- Repeat shots against standing, ducking, crouching robot.
- Try crouched traversal over low obstacles/bushes/rough terrain.

Observe:
- Hit frequency or deterministic misses.
- Traversal restrictions.
