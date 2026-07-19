// The Echo Tower — game server. Zero dependencies. Run: node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'TheEchoTower';

// ---------------------------------------------------------------- constants
const POSITIONS = ['NW', 'N', 'NE', 'W', 'E'];
const ROOM_LIST = ['Bell', 'Flame', 'Chain', 'Mirror'];
const NORMAL_ROOMS = ['Bell', 'Flame', 'Chain'];
const BASE_ANGLE = { Bell: 0, Flame: 90, Chain: 180, Mirror: 270 };
const GLYPH = { Bell: '\u{1F514}', Flame: '\u{1F525}', Chain: '⛓️', Mirror: '\u{1FA9E}' };

const ROOMS = {
  Bell: {
    desc: 'A small, cold stone chamber. A door of dark wood stands in the south wall.',
    stations: {
      N: { name: 'Bell-rope', grated: true },
      E: { name: 'Bronze lever' },
      W: { name: 'Pressure plate' },
    },
  },
  Flame: {
    desc: 'Warm air, the smell of coals. A door of dark wood stands in the south wall.',
    stations: {
      N: { name: 'Brazier & iron poker' },
      E: { name: 'Iron lever', grated: true },
      W: { name: 'Hanging chain' },
    },
  },
  Chain: {
    desc: 'Chains sway gently overhead. A door of dark wood stands in the south wall.',
    stations: {
      N: { name: 'Chain-wheel', grated: true },
      E: { name: 'Counterweight ring' },
      W: { name: 'Pressure plate' },
    },
  },
  Mirror: {
    desc: 'A room of black glass. The whole north wall is a mirror. Behind your reflection you glimpse, faintly, a round room full of candlelight.',
    stations: {
      N: { name: 'Silver lever (center)' },
      NW: { name: 'Silver lever (north-west)', grated: true },
      NE: { name: 'Silver lever (north-east)', grated: true },
    },
  },
};

const MURALS = {
  Bell: {
    title: 'Arc of the Bell — the law of shadows',
    lines: [
      'What the living does, the shadow does one door later.',
      'What the living did the door before, the golden shadow keeps.',
      'Each shadow rests where it last reached — and rests there holding.',
      'Cold iron stays the living; shadows pass, and grip.',
    ],
  },
  Flame: {
    title: 'Arc of the Flame — the light and the silver door',
    lines: [
      'The living walks where the light is willed.',
      'Hold one room whole — north, east, and west as one —',
      'and the tower will show its silver door.',
    ],
  },
  Chain: {
    title: 'Arc of the Chain — the second shadow',
    lines: [
      'When a shadow keeps the wheel,',
      'and the living keeps the stone,',
      'and each watcher faces where the living next walked —',
      'the second shadow wakes.',
    ],
  },
  Mirror: {
    title: 'Arc of the Mirror',
    lines: [
      'Three hands upon the north wall, held as one.',
      'Bring a shadow for each hand you lack,',
      'and let each arrive already holding.',
    ],
  },
};

const ALL_CANDLES = [];
for (const r of ROOM_LIST) for (const p of Object.keys(ROOMS[r].stations)) ALL_CANDLES.push({ room: r, pos: p });

// ---------------------------------------------------------------- state
let state;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function freshGame() {
  return {
    walker: { room: 'Bell', hold: null },
    scripts: { current: [], blue: null, yellow: null }, // arrays of positions; null = mime not yet fed
    yellowAwake: false,
    mirrorUnlocked: false,
    solved: false,
    beamAngle: null,
    ringOffset: 0,        // statue rotation, in 15-degree notches
    clockNotches: 0,      // doom clock, 0..24
    rewindUsed: false,    // once per room-visit
    statues: { Bell: { facing: null }, Flame: { facing: null }, Chain: { facing: null }, Mirror: { facing: null } },
    routeHistory: ['Bell'],
    candleOrder: shuffle(ALL_CANDLES.slice()),
    log: [],
  };
}

function resetAll(keepPlayers) {
  const players = keepPlayers && state ? state.players : {};
  // free every non-admin role so people re-choose; Echo lock is released
  for (const n of Object.keys(players)) if (players[n].role !== 'admin') players[n].role = null;
  state = freshGame();
  state.players = players; // name -> { role: null|'echo'|'loom'|'admin' }
  state.echoPlayer = null;
  log('Puzzle reset.');
}
state = null; resetAll(false);

function log(msg) {
  state.log.unshift({ t: new Date().toISOString().slice(11, 19), msg });
  if (state.log.length > 200) state.log.pop();
}

