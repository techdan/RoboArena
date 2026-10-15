# ROBO.EXE resource inventory

An index of every string table, dialog and menu in `ROBO.EXE`. It gives the
ranges and their purpose, not the full text. Regenerate the full text locally
with `python3 tools/re/dump_res.py ROBO.EXE strings|dialogs|menus`, and dump the
controls of any dialog with `python3 tools/re/dlg_ids.py ROBO.EXE <id>`.

## String tables (524 strings)

The original groups its strings into named blocks. The first string of each
block is the block name, as in the source.

| STR range | Block name | Contents |
|---|---|---|
| 100–104 | (errors) | Fatal load and out-of-memory messages |
| 200–201 | (boot) | "System Is Fully Operational" splash |
| 300–340 | `STRN_TEAMSLCT` | Team select: robot classes 305–309, roster lines "%d Rifle Robot" 311–319, brains 329–333, base patterns 336–339, ratings |
| 400–424 | `STRN_GAMEOPTION` | Game Options labels and units (Time Limit, Score Limit, Turn Clock, "minutes") |
| 500–511 | `STRN_MAPVIEW` | Arena viewer, ruler labels |
| 600–652 | `STRN_TOKMAP` | Planner: weapon labels 605–611, targeting statuses 630–637, max range 641, terrain names 644–650 |
| 700–704 | `STRN_SCHEDULE` | Turn generation progress |
| 800–845 | `STRN_MENU` | Dynamic menu items: Scan 823, Self Destruct 824, Place Bomb 825, sport verbs 826–831, Zap 836, "Arenas" 844 |
| 900–922 | `STRN_NETWORK` | Network and modem status |
| 1000–1018 | `STRN_NEWDROID` | New robot defaults: weapon names 1007–1012, class names 1013–1017 |
| 1100–1116 | `STRN_FILE` | File open and save errors |
| 1200–1208 | `STRN_IOERROR` | Disk I/O errors |
| 1300–1343 | `STRN_TELEVISION` | Movie and title captions, registered-owner text |
| 1400–1446 | `STRN_ENDGAME` | Final Ceremony: sport names 1406–1410, bonus labels 1412–1416, MVP 1417–1419 (unreferenced), Ow/Argh 1422/1423, stats formats 1431–1446 |
| 1500, 1600 | `STRN_HELPTITLE`, `STRN_HELPINFO` | Placeholders; help text lives in dialogs #13–#22 |
| 1700–1701 | `STRN_MOVIE` | "%d Frames/Sec" |
| 1800–1808 | `STRN_PRINT` | Printing |
| 2000–2005 | `TYPEMENU` | Sports: Survival, Treasure Hunt, Capture the Flag, Hostage, Baseball |
| 2010–2015 | `LEVELMENU` | Formations: Beginner, Standard, Fire Fight, Missile Fest, Beat the Clock |
| 2020–2024 | `LENGTHMENU` | Game lengths: Skirmish, Melee, Battle, Campaign |
| 2100–2102 | `DEFAULT_TEAMS` | Default team names Cyborgs, Computers |
| 2200–2255 | `STRN_ALERT` | Planner and setup alerts (dock rules 2201/2228, out of ammo 2202, minimum hostages 2204, self-destruct confirm 2227, turn clock expired 2230) |
| 2900–2939 | `STRN_NETBIOS` | NetBIOS errors |
| 3000–3032 | `STRN_MISC` | Version "1.00" (3031), misc |
| 4000–4021 | `STRN_PLAY` | RoboPlayer captions, ceremony lines 4006–4019. ROBO.EXE never references these; they are probably for `PLAYER.EXE` |

## Dialogs

| DLG | Title or purpose | Notes |
|---|---|---|
| 1 | About RoboSport | |
| 2 | Bomb Fuse and Placement | Time Bomb fuse 0–40 s ([commands.md](commands.md) §4) |
| 3 | Custom Game | Sport radio buttons, View Arena, Options, Teams, Color, Side, Brain, Rating, Home |
| 4 | Team Edit | Class buttons Rifle/Burst/Auto/Missile/Stealth, rating ([setup.md](setup.md) §5) |
| 5 | Final Ceremony | Start Ceremony, Show Stats, Return to Start |
| 6, 7 | End movie / end game confirms | |
| 9 | Game Options | Time Limit, Score Limit, Turn Clock, Show Enemy Positions/Damage ([setup.md](setup.md) §4) |
| 10, 11 | Turn Generation | "Generating Turn..." |
| 13–22 | Terrain help | Bushes, Crevice, Dock, Fence, Ground, Low Walls, off-arena, Outer Wall, Rough Ground, Walls |
| 23 | Load Arena | Custom `.TWN` picker |
| 24 | Select Team for Viewing | Movie |
| 25–32, 40–42, 47 | Network, modem, serial, password, talk, data transfer | Out of scope |
| 33 | Preferences | |
| 35 | Quick Start | Team Name, Sport Type, Formation, Game Length, Arena Type ([setup.md](setup.md) §1) |
| 36 | Record Movie | |
| 37 | Scan for N seconds | Selectors 32–39 |
| 38 | Scan & Fire | Maximum Distance, Seconds |
| 39 | Score Limit | 50–10000 |
| 43 | Base pattern | Four/Five Cross, Four/Five Corner ([sports.md](sports.md) §6) |
| 44 | Coins | 1–12 per turn ([sports.md](sports.md) §3) |
| 45 | Hostages | Give and take ([sports.md](sports.md) §5) |
| 46 | Extra weapons | Grenades 0–9, Missiles 0–9, Zap, Time Bomb |
| 48 | `STEALTHALERT` | Stealth robots with Show Enemy Positions on ([stealth-fence-ceremony-ai-formats.md](stealth-fence-ceremony-ai-formats.md) §1.5) |
| 49 | Team Data | |
| 50 | Time Limit | |
| 51 | Robot info | e.g. "Cyborgs: Rifle1 (140)" |
| 52 | Tools | Posture buttons |
| 53 | Turn Clock | 1–15 min |
| 54 | Select Team for Editing | |
| 55 | Turn Length | "1-%d Seconds" |
| 56 | RoboPlayer | First Turn, All Turns |
| 57 | Zap Duration | 1–40 s ([commands.md](commands.md) §3) |

## Menus

| MENU | Window | Items of interest |
|---|---|---|
| 1 | Start | File (New/Open/Save Scenario, links, Preferences), Team (New/Open/Save/Edit/Delete) |
| 2 | Arena viewer | Print, Open Arena, Show Ruler, Magnify, Show Home Area |
| 3 | Movie | Play, Stop, Rewind, Forward/Back Step, Team Data, frame rates |
| 4 | Link | Open Game, Serial/Modem/Network link |
| 5 | Planner | Turn (End Turn, Team Data), Robots, Arena, Commands (Scan, Zap, Place Bomb, Self Destruct, sport verbs added at run time by `seg79:0x1044`) |
