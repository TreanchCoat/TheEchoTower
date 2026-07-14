# The Echo Tower — companion app

Runs the whole puzzle from `the-echo-tower.md` as a small multiplayer web app. No dependencies.

## Run

```
node server.js
```

Then open http://localhost:3000. Other players on your network join via your machine's IP, e.g. `http://192.168.1.20:3000` (allow Node through the Windows firewall when prompted). Requires Node.js 18+.

## How it works

- **Log in** with a name — the name is the ID. Reconnecting with the same name returns you to your room.
- **Enter the Echo** — the Walker. Only one player; the button locks for everyone else.
- **Enter the Loom** — the Readers. Any number of players share one live view.
- **Overseer** — password `TheEchoTower` (change `ADMIN_PASSWORD` at the top of server.js). Shows both views live (fully interactive, for debugging), all hidden state (scripts, holds, beam target, statue alignment requirements, the secret candle map), goal force-buttons, teleport, clock control, script wipe, per-player role release, and full puzzle **reset**.

## Rules implemented

Scripts (current / blue = 1 room ago / yellow = 2 rooms ago) shift on every door. Mimes replay on room entry (mid-script candles flicker in the Loom) and freeze holding their final gesture. Walker gestures at grates/bare stone are recorded but do nothing. Routing = the beam; the statue ring rotates one notch per door, so the beam mis-aims after every transit. Goal 1 (Chain room: blue holds N, Walker holds W, statues aligned to route history) wakes Yellow. Goal 2 (N+E+W held at once in any room) reveals the silver doors. Goal 3 (Mirror room: NW+N+NE held) solves it. Clock: 24 door-passages wipes all scripts; Readers can rewind one notch by snuffing the candle of the station the Walker currently holds (once per visit).