// ---------------------------------------------------------------- game logic
const finalPos = (s) => (s && s.length ? s[s.length - 1] : null);
const stationAt = (room, pos) => ROOMS[room].stations[pos] || null;
const statueAngle = (room) => (BASE_ANGLE[room] + state.ringOffset * 15) % 360;

function beamTarget() {
  if (state.beamAngle === null) return null;
  for (const r of ROOM_LIST) if (statueAngle(r) === state.beamAngle % 360) return r;
  return null;
}

function holdsMap() {
  const m = {}; const room = state.walker.room;
  const add = (pos, who) => { if (pos && stationAt(room, pos)) (m[pos] = m[pos] || []).push(who); };
  if (state.yellowAwake && state.scripts.yellow) add(finalPos(state.scripts.yellow), 'yellow');
  if (state.scripts.blue) add(finalPos(state.scripts.blue), 'blue');
  if (state.walker.hold) add(state.walker.hold, 'walker');
  return m;
}

function requiredFacing(room) {
  const h = state.routeHistory;
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i] === room) return h[i + 1] === room ? 'Center' : h[i + 1];
  }
  return null; // never visited-and-departed: cannot be satisfied
}

function statuesAligned() {
  return NORMAL_ROOMS.every((r) => {
    const req = requiredFacing(r);
    return req !== null && state.statues[r].facing === req;
  });
}

function checkGoals() {
  const room = state.walker.room;
  if (!state.yellowAwake && room === 'Chain' && finalPos(state.scripts.blue) === 'N'
      && state.walker.hold === 'W' && statuesAligned()) {
    state.yellowAwake = true;
    log('★ GOAL 1 — the Yellow Mime awakens.');
    toast('all', 'A golden figure steps out of the Walker’s shadow. The second shadow is awake.');
  }
  const m = holdsMap();
  if (state.yellowAwake && !state.mirrorUnlocked && room !== 'Mirror' && m.N && m.E && m.W) {
    state.mirrorUnlocked = true;
    log('★ GOAL 2 — the Mirror Room is unlocked.');
    toast('all', 'Stone grinds throughout the tower. In the Loom, the mirror statue opens its eyes and three new candles rise from the table. The way to the Mirror Room is now open.');
  }
  if (!state.solved && state.mirrorUnlocked && room === 'Mirror' && m.N && m.NW && m.NE) {
    state.solved = true;
    log('★ GOAL 3 — the Mirror dissolves. Puzzle solved!');
    toast('all', 'The mirror does not shatter — it thins like fog burning off. Behind the glass: a round room full of candlelight, four statues, and your friends. The Loom was behind the mirror all along.');
  }
}

function candleIndex(room, pos) {
  return state.candleOrder.findIndex((c) => c.room === room && c.pos === pos);
}

function walkerGesture(pos, kind) {
  if (state.solved) return { error: 'The puzzle is already solved.' };
  const room = state.walker.room; const st = stationAt(room, pos);
  if (state.walker.hold && state.walker.hold !== pos) state.walker.hold = null; // moving away releases
  let msg;
  if (kind === 'hold') {
    if (!st) return { error: 'There is nothing to hold there.' };
    if (st.grated) return { error: 'Your hand stops dead at the cold iron.' };
    state.walker.hold = pos;
    msg = 'You take hold of the ' + st.name + ' and keep it engaged.';
    state.scripts.current.push(pos);
  } else if (!st) {
    msg = 'You grasp at bare stone and empty air. The gesture is made — and, somewhere, remembered.';
    state.scripts.current.push(pos);
  } else if (st.grated) {
    msg = 'You reach for the ' + st.name + ', but your hand stops dead against the pale iron grate. The gesture is not remembered.';
  } else {
    msg = 'You work the ' + st.name + ' for a moment, then let go.';
    flicker([{ idx: candleIndex(room, pos), color: 'orange' }]);
    state.scripts.current.push(pos);
  }
  log('Walker gesture: ' + pos + ' (' + kind + ') in ' + room + '.');
  checkGoals();
  broadcast();
  return { ok: true, message: msg };
}

function walkerRelease() {
  if (!state.walker.hold) return { error: 'You are not holding anything.' };
  state.walker.hold = null;
  log('Walker released hold.');
  checkGoals(); broadcast();
  return { ok: true, message: 'You let go.' };
}

