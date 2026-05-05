# Open Questions for Faithful RoboSport Clone

These are the most important unresolved issues.

## Critical simulation questions

1. Collision rules
   - What happens when two robots try to move into the same square/space?
   - What happens on direct swaps?
   - Can one robot follow another into a square vacated during the same micro-time?
   - Can robots pass through each other during continuous movement?

2. Movement model
   - Is movement tile-based, waypoint-based, pixel-continuous, or hybrid?
   - Is collision checked at command boundaries, per frame, or per smaller simulation tick?
   - Does posture change movement speed?

3. Timing model
   - Exact action durations.
   - Exact firing rate per weapon.
   - Exact turn duration in all versions/modes.
   - Whether all commands are quantized to frames/ticks.

4. Damage model
   - Exact robot armor/health values.
   - Exact weapon damage values.
   - Whether bullets have deterministic hits or probability influenced by aim/scan/posture.
   - Blast radius and falloff for missiles/grenades.

5. Visibility / scanning
   - Exact scan arc or box geometry.
   - Whether line of sight is blocked by all obstacles.
   - Whether scan direction only affects firing accuracy or also visibility.
   - How last-known enemy positions are represented.

6. Objective modes
   - Exact scoring and win conditions for Treasure, Hunt/Hostage, Capture the Flag, and Baseball.

7. AI
   - Difficulty levels and behavior.
   - Whether AI uses hidden information.

## Best path to answer

1. Download/read RoboSport-Reference.7z and ROBO.TXT if available.
2. Run the original Windows or Mac version.
3. Create controlled experiments for movement/collision edge cases.
4. Update `docs/confirmed-mechanics.md` and `docs/resolution-rules-proposal.md` accordingly.
