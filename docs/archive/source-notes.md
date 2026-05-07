# RoboSport Source Notes

## Most useful sources identified

### Lemon Amiga manual transcription
URL: https://www.lemonamiga.com/doc/robosport/1368

Use for:
- tutorial flow
- Robot Turn Clock / programmed timeline
- robot postures
- scan box / aim direction
- beginner vs advanced visibility
- bullets vs explosive friendly-fire behavior
- formations and game lengths

Known limitation:
- It appears to include a tutorial and references to a Technical Reference section, but may not expose every low-level rule needed for exact simulation.

### The Good Old Days RoboSport page
URL: https://www.goodolddays.net/en/game/RoboSport/

Search result indicates downloadable files:
- RoboSport-Manual.txt
- RoboSport-Reference.7z

Use for:
- locating a fuller manual/reference archive, likely the best next source.

Known limitation:
- Page/file access may need manual download in a browser.

### MobyGames RoboSport page
URL: https://www.mobygames.com/game/1834/robosport/

Use for:
- official description
- screenshots
- platform/release metadata
- screenshots showing deployment, command phase, movie playback, objective modes

### Macintosh Repository RoboSport page
URL: https://www.macintoshrepository.org/5332-robosport

Use for:
- confirming network/multiplayer concept
- possible downloadable Mac version/manual material

### MyAbandonware RoboSport for Windows page
URL: https://www.myabandonware.com/game/robosport-for-windows-18y

Use for:
- Windows version download
- screenshots
- possible path for empirical testing in Wine/VM

### YouTube gameplay/setup video
URL: https://www.youtube.com/watch?v=eL3XIMHuBUE

Use for:
- frame-by-frame reconstruction of UI flow
- robot placement flow
- command recording flow
- 15-second timeline and movie playback behavior

Known limitation:
- No dialog. It may not reveal hidden formulas or collision rules unless the shown game state exercises those edge cases.

## Research policy for this project

Each mechanic should be tagged:

- CONFIRMED: explicitly shown in manual, official description, or observed in repeatable original-game test
- INFERRED: strongly suggested but not explicitly stated
- PROPOSED: clone implementation choice
- UNKNOWN: do not implement as original without further evidence