function doorPass(dest, via) {
  const from = state.walker.room;
  state.scripts.yellow = state.scripts.blue;
  state.scripts.blue = state.scripts.current;
  state.scripts.current = [];
  state.walker.hold = null;
  state.walker.room = dest;
  state.routeHistory.push(dest);
  state.ringOffset = (state.ringOffset + 1) % 24;
  state.clockNotches += 1;
  state.rewindUsed = false;
  log('Walker passed ' + via + ' door: ' + from + ' → ' + dest + '. (clock ' + state.clockNotches + '/24)');

  // Mimes replay their scripts in the new room: mid-script entries flicker, final entry is held.
  const items = []; const narr = [];
  for (const [key, color] of [['yellow', 'yellow'], ['blue', 'blue']]) {
    if (key === 'yellow' && !state.yellowAwake) continue;
    const s = state.scripts[key];
    if (!s) continue;
    for (let i = 0; i < s.length - 1; i++) {
      const idx = candleIndex(dest, s[i]);
      if (idx >= 0) items.push({ idx, color });
    }
    const f = finalPos(s);
    narr.push((key === 'blue' ? 'The blue mime' : 'The golden mime') +
      (s.length ? ' replays ' + s.length + ' gesture' + (s.length > 1 ? 's' : '') + ' and freezes ' +
        (f ? 'at ' + f + (stationAt(dest, f) ? ' — gripping the ' + stationAt(dest, f).name : ' — gripping empty air') : '')
        : ' stands idle — it has nothing to repeat.'));
  }
  if (items.length) flicker(items);

  if (state.clockNotches >= 24) {
    state.clockNotches = 0;
    state.scripts = { current: [], blue: null, yellow: null };
    state.walker.hold = null;
    log('⚠ The clock completed its turn. All candles guttered; every script wiped.');
    toast('all', 'Every candle gutters at once. The shadows scatter like smoke — all scripts are wiped. The ring begins its turn anew.');
  }
  checkGoals();
  playSound('gear', false);
  broadcast();
  return { ok: true, message: 'You step through the ' + via + ' door.' + (from === dest ? ' The door opens back into the same room.' : ''), narration: narr };
}

function useSouthDoor() {
  if (state.solved) return { error: 'The puzzle is already solved.' };
  let dest = beamTarget();
  if (!dest || (dest === 'Mirror' && !state.mirrorUnlocked)) dest = state.walker.room;
  return doorPass(dest, 'south');
}

function useSilverDoor() {
  if (state.solved) return { error: 'The puzzle is already solved.' };
  if (!state.mirrorUnlocked) return { error: 'There is no silver door.' };
  return doorPass('Mirror', 'silver');
}

function aimBeam(room) {
  if (!ROOM_LIST.includes(room)) return { error: 'No such statue.' };
  state.beamAngle = statueAngle(room);
  log('Beam aimed at the ' + room + ' statue (angle ' + state.beamAngle + '°).');
  broadcast();
  return { ok: true };
}

function faceStatue(statue, target) {
  if (!ROOM_LIST.includes(statue)) return { error: 'No such statue.' };
  const valid = ROOM_LIST.concat(['Center']);
  if (!valid.includes(target)) return { error: 'Invalid facing.' };
  state.statues[statue].facing = target;
  log('Statue ' + statue + ' turned to face ' + target + '.');
  checkGoals(); broadcast();
  return { ok: true };
}

function snuffCandle(idx) {
  if (state.rewindUsed) return { error: 'The wax is still soft — this can be done only once per room the Walker visits.' };
  state.rewindUsed = true;
  const c = state.candleOrder[idx];
  let msg;
  if (c && c.room === state.walker.room && (holdsMap()[c.pos] || []).includes('walker')) {
    state.ringOffset = (state.ringOffset + 23) % 24;
    state.clockNotches = Math.max(0, state.clockNotches - 1);
    state.scripts.current = [];
    state.scripts.blue = [];
    state.scripts.yellow = [];
    msg = 'You snuff and relight the candle. The great ring grinds backward one notch. All shadows disappear and the Walker\'s actions are forgotten.';
    playSound('gear', true);
    log('Rewind succeeded: clock now ' + state.clockNotches + '/24. Mimes and scripts wiped.');
  } else {
    msg = 'You snuff and relight the candle. Nothing happens.';
    log('Rewind attempted on the wrong candle. Chance spent for this visit.');
  }
  broadcast();
  return { ok: true, message: msg };
}

// ---------------------------------------------------------------- views
function echoView() {
  const m = holdsMap(); const room = state.walker.room;
  return {
    room, glyph: GLYPH[room], desc: ROOMS[room].desc,
    positions: POSITIONS.map((pos) => {
      const st = stationAt(room, pos);
      return { pos, station: st ? st.name : null, grated: !!(st && st.grated), heldBy: m[pos] || [] };
    }),
    walkerHold: state.walker.hold,
    mimes: {
      blue: { present: state.scripts.blue !== null, holding: finalPos(state.scripts.blue) },
      yellow: { present: state.yellowAwake, holding: state.yellowAwake ? finalPos(state.scripts.yellow) : null },
    },
    mirrorUnlocked: state.mirrorUnlocked,
    solved: state.solved,
  };
}

function colorFor(holders) {
  if (holders.includes('walker')) return 'orange';
  if (holders.includes('blue')) return 'blue';
  return 'yellow';
}

function loomView() {
  const m = holdsMap();
  const loomPlayers = Object.keys(state.players).filter((n) => state.players[n].role === 'loom');
  return {
    statues: ROOM_LIST.map((r) => ({
      room: r, glyph: GLYPH[r], angle: statueAngle(r),
      eyesGlow: r === state.walker.room,
      eyesOpen: r !== 'Mirror' || state.mirrorUnlocked,
      facing: state.statues[r].facing,
    })),
    beamAngle: state.beamAngle,
    clockNotches: state.clockNotches,
    candles: state.candleOrder.map((c, i) => {
      if (c.room === 'Mirror' && !state.mirrorUnlocked) return { i, hidden: true };
      const lit = c.room === state.walker.room && m[c.pos];
      return { i, lit: !!lit, color: lit ? colorFor(m[c.pos]) : null };
    }),
    mural: MURALS[state.walker.room],
    rewindAvailable: !state.rewindUsed,
    yellowAwake: state.yellowAwake,
    mirrorUnlocked: state.mirrorUnlocked,
    solved: state.solved,
    loomPlayers,
  };
}

function adminView() {
  return {
    walker: state.walker,
    scripts: state.scripts,
    yellowAwake: state.yellowAwake,
    mirrorUnlocked: state.mirrorUnlocked,
    solved: state.solved,
    beamAngle: state.beamAngle,
    beamTarget: beamTarget(),
    ringOffset: state.ringOffset,
    clockNotches: state.clockNotches,
    rewindUsed: state.rewindUsed,
    routeHistory: state.routeHistory,
    holds: holdsMap(),
    statues: ROOM_LIST.map((r) => ({
      statue: r, facing: state.statues[r].facing,
      required: NORMAL_ROOMS.includes(r) ? requiredFacing(r) : '(irrelevant)',
      ok: NORMAL_ROOMS.includes(r) ? requiredFacing(r) !== null && state.statues[r].facing === requiredFacing(r) : true,
    })),
    aligned: statuesAligned(),
    candleOrder: state.candleOrder,
    players: Object.keys(state.players).map((n) => ({ name: n, role: state.players[n].role })),
    echoPlayer: state.echoPlayer,
    log: state.log.slice(0, 60),
  };
}

function viewFor(name) {
  const p = state.players[name];
  const role = p ? p.role : null;
  if (role === 'echo') return { screen: 'echo', echo: echoView() };
  if (role === 'loom') return { screen: 'loom', loom: loomView() };
  if (role === 'admin') return { screen: 'admin', echo: echoView(), loom: loomView(), admin: adminView() };
  return { screen: 'choose', echoTaken: !!state.echoPlayer };
}

// ---------------------------------------------------------------- sse
const clients = []; // { name, res }
function sseSend(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
function broadcast() {
  for (const c of clients) { try { sseSend(c.res, { type: 'state', view: viewFor(c.name) }); } catch (e) { /* ignore */ } }
}
function toast(roles, msg) {
  for (const c of clients) {
    const p = state.players[c.name]; const role = p ? p.role : null;
    if (roles === 'all' || roles.includes(role) || role === 'admin') {
      try { sseSend(c.res, { type: 'toast', msg }); } catch (e) { /* ignore */ }
    }
  }
}
function flicker(items) {
  for (const c of clients) {
    const p = state.players[c.name]; const role = p ? p.role : null;
    if (role === 'loom' || role === 'admin') {
      try { sseSend(c.res, { type: 'flicker', items }); } catch (e) { /* ignore */ }
    }
  }
}
function playSound(sound, reverse = false) {
  for (const c of clients) {
    try { sseSend(c.res, { type: 'sound', sound, reverse }); } catch (e) { /* ignore */ }
  }
}
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (e) { /* ignore */ } } }, 25000);

// ---------------------------------------------------------------- actions
function handleAction(body) {
  const name = (body.name || '').trim();
  const a = body.action;
  if (a === 'login') {
    if (!name) return { error: 'Please enter a name.' };
    if (!state.players[name]) { state.players[name] = { role: null }; log('Player "' + name + '" logged in.'); }
    return { ok: true, role: state.players[name].role };
  }
  const player = state.players[name];
  if (!player) return { error: 'Not logged in.' };

  if (a === 'choose') {
    if (player.role) return { error: 'You are already bound to your place. Only the Overseer can release you.' };
    if (body.role === 'echo') {
      if (state.echoPlayer && state.echoPlayer !== name) return { error: 'Someone already walks the Echo. Only one may.' };
      state.echoPlayer = name; player.role = 'echo';
      log('"' + name + '" entered the Echo (the Walker).');
    } else if (body.role === 'loom') {
      player.role = 'loom';
      log('"' + name + '" entered the Loom (a Reader).');
    } else if (body.role === 'admin') {
      if (body.password !== ADMIN_PASSWORD) return { error: 'Wrong password.' };
      player.role = 'admin';
      log('"' + name + '" entered as Overseer.');
    } else return { error: 'Unknown destination.' };
    broadcast();
    return { ok: true, role: player.role };
  }

  const role = player.role;
  const isAdmin = role === 'admin';

  // Walker actions
  if (a === 'gesture') { if (role !== 'echo' && !isAdmin) return { error: 'Not your place.' }; return walkerGesture(body.pos, body.kind); }
  if (a === 'release') { if (role !== 'echo' && !isAdmin) return { error: 'Not your place.' }; return walkerRelease(); }
  if (a === 'door') {
    if (role !== 'echo' && !isAdmin) return { error: 'Not your place.' };
    return body.which === 'silver' ? useSilverDoor() : useSouthDoor();
  }
  // Loom actions
  if (a === 'aimBeam') { if (role !== 'loom' && !isAdmin) return { error: 'Not your place.' }; return aimBeam(body.room); }
  if (a === 'faceStatue') { if (role !== 'loom' && !isAdmin) return { error: 'Not your place.' }; return faceStatue(body.statue, body.target); }
  if (a === 'snuffCandle') { if (role !== 'loom' && !isAdmin) return { error: 'Not your place.' }; return snuffCandle(body.idx); }

  // Admin tools
  if (!isAdmin) return { error: 'Overseer only.' };
  if (a === 'reset') { resetAll(true); toast('all', 'The Overseer resets the tower. Choose your place again.'); broadcast(); return { ok: true }; }
  if (a === 'wakeYellow') { state.yellowAwake = true; log('DEBUG: Yellow forced awake.'); checkGoals(); broadcast(); return { ok: true }; }
  if (a === 'unlockMirror') { state.mirrorUnlocked = true; log('DEBUG: Mirror forced unlocked.'); checkGoals(); broadcast(); return { ok: true }; }
  if (a === 'forceSolve') { state.solved = true; log('DEBUG: forced solve.'); broadcast(); return { ok: true }; }
  if (a === 'teleport') {
    if (!ROOM_LIST.includes(body.room)) return { error: 'No such room.' };
    return doorPass(body.room, 'overseer (teleport)');
  }
  if (a === 'wipeScripts') { state.scripts = { current: [], blue: null, yellow: null }; state.walker.hold = null; log('DEBUG: scripts wiped.'); broadcast(); return { ok: true }; }
  if (a === 'setClock') { state.clockNotches = Math.max(0, Math.min(24, body.n | 0)); log('DEBUG: clock set to ' + state.clockNotches + '.'); broadcast(); return { ok: true }; }
  if (a === 'freeRole') {
    const t = state.players[body.target];
    if (!t) return { error: 'No such player.' };
    if (state.echoPlayer === body.target) state.echoPlayer = null;
    t.role = null;
    log('DEBUG: freed "' + body.target + '" from their place.');
    broadcast(); return { ok: true };
  }
  return { error: 'Unknown action: ' + a };
}

// ---------------------------------------------------------------- http
const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/gear.mp3') {
    fs.readFile(path.join(__dirname, 'heavy_gear_locking_into_place.mp3'), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000' });
      res.end(data);
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    const name = (url.searchParams.get('name') || '').trim();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const client = { name, res };
    clients.push(client);
    sseSend(res, { type: 'state', view: viewFor(name) });
    req.on('close', () => { const i = clients.indexOf(client); if (i >= 0) clients.splice(i, 1); });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api') {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { /* ignore */ }
      let out;
      try { out = handleAction(body); } catch (e) { out = { error: 'Server error: ' + e.message }; console.error(e); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('The Echo Tower is listening on http://localhost:' + PORT);
  console.log('Players on your network can join via your machine’s IP, e.g. http://192.168.x.x:' + PORT);
  console.log('Overseer password: ' + ADMIN_PASSWORD);
});
