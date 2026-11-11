// QUICKTIME RUSH: 1v1 half-court streetball. First to 11, make it take it, 1s and 2s, clear it on a change of possession.
import * as THREE from '../vendor/three.module.min.js';
import { buildWorld, makeBaller, makeBall, makeRing, ARC, CORNER_X, CORNER_Z, RIM } from './world.js';
import { sfx, unlockAudio, setMuted, isMuted, startBeat, stopBeat, setBeat } from './audio.js';
import { input, input2, initInput, pollMove, endFrame, setTwoPlayer, setScheme, getScheme } from './input.js';
import { loadRig, makeRigBaller } from './anim.js';
import { hostRoom, joinRoom, cleanCode } from './net.js';
import { SITE, TITLE, FEEDBACK } from './config.js';

// self-hosted fonts must be ready before anything is painted into a canvas texture (court, wall, jersey numbers)
try { await Promise.race([Promise.all([document.fonts.load("900 40px 'Big Shoulders Display'"), document.fonts.load('700 16px Barlow')]), new Promise(r => setTimeout(r, 1500))]); } catch (err) { /* system fonts */ }
// mocap rig (assets/baller.glb); if it can't load (filter, old browser) fall back to the procedural baller
let RIG = false;
try { await loadRig(new URL('../assets/baller.glb', import.meta.url).href); RIG = true; } catch (err) { console.warn('[iso] rig failed, using procedural baller', err); }

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rand = (a, b) => a + Math.random() * (b - a), lerp = (a, b, t) => a + (b - a) * t;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const isThree = (x, z) => (Math.abs(x) >= CORNER_X && z <= CORNER_Z) || Math.hypot(x, z) >= ARC;
const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
const LEAN_K = 2.6;          // how hard a CPU must be leaning the wrong way (m/s) before a move drops him, before its ankle rating
const BLOCK_K = 0.45;        // CPU jump-timing handicap: higher = CPUs block less
const GREEN = 0.78;           // ideal release point on the meter
const PW = 0.07, GW = 0.15;   // perfect / good half-windows (meter units)
const CHECK = [{ x: 0, z: 8.8 }, { x: 0, z: 7.1 }];

// ---------- difficulty + daily boss ----------
const DIFF = {
  rookie: { name: 'Rookie', read: 0.35, readAcc: 0.4, bite: 0.85, speed: 0.86, react: 0.34, perfect: 0.1, good: 0.33, okay: 0.32, gap: 1.4, contest: 0.45, steal: 0.14, stealRate: 0.25, block: 0.16, ankle: 0.62, open: 2.0, cross: 0.7, patience: 7, plans: { drive: 0.4, spot: 0.4, pull: 0.2 } },
  pro:    { name: 'Pro',    read: 0.5, readAcc: 0.5, bite: 0.6, speed: 0.95, react: 0.22, perfect: 0.2, good: 0.4, okay: 0.26, gap: 1.15, contest: 0.75, steal: 0.2, stealRate: 0.45, block: 0.27, ankle: 0.42, open: 1.6, cross: 1.2, patience: 6.5, plans: { drive: 0.35, spot: 0.45, pull: 0.2 } },
  legend: { name: 'Legend', read: 0.6, readAcc: 0.6, bite: 0.35, speed: 1.02, react: 0.14, perfect: 0.32, good: 0.42, okay: 0.18, gap: 1.0, contest: 0.92, steal: 0.27, stealRate: 0.7, block: 0.36, ankle: 0.25, open: 1.35, cross: 1.8, patience: 6, plans: { drive: 0.35, spot: 0.45, pull: 0.2 } },
};
const TRAITS = {
  LOCKDOWN:   { desc: 'Sticks to you on D', fx: c => { c.gap -= 0.18; c.speed += 0.05; c.contest += 0.1; } },
  SNIPER:     { desc: 'Lives behind the arc', fx: c => { c.perfect += 0.14; c.plans = { drive: 0.15, spot: 0.6, pull: 0.25 }; c.open -= 0.2; } },
  PICKPOCKET: { desc: 'Swipes at everything', fx: c => { c.stealRate *= 2; c.steal += 0.08; } },
  SKYWALKER:  { desc: 'Blocks shots', fx: c => { c.block += 0.16; c.contest = 1; } },
  SLASHER:    { desc: 'Attacks the rim', fx: c => { c.plans = { drive: 0.7, spot: 0.2, pull: 0.1 }; c.cross += 0.8; } },
  ICE:        { desc: 'Reads your moves', fx: c => { c.ankle *= 0.3; c.bite *= 0.4; c.read = 0.75; c.readAcc = 0.65; } },
  MOTOR:      { desc: 'Never gets tired', fx: c => { c.speed += 0.06; c.react -= 0.04; } },
};
const NAMES = ['Vince', 'Marlo', 'Dre', 'Kenji', 'Sol', 'Rico', 'Tasha', 'Bo', 'Jules', 'Nia', 'Omar', 'Lex', 'Theo', 'Imani', 'Zeke', 'Quinn'];
const BOSS_COLORS = [0xf0452a, 0x2f6bff, 0x9b5cff, 0x27d86c, 0xff7a1a, 0xf3f2ee, 0xff5fa2];
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayN() { const now = new Date(); return Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(2026, 10, 9)) / 864e5) + 1; }
function dailyBoss(n = todayN()) {
  const r = mulberry(n * 7919 + 13), keys = Object.keys(TRAITS);
  const t1 = keys[Math.floor(r() * keys.length)]; let t2; do { t2 = keys[Math.floor(r() * keys.length)]; } while (t2 === t1);
  const cfg = structuredClone(DIFF.pro); cfg.plans = { ...cfg.plans };
  TRAITS[t1].fx(cfg); TRAITS[t2].fx(cfg); cfg.name = 'Boss';
  return { n, key: 'd' + n, name: NAMES[Math.floor(r() * NAMES.length)], traits: [t1, t2], cfg, color: BOSS_COLORS[Math.floor(r() * BOSS_COLORS.length)], look: { hair: Math.floor(r() * 5), skin: Math.floor(r() * 5), band: r() < 0.5 } };
}

// ---------- renderer / scene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;   // flat poster colour, no filmic roll-off
const world = buildWorld(), scene = world.scene;
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
const camPos = new THREE.Vector3(0, 7, 16), camLook = new THREE.Vector3(0, 1.2, 3);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 64 : 48; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- entities ----------
const YOU_COLOR = 0xffcf1a;
function makeEntity(team, color, skin) {
  const mesh = RIG ? makeRigBaller(color, skin, team === 0 ? 3 : 11) : makeBaller(color, skin, team === 0 ? 3 : 11), ring = makeRing(color);
  scene.add(mesh.root, ring);
  return { team, mesh, ring, color, x: 0, z: 10, vx: 0, vz: 0, wantX: 0, wantZ: 0, y: 0, vy: 0, face: Math.PI, stamina: 100, stun: 0, stumble: 0,
    dashT: 0, dx: 0, dz: 0, stealCd: 0, reachT: 0, shooting: false, meter: 0, fill: 1, jumpH: 0.5, lay: false, shotX: 0, shotZ: 0,
    hand: 1, slideCd: 0, readT: 0, lastSlide: null, lastMoveDir: null, sprint: false, stepT: 0, spinT: 0, spinDir: 1, dashDelay: 0, hangT: 0, bumpCd: 0, lastMove: -9, moveKind: '', offBal: false, stepShot: false, needsClear: false, phase: 0, dribble: 0, bounced: false, cfg: DIFF.pro, ai: { plan: 'spot', planT: 0, holdT: 0, tx: 0, tz: 5, sx: 0, sz: 8, contest: false, jumpIn: -1, releaseAt: GREEN, seed: Math.random() * 9 } };
}
const P = [makeEntity(0, YOU_COLOR, 0xc58c62), makeEntity(1, 0xf0452a, 0x7a4a2e)];
// ---------- looks: hair / skin / kit ----------
const HAIRS = ['Fade', 'Afro', 'Locs', 'Buzz', 'Bun', 'Bald'];
const SKINS = [0xc58c62, 0x8d5a3b, 0x5c3a26, 0xe2b48a, 0xf1cfa8];
const KITS = [{ name: 'Taxi', c: 0xffcf1a, need: 0 }, { name: 'Chalk', c: 0xf3f2ee, need: 0 }, { name: 'Mint', c: 0x27d86c, need: 3 }, { name: 'Grape', c: 0x9b5cff, need: 8 }, { name: 'Ice', c: 0x53d0ff, need: 15 }, { name: 'Blackout', c: 0x343744, need: 25 }];
const CPU_LOOK = { rookie: { hair: 3, skin: 3, band: false }, pro: { hair: 0, skin: 1, band: true }, legend: { hair: 2, skin: 2, band: true } };
function setLook(e, look) { if (e.mesh.setLook) e.mesh.setLook({ hair: HAIRS[look.hair % HAIRS.length], skin: SKINS[look.skin % SKINS.length], band: look.band !== false }); }
function applyMyLook() { const L = G.look; setLook(P[0], { ...L, band: true }); recolor(P[0], KITS[L.kit % KITS.length].c); }
function recolor(e, color) {
  e.color = color; e.ring.material.color.setHex(color);
  if (e.mesh.setColor) { e.mesh.setColor(color); return; }
  e.mesh.root.traverse(o => { if (o.isMesh && o.material.emissive && o.material.emissiveIntensity < 0.4 && o.material.color.getHex() !== 0x15161d && o.material.roughness === 0.5) { o.material.color.setHex(color); o.material.emissive.setHex(color); } });
  e.mesh.root.traverse(o => { if (o.isMesh && o.material.roughness === 0.4) o.material.emissive.setHex(color); });
}
const ballMesh = makeBall(); scene.add(ballMesh);
const ball = { state: 'held', holder: null, p: new THREE.Vector3(0, 1, 8), v: new THREE.Vector3(), shot: null, noPick: -1 };   // noPick: team that fumbled it can't recover
// glowing trail behind a shot in flight: green on a perfect release
const trail = (() => {
  const N = 16, meshes = [], hist = [], geo = new THREE.SphereGeometry(0.1, 8, 6);
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.setScalar(1 - (i / N) * 0.8); m.visible = false; scene.add(m); meshes.push(m);
  }
  let green = false;
  return {
    reset(g, hot = false) { green = g || hot; hist.length = 0; for (const m of meshes) m.material.color.setHex(g ? 0x3dff8a : hot ? 0xff8a1a : 0xffd9a0); },
    update() {
      if (ball.state === 'flight') { hist.unshift(ball.p.clone()); if (hist.length > N) hist.pop(); } else if (hist.length) hist.pop();
      meshes.forEach((m, i) => { const q = hist[i]; m.visible = !!q; if (q) { m.position.copy(q); m.material.opacity = (green ? 0.8 : 0.22) * (1 - i / N); } });
    },
  };
})();
// pooled additive particles: rim bursts, ankle sparks, flames, confetti
const pfx = (() => {
  const N = 600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3), base = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N), grav = new Float32Array(N);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -99;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; scene.add(pts);
  let next = 0; const c = new THREE.Color();
  return {
    burst(x, y, z, n, colors, speed = 4, up = 2, ttl = 0.9, g = -7) {
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % N;
        const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = speed * (0.35 + Math.random() * 0.65);
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = Math.cos(a) * r * sp; vel[i * 3 + 1] = u * sp * 0.5 + up * (0.4 + Math.random() * 0.8); vel[i * 3 + 2] = Math.sin(a) * r * sp;
        c.setHex(colors[Math.floor(Math.random() * colors.length)]); base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
        life[i] = max[i] = ttl * (0.6 + Math.random() * 0.7); grav[i] = g;
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt; const k = Math.max(0, life[i] / max[i]);
        vel[i * 3 + 1] += grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.7; vel[i * 3 + 2] *= 0.7; }
        col[i * 3] = base[i * 3] * k; col[i * 3 + 1] = base[i * 3 + 1] * k; col[i * 3 + 2] = base[i * 3 + 2] * k;
        if (life[i] <= 0) pos[i * 3 + 1] = -99;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
})();
const FIRE = [0xff7a1a, 0xffd23f, 0xff3d3d], GOLD = [0xffd23f, 0xfff1b0, 0xffb02e], GREENS = [0x3dff8a, 0xb6ffd0, 0xffffff];
const pick = a => a[Math.floor(Math.random() * a.length)];

const G = { mode: 'check', attract: true, streak: [0, 0], hype: 0, takeover: 0, score: [0, 0], target: 11, poss: 0, timer: 0, time: 0, shake: 0, hitstop: 0, slow: 0, paused: false,
  cfg: DIFF.pro, twoP: false, diff: store.get('iso.diff', 'rookie'), ctl: store.get('iso.ctl', 'simple'), look: store.get('iso.look', { hair: 0, skin: 0, kit: 0 }), chal: null, walked: false, daily: null, boss: dailyBoss(), stats: null, shots: [], winner: -1, nextOff: 0, lastShotMiss: false };
const newStats = () => [0, 1].map(() => ({ fga: 0, fgm: 0, ta: 0, tm: 0, greens: 0, steals: 0, blocks: 0, ankles: 0, dunks: 0, reb: 0, pts: 0 }));
G.stats = newStats();
const human = () => !G.attract;   // is team 0 player-controlled right now
const isHuman = e => !G.attract && (e.team === 0 || G.twoP);

// ---------- UI helpers ----------
let bannerT = null;
function banner(text, cls = '', ms = 1100) {
  netEv('banner', text, cls, ms);
  const b = $('#banner'); b.className = ''; void b.offsetWidth; b.innerHTML = `<span>${text}</span>`; b.className = 'show ' + cls;
  clearTimeout(bannerT); bannerT = setTimeout(() => { b.className = ''; }, ms);
}
const tags = [$('#tag0'), $('#tag1')], tagT = [0, 0];
function tag(e, text, cls = '', dur = 0.9) { netEv('tag', e.team, text, cls, dur); const el = tags[e.team]; el.innerHTML = text; el.className = 'tag show ' + cls; tagT[e.team] = dur; }
function hudScore() {
  $('#s0').textContent = G.score[0]; $('#s1').textContent = G.score[1];
  const hex = e => '#' + e.color.toString(16).padStart(6, '0');
  world.setScore(G.score[0], G.score[1], G.attract ? 'HOME' : $('#youName').textContent, G.attract ? 'AWAY' : $('#cpuName').textContent, hex(P[0]), hex(P[1]));
  $('#score').dataset.poss = G.poss;
}
const v3 = new THREE.Vector3();
function toScreen(x, y, z) { v3.set(x, y, z).project(camera); return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight]; }

// ---------- game flow ----------
function resetEntity(e) { e.stealTry = 0; e.ai.expT = 0; e.ai.pend = null; e.lastSlide = e.lastMoveDir = null; e.readT = 0; e.sprint = false; e.stepT = e.spinT = e.dashDelay = e.hangT = 0; e.vx = e.vz = e.wantX = e.wantZ = e.vy = 0; e.y = 0; e.shooting = false; e.dashT = 0; e.stun = 0; e.stumble = 0; e.needsClear = false; e.ai.contest = false; e.ai.jumpIn = -1; }
function giveBall(e) { ball.state = 'held'; ball.holder = e; ball.shot = null; ball.noPick = -1; e.ai.holdT = 0; e.ai.planT = 0; }
function setupCheck(team) {
  clipStop(); clipStart();
  G.mode = 'check'; G.timer = 0.5; G.poss = team;
  for (const e of P) resetEntity(e);
  giveBall(P[team]);
  const d = P[1 - team]; d.ai.sx = P[team].x; d.ai.sz = P[team].z;
  hudScore();
  if (!G.attract) banner(G.twoP ? `P${team + 1} BALL` : team === 0 ? 'YOUR BALL' : 'DEFENSE', G.twoP ? 'small p' + team : 'small', 900);
}
function resetFun() { G.streak = [0, 0]; G.hype = 0; G.takeover = 0; for (const e of P) e.fire = false; }
const meHype = () => !G.attract && !G.twoP;
function hype(n) {   // fill the meter; full = TAKEOVER for 10s
  if (!meHype() || G.takeover > 0) return;
  G.hype = clamp(G.hype + n, 0, 100);
  if (G.hype >= 100) {
    G.hype = 0; G.takeover = 10; G.slow = 0.5; G.punch = 1; sfx.takeover();
    setTimeout(() => banner('TAKEOVER', 'takeover big', 1500), 350);
    pfx.burst(P[0].x, 1.2, P[0].z, 140, GOLD, 5, 3, 1.2, -5);
  }
}
const takeover = e => e.team === 0 && G.takeover > 0 && !G.attract;
function winMul(e) {   // green window size: bigger when hot, smaller when deep or someone's in your face
  const opp = P[1 - e.team], d = Math.hypot(e.shotX, e.shotZ);
  const deep = d > ARC + 0.8 ? Math.max(0.3, 1 - (d - ARC - 0.8) * 0.16) : 1;
  const tight = 1 - contestOf(e, opp) * 0.6;
  return (e.fire ? 1.35 : 1) * (takeover(e) ? 2.2 : 1) * deep * tight;
}
function coolOff(e, why) { if (!e.fire) return; e.fire = false; if (!G.attract) tag(e, why, 'okay', 0.9); }
function startGame({ cfg, daily = null, twoP = false, chal = null, online = false }) {
  unlockAudio();
  if (!online && net.role) netClose();
  G.twoP = twoP; setTwoPlayer(twoP && !online); $('#score').classList.toggle('two', twoP);
  $('#youName').textContent = online ? 'YOU' : twoP ? 'P1' : 'YOU';
  G.attract = false; G.cfg = cfg; G.daily = daily; G.runChal = chal; clip.best = null; coach.cur = null; G.score = [0, 0]; G.stats = newStats(); G.shots = []; G.winner = -1; G.paused = false; G.hitstop = G.slow = 0;
  P[1].cfg = cfg; P[0].cfg = DIFF.pro;
  recolor(P[1], twoP ? 0x2f6bff : daily ? daily.color : 0xf0452a); setLook(P[1], daily ? daily.look : twoP ? { hair: 1, skin: 3 } : CPU_LOOK[cfg.name.toLowerCase()] || CPU_LOOK.pro); applyMyLook();
  $('#cpuName').textContent = twoP ? 'P2' : daily ? daily.name.toUpperCase() : cfg.name.toUpperCase();
  $('#to').textContent = `TO ${G.target}`;
  if (online) { netApplyLooks(net.looks); net.out = []; net.evIn = []; }
  netHudColors();
  show('hud'); hideScreens(); resetFun(); startBeat();
  if (online) setupCheck(0); else startWalkup();   // online starts straight at the check: both screens stay in step
}
function startAttract() {
  if (net.role) netClose();
  $('#banner').className = '';
  resetFun(); stopBeat(); G.cine = null; document.body.classList.remove('cine', 'boot');
  G.attract = true; G.twoP = false; setTwoPlayer(false); G.cfg = DIFF.pro; P[0].cfg = DIFF.pro; P[1].cfg = DIFF.pro; G.score = [0, 0]; G.stats = newStats(); G.daily = null;
  recolor(P[1], 0xf0452a); setLook(P[1], CPU_LOOK.pro); applyMyLook(); clipStop(false);
  hide('hud'); setupCheck(Math.random() < 0.5 ? 0 : 1);
}
function endGame() {
  stopBeat();
  if (G.attract) { G.score = [0, 0]; setupCheck(Math.random() < 0.5 ? 0 : 1); return; }
  G.mode = 'over';
  const win = G.winner === 0;
  if (G.twoP) { netEv('over', G.stats, G.score, G.lastWinner); sfx.win(); renderOver2P(); setTimeout(() => showScreen('over'), 900); return; }
  win ? sfx.win() : sfx.lose();
  const career = store.get('iso.career', { games: 0, wins: 0, streak: 0, best: 0 });
  career.games++; if (win) { career.wins++; career.streak++; career.best = Math.max(career.best, career.streak); } else career.streak = 0;
  store.set('iso.career', career);
  if (G.daily && G.daily.n === G.boss.n) {
    const k = 'iso.daily.' + G.daily.key;
    if (!store.get(k, null)) {
      store.set(k, { win, score: [...G.score], shots: G.shots.join('') });
      if (win) { const st = store.get('iso.streak', { n: 0, count: 0 }); store.set('iso.streak', { n: G.daily.n, count: st.n === G.daily.n - 1 ? st.count + 1 : 1 }); }
    }
  }
  setTimeout(() => clipStop(), 1300);
  renderOver(win, career);
  setTimeout(() => showScreen('over'), 900);
}

// ---------- shooting ----------
function inFront(shooter, def) {   // is the defender between the shooter and the rim?
  const hx = -shooter.x, hz = -shooter.z, hl = Math.hypot(hx, hz) || 1, ox = def.x - shooter.x, oz = def.z - shooter.z, ol = Math.hypot(ox, oz) || 1;
  return (hx * ox + hz * oz) / (hl * ol) > 0.15;
}
function tryStartShot(e, opp) {
  if (e.shooting || e.stun > 0 || e.y > 0.05) return false;
  if (e.needsClear && !isThree(e.x, e.z)) { if (isHuman(e)) { banner('CLEAR IT FIRST', 'warn small', 900); sfx.deny(); } return false; }
  const d = Math.hypot(e.x, e.z), spd = Math.hypot(e.vx, e.vz);
  const inward = spd > 0.1 ? (-e.x * e.vx - e.z * e.vz) / (d * spd || 1) : 0;
  e.shooting = true; e.meter = 0;
  e.lay = d < 2.3 || (d < 3.6 && spd > 4.5 && inward > 0.6);          // attacking downhill = layup/dunk package
  e.fill = e.lay ? 1 / 0.42 : 1 / 0.6; e.jumpH = e.lay ? 0.85 : 0.55;
  e.offBal = !e.lay && spd > 5.8; e.stepShot = e.stepT > 0;
  e.shotX = e.x; e.shotZ = e.z;
  if (e.lay) { if (d > 0.7) { const s = clamp((d - 0.7) / 0.26, 2, 8); e.dashT = 0.26; e.dx = -e.x / d * s; e.dz = -e.z / d * s; } }
  else { e.vx *= 0.25; e.vz *= 0.25; e.dashT = 0; }
  if (!isHuman(e) || G.twoP) tag(e, e.lay ? 'DRIVE!' : 'SHOT!', 'cue', 0.5);
  return true;
}
function contestOf(e, opp) {   // 0 = wide open, 1 = smothered
  const sep = Math.hypot(opp.x - e.x, opp.z - e.z);
  let c = clamp((1.9 - sep) / 1.3, 0, 1);
  if (!inFront(e, opp)) c *= 0.35;           // closing from the side/behind still bothers it a little
  if (opp.y < 0.15) c *= 0.6;                // hands up but feet on the floor
  return c;
}
function makeChance(e, timing, opp, d) {
  let base = d < 2.3 ? 0.76 : d < 4 ? 0.66 - (d - 2.3) * 0.04 : d < ARC + 0.4 ? 0.58 - (d - 4) * 0.03 : 0.48 - (d - ARC - 0.4) * 0.1;
  base = clamp(base, 0.05, 0.9);
  const range = d > ARC + 1 ? Math.max(0.15, 1 - (d - ARC - 1) * 0.2) : 1;
  const squeeze = 1 - contestOf(e, opp) * 0.45;   // a hand in your face eats into even a green
  const add = { perfect: 0.5 * range * squeeze, good: 0.12 * range * squeeze, okay: -0.14, bad: -0.38 }[timing];
  let c = contestOf(e, opp) * 0.5 * (e.lay ? 1.15 : 1);
  if (timing === 'perfect') c *= 0.7;        // a green still feels it when someone is in your face
  const bal = (e.offBal ? -0.12 : 0) + (e.stepShot ? 0.04 : 0) + (e.fire ? 0.08 : 0) + (takeover(e) ? 0.05 : 0);
  const cap = d > ARC + 1.5 && contestOf(e, opp) > 0.5 ? 0.03 : 0.97;   // no contested half-court heaves
  return clamp(base + add - c + bal, 0.02, cap);
}
function releaseShot(e, opp) {
  e.shooting = false; e.vy = 0.5; e.followT = 0.45;
  const raw = e.meter - GREEN, diff = Math.abs(raw) * (e.lay ? 0.7 : 1);
  const wm = winMul(e), timing = diff < PW * wm ? 'perfect' : diff < GW * wm ? 'good' : diff < 0.25 * Math.sqrt(wm) ? 'okay' : 'bad';
  const d = Math.hypot(e.x, e.z), pts = isThree(e.shotX, e.shotZ) ? 2 : 1;
  const S = G.stats[e.team]; S.fga++; if (pts === 2) S.ta++;
  const sep = Math.hypot(opp.x - e.x, opp.z - e.z), front = inFront(e, opp), air = opp.y > 0.2, cont = contestOf(e, opp);
  if (isHuman(e)) {
    const word = timing === 'perfect' ? 'EXCELLENT' : timing === 'good' ? (raw < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE') : raw < 0 ? 'VERY EARLY' : 'VERY LATE';
    const cover = cont < 0.1 ? 'WIDE OPEN' : cont < 0.35 ? 'OPEN' : cont < 0.7 ? 'CONTESTED' : 'SMOTHERED';
    tag(e, `${word}<small>${cover}${e.offBal ? ' · OFF BALANCE' : ''}</small>`, timing, 1.1); meterFlash(e.team, timing);
  }
  if (timing === 'perfect') { sfx.green(); if (isHuman(e) && e.team === 0) hype(14); }
  if (isHuman(e) && e.team === 0) coachMark('shoot');

  let outcome, dunk = false, poster = false;
  // blocks are timing: the defender's hand has to be up there at the release. Greens need a near-perfect jump.
  const need = Math.max(0.25, (timing === 'perfect' ? 0.62 : 0.4) - (e.lay ? 0.08 : 0) + (isHuman(opp) ? 0 : BLOCK_K - opp.cfg.block));
  let chase = false, blocked = front && sep < 1.1 && opp.y >= need;
  if (!blocked && e.lay && sep < 1.4 && opp.y >= need + 0.08) blocked = chase = true;   // chase-down from behind
  if (blocked) outcome = 'block';
  else if (e.lay && d < 1.6 && (timing === 'perfect' || timing === 'good')) {
    dunk = true; outcome = cont > 0.6 && air && front ? 'miss' : 'make';   // a defender up and in front at the rim stuffs it; anything less is a bucket
    poster = outcome === 'make' && cont > 0.45;
  }
  else {   // skill first: a clean green always drops and a bad release never does; only the in-between releases roll
    const pch = makeChance(e, timing, opp, d);
    outcome = timing === 'perfect' && pch >= 0.6 ? 'make' : timing === 'bad' ? (d > 3.5 && Math.random() < 0.5 ? 'air' : 'miss') : Math.random() < pch ? 'make' : 'miss';
  }

  const fx = Math.sin(e.face), fz = Math.cos(e.face);
  const R = ball.state === 'held' && ball.holder === e ? ball.p.clone() : new THREE.Vector3(e.x + fx * 0.22, e.y + 2.2, e.z + fz * 0.22);
  R.y = Math.max(R.y, e.y + 1.6);
  ball.state = 'flight'; ball.holder = null; ball.noPick = e.team; ball.p.copy(R);   // no offensive boards: only the defense can grab a miss
  G.lastShotMiss = false;
  if (outcome === 'block') {
    G.stats[opp.team].blocks++; G.streak[e.team] = 0; coolOff(e, 'COOLED OFF');
    if (opp.team === 0) { hype(chase ? 35 : 25); clipMark(chase ? 5 : 3, chase ? 'chase-down' : 'block'); }
    G.punch = chase ? 0.9 : 0.5;
    pfx.burst(R.x, R.y, R.z, 40, [0xffffff, 0xbfe9ff], 4, 1.5, 0.6);
    ball.state = 'loose';
    ball.v.set((e.x - opp.x) * 2 + rand(-1.5, 1.5), rand(1.5, 3), (e.z - opp.z) * 2 + rand(-1, 1.5));
    ball.p.y = R.y + 0.2; G.lastShotMiss = true;
    G.hitstop = chase ? 0.15 : 0.1; if (chase) G.slow = 0.6;
    banner(chase ? 'CHASE DOWN!' : G.twoP || isHuman(opp) ? 'BLOCKED!' : 'GOT BLOCKED', G.twoP ? 'p' + opp.team : opp.team === 0 ? 'hot' : 'warn', 900); sfx.block(); G.shake = 0.3;
    if (e.team === 0) G.shots.push('🟥');
    return;
  }
  const a = Math.atan2(e.x, e.z);   // angle from rim toward the shooter
  let T, tgt;
  if (dunk) {
    T = 0.3; tgt = outcome === 'make' ? new THREE.Vector3(0, 3.2, 0) : new THREE.Vector3(Math.sin(a) * 0.26, 3.12, Math.cos(a) * 0.26);
    e.dashT = 0.26; e.dx = -e.x / Math.max(d, 0.1) * Math.max(0, d - 0.55) / 0.26; e.dz = -e.z / Math.max(d, 0.1) * Math.max(0, d - 0.55) / 0.26; e.vy = 5.2;
  } else if (outcome === 'make') { T = 0.7 + d * 0.075; tgt = new THREE.Vector3(0, 3.14, 0); }
  else if (outcome === 'miss') {
    const side = Math.random(), off = side < 0.45 ? a + rand(-0.5, 0.5) : side < 0.8 ? a + Math.PI + rand(-0.6, 0.6) : a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    T = 0.7 + d * 0.075; tgt = new THREE.Vector3(Math.sin(off) * 0.25, 3.09, Math.cos(off) * 0.25);
  } else { T = 0.65 + d * 0.07; tgt = new THREE.Vector3(Math.sin(a) * 0.95, 2.75, Math.cos(a) * 0.95); }
  const v0 = tgt.clone().sub(R).divideScalar(T); v0.y += 4.9 * T;
  ball.v.copy(v0);
  ball.shot = { team: e.team, outcome, pts, timing, dunk, poster, t: 0, T, R, v0, done: false, shooter: e };
  trail.reset(timing === 'perfect', e.fire || takeover(e));
  if (outcome === 'make' && !G.attract && G.score[e.team] + pts >= G.target) G.slow = T + 0.5;   // game-winner in slow-mo
}
function resolveShot(s) {
  const S = G.stats[s.team];
  if (s.outcome === 'make') {
    ball.p.set(0, 3.12, 0); ball.v.set(ball.v.x * 0.06, s.dunk ? -6 : -2.2, ball.v.z * 0.06); ball.state = 'dead';
    world.swish();
    if (s.dunk) { sfx.dunk(); G.punch = s.poster ? 1 : 0.8; G.shake = s.poster ? 0.8 : 0.6; G.hitstop = s.poster ? 0.16 : 0.11; if (s.poster) G.slow = 0.6; world.clank(); S.dunks++; s.shooter.hangT = 0.32; } else sfx.swish();
    S.fgm++; S.pts += s.pts; if (s.pts === 2) S.tm++; if (s.timing === 'perfect') S.greens++;
    if (s.team === 0) G.shots.push(s.timing === 'perfect' ? '🟩' : '🟧');
    G.score[s.team] += s.pts; hudScore();
    const mine = s.team === 0 && human(), sh = s.shooter, other = P[1 - s.team];
    const st = ++G.streak[s.team]; G.streak[1 - s.team] = 0; coolOff(other, 'FIRE OUT');
    if (mine) { hype(s.poster ? 30 : s.dunk ? 15 : 8); clipMark(s.poster ? 6 : s.dunk ? 4 : s.timing === 'perfect' ? (s.pts === 2 ? 2 : 1) : 0.5, s.poster ? 'poster' : s.dunk ? 'dunk' : s.timing === 'perfect' ? 'green' : 'bucket'); if (G.score[0] >= G.target) clipMark(7, 'game-winner'); } else if (meHype()) G.hype = Math.max(0, G.hype - 10);
    const burst = s.timing === 'perfect' ? GREENS : sh.fire ? FIRE : takeover(sh) ? GOLD : [0xffffff, 0xffe2b0];
    pfx.burst(0, 3.0, 0, s.dunk ? 90 : 45, burst, s.dunk ? 6 : 3.5, 1.4, 0.9);
    if (s.timing === 'perfect' && !s.dunk) G.punch = Math.max(G.punch || 0, 0.35);
    if (st === 3 && !sh.fire) { sh.fire = true; sfx.fire(); if (!G.attract) setTimeout(() => banner(mine ? 'ON FIRE' : `${$('#cpuName').textContent} IS HEATING UP`, 'fire', 1200), 700); }
    const plain = mine ? `${pick(['BUCKET', 'SPLASH', 'COOKED', 'TOO SMOOTH', 'WET', 'CASH'])} · +${s.pts}` : `+${s.pts}`;
    const label = s.dunk ? (s.poster ? 'POSTERIZED!' : pick(['DUNK!', 'SLAM!', 'HAMMER!'])) : s.timing === 'perfect' ? (s.pts === 2 ? 'GREEN · +2' : 'GREEN · +1') : plain;
    if (G.twoP) banner(`P${s.team + 1} ${label}`, 'p' + s.team, 1100);
    else if (!G.attract) banner(mine ? label : `${$('#cpuName').textContent} ${label}`, mine ? (s.dunk || s.timing === 'perfect' ? 'hot' : '') : 'cpu', 1100);
    sfx.crowd(s.dunk || s.timing === 'perfect' ? 1.6 : 1);
    G.mode = 'scored'; G.timer = 1.05; G.nextOff = s.team;
    if (G.score[s.team] >= G.target) { G.winner = s.team; G.timer = 2.2; G.punch = 1; if (!G.attract) pfx.burst(0, 8, 4, 320, [0xffcf1a, 0xf0452a, 0xffd23f, 0x3dff8a, 0xffffff], 7, 1, 2.6, -3.5); if (!G.attract) { sfx.buzzer(); banner(G.twoP ? `P${s.team + 1} WINS` : s.team === 0 ? 'GAME!' : 'GAME OVER', G.twoP ? 'big p' + s.team : s.team === 0 ? 'hot big' : 'cpu big', 1700); } }
  } else if (s.outcome === 'miss') {
    world.clank(); sfx.clank();
    G.streak[s.team] = 0; coolOff(s.shooter, 'COOLED OFF');
    if (s.dunk && !G.attract) banner('STUFFED AT THE RIM', G.twoP ? 'p' + (1 - s.team) : s.team === 0 ? 'warn' : 'hot', 900);
    const ox = ball.p.x, oz = ball.p.z, l = Math.hypot(ox, oz) || 1, spin = rand(-0.7, 0.7);
    let dx = ox / l, dz = oz / l; const c = Math.cos(spin), sn = Math.sin(spin); [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
    if (dz < -0.3) dz = -dz * 0.5;   // the backboard sends it back out
    const sp = rand(1.8, 3.8);
    ball.v.set(dx * sp, rand(1.8, 4.2), dz * sp + 0.6); ball.state = 'loose'; G.lastShotMiss = true;
    if (s.team === 0) G.shots.push('⬛');
  } else {
    ball.state = 'loose'; G.lastShotMiss = true; G.streak[s.team] = 0; coolOff(s.shooter, 'COOLED OFF');
    if (!G.attract) banner('AIRBALL', G.twoP ? 'p' + s.team : s.team === 0 ? 'warn' : 'hot', 900);
    if (s.team === 0) G.shots.push('⬛');
  }
}

// ---------- moves ----------
function doMove(e, opp, mx, mz, force = null) {
  if (e.dashT > 0 || e.dashDelay > 0 || e.stamina < 16 || e.stun > 0 || e.shooting || e.y > 0.05) return;
  const hl = Math.hypot(e.x, e.z) || 1, fx = -e.x / hl, fz = -e.z / hl;               // toward the rim
  const tx = opp.x - e.x, tz = opp.z - e.z, td = Math.hypot(tx, tz) || 1;
  const l = Math.hypot(mx, mz), fwd = l > 0.3 ? (mx * fx + mz * fz) / l : 0;
  const want = force || (l > 0.3 && fwd < -0.55 ? 'step' : l > 0.3 && fwd > 0.6 ? 'hesi' : 'cross');
  const combo = G.time - e.lastMove < 0.75;
  let kind, dx, dz, spd, dur;
  if (want === 'step') { kind = 'STEPBACK'; if (!force && l > 0.3) { dx = mx / l; dz = mz / l; } else { dx = -fx; dz = -fz; } spd = 7.8; dur = 0.2; e.stepT = 0.85; }   // the tech button steps back the way you point
  else if (want === 'drive' || want === 'hesi') {
    if (want === 'drive') { const side = Math.sign(fx * tz - fz * tx) || 1; dx = fx + fz * side * 0.55; dz = fz - fx * side * 0.55; }  // attack the shoulder away from the defender
    else { dx = mx / l; dz = mz / l; }
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    if (e.sprint) { kind = 'SPIN'; spd = 7.6; dur = 0.3; e.spinT = 0.3; e.spinDir = Math.sign(dx * fz - dz * fx) || 1; e.hand *= -1; }
    else if (want === 'drive') { kind = 'DRIVE'; spd = 9.4; dur = 0.26; }
    else { kind = 'HESI'; spd = 9.6; dur = 0.22; e.dashDelay = 0.13; }
  } else {
    kind = 'CROSS'; spd = 9.2; dur = 0.2;
    if (want === 'crossL') { dx = fz; dz = -fx; e.hand = 1; }
    else if (want === 'crossR') { dx = -fz; dz = fx; e.hand = -1; }
    else { if (l < 0.3) { dx = (tz / td) * e.hand; dz = (-tx / td) * e.hand; } else { dx = mx / l; dz = mz / l; } e.hand *= -1; }
  }
  e.dashT = dur; e.dx = dx * spd; e.dz = dz * spd; e.moveKind = kind; e.lastMove = G.time;
  e.stamina -= kind === 'STEPBACK' ? 15 : 19; sfx.cross();
  if (isHuman(e) && e.team === 0) coachMark('tech');
  if (isHuman(e)) tag(e, combo ? `${kind}<small>COMBO</small>` : kind, 'move', 0.5);
  // shadowboxing: which way did the move go (screen left/right)?
  e.lastMoveDir = { x: dx, z: dz, t: G.time, done: false, combo };
  if (opp.y > 0.05 || td > 2.3) return;
  if (isHuman(e) && combo) hype(4);
  if (!isHuman(opp) && opp.stun <= 0 && !takeover(e) && Math.random() < opp.cfg.read) {      // CPU guesses one of 4 directions
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const best = dirs.reduce((b, d) => (d[0] * dx + d[1] * dz > b[0] * dx + b[1] * dz ? d : b));
    const g = Math.random() < opp.cfg.readAcc ? best : dirs.filter(d => d !== best)[Math.floor(Math.random() * 3)];
    opp.lastSlide = { x: g[0], z: g[1], t: G.time }; defSlide(opp, g[0], g[1], true);
  }
  resolveShadow(e, opp);
  if (e.lastMoveDir.done) return;
  // nobody guessed: small chance the move still beats them
  const lat = Math.abs(dx * (tz / td) - dz * (tx / td));
  const fits = kind === 'STEPBACK' ? td < 1.5 : kind === 'CROSS' ? lat > 0.5 : td < 1.6;
  // nobody guessed: the move breaks ankles if the defender is caught leaning the other way (get him moving, then go back)
  const lean = -(opp.vx * dx + opp.vz * dz), needLean = (isHuman(opp) ? 2.0 : LEAN_K - opp.cfg.ankle * 3.2) * (combo ? 0.7 : 1) * (takeover(e) ? 0.4 : 1);
  if (fits && opp.stun <= 0 && lean > needLean) breakAnkles(e, opp);
  else if (fits && !isHuman(opp)) opp.stun = Math.max(opp.stun, combo ? 0.2 : 0.1);
}
const READ_PRE = 0.38, READ_POST = 0.16;   // a guess counts if it lands this long before/after the move
function resolveShadow(off, def) {
  const m = off.lastMoveDir, g = def.lastSlide;
  if (!m || !g || m.done) return;
  const gap = m.t - g.t;                     // > 0 means the defender committed first
  if (gap > READ_PRE || gap < -READ_POST) return;
  const ml = Math.hypot(m.x, m.z) || 1, dot = (m.x * g.x + m.z * g.z) / ml;
  if (dot > -0.4 && dot < 0.6) return;       // guessed sideways to the move: no read, no cross
  m.done = true;
  if (dot >= 0.6) {                          // read it: cut off, ball exposed
    off.dashT = 0; off.dashDelay = 0; off.vx *= 0.1; off.vz *= 0.1; off.stun = 0.4; def.readT = 0.8; def.dashT = 0;
    G.hitstop = 0.08; G.punch = 0.4; sfx.steal(); pfx.burst(off.x, 1, off.z, 25, def.team === 0 ? GOLD : [0xf0452a, 0xffffff], 3, 1.5, 0.5);
    if (def.team === 0) { hype(22); clipMark(2, 'read'); }
    if (!G.attract) banner(def.team === 0 || G.twoP ? 'READ IT!' : 'HE READ YOU', def.team === 0 ? 'hot' : 'warn', 800);
    if (!isHuman(def)) { def.stealCd = 0; def.stun = 0; steal(def, off); }
  } else {                                   // bit the wrong way: crossed
    def.dashT = 0;
    if (m.combo || Math.hypot(def.x - off.x, def.z - off.z) < 1.5) breakAnkles(off, def);   // bit the wrong way up close = ankles, every time
    else { def.stun = 0.5; def.stumble = 0.3; tag(def, 'CROSSED', 'okay', 0.6); G.hitstop = 0.06; sfx.ankle(); }
  }
}
function breakAnkles(e, opp) {
  G.punch = 0.7;
  pfx.burst(opp.x, 0.3, opp.z, 40, [0xffcf1a, 0xffffff, 0xf3f2ee], 4.5, 2, 0.7);
  if (e.team === 0) { hype(30); clipMark(5, 'ankles'); }
  opp.stun = 0.75; opp.stumble = 0.75; G.stats[e.team].ankles++; sfx.ankle(); G.shake = 0.3; G.hitstop = 0.12; G.slow = 0.45;
  if (!G.attract) banner(G.twoP ? 'ANKLES!' : e.team === 0 ? pick(['ANKLES!', 'SIT DOWN', 'BROKEN', 'GET UP']) : 'YOU GOT CROSSED', G.twoP ? 'p' + e.team : e.team === 0 ? 'hot' : 'warn', 1000);
}
function pumpFake(e, opp) {
  e.shooting = false; e.meter = 0; e.y = 0; e.vy = 0;
  tag(e, 'PUMP FAKE', 'move', 0.55);
  if (!isHuman(opp) && opp.ai.jumpIn > 0 && Math.random() > opp.cfg.bite) opp.ai.jumpIn = -1;   // read the fake
}
// Steals are decided by reach, not a dice roll. A reach is live for a moment; it takes the ball if your hand
// gets to it. Range grows if you read the move or the handler is sprinting or off balance, shrinks mid-move,
// and a ball kept on the far side of the handler's body can't be reached at all.
function steal(e, opp) {
  if (e.stealCd > 0 || e.stun > 0) return;
  e.stealCd = 0.85; e.reachT = 0.3; e.stealTry = 0.16; sfx.swipe();
}
function stealReach(e, opp) {
  let R = isHuman(e) ? 0.84 : 0.55 + e.cfg.steal;
  if (e.readT > 0) R += 0.32;
  if (opp.sprint) R += 0.12; if (opp.stun > 0) R += 0.15;
  if (opp.dashT > 0 || opp.spinT > 0) R -= 0.22;
  return R;
}
function ballGap(e, opp) {   // [distance from e to the ball, is the handler's body in the way]
  const dBall = Math.hypot(ball.p.x - e.x, ball.p.z - e.z), dBody = Math.hypot(opp.x - e.x, opp.z - e.z);
  return [dBall, dBall > dBody + 0.08 && e.readT <= 0];
}
function stealCheck(e, opp, last) {
  if (ball.state !== 'held' || ball.holder !== opp || opp.shooting) { e.stealTry = 0; return; }
  const [dBall, shielded] = ballGap(e, opp);
  if (!shielded && dBall <= stealReach(e, opp)) {
    e.stealTry = 0;
    ball.state = 'loose'; ball.holder = null;
    ball.v.set((e.x - opp.x) * 1.6 + rand(-0.8, 0.8), 1.6, (e.z - opp.z) * 1.6 + rand(-0.8, 0.8));
    ball.noPick = opp.team; opp.stun = 0.35; G.stats[e.team].steals++; if (e.team === 0) { hype(15); clipMark(2, 'steal'); } sfx.steal(); G.lastShotMiss = false;
    if (!G.attract) banner(G.twoP || e.team === 0 ? 'PICKED!' : 'STRIPPED', G.twoP ? 'p' + e.team : e.team === 0 ? 'hot' : 'warn', 900);
  } else if (last) {
    e.stun = isHuman(e) ? 0.3 : 0.4;                       // reached and missed: you're off balance
    if (isHuman(e)) tag(e, shielded ? 'SHIELDED' : 'TOO FAR', 'okay', 0.55);
  }
}
function gain(e) {
  giveBall(e); sfx.catch();
  const changed = e.team !== G.poss;
  e.needsClear = changed && !isThree(e.x, e.z);
  if (G.lastShotMiss) G.stats[e.team].reb++;
  G.lastShotMiss = false;
  if (changed) {
    G.poss = e.team; hudScore();
    const o = P[1 - e.team]; o.ai.sx = e.x; o.ai.sz = e.z;
    if (isHuman(e) && e.needsClear) tag(e, 'CLEAR IT', 'cue', 0.9);
  }
}

// ---------- control ----------
function moveTo(e, tx, tz, speed) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.06) { e.wantX = e.wantZ = 0; return d; }
  const s = Math.min(speed, d * 6); e.wantX = dx / d * s; e.wantZ = dz / d * s; return d;
}
function controlHuman(e, opp, input) {
  const m = input.move, has = ball.holder === e && ball.state === 'held', moving = Math.hypot(m.x, m.z) > 0.2;
  if (moving) e.lastStick = G.time;
  e.sprint = input.sprintHeld && moving && e.stamina > 8 && !e.shooting;
  let sp = has ? (e.sprint ? 7.0 : 4.9) : (e.sprint ? 7.4 : 5.6);
  if (e.shooting) sp *= 0.1; if (e.stun > 0) sp *= 0.35; if (e.y > 0.05 && !e.shooting) sp *= 0.6;
  e.wantX = m.x * sp; e.wantZ = m.z * sp;
  if (G.mode !== 'live') return;
  if (has) {
    if (!e.shooting && input.shootPressed) tryStartShot(e, opp);
    if (e.shooting && (!input.shootHeld || e.meter >= 1.15)) { if (!input.shootHeld && e.meter < 0.2 && !e.lay) pumpFake(e, opp); else releaseShot(e, opp); }
    if (!e.shooting && input.moveKey) doMove(e, opp, m.x, m.z, input.moveKey);
    else if (!e.shooting && input.actPressed) doMove(e, opp, m.x, m.z);
  } else {
    const k = input.moveKey;
    if (input.shootPressed && e.y === 0 && e.stun <= 0) { e.vy = 4.8; sfx.jump(); if (e.team === 0) coachMark('def'); }                       // Space = contest
    const h = ball.state === 'held' && ball.holder !== e ? ball.holder : null;
    const guarding = h && inFront(h, e) && Math.hypot(h.x - e.x, h.z - e.z) < 3.2;   // you're between your man and the rim
    // tech button on defense: steal when the ball is in reach (the ring), otherwise dash the way you're pointing.
    // A dash is also a guess at his move, so Simple and touch players can read and get crossed too.
    let inReach = false; if (h && input.tapAct) { const [dB, sh] = ballGap(e, h); inReach = !sh && dB <= stealReach(e, h) + 0.08; }
    if (input.tapAct && moving && !inReach) { const ml = Math.hypot(m.x, m.z); defSlide(e, m.x / ml, m.z / ml); if (e.team === 0) coachMark('def'); }
    else if ((k || input.tapAct) && h && !guarding) recoverDash(e, h);                // beaten and not pointing anywhere: dash back in front
    else if (k === 'step' || input.tapAct) {                                           // K = steal (and a step-up guess vs stepbacks)
      if (h) { e.lastSlide = { x: 0, z: 1, t: G.time }; resolveShadow(h, e); }
      steal(e, opp); if (e.team === 0) coachMark('def');
    } else {
      const G4 = { crossL: [-1, 0], crossR: [1, 0], drive: [0, -1] }[k];             // J L I = guess left / right / drive
      if (G4) defSlide(e, G4[0], G4[1]);
    }
    // stay-in-front assist: hands off the stick and you hold your spot between the ball and the rim
    if (!moving && G.time - (e.lastStick || 0) > 0.35 && ball.state === 'held' && ball.holder === opp && e.stun <= 0 && e.dashT <= 0) {
      const dh = Math.hypot(opp.x, opp.z) || 1, gap = opp.needsClear ? 1.8 : 1.15;
      if (Math.hypot(opp.x - e.x, opp.z - e.z) < 4) moveTo(e, opp.x - opp.x / dh * gap, opp.z - opp.z / dh * gap, 5.6);
    }
  }
}
function recoverDash(e, h) {   // burst back to the spot between the handler and the rim
  if (e.slideCd > 0 || e.stun > 0 || e.stamina < 8 || e.y > 0.05) return;
  const dh = Math.hypot(h.x, h.z) || 1, tx = h.x - h.x / dh * 1.1, tz = h.z - h.z / dh * 1.1;
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(9.5, d / 0.22);
  e.dashT = 0.22; e.dx = dx / d * sp; e.dz = dz / d * sp; e.moveKind = 'RECOVER'; e.slideCd = 0.3; e.stamina -= 10; sfx.cross();
  tag(e, 'RECOVER', 'move', 0.4);
}
function defSlide(e, gx, gz, cpuGuess = false) {   // quick defensive shuffle in a screen direction = your guess
  if (e.slideCd > 0 || e.stun > 0 || e.stamina < 8 || e.y > 0.05) return;
  e.dashT = 0.17; e.dx = gx * 8.6; e.dz = gz * 7; e.moveKind = 'SLIDE'; e.slideCd = 0.28; e.stamina -= 8; sfx.cross();
  if (cpuGuess) return;
  e.lastSlide = { x: gx, z: gz, t: G.time };
  const h = ball.state === 'held' ? ball.holder : null;
  if (h && h !== e) resolveShadow(h, e);
}
function pickPlan(e) {
  const ai = e.ai, w = e.cfg.plans, r = Math.random();
  const SPOTS = [[-6.2, 0.8], [6.2, 0.8], [-4.9, 4.9], [4.9, 4.9], [0, 7.4], [-2.6, 3.8], [2.6, 3.8], [-3.6, 1.4], [3.6, 1.4], [-2.2, 7], [2.2, 7]];
  if (r < w.drive) { ai.plan = 'drive'; ai.tx = rand(-0.5, 0.5); ai.tz = rand(0.4, 1); }
  else if (r < w.drive + w.spot) { ai.plan = 'spot'; const s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; ai.tx = s[0]; ai.tz = s[1]; }
  else { ai.plan = 'pull'; ai.tx = e.x; ai.tz = e.z; }
  ai.planT = rand(1, 2.4);
}
function aiShoot(e, opp) {
  if (!tryStartShot(e, opp)) return;
  const c = e.cfg, r = Math.random(), sg = Math.random() < 0.5 ? -1 : 1;
  const off = r < c.perfect ? rand(-0.05, 0.05) : r < c.perfect + c.good ? sg * rand(0.075, 0.14) : r < c.perfect + c.good + c.okay ? sg * rand(0.16, 0.24) : sg * rand(0.27, 0.36);
  e.ai.releaseAt = clamp(GREEN + off, 0.35, 1.12);
  e.ai.fake = !e.lay && Math.random() < 0.12; if (e.ai.fake) e.ai.releaseAt = 0.12;
}
function queueMove(e, opp, mx, mz) {
  if (isHuman(opp)) { e.ai.pend = { mx, mz, t: 0.22 }; tag(e, '⇆', 'cue', 0.3); }
  else doMove(e, opp, mx, mz);
}
function aiOffense(e, opp, dt) {
  const ai = e.ai, c = e.cfg; ai.holdT += dt; ai.planT -= dt;
  if (ai.pend) {   // winding up a move: the tell
    ai.pend.t -= dt; e.wantX = e.wantZ = 0;
    if (ai.pend.t <= 0) { const q = ai.pend; ai.pend = null; doMove(e, opp, q.mx, q.mz); }
    return;
  }
  if (e.shooting) {
    e.wantX = e.wantZ = 0;
    if (e.meter >= ai.releaseAt) { if (ai.fake) { ai.fake = false; pumpFake(e, opp); ai.plan = 'drive'; ai.tx = rand(-0.4, 0.4); ai.tz = 0.6; ai.planT = 1.3; } else releaseShot(e, opp); }
    return;
  }
  const dh = Math.hypot(e.x, e.z), sep = Math.hypot(opp.x - e.x, opp.z - e.z), front = inFront(e, opp);
  {   // protect the ball: defender sitting on the ball side for longer than a reaction time = switch hands
    const lat = (opp.x - e.x) * Math.cos(e.face) - (opp.z - e.z) * Math.sin(e.face);
    ai.expT = sep < 1.5 && e.dashT <= 0 && lat * e.hand > 0.12 ? (ai.expT || 0) + dt : 0;
    if (ai.expT > c.react * 1.8) { e.hand *= -1; ai.expT = 0; }
  }
  e.sprint = ai.plan === 'drive' && (!front || sep > 1.7) && e.stamina > 20;
  const sp = (e.sprint ? 6.8 : 4.9) * c.speed * (e.stun > 0 ? 0.35 : 1);
  if (e.needsClear && !isThree(e.x, e.z)) {
    const th = clamp(Math.atan2(e.x, Math.max(e.z, 0.5)), -1.15, 1.15);
    moveTo(e, Math.sin(th) * (ARC + 0.9), Math.cos(th) * (ARC + 0.9), sp); ai.holdT = 0; return;
  }
  if (ai.planT <= 0) pickPlan(e);
  if (dh < 2.3 && (sep > 0.85 || !front)) return aiShoot(e, opp);
  if (e.stepT > 0 && e.stepT < 0.6 && (sep > 1.2 || !front) && dh < 8.3) return aiShoot(e, opp);   // stepback into the shot
  const open = sep > c.open || (!front && sep > 0.9);
  if (ai.plan !== 'drive' && dh < 8.3 && open && ai.holdT > 0.5 && Math.random() < dt * 3) return aiShoot(e, opp);
  if (ai.holdT > c.patience) return aiShoot(e, opp);
  if (sep < 1.5 && front && e.stamina > 35 && Math.random() < dt * c.cross * (ai.plan === 'drive' ? 1.6 : 1)) {
    const r = Math.random();
    if (dh > ARC - 0.6 && dh < ARC + 1.4 && r < 0.3) return queueMove(e, opp, e.x / dh, e.z / dh);          // stepback
    if (ai.plan === 'drive' && r < 0.55) return queueMove(e, opp, -e.x / dh, -e.z / dh);                     // hesi / spin
    const side = Math.random() < 0.5 ? -1 : 1;                                                                 // crossover, either way
    return queueMove(e, opp, side, 0);
  }
  const d = moveTo(e, ai.tx, ai.tz, sp);
  if (ai.plan === 'spot' && d < 0.3) { ai.plan = 'pull'; ai.planT = rand(0.6, 1.4); }
  if (ai.plan === 'pull') { e.wantX = Math.sin(G.time * 5 + ai.seed) * 1.6; e.wantZ = Math.cos(G.time * 3.3 + ai.seed) * 0.6; }
}
function aiDefense(e, opp, dt) {
  const ai = e.ai, c = e.cfg, h = opp;
  const k = Math.min(1, dt / c.react); ai.sx += (h.x - ai.sx) * k; ai.sz += (h.z - ai.sz) * k;
  const dh = Math.hypot(ai.sx, ai.sz) || 0.01, sep = Math.hypot(h.x - e.x, h.z - e.z);
  const gap = h.needsClear ? 2.0 : dh > 8.5 ? 2.3 : c.gap;
  const tgx = ai.sx - ai.sx / dh * gap, tgz = ai.sz - ai.sz / dh * gap, off = Math.hypot(tgx - e.x, tgz - e.z);
  const sp = (off > 1.0 ? 7.0 : 5.5) * c.speed * (e.stun > 0 ? 0.35 : 1);   // recover hard when beaten
  if (ai.jumpIn > 0) {
    ai.jumpIn -= dt;
    if (ai.jumpIn <= 0 && e.y === 0 && e.stun <= 0) { e.vy = 4.6; if (!h.shooting) { e.stun = 0.75; tag(e, 'BIT!', 'cue', 0.7); if (isHuman(h)) G.slow = 0.35; } }
  }
  if (h.shooting) {
    if (!ai.contest) { ai.contest = true; ai.jumpIn = sep < (h.lay ? 2.2 : 2.6) && Math.random() < c.contest ? (h.lay ? c.react * 0.6 + rand(0.02, 0.1) : c.react * 0.9 + rand(0.05, 0.18)) : -1; }
    if (sep > 0.85) moveTo(e, h.x, h.z, sp); else e.wantX = e.wantZ = 0;
    return;
  }
  ai.contest = false;
  moveTo(e, tgx, tgz, sp);
  if (!h.needsClear && e.stealCd <= 0) {                   // reaches when the ball is there (and sometimes when it only looks like it)
    const [dBall, shielded] = ballGap(e, h), R = stealReach(e, h);
    if (!shielded && dBall <= R + 0.22 && Math.random() < dt * c.stealRate * (dBall <= R ? 0.6 : 0.25)) steal(e, opp);
  }
}
function aiLoose(e, opp, dt) {
  const sp = 5.7 * e.cfg.speed * (e.stun > 0 ? 0.35 : 1);
  if (ball.state === 'flight' && ball.noPick !== e.team) {
    const dh = Math.hypot(e.x, e.z) || 1; moveTo(e, e.x / dh * 1.9, Math.max(e.z / dh * 1.9, 0.5), 4.6);
  } else if ((ball.state === 'loose' || ball.state === 'flight') && ball.noPick === e.team) {   // got stripped: can't recover it, so get back on D
    const dh = Math.hypot(ball.p.x, ball.p.z) || 1; moveTo(e, ball.p.x - ball.p.x / dh * 1.6, ball.p.z - ball.p.z / dh * 1.6, sp);
  } else if (ball.state === 'loose') {
    moveTo(e, ball.p.x + ball.v.x * 0.3, ball.p.z + ball.v.z * 0.3, sp);
    const d = Math.hypot(ball.p.x - e.x, ball.p.z - e.z);
    if (ball.p.y > 2 && ball.p.y < 3.2 && d < 0.9 && ball.v.y < 0 && e.y === 0) e.vy = 4.6;
  } else { e.wantX = e.wantZ = 0; }
}
function controlAI(e, opp, dt) {
  if (G.mode !== 'live') { e.wantX = e.wantZ = 0; return; }
  if (ball.state === 'held' && ball.holder === e) aiOffense(e, opp, dt);
  else if (ball.state === 'held' && ball.holder === opp) aiDefense(e, opp, dt);
  else aiLoose(e, opp, dt);
}

// ---------- physics ----------
function integrate(e, dt) {
  if (e.dashDelay > 0) { e.dashDelay -= dt; e.vx *= 0.5; e.vz *= 0.5; }
  else if (e.dashT > 0) { e.dashT -= dt; e.vx = e.dx; e.vz = e.dz; }
  else {
    const accel = e.stun > 0 ? 3 : Math.hypot(e.wantX, e.wantZ) < Math.hypot(e.vx, e.vz) ? 26 : 19;   // plant hard, burst fast
    const k = Math.min(1, dt * accel); e.vx += (e.wantX - e.vx) * k; e.vz += (e.wantZ - e.vz) * k;
  }
  e.x = clamp(e.x + e.vx * dt, -8.5, 8.5); e.z = clamp(e.z + e.vz * dt, -2.6, 13.6);
  if (e.shooting) { e.meter += dt * e.fill; e.y = e.jumpH * Math.sin(Math.min(1, e.meter / GREEN) * Math.PI / 2); }
  else if (e.hangT > 0) { e.hangT -= dt; e.vy = 0; e.y = Math.max(e.y, 1.0); }
  else if (e.y > 0 || e.vy > 0) { e.vy -= 15 * dt; e.y += e.vy * dt; if (e.y <= 0) { e.y = 0; e.vy = 0; } }
  let fx, fz; const has = ball.state === 'held' && ball.holder === e, spd = Math.hypot(e.vx, e.vz);
  const downhill = (-e.x * e.vx - e.z * e.vz) > spd * 0.5 * Math.hypot(e.x, e.z);
  const dashing = e.dashT > 0 && e.moveKind !== 'STEPBACK', wantVel = has && !e.shooting && spd > 1.5 && (e.sprint || dashing || downhill);
  if (wantVel === !!e.faceVel) e.faceSw = 0;
  else { e.faceSw = (e.faceSw || 0) + dt; if (dashing || e.shooting || e.faceSw > (wantVel ? 0.12 : 0.3)) { e.faceVel = wantVel; e.faceSw = 0; } }   // needs to hold for a beat before the body turns
  if (e.faceVel && has && spd > 0.8) { fx = e.vx; fz = e.vz; }
  else if (has || e.shooting) { fx = -e.x; fz = -e.z; }   // squared up to the rim while sizing up
  else { const t = ball.state === 'held' ? ball.holder : null; fx = (t ? t.x : ball.p.x) - e.x; fz = (t ? t.z : ball.p.z) - e.z; }
  if (Math.hypot(fx, fz) > 0.01) e.face = angLerp(e.face, Math.atan2(fx, fz), Math.min(1, dt * (e.dashT > 0 || e.shooting ? 22 : 13)));
  if (e.stealTry > 0) { e.stealTry -= dt; stealCheck(e, P[1 - e.team], e.stealTry <= 0); }
  e.stun = Math.max(0, e.stun - dt); e.stumble = Math.max(0, e.stumble - dt); e.stealCd = Math.max(0, e.stealCd - dt); e.reachT = Math.max(0, e.reachT - dt);
  e.stepT = Math.max(0, e.stepT - dt); e.spinT = Math.max(0, e.spinT - dt); e.bumpCd = Math.max(0, e.bumpCd - dt); e.slideCd = Math.max(0, e.slideCd - dt); e.readT = Math.max(0, e.readT - dt);
  e.stamina = clamp(e.stamina + dt * (e.sprint && spd > 3 ? -18 : 17), 0, 100);
  if (e.needsClear && isThree(e.x, e.z)) { e.needsClear = false; if (isHuman(e)) tag(e, 'CLEARED', 'good', 0.6); }
}
function separate() {
  const a = P[0], b = P[1]; let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz), min = 0.74;
  if (d < min && d > 1e-4) {
    dx /= d; dz /= d;
    const h = ball.state === 'held' ? ball.holder : null;
    if (h && h.sprint && h.bumpCd <= 0) {          // sprinting into a set defender = bump, you lose momentum
      const o = h === a ? b : a, ux = (o.x - h.x) / d, uz = (o.z - h.z) / d, sp = Math.hypot(h.vx, h.vz);
      if (sp > 4.5 && (h.vx * ux + h.vz * uz) > sp * 0.5 && o.stun <= 0) { h.vx *= 0.3; h.vz *= 0.3; h.bumpCd = 0.6; h.dashT = 0; G.shake = 0.12; sfx.board(); if (isHuman(h) || isHuman(o)) tag(h, 'BUMP', 'okay', 0.4); }
    }
    const p = (min - d) / 2; a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p;
  }
}
function updateBall(dt) {
  if (ball.state === 'flight') {
    const s = ball.shot; s.t += dt;
    if (!s.done) {
      const t = Math.min(s.t, s.T);
      ball.p.set(s.R.x + s.v0.x * t, s.R.y + s.v0.y * t - 4.9 * t * t, s.R.z + s.v0.z * t);
      ball.v.set(s.v0.x, s.v0.y - 9.8 * t, s.v0.z);
      if (s.t >= s.T) { s.done = true; resolveShot(s); }
    }
    return;
  }
  if (ball.state !== 'loose' && ball.state !== 'dead') return;
  ball.v.y -= 9.8 * dt; ball.p.addScaledVector(ball.v, dt);
  const p = ball.p, v = ball.v;
  if (p.z < -0.3 && p.z > -0.55 && Math.abs(p.x) < 0.9 && p.y > 2.92 && p.y < 3.98 && v.z < 0) { v.z *= -0.55; p.z = -0.3; sfx.board(); }
  if (p.y < 0.12) {
    p.y = 0.12;
    if (v.y < -1) { v.y *= -0.6; v.x *= 0.85; v.z *= 0.85; sfx.bounce(Math.min(1, -v.y / 5)); } else { v.y = 0; v.x *= 1 - dt * 1.4; v.z *= 1 - dt * 1.4; }
  }
  if (Math.abs(p.x) > 8.75) { p.x = Math.sign(p.x) * 8.75; v.x *= -0.5; }
  if (p.z < -2.85) { p.z = -2.85; v.z *= -0.5; }
  if (p.z > 13.85) { p.z = 13.85; v.z *= -0.5; }
  G.looseT = ball.state === 'loose' && G.mode === 'live' ? (G.looseT || 0) + dt : 0;
  if (G.looseT > 3.5) {   // nobody secured it: check it up, defense's ball
    G.looseT = 0; const t = ball.noPick >= 0 ? 1 - ball.noPick : 1 - G.poss;
    if (!G.attract) banner('CHECK IT UP', 'small', 900);
    setupCheck(t); return;
  }
  if (ball.state === 'loose' && G.mode === 'live') {
    const order = [...P].sort((a, b) => Math.hypot(ball.p.x - a.x, ball.p.z - a.z) - Math.hypot(ball.p.x - b.x, ball.p.z - b.z));
    for (const e of order) {
      if (e.stun > 0.25 || ball.noPick === e.team) continue;   // a stripped ball belongs to the defense
      if (Math.hypot(p.x - e.x, p.z - e.z) < 0.78 && p.y < 2.1 + e.y) { gain(e); break; }
    }
  }
}
const _hA = new THREE.Vector3(), _hB = new THREE.Vector3();
function placeBall(dt) {
  if (ball.state === 'held') {
    const e = ball.holder, fx = Math.sin(e.face), fz = Math.cos(e.face), rx = Math.cos(e.face), rz = -Math.sin(e.face);
    if (e.shooting) { const A = e.mesh.arms; A.N.tip.getWorldPosition(_hA); A.P.tip.getWorldPosition(_hB); ball.p.copy(_hA).add(_hB).multiplyScalar(0.5); ball.p.x += fx * 0.1; ball.p.z += fz * 0.1; ball.p.y += 0.04; }
    else {
      const o = P[1 - e.team], tight = Math.hypot(o.x - e.x, o.z - e.z) < 1.7;
      e.dribble += dt * (tight ? 3.1 : 2.3 + Math.hypot(e.vx, e.vz) * 0.25);
      const b = Math.abs(Math.sin(e.dribble * Math.PI));
      const side = e.hand * (e.dashT > 0 && e.moveKind === 'CROSS' ? 0.38 * (1 - 2 * e.dashT / 0.2) : 0.38);
      const fwd = e.sprint ? 0.55 : tight ? 0.14 : 0.3, hgt = tight ? 0.55 : 0.8;
      ball.p.set(e.x + rx * side + fx * fwd, 0.13 + b * hgt + e.y * 0.6, e.z + rz * side + fz * fwd);
      if (b < 0.2 && !e.bounced) { e.bounced = true; sfx.dribble(isHuman(e) ? 0.9 : 0.45); } else if (b > 0.5) e.bounced = false;
    }
  }
  ballMesh.position.copy(ball.p);
  trail.update(dt);
  const sp = ball.state === 'held' ? 6 : ball.v.length() * 3;
  ballMesh.rotation.x -= dt * sp; ballMesh.rotation.z += dt * sp * 0.3;
}

// ---------- animation ----------
const LEG = 0.84;                 // hip-to-ankle length (thigh + shin)
const sm = (o, p, v, k) => { o[p] += (v - o[p]) * k; };
function poseArm(a, sx, sz, el, wr, k) { sm(a.sh.rotation, 'x', sx, k); sm(a.sh.rotation, 'z', sz, k); sm(a.el.rotation, 'x', el, k); sm(a.wr.rotation, 'x', wr, k); }
function animate(e, dt) {
  const m = e.mesh, k = 1 - Math.exp(-dt * 20);
  if ((e.prevY || 0) > 0.08 && e.y === 0) e.landT = 0.18;          // landing squash
  e.prevY = e.y; e.landT = Math.max(0, (e.landT || 0) - dt); e.followT = Math.max(0, (e.followT || 0) - dt);
  m.root.position.set(e.x, e.y, e.z);
  m.root.rotation.y = e.face + (e.spinT > 0 ? (1 - e.spinT / 0.3) * Math.PI * 2 * e.spinDir : 0);
  const sp = Math.hypot(e.vx, e.vz), run = Math.min(1, sp / 5.5);
  e.phase += dt * (sp * 1.9 + (sp > 0.3 ? 2 : 0));
  const ph = e.phase, air = e.y > 0.06;
  const has = ball.state === 'held' && ball.holder === e, defending = ball.state === 'held' && ball.holder && ball.holder !== e;
  const opp = P[1 - e.team], near = Math.hypot(opp.x - e.x, opp.z - e.z) < 1.7;
  const won = G.mode === 'scored' ? G.nextOff === e.team : G.mode === 'over' ? G.lastWinner === e.team : null;
  if (m.isRig) {
    m.update(e, { has, defending, near, won, ball: has ? ball.p : null, mode: G.mode, landT: e.landT, green: GREEN, rim: RIM_V }, dt);
    updateRing(e, has); return;
  }

  // ---- defaults: athletic idle / run ----
  const swing = Math.sin(ph) * 0.7 * run;
  let hipH = 0.93 - run * 0.05 + Math.abs(Math.cos(ph)) * 0.04 * run, lean = 0.06 + run * 0.18, twist = -Math.sin(ph) * 0.18 * run, spread = 0.03, headX = 0;
  let flexP = Math.max(0, Math.sin(ph + 1.7)) * 1.2 * run, flexN = Math.max(0, Math.sin(ph + 1.7 + Math.PI)) * 1.2 * run;
  let armSw = 0.9, elb = -0.35 - run * 0.8;
  let aP = [swing * armSw, 0.12, elb, 0.1], aN = [-swing * armSw, -0.12, elb, 0.1];   // [shoulder x, shoulder z, elbow, wrist]
  if (sp < 0.3) hipH = 0.91 + Math.sin(G.time * 2.2 + e.team) * 0.006;           // breathing bob

  if (e.sprint) { lean = 0.38; aP = [swing * 1.4, 0.12, -1.45, 0.2]; aN = [-swing * 1.4, -0.12, -1.45, 0.2]; }
  if (defending && !air) {                                                    // stance: low, wide, hands active
    hipH = 0.74 + Math.abs(Math.sin(ph)) * 0.03 * run; lean = 0.32; spread = 0.2; flexP *= 0.4; flexN *= 0.4;
    aP = [-0.45, 1.0, -0.6, 0.3]; aN = [-0.45 + Math.sin(G.time * 6) * 0.15, -1.0, -0.6, 0.3]; headX = -0.25;
  }
  if (has && !e.sprint && near) { hipH = 0.82; lean += 0.12; spread = 0.14; }
  if (e.dashT > 0) {
    if (e.moveKind === 'STEPBACK') { lean = -0.28; hipH = 0.8; }
    else if (['CROSS', 'SLIDE', 'DRIVE', 'RECOVER'].includes(e.moveKind)) {
      twist = Math.sign(e.dx * Math.cos(e.face) - e.dz * Math.sin(e.face)) * 0.5; hipH -= 0.08; spread = Math.max(spread, 0.22); lean += 0.1;
    }
  }
  if (e.dashDelay > 0) { lean = -0.2; hipH = 0.86; twist = 0.25 * e.hand; }
  if (has && !e.shooting) {                                                   // dribble: elbow pumps with the ball, off-arm guards
    const b = Math.abs(Math.sin(e.dribble * Math.PI)), dr = [-0.35 - b * 0.3, 0.3, -0.25 - b * 0.95, 0.5 - b * 0.6];
    const guard = near ? [-1.05, 0.55, -1.0, 0.2] : null;
    if (e.hand > 0) { aP = dr; if (guard) aN = [guard[0], -guard[1], guard[2], guard[3]]; }
    else { aN = [dr[0], -dr[1], dr[2], dr[3]]; if (guard) aP = guard; }
    lean += 0.08;
  }
  if (e.hangT > 0) { aP = [-3.0, 0.3, -0.25, 0.3]; aN = [-3.0, -0.3, -0.25, 0.3]; lean = 0.1; }
  else if (e.shooting) {                                                      // gather at the chest -> set point above the head
    const t = clamp(e.meter / GREEN, 0, 1.2), s2 = clamp((t - 0.3) / 0.6, 0, 1);
    if (e.lay) { aN = [-2.4 - s2 * 0.6, -0.15, -0.5, 0.3]; aP = [-1.6, 0.4, -0.8, 0.2]; lean = 0.15; }
    else {
      aN = [lerp(-0.85, -2.7, s2), -0.08, lerp(-1.75, -1.35, s2), lerp(0.2, 1.0, s2)];   // shooting arm (right)
      aP = [lerp(-0.85, -2.45, s2), 0.3, lerp(-1.6, -1.15, s2), 0.4];                      // guide hand
      lean = -0.04; headX = -0.2;
    }
    if (t < 0.3) hipH = 0.76;
  } else if (e.followT > 0) { aN = [-2.9, -0.06, -0.08, -0.9]; aP = [-2.35, 0.35, -0.5, 0.2]; lean = -0.06; headX = -0.25; }   // hold the follow-through, wrist snapped
  else if (air) { aP = [-3.0, 0.22, -0.08, 0.2]; aN = [-3.0, -0.22, -0.08, 0.2]; }                                             // contest
  if (e.reachT > 0) { aN = [-1.5, -0.05, -0.12, 0.2]; lean = 0.48; twist = -0.35; hipH = 0.78; }
  if (won === true && !air) { const w = Math.sin(G.time * 12); aP = [-2.7 + w * 0.3, 0.45, -0.3 - Math.abs(w) * 0.9, 0.2]; aN = [-2.7 - w * 0.3, -0.45, -0.3 - Math.abs(w) * 0.9, 0.2]; hipH = 0.95 + Math.abs(w) * 0.04; lean = -0.12; headX = -0.3; }
  if (won === false) { aP = [-0.85, 0.3, -0.25, 0.2]; aN = [-0.85, -0.3, -0.25, 0.2]; lean = 0.75; hipH = 0.78; headX = 0.3; }   // hands on knees
  if (e.landT > 0) hipH -= 0.16 * (e.landT / 0.18);
  if (e.stumble > 0) { hipH = 0.7; lean = -0.2; aP = [-1.2, 0.9, -0.3, 0]; aN = [-0.3, -1.2, -0.2, 0]; }

  // ---- legs: knee bend keeps the feet planted at any hip height ----
  const reach = clamp(hipH - 0.04 - 0.07, 0.3, LEG), a = Math.acos(reach / LEG);
  const legPose = (L, sw, fl, side) => {
    let hip, knee;
    if (air) { hip = side > 0 ? -0.75 : -0.35; knee = side > 0 ? 1.3 : 0.9; }   // tuck in the air
    else { hip = -a + sw - fl * 0.45; knee = 2 * a + fl; }
    sm(L.hip.rotation, 'x', hip, k); sm(L.knee.rotation, 'x', knee, k); sm(L.ankle.rotation, 'x', -(hip + knee) * (air ? 0.4 : 0.95), k);
    sm(L.hip.rotation, 'z', spread * side, k);
  };
  legPose(m.legs.P, -swing, flexP, 1); legPose(m.legs.N, swing, flexN, -1);
  sm(m.pelvis.position, 'y', air ? 0.95 : hipH, k);
  sm(m.abdomen.rotation, 'x', lean * 0.45, k); sm(m.chest.rotation, 'x', lean * 0.55, k);
  sm(m.abdomen.rotation, 'y', twist * 0.4, k); sm(m.chest.rotation, 'y', twist * 0.6, k);
  sm(m.head.rotation, 'x', -lean * 0.8 + headX, k); sm(m.head.rotation, 'y', -twist * 0.5, k);
  poseArm(m.arms.P, aP[0], aP[1], aP[2], aP[3], k); poseArm(m.arms.N, aN[0], aN[1], aN[2], aN[3], k);
  m.root.rotation.z = e.stumble > 0 ? Math.sin(e.stumble * 22) * 0.12 * (e.stumble / 0.75) : 0;
  m.root.updateMatrixWorld(true);

  updateRing(e, has);
}
const RIM_V = new THREE.Vector3(RIM.x, RIM.y, RIM.z);
function updateRing(e, has) {
  e.ring.position.set(e.x, 0.02, e.z);
  const pulse = e.needsClear && has ? 0.55 + Math.sin(G.time * 12) * 0.4 : has ? 1 : 0.55;
  e.ring.material.opacity = pulse; e.ring.scale.setScalar(has ? 1.1 : 1);
  if (e.fire) { e.ring.material.color.setHex(Math.random() < 0.5 ? 0xff7a1a : 0xffd23f); e.ring.material.opacity = 1; e.ring.scale.setScalar(1.25 + Math.sin(G.time * 18) * 0.06); }
  else if (takeover(e)) { e.ring.material.color.setHex(0xffd23f); e.ring.material.opacity = 1; e.ring.scale.setScalar(1.35 + Math.sin(G.time * 10) * 0.1); }
  else e.ring.material.color.setHex(e.color);
}

// ---------- camera ----------
function updateCamera(dt) {
  const t = G.time;
  if (G.cine) return cineCamera(dt);
  let px, py, pz, lx, ly, lz;
  if (G.attract) {
    const th = Math.sin(t * 0.09) * 1.0;
    px = Math.sin(th) * 12; py = 3.6 + Math.sin(t * 0.13) * 0.7; pz = 4 + Math.cos(th) * 11.5;
    lx = ball.p.x * 0.3; ly = 1.8; lz = 3.2;
  } else {
    const me = net.role === 'guest' ? P[1] : P[0], solo = !G.twoP || !!net.role, portrait = camera.aspect < 1;   // online: each side's camera favours its own player
    const bx = solo ? lerp(ball.p.x, me.x, 0.45) : ball.p.x, bz = clamp(solo ? lerp(ball.p.z, me.z, 0.45) : ball.p.z, -1, 12);
    const push = isHuman(me) && me.shooting ? 1 : 0;                     // dolly in while you rise up
    px = bx * 0.45; py = (portrait ? 7.4 : 5.0) - push * 0.5;
    pz = Math.max(portrait ? 12 : 9.8, bz + (portrait ? 7.4 : 5.4) - push * 1.0);
    lx = bx * 0.6; ly = 1.3; lz = lerp(1.6, bz, 0.6);
    if (ball.state === 'flight') { lx = lerp(lx, 0, 0.35); ly = lerp(ly, 2.6, 0.45); lz = lerp(lz, 0, 0.35); }   // ride the shot to the rim
    if (G.slow > 0 && ball.state === 'flight') { pz -= 2.5; py -= 0.8; }                                         // game-winner push-in
    // rim cam: drives, layups and dunks get a low, close angle from the shooter's side so the finish fills the frame
    const fin = P.find(e => (e.shooting && e.lay) || e.hangT > 0) || (ball.state === 'flight' && ball.shot && ball.shot.dunk ? ball.shot.shooter : null);
    if (fin) { G.rimCam = 0.75; G.rimSide = Math.abs(fin.x) > 0.3 ? Math.sign(fin.x) : (G.rimSide || 1); }
    if (G.rimCam > 0) {
      G.rimCam -= dt;
      px = G.rimSide * 2.6; py = portrait ? 3.4 : 2.2; pz = portrait ? 7.4 : 4.7; lx = 0; ly = 2.55; lz = 0.3;
    }
  }
  const k = 1 - Math.exp(-dt * (G.attract ? 1.5 : G.rimCam > 0 ? 9 : 5));
  camPos.x += (px - camPos.x) * k; camPos.y += (py - camPos.y) * k; camPos.z += (pz - camPos.z) * k;
  camLook.x += (lx - camLook.x) * k; camLook.y += (ly - camLook.y) * k; camLook.z += (lz - camLook.z) * k;
  camera.position.copy(camPos);
  if (G.shake > 0) { camera.position.x += rand(-1, 1) * G.shake * 0.3; camera.position.y += rand(-1, 1) * G.shake * 0.3; G.shake = Math.max(0, G.shake - dt * 1.4); }
  // zoom punch: snap in on big moments, ease back out
  G.punch = Math.max(0, (G.punch || 0) - dt * 2.4);
  const want = (camera.aspect < 1 ? 60 : 46) - G.punch * 13 - (G.slow > 0 ? 6 : 0);
  camera.fov += (want - camera.fov) * Math.min(1, dt * (G.punch > 0.05 ? 18 : 6)); camera.updateProjectionMatrix();
  camera.lookAt(camLook);
}

// ---------- HUD per-frame ----------
const meters = [$('#meter'), $('#meter1')], meterHold = [0, 0];
function meterFlash(team, timing) { netEv('mf', team, timing); meters[team].dataset.res = timing; meterHold[team] = 0.55; }
const reachEl = $('#reach');
function updateHUD(dt) {
  const me = P[0];
  coachUpdate(dt);
  {   // reach cue: a marker on the ball whenever a steal would land right now
    const h = ball.state === 'held' ? ball.holder : null; let on = false;
    if (h && G.mode === 'live' && !G.attract && !h.shooting) for (const e of P) {
      if (e === h || !isHuman(e) || e.stun > 0) continue;
      const [dBall, shielded] = ballGap(e, h); if (!shielded && dBall <= stealReach(e, h)) on = true;
    }
    reachEl.classList.toggle('on', on);
    if (on) { const [sx, sy] = toScreen(ball.p.x, ball.p.y, ball.p.z); reachEl.style.transform = `translate(${sx}px, ${sy}px)`; }
  }
  for (const e of P) {
    const el = meters[e.team];
    if (isHuman(e) && e.shooting) {
      el.hidden = false; el.dataset.res = '';
      const wm = winMul(e), w = (e.lay ? PW / 0.7 : PW) * wm, gw = (e.lay ? GW / 0.7 : GW) * wm;
      el.style.setProperty('--p0', ((GREEN - w) / 1.15 * 100) + '%'); el.style.setProperty('--p1', ((w * 2) / 1.15 * 100) + '%');
      el.style.setProperty('--g0', ((GREEN - gw) / 1.15 * 100) + '%'); el.style.setProperty('--g1', ((gw * 2) / 1.15 * 100) + '%');
      el.querySelector('.fill').style.height = (Math.min(1, e.meter / 1.15) * 100) + '%';
    } else if (meterHold[e.team] > 0) meterHold[e.team] -= dt; else el.hidden = true;
    if (!el.hidden) { const [sx, sy] = toScreen(e.x, e.y + 1.6, e.z); el.style.transform = `translate(${sx + 34}px, ${sy - 50}px)`; }
  }
  for (const e of P) {
    tagT[e.team] -= dt; if (tagT[e.team] <= 0) tags[e.team].classList.remove('show');
    const [sx, sy] = toScreen(e.x, e.y + 2.35, e.z); tags[e.team].style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-100%)`;
  }
  if (!G.attract) {
    $('#stam i').style.width = me.stamina + '%';
    const hb = $('#hype'); hb.classList.toggle('on', G.takeover > 0); hb.hidden = G.twoP;
    hb.querySelector('i').style.width = (G.takeover > 0 ? G.takeover / 10 * 100 : G.hype) + '%';
    hb.querySelector('span').textContent = G.takeover > 0 ? 'TAKEOVER' : me.fire ? 'ON FIRE' : 'HYPE';
    const clr = !G.twoP && ball.state === 'held' && ball.holder === me && me.needsClear && !isThree(me.x, me.z);
    $('#clear').classList.toggle('on', clr);
    if (input.touch) {
      const off = ball.state === 'held' && ball.holder === me;
      const a = off ? 'MOVE' : reachEl.classList.contains('on') ? 'STEAL' : 'DASH', s = off ? 'SHOOT' : 'JUMP';
      if (bAct.textContent !== a) bAct.textContent = a;
      if (bShoot.textContent !== s) bShoot.textContent = s;
    }
  }
}
const bAct = $('#bAct'), bShoot = $('#bShoot');

// ---------- coach: the first game teaches one input at a time, while you play ----------
const coach = { el: $('#coach'), cur: null, doneT: 0, dist: 0, hit: {}, done: store.get('iso.tut', {}) };
function coachMark(id) { coach.hit[id] = true; }
function coachSteps(me, has, near, defending) {
  const t = input.touch, simple = getScheme() === 'simple', k = (...a) => a.map(x => `<kbd>${x}</kbd>`).join('');
  return [
    { id: 'move', when: has, text: t ? 'Drag the stick to move' : `${k('W', 'A', 'S', 'D')} to move` },
    { id: 'shoot', when: has && !me.needsClear, text: t ? 'Hold SHOOT, let go in the green' : simple ? `Hold ${k('L')} or ${k('Space')}, let go in the green` : `Hold ${k('Space')}, let go in the green` },
    { id: 'tech', when: has && near, text: t ? 'Tap MOVE next to him to cross him up' : simple ? `${k('K')} next to him: cross him up` : `${k('J')} or ${k('L')} next to him: cross him up` },
    { id: 'def', when: defending, text: t ? 'DASH where you point. Ball ringed? STEAL' : simple ? `Defense: ${k('K')} dashes where you move. Ball ringed? ${k('K')} steals` : `Defense: ${k('K')} steal, ${k('Space')} block, ${k('J')}${k('L')} guess his move` },
  ];
}
function coachUpdate(dt) {
  const c = coach, me = P[0];
  if (c.doneT > 0) { c.doneT -= dt; if (c.doneT <= 0) { c.doneT = 0; c.cur = null; c.el.hidden = true; } return; }
  if (G.attract || G.twoP || G.mode !== 'live' || G.paused) { c.el.hidden = true; if (G.mode !== 'live') c.hit = {}; return; }
  const has = ball.state === 'held' && ball.holder === me, defending = ball.state === 'held' && ball.holder === P[1];
  const near = Math.hypot(P[1].x - me.x, P[1].z - me.z) < 2.2;
  if (c.cur === 'move') { c.dist += Math.hypot(me.vx, me.vz) * dt; if (c.dist > 2.5) c.hit.move = true; }
  if (c.cur && c.hit[c.cur]) { c.done[c.cur] = 1; store.set('iso.tut', c.done); c.el.className = 'done'; c.el.hidden = false; c.doneT = 0.7; return; }   // did what the prompt asked
  const step = coachSteps(me, has, near, defending).find(s => !c.done[s.id] && s.when);
  if (!step) { if (ball.state === 'held') { c.el.hidden = true; c.cur = null; } return; }       // keep the prompt up while a shot is in the air
  if (c.cur !== step.id) { c.cur = step.id; c.dist = 0; c.hit[step.id] = false; c.el.className = ''; c.el.innerHTML = step.text; }
  c.el.hidden = false;
}

// ---------- clips: every possession is recorded; the best highlight can be saved after the game ----------
const clip = { on: store.get('iso.clips', true) && !!canvas.captureStream && typeof MediaRecorder !== 'undefined', rec: null, best: null, stream: null };
function clipStart() {
  if (!clip.on || G.attract || clip.rec) return;
  try {
    clip.stream ||= canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) { clip.on = false; return; }
    const r = new MediaRecorder(clip.stream, { mimeType: mime, videoBitsPerSecond: 3.5e6 }), chunks = [];
    r.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    r.onstop = () => {
      if (!r.keep || (clip.best && clip.best.score > r.keep.score)) return;
      clip.best = { ...r.keep, blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.includes('mp4') ? 'mp4' : 'webm' };
      clipButton();
    };
    r.score = 0; r.label = ''; r.t0 = performance.now(); r.start(); clip.rec = r;
  } catch (err) { clip.on = false; }
}
function clipMark(score, label) { const r = clip.rec; if (r && score > r.score) { r.score = score; r.label = label; } }
function clipStop(keep = true) {
  const r = clip.rec; if (!r) return; clip.rec = null;
  if (keep && r.score >= 2) r.keep = { score: r.score, label: r.label };
  try { r.stop(); } catch (err) { /* already stopped */ }
}
function clipButton() {
  const b = $('#ovClip'), c = clip.best; b.hidden = !c;
  if (c) b.textContent = `Save clip: ${{ 'ankles': 'the ankle breaker', 'poster': 'the poster', 'dunk': 'the dunk', 'chase-down': 'the chase-down', 'block': 'the block', 'green': 'the green', 'read': 'the read', 'game-winner': 'the game winner' }[c.label] || 'best play'}`;
}
function clipSave() {
  const c = clip.best; if (!c) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(c.blob); a.download = `quicktime-rush-${c.label}.${c.ext}`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- quality: step down if the device can't hold ~40 fps ----------
const quality = { level: store.get('iso.q', 0), acc: 0, n: 0 };
function applyQuality() {
  const q = quality.level;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q >= 3 ? 0.75 : q >= 1 ? 1 : 1.5));
  const sh = q < 2; if (renderer.shadowMap.enabled !== sh) { renderer.shadowMap.enabled = sh; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  for (const e of P) if (e.mesh.setOutline) e.mesh.setOutline(q < 2);
  if (q >= 2 && clip.on) { clip.on = false; clipStop(false); }
  resize();
}
function qualityTick(raw) {
  if (document.hidden) return;
  quality.acc += raw; quality.n++;
  if (quality.n < 150) return;
  const avg = quality.acc / quality.n; quality.acc = quality.n = 0;
  if (avg > 1 / 40 && quality.level < 3) { quality.level++; store.set('iso.q', quality.level); applyQuality(); }
}

// ---------- main loop ----------
function tick(dt) {
  G.time += dt;
  if (G.mode === 'check') {
    G.timer -= dt;
    const off = P[G.poss], def = P[1 - G.poss];
    const a = moveTo(off, CHECK[0].x, CHECK[0].z, 7.5), b = moveTo(def, CHECK[1].x, CHECK[1].z, 7.5);
    integrate(off, dt); integrate(def, dt);
    if ((a < 0.2 && b < 0.2 && G.timer <= 0) || G.timer < -2.5) { G.mode = 'live'; def.ai.sx = off.x; def.ai.sz = off.z; }
  } else if (G.mode === 'live' || G.mode === 'scored') {
    for (const e of P) {
      const opp = P[1 - e.team];
      if (G.mode === 'scored') { e.wantX = e.wantZ = 0; if (e.shooting) e.shooting = false; }
      else if (isHuman(e)) controlHuman(e, opp, e.team === 0 ? input : input2);
      else controlAI(e, opp, dt);
      integrate(e, dt);
    }
    separate(); updateBall(dt);
    if (G.mode === 'scored') { G.timer -= dt; if (G.timer <= 0) { if (G.winner >= 0) { const w = G.winner; G.winner = -1; G.lastWinner = w; endGame(); } else setupCheck(G.nextOff); } }
  } else if (G.mode === 'cine') cineTick(dt);
  else if (G.mode === 'over') { updateBall(dt); for (const e of P) { e.wantX = e.wantZ = 0; integrate(e, dt); } }
  for (const e of P) animate(e, dt);
  placeBall(dt);
  if (G.mode === 'live' && G.takeover > 0) G.takeover = Math.max(0, G.takeover - dt);
  if (clip.rec && clip.rec.score < 2 && performance.now() - clip.rec.t0 > 20000) { clipStop(false); clipStart(); }
  if (ball.state === 'held' && (ball.holder.fire || takeover(ball.holder)) && Math.random() < 0.7)
    pfx.burst(ball.p.x, ball.p.y, ball.p.z, 1, ball.holder.fire ? FIRE : GOLD, 0.4, 1.2, 0.45, 2);
  if (G.takeover > 0 && Math.random() < 0.5) pfx.burst(P[0].x + rand(-0.4, 0.4), 0.1, P[0].z + rand(-0.4, 0.4), 1, GOLD, 0.3, 1.6, 0.7, 1);
  pfx.update(dt);
  if (!G.attract) { const hi = Math.max(...G.score); setBeat((hi >= G.target - 2 ? 2 : hi >= 5 || P[0].fire || P[1].fire ? 1 : 0) + (G.takeover > 0 ? 1 : 0)); }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (G.manual) { last = now; return; }
  qualityTick((now - last) / 1000);
  const raw = Math.min(1 / 30, (now - last) / 1000); last = now;
  let ts = 1;   // hit-stop freezes the frame on contact, slow-mo sells ankles + game-winners
  if (G.hitstop > 0) { G.hitstop -= raw; ts = 0.05; } else if (G.slow > 0) { G.slow -= raw; ts = 0.4; }
  const dt = raw * ts;
  pollMove();
  if (net.role === 'guest') {                               // the guest draws the host's game
    if (input.pausePressed) togglePause();
    if (net.conn) netInput(now);
    guestTick(raw); world.update(raw, G.time); updateCamera(raw); updateHUD(raw);
    renderer.render(scene, camera); endFrame(); return;
  }
  if (net.role === 'host') netApplyInput();
  if (input.pausePressed && !G.attract && (G.mode === 'live' || G.mode === 'check' || G.mode === 'scored')) togglePause();
  if (!G.paused) { tick(dt); world.update(dt, G.time); }
  updateCamera(G.paused ? 0 : dt); updateHUD(dt);
  renderer.render(scene, camera);
  if (net.role === 'host' && net.conn) netSend(now);
  endFrame();
}

// ---------- cinematics ----------
// boot: tight on your baller's handle under the light, crane up to his face, pull out into the attract orbit as the title slams in.
// walk-up: every game start, you walk the ball up from half court to the check spot, defender waiting, crossover combo, GAME ON.
const CINE = { boot: 5.4, walk: 4.1, walkArrive: 2.8 };
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function crossFx(e) { e.hand *= -1; e.dashT = 0.2; e.moveKind = 'CROSS'; e.dx = Math.cos(e.face) * e.hand * 0.01; e.dz = -Math.sin(e.face) * e.hand * 0.01; sfx.dribble(0.9); }
function faceTo(e, x, z) { e.face = Math.atan2(x - e.x, z - e.z); }
function startBoot() {
  startAttract();
  const a = P[0], b = P[1];
  resetEntity(a); resetEntity(b); giveBall(a);
  a.x = 0; a.z = 7.4; a.face = 0; b.x = 1.3; b.z = 4.4; faceTo(b, a.x, a.z);
  G.mode = 'cine'; G.cine = { kind: 'boot', t: 0 };
  document.body.classList.add('cine', 'boot'); document.body.classList.remove('reveal');
}
function startWalkup() {
  const a = P[0], b = P[1];
  for (const e of P) resetEntity(e);
  giveBall(a); G.poss = 0;
  const short = G.walked; G.walked = true;                         // full walk-up once per visit, then a 1.5s version
  a.x = short ? 0.6 : 1.3; a.z = short ? 10.5 : 13.1; b.x = CHECK[1].x; b.z = CHECK[1].z; faceTo(a, CHECK[0].x, CHECK[0].z); faceTo(b, a.x, a.z);
  G.mode = 'cine'; G.cine = { kind: 'walk', t: 0, fx: a.x, fz: a.z, short, T1: short ? 0.7 : CINE.walkArrive, T: short ? 1.5 : CINE.walk, keys: short ? SHORT_KEYS : WALK_KEYS };
  clipStop(false);
  document.body.classList.add('cine'); document.body.classList.remove('boot');
}
function skipCine() {
  const c = G.cine; if (!c) return;
  if (c.kind === 'boot') endBoot(); else if (c.t > 0.25) endWalkup();
}
function endBoot() { G.cine = null; document.body.classList.remove('cine', 'boot'); document.body.classList.add('reveal'); setupCheck(Math.random() < 0.5 ? 0 : 1); }
function endWalkup() { G.cine = null; document.body.classList.remove('cine'); setupCheck(0); }
function cineTick(dt) {
  const c = G.cine; c.t += dt;
  const a = P[0], b = P[1];
  for (const e of P) { e.dashT = Math.max(0, e.dashT - dt); e.stamina = 100; }
  if (c.kind === 'boot') {
    a.vx = a.vz = 0; b.vx = b.vz = 0;
    if (c.t > 2.0 && !c.title) { c.title = true; document.body.classList.add('reveal'); }
    if (c.t > 3.05 && !c.x1) { c.x1 = true; crossFx(a); }
    if (c.t > 3.4 && !c.x2) { c.x2 = true; crossFx(a); }
    if (c.t >= CINE.boot) endBoot();
    return;
  }
  // walk-up: steady stroll, ease into the spot
  const T1 = c.T1, u = clamp(c.t / T1, 0, 1);
  const k = u < 0.8 ? u / 0.9 : 0.8 / 0.9 + (1 - 0.8 / 0.9) * ease((u - 0.8) / 0.2);
  const nx = lerp(c.fx, CHECK[0].x, k), nz = lerp(c.fz, CHECK[0].z, k);
  a.vx = dt > 0 ? (nx - a.x) / dt : 0; a.vz = dt > 0 ? (nz - a.z) / dt : 0; a.x = nx; a.z = nz;
  if (u < 1) faceTo(a, CHECK[0].x, CHECK[0].z); else { a.vx = a.vz = 0; a.face = angLerp(a.face, Math.atan2(-a.x, -a.z), Math.min(1, dt * 10)); }
  b.vx = b.vz = 0; faceTo(b, a.x, a.z);
  if (c.t > T1 + 0.1 && !c.x1) { c.x1 = true; crossFx(a); }
  if (!c.short && c.t > T1 + 0.42 && !c.x2) { c.x2 = true; crossFx(a); }
  if (c.t > T1 + (c.short ? 0.3 : 0.72) && !c.go) { c.go = true; G.punch = 1; G.shake = 0.12; sfx.takeover(); banner(G.twoP ? 'P1 BALL' : G.daily ? `VS ${G.daily.name.toUpperCase()}` : 'GAME ON', 'big', 1000); }
  if (c.t >= c.T) endWalkup();
}
// camera keys are relative to a baller: [time, pos [fwd, left, up], look [fwd, left, up], fov]
const BOOT_KEYS = [[0, [2.5, -0.75, 0.55], [0.35, 0.05, 0.62], 34], [1.6, [2.1, -0.6, 0.75], [0.3, 0.0, 0.75], 34], [3.0, [2.3, -0.55, 1.75], [0, 0, 1.5], 36]];
const WALK_KEYS = [[0, [-2.7, -0.85, 1.75], [3, 0, 1.15], 46], [2.0, [-1.6, -2.6, 1.45], [1.4, 0, 1.05], 44], [2.8, [0.75, -3.3, 1.25], [0.8, 0, 1.0], 40], [3.6, [0.4, -3.6, 1.45], [0.8, 0, 1.0], 42]];
const SHORT_KEYS = [[0, [0.2, -3.5, 1.5], [0.9, 0, 1.0], 44], [0.8, [0.75, -3.3, 1.25], [0.8, 0, 1.0], 40], [1.5, [0.4, -3.6, 1.45], [0.8, 0, 1.0], 42]];
function keyCam(keys, t, e) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const A = keys[i], B = keys[i + 1], s = ease((t - A[0]) / (B[0] - A[0]));
  const Fx = Math.sin(e.face), Fz = Math.cos(e.face), Lx = Math.cos(e.face), Lz = -Math.sin(e.face);
  const pt = j => { const f = lerp(A[j][0], B[j][0], s), l = lerp(A[j][1], B[j][1], s), u = lerp(A[j][2], B[j][2], s); return [e.x + Fx * f + Lx * l, (e.y || 0) + u, e.z + Fz * f + Lz * l]; };
  return { p: pt(1), l: pt(2), fov: lerp(A[3], B[3], s) };
}
function cineCamera(dt) {
  const c = G.cine, a = P[0];
  let k;
  if (c.kind === 'boot') {
    c.anchor ||= { x: a.x, y: 0, z: a.z, face: a.face };           // anchor on the spot so the dribble doesn't shake the shot
    k = keyCam(BOOT_KEYS, Math.min(c.t, 3.0), c.anchor);
    if (c.t > 3.0) {                                               // pull out into the attract orbit
      const s = ease((c.t - 3.0) / (CINE.boot - 3.0)), th = Math.sin(G.time * 0.09) * 1.0;
      const ap = [Math.sin(th) * 12, 3.6 + Math.sin(G.time * 0.13) * 0.7, 4 + Math.cos(th) * 11.5], al = [ball.p.x * 0.3, 1.8, 3.2];
      k = { p: k.p.map((v, i) => lerp(v, ap[i], s)), l: k.l.map((v, i) => lerp(v, al[i], s)), fov: lerp(k.fov, 46, s) };
    }
  } else {
    c.anchor = { x: a.x, y: 0, z: a.z, face: c.t < c.T1 ? a.face : (c.anchor ? c.anchor.face : a.face) };
    k = keyCam(c.keys, c.t, c.anchor);
  }
  const sm = 1 - Math.exp(-dt * (c.kind === 'boot' ? 9 : 7));
  if (!c.cut) { c.cut = true; camPos.set(...k.p); camLook.set(...k.l); }
  camPos.x += (k.p[0] - camPos.x) * sm; camPos.y += (k.p[1] - camPos.y) * sm; camPos.z += (k.p[2] - camPos.z) * sm;
  camLook.x += (k.l[0] - camLook.x) * sm; camLook.y += (k.l[1] - camLook.y) * sm; camLook.z += (k.l[2] - camLook.z) * sm;
  camera.position.copy(camPos);
  if (G.shake > 0) { camera.position.x += rand(-1, 1) * G.shake * 0.3; camera.position.y += rand(-1, 1) * G.shake * 0.3; G.shake = Math.max(0, G.shake - dt * 1.4); }
  G.punch = Math.max(0, (G.punch || 0) - dt * 2.4);
  camera.fov = (camera.aspect < 1 ? k.fov * 1.3 : k.fov) - G.punch * 8; camera.updateProjectionMatrix();
  camera.lookAt(camLook);
}
addEventListener('keydown', ev => { if (G.cine && !ev.repeat && ['Space', 'Enter', 'Escape', 'KeyP'].includes(ev.code)) skipCine(); });
addEventListener('pointerdown', ev => { if (G.cine && (G.cine.kind === 'walk' || ev.target === canvas)) skipCine(); });

// ---------- online: friend vs friend ----------
// The host runs the real game (as a 2-player match) and sends ~30 snapshots a second. The guest sends its inputs,
// draws what the host says, and replays the host's banners, sounds and particles. The guest's shot release is
// judged on the meter value the guest actually saw, so lag doesn't eat greens.
const NET_FIELDS = ['x', 'z', 'y', 'vx', 'vz', 'vy', 'face', 'hand', 'shooting', 'meter', 'fill', 'lay', 'dashT', 'dx', 'dz', 'moveKind', 'stun', 'stumble', 'sprint', 'hangT', 'reachT', 'followT', 'spinT', 'spinDir', 'dashDelay', 'stamina', 'fire', 'needsClear', 'jumpH', 'readT'];
const BALL_STATES = ['held', 'flight', 'loose', 'dead'];
const net = { role: null, conn: null, peer: null, code: '', out: [], evIn: [], remote: { mx: 0, mz: 0, sp: false, sh: false, m: 0 }, snap: null, snapAt: 0, sendT: 0, lastIn: '', hello: null, looks: null };
const r3 = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
function netEv(...a) { if (net.role === 'host') net.out.push(a); }
// everything the guest should hear and see goes through these, so wrap them once
for (const k of Object.keys(sfx)) { if (k === 'dribble' || k === 'click') continue; const f = sfx[k]; sfx[k] = (...a) => { netEv('sfx', k, a); return f(...a); }; }
{ const b = pfx.burst; pfx.burst = (...a) => { if (a[3] >= 5) netEv('pfx', a); b(...a); }; }
{ const sw = world.swish, cl = world.clank; world.swish = () => { netEv('swish'); sw(); }; world.clank = () => { netEv('clank'); cl(); }; }
{ const tr = trail.reset; trail.reset = (...a) => { netEv('trail', a); tr(...a); }; }
function netReplay([k, ...a]) {
  if (k === 'banner') banner(...a);
  else if (k === 'tag') tag(P[a[0]], a[1], a[2], a[3]);
  else if (k === 'sfx') { if (sfx[a[0]]) sfx[a[0]](...a[1]); }
  else if (k === 'pfx') pfx.burst(...a[0]);
  else if (k === 'swish') world.swish(); else if (k === 'clank') world.clank();
  else if (k === 'trail') trail.reset(...a[0]);
  else if (k === 'mf') meterFlash(a[0], a[1]);
  else if (k === 'over') { G.stats = a[0]; G.score = a[1]; G.lastWinner = a[2]; G.mode = 'over'; stopBeat(); renderOver2P(); setTimeout(() => { if (net.role) showScreen('over'); }, 900); }
}
function netSend(now) {                                    // host -> guest
  if (now - net.sendT < 33) return; net.sendT = now;
  net.conn.send({ t: 's', g: [G.mode, G.score[0], G.score[1], G.poss, G.nextOff, G.lastWinner, r3(G.takeover), r3(G.shake), r3(G.punch || 0), r3(G.time)],
    b: [BALL_STATES.indexOf(ball.state), ball.holder ? ball.holder.team : -1, r3(ball.p.x), r3(ball.p.y), r3(ball.p.z), r3(ball.v.x), r3(ball.v.y), r3(ball.v.z)],
    p: P.map(e => NET_FIELDS.map(f => r3(e[f]))), ev: net.out.splice(0) });
}
function netApplyInput() {                                 // host: the guest's controller drives player 2
  const r = net.remote, was = input2.shootHeld;
  input2.move.x = r.mx; input2.move.z = r.mz; input2.sprintHeld = !!r.sp; input2.shootHeld = !!r.sh; input2.tapAct = false;
  for (const ev of net.evIn.splice(0)) {
    if (ev === 'shoot') input2.shootPressed = true;
    else if (ev === 'tap') input2.actPressed = input2.tapAct = true;
    else if (ev === 'act') input2.actPressed = true;
    else { input2.moveKey = ev; input2.actPressed = true; }
  }
  if (was && !r.sh && P[1].shooting && r.m > 0.05) P[1].meter = r.m;   // judge the release the guest saw
}
function netInput(now) {                                   // guest -> host
  const ev = [];
  if (input.shootPressed) ev.push('shoot');
  if (input.moveKey) ev.push(input.moveKey); else if (input.actPressed) ev.push(input.tapAct ? 'tap' : 'act');
  const msg = { t: 'i', mx: r3(input.move.x), mz: r3(input.move.z), sp: input.sprintHeld, sh: input.shootHeld, m: r3(P[1].meter) };
  const key = `${msg.mx},${msg.mz},${msg.sp},${msg.sh}`;
  if (!ev.length && key === net.lastIn && now - net.sendT < 100) return;
  msg.ev = ev; net.lastIn = key; net.sendT = now; net.conn.send(msg);
}
function guestTick(dt) {
  const s = net.snap;
  if (s) {
    const age = Math.min(0.12, (performance.now() - net.snapAt) / 1000), k = 1 - Math.exp(-dt * 18), ky = 1 - Math.exp(-dt * 32);
    const [mode, s0, s1, poss, nextOff, lastWinner, takeover, shake, punch, time] = s.g;
    if (s0 !== G.score[0] || s1 !== G.score[1] || poss !== G.poss) { G.score = [s0, s1]; G.poss = poss; hudScore(); }
    if (G.mode !== 'over') G.mode = mode;
    G.nextOff = nextOff; G.lastWinner = lastWinner; G.takeover = takeover; G.time = time;
    if (!s.used) { G.shake = Math.max(G.shake, shake); G.punch = Math.max(G.punch || 0, punch); }
    P.forEach((e, i) => {
      const a = s.p[i];
      NET_FIELDS.forEach((f, j) => {
        const v = a[j]; if (v == null) return;
        if (f === 'x' || f === 'z') { const tgt = v + a[f === 'x' ? 3 : 4] * age; e[f] = Math.abs(tgt - e[f]) > 3 ? tgt : e[f] + (tgt - e[f]) * k; }
        else if (f === 'y') e.y = v === 0 ? 0 : e.y + (v - e.y) * ky;
        else if (f === 'face') e.face = angLerp(e.face, v, k);
        else if (f === 'meter') e.meter = a[8] ? v + a[10] * age : v;         // keep the meter moving between snapshots
        else e[f] = v;
      });
    });
    ball.state = BALL_STATES[s.b[0]]; ball.holder = s.b[1] >= 0 ? P[s.b[1]] : null;
    ball.v.set(s.b[5], s.b[6], s.b[7]);
    if (ball.state !== 'held') { v3.set(s.b[2] + s.b[5] * age, Math.max(0.12, s.b[3] + s.b[6] * age), s.b[4] + s.b[7] * age); if (ball.p.distanceTo(v3) > 2.5 || !s.used) ball.p.copy(v3); else ball.p.lerp(v3, 1 - Math.exp(-dt * 30)); }
    s.used = true;
  }
  for (const ev of net.evIn.splice(0)) netReplay(ev);
  for (const e of P) animate(e, dt);
  placeBall(dt); pfx.update(dt);
}
function netOn(conn, role) {
  net.conn = conn; net.role = role; net.out = []; net.evIn = []; net.snap = null; net.remote = { mx: 0, mz: 0, sp: false, sh: false, m: 0 };
  conn.on('data', m => {
    if (!m || net.conn !== conn) return;
    if (m.t === 's' && role === 'guest') { net.snap = m; net.snapAt = performance.now(); if (m.ev.length) net.evIn.push(...m.ev); }
    else if (m.t === 'i' && role === 'host') { net.remote = m; if (m.ev && m.ev.length) net.evIn.push(...m.ev.slice(0, 6)); }
    else if (m.t === 'hello' && role === 'host') { net.hello = { look: { hair: m.look.hair | 0, skin: m.look.skin | 0 }, color: m.color | 0 }; netStart(); }
    else if (m.t === 'start' && role === 'guest') guestStart(m.looks);
    else if (m.t === 'again' && role === 'host') netStart();
  });
  conn.on('close', () => { if (net.conn === conn) netEnd('Your friend left the game.'); });
  conn.on('error', () => { if (net.conn === conn) netEnd('The connection dropped.'); });
  if (role === 'guest') conn.send({ t: 'hello', look: G.look, color: KITS[G.look.kit % KITS.length].c });
}
function netApplyLooks(looks) { looks.forEach((l, i) => { setLook(P[i], { ...l.look, band: true }); recolor(P[i], l.color); }); }
function netStart() {                                      // host: (re)start the match
  if (net.role !== 'host' || !net.conn) return;
  const mine = { look: { hair: G.look.hair, skin: G.look.skin }, color: KITS[G.look.kit % KITS.length].c }, theirs = { ...(net.hello || { look: { hair: 1, skin: 3 }, color: 0x2f6bff }) };
  if (theirs.color === mine.color) theirs.color = mine.color === 0x2f6bff ? 0xf0452a : 0x2f6bff;   // never the same jersey
  net.looks = [mine, theirs];
  net.conn.send({ t: 'start', looks: net.looks });
  startGame({ cfg: DIFF.pro, twoP: true, online: true });
}
function guestStart(looks) {
  unlockAudio(); net.looks = looks; net.snap = null; net.evIn = [];
  G.cine = null; document.body.classList.remove('cine', 'boot');
  G.attract = false; G.twoP = true; G.paused = false; G.mode = 'check'; G.score = [0, 0]; G.stats = newStats(); G.hitstop = G.slow = 0;
  $('#score').classList.add('two'); $('#youName').textContent = 'P1'; $('#cpuName').textContent = 'YOU'; $('#to').textContent = `TO ${G.target}`;
  netApplyLooks(looks); netHudColors();
  show('hud'); hideScreens(); resetFun(); startBeat(); hudScore();
  banner('YOU ARE P2', 'small', 1600);
}
function netHudColors() {                                  // scoreboard tiles take the two jersey colours
  const on = !!net.role && net.looks, hex = v => '#' + v.toString(16).padStart(6, '0'), dark = v => ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) < 140;
  [['.you', 0], ['.cpu', 1]].forEach(([sel, i]) => { const el = document.querySelector('#score ' + sel); el.style.background = on ? hex(net.looks[i].color) : ''; el.style.color = on ? (dark(net.looks[i].color) ? '#f3f2ee' : '#0e0f13') : ''; });
}
function netClose() {                                      // leave on purpose
  const { conn, peer } = net; net.conn = null; net.role = null; net.looks = null; net.code = '';
  try { if (conn) conn.close(); } catch (e) { /* closed */ }
  try { if (peer) peer.destroy(); } catch (e) { /* gone */ }
  net.peer = null; netHudColors();
}
function netEnd(why) {                                     // the other side went away
  netClose(); setTwoPlayer(false); startAttract(); renderMenu(); showScreen('online'); onlineUI(why, false);
}
function onlineUI(status, hosting) {
  $('#onStatus').textContent = status; $('#onHost').hidden = !hosting;
  if (hosting) $('#onCode').textContent = net.code;
}
const inviteURL = () => `${baseURL()}?room=${net.code}`;
async function openOnline() {                              // host a room and wait for a friend
  showScreen('online');
  if (net.peer && net.code && !net.conn) { onlineUI('Waiting for your friend.', true); return; }
  netClose(); onlineUI('Getting you a code.', false);
  try {
    const room = await hostRoom(conn => { if (net.conn) { conn.close(); return; } netOn(conn, 'host'); },
      () => { if (!net.conn) onlineUI('Could not reach the matchmaking server. Check your connection, or this network may block it.', false); });
    if (!room) return;
    if ($('#online').hidden) { room.peer.destroy(); return; }
    net.peer = room.peer; net.code = room.code; onlineUI('Waiting for your friend.', true); drawQR($('#onQR'), inviteURL());
  } catch (err) { onlineUI('Online play could not load on this network.', false); }
}
async function joinOnline(code) {
  code = cleanCode(code); if (code.length < 4) { onlineUI('Codes are 4 characters.', !!net.code); return; }
  netClose(); showScreen('online'); onlineUI(`Joining ${code}.`, false);
  try { const { peer, conn } = await joinRoom(code); net.peer = peer; net.code = code; onlineUI('Connected. Starting.', false); netOn(conn, 'guest'); }
  catch (err) { onlineUI(err.message === 'no-room' ? `No game found for ${code}. Ask your friend for a fresh link.` : 'Could not connect. Some school networks block direct connections. Try another network or a phone hotspot.', false); }
}

// ---------- feedback: a short note sent to the author's form. No name, no account ----------
const fb = { mood: '', from: 'menu' };
function openFeedback(from) {
  fb.from = from; fb.mood = '';
  for (const b of document.querySelectorAll('[data-mood]')) b.classList.remove('on');
  $('#fbStatus').textContent = ''; $('#fbSend').disabled = false; $('#fbSend').textContent = 'Send it';
  showScreen('feedback'); if (!input.touch) $('#fbText').focus();
}
async function sendFeedback() {
  const text = $('#fbText').value.trim();
  if (!text && !fb.mood) { $('#fbStatus').textContent = 'Pick one above or type something first.'; return; }
  if (Date.now() - store.get('iso.fbAt', 0) < 20000) { $('#fbStatus').textContent = 'Got your last one. Give it a few seconds before the next.'; return; }
  const c = store.get('iso.career', { games: 0, wins: 0 });
  // context that helps fix things; nothing that identifies the player
  const meta = `[${fb.mood || 'no pick'}] ${input.touch ? 'touch' : 'keyboard'}, ${getScheme()} controls, ${c.games} games, quality ${quality.level}, ${innerWidth}x${innerHeight}`;
  $('#fbSend').disabled = true; $('#fbSend').textContent = 'Sending';
  try {
    await fetch(FEEDBACK.url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ [FEEDBACK.field]: `${text || '(no text)'}\n${meta}` }) });
    store.set('iso.fbAt', Date.now()); $('#fbText').value = '';
    $('#fbStatus').textContent = 'Sent. Thank you, for real.'; $('#fbSend').textContent = 'Sent';
  } catch (err) {
    $('#fbStatus').textContent = 'Could not send on this network. Try again later.'; $('#fbSend').disabled = false; $('#fbSend').textContent = 'Send it';
  }
}

// ---------- QR codes: scan the screen to get the game (or the invite) on a phone ----------
let qrLoad = null;
async function drawQR(el, text) {
  try {
    qrLoad ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = new URL('../vendor/qrcode.js', import.meta.url).href; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
    await qrLoad;
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); el.hidden = false;
  } catch (err) { el.hidden = true; }
}

// ---------- screens ----------
const screens = ['menu', 'over', 'pause', 'howto', 'online', 'feedback'];
function hideScreens() { for (const s of screens) $('#' + s).hidden = true; }
function showScreen(s) { hideScreens(); $('#' + s).hidden = false; }
function show(id) { $('#' + id).hidden = false; } function hide(id) { $('#' + id).hidden = true; }
function togglePause() {
  if (net.role) { $('#pause').hidden ? showScreen('pause') : hideScreens(); return; }
  G.paused = !G.paused; G.paused ? showScreen('pause') : hideScreens(); }

function renderMenu() {
  const b = G.boss;
  $('#dn').textContent = b.n;
  $('#bossName').textContent = b.name;
  $('#bossName').style.color = '#' + b.color.toString(16).padStart(6, '0');
  $('#bossTraits').innerHTML = b.traits.map(t => `<span class="chip" title="${TRAITS[t].desc}">${t}<small>${TRAITS[t].desc}</small></span>`).join('');
  const r = store.get('iso.daily.' + b.key, null);
  $('#dailyRes').textContent = r ? (r.win ? `Beaten today ${r.score[0]}–${r.score[1]} · replay for fun` : `Lost today ${r.score[0]}–${r.score[1]} · replay for fun`) : 'One official run per day. Same boss for everyone.';
  for (const btn of document.querySelectorAll('[data-diff]')) btn.classList.toggle('on', btn.dataset.diff === G.diff);
  const c = store.get('iso.career', null);
  $('#career').textContent = c && c.games ? `${c.wins}–${c.games - c.wins} career · best streak ${c.best}` : '';
  $('#mute').textContent = isMuted() ? 'Sound off' : 'Sound on';
  for (const btn of document.querySelectorAll('[data-ctl]')) btn.classList.toggle('on', btn.dataset.ctl === G.ctl);
  document.body.classList.toggle('ctl-simple', G.ctl === 'simple'); document.body.classList.toggle('ctl-pro', G.ctl !== 'simple');
  $('#ctlHint').textContent = G.ctl === 'simple' ? 'WASD to move. K for moves and steals. L or Space to shoot.' : 'WASD, Shift to sprint, Space to shoot, J K L I for moves and reads.';
  const st = store.get('iso.streak', { n: 0, count: 0 }), live = st.n >= G.boss.n - 1 ? st.count : 0;
  if (live > 1) $('#career').textContent = `${live} day boss streak` + ($('#career').textContent ? ' · ' + $('#career').textContent : '');
  const L = G.look, wins = c ? c.wins : 0, hex = v => '#' + v.toString(16).padStart(6, '0');
  const lb = n => document.querySelector(`[data-look="${n}"]`);
  lb('hair').textContent = HAIRS[L.hair % HAIRS.length];
  lb('skin').innerHTML = `<i class="sw" style="background:${hex(SKINS[L.skin % SKINS.length])}"></i>Skin`;
  const peek = G.kitPeek != null ? KITS[G.kitPeek] : null, kit = KITS[L.kit % KITS.length];
  lb('kit').innerHTML = peek ? `${peek.name}: ${peek.need} wins` : `<i class="sw" style="background:${hex(kit.c)}"></i>${kit.name}`;
  const ch = G.chal; $('#challenge').hidden = !ch;
  if (ch) $('#chalText').textContent = ch.win ? `A friend beat ${ch.boss.name} ${ch.s0} to ${ch.s1}. Beat that.` : `A friend lost to ${ch.boss.name} ${ch.s0} to ${ch.s1}. Show them how.`;
}
function cycleLook(what) {
  const L = G.look, wins = (store.get('iso.career', null) || { wins: 0 }).wins;
  if (what === 'hair') L.hair = (L.hair + 1) % HAIRS.length;
  else if (what === 'skin') L.skin = (L.skin + 1) % SKINS.length;
  else {                                                   // kits unlock with career wins; a locked one shows what it costs
    const from = G.kitPeek != null ? G.kitPeek : L.kit, next = (from + 1) % KITS.length;
    if (KITS[next].need > wins) G.kitPeek = next; else { G.kitPeek = null; L.kit = next; }
  }
  store.set('iso.look', L); applyMyLook(); renderMenu();
}
// challenge links: ?c=<boss number>-<W|L>-<their score>-<boss score>
function readChallenge() {
  const m = /^(\d{1,5})-([WL])-(\d{1,2})-(\d{1,2})$/.exec(new URLSearchParams(location.search).get('c') || '');
  if (!m) return null;
  const n = +m[1]; if (n < 1 || n > todayN() + 1) return null;
  return { n, win: m[2] === 'W', s0: +m[3], s1: +m[4], boss: dailyBoss(n) };
}
const baseURL = () => location.href.split(/[?#]/)[0];
function challengeURL() { return G.daily ? `${baseURL()}?c=${G.daily.n}-${G.score[0] > G.score[1] ? 'W' : 'L'}-${G.score[0]}-${G.score[1]}` : baseURL(); }
function shareText(win) {
  if (G.twoP) return `${TITLE.toUpperCase()} 🏀 2P · P${G.lastWinner + 1} wins ${G.score[0]}–${G.score[1]}
${baseURL()}`;
  const s = G.stats[0], who = G.daily ? `Daily #${G.daily.n} vs ${G.daily.name} (${G.daily.traits.join(' + ')})` : `vs ${G.cfg.name} CPU`;
  return `${TITLE.toUpperCase()} 🏀 ${who}\n${win ? 'W' : 'L'} ${G.score[0]}–${G.score[1]} · FG ${s.fgm}/${s.fga} · ${s.greens} greens${s.ankles ? ` · ${s.ankles} ankles` : ''}\n${G.shots.join('')}\n${G.daily ? 'Beat my score: ' : ''}${challengeURL()}`;
}
function renderOver2P() {
  const w = G.lastWinner, a = G.stats[0], b = G.stats[1];
  const mine = net.role ? (net.role === 'host' ? 0 : 1) : -1;
  $('#ovTitle').textContent = mine < 0 ? `P${w + 1} WINS` : w === mine ? 'YOU WIN' : 'YOU LOSE'; $('#ovTitle').className = mine < 0 ? (w === 0 ? 'p0' : 'p1') : w === mine ? 'win' : 'lose';
  $('#ovSub').textContent = net.role ? 'Online match' : '2 players · same keyboard';
  $('#ovAgain').textContent = 'Rematch'; $('#ovAgain').disabled = false;
  $('#ovScore').textContent = `${G.score[0]} – ${G.score[1]}`; $('#ovShots').textContent = '';
  $('#ovStats').innerHTML = [['P1 FG', `${a.fgm}/${a.fga}`], ['P1 greens', a.greens], ['P1 ankles', a.ankles], ['P1 steals', a.steals], ['P2 FG', `${b.fgm}/${b.fga}`], ['P2 greens', b.greens], ['P2 ankles', b.ankles], ['P2 steals', b.steals]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('#ovCareer').textContent = ''; $('#ovShare').textContent = 'Copy result'; $('#ovChal').hidden = true; clipButton();
}
function renderOver(win, career) {
  const s = G.stats[0];
  $('#ovTitle').textContent = win ? 'BUCKETS.' : 'COOKED.';
  $('#ovTitle').className = win ? 'win' : 'lose';
  $('#ovSub').textContent = G.daily ? `Daily #${G.daily.n} vs ${G.daily.name}` : `vs ${G.cfg.name} CPU`;
  $('#ovScore').textContent = `${G.score[0]} – ${G.score[1]}`;
  $('#ovShots').textContent = G.shots.join('') || '—';
  const pct = s.fga ? Math.round(s.fgm / s.fga * 100) : 0;
  $('#ovStats').innerHTML = [['FG', `${s.fgm}/${s.fga}`], ['FG%', pct + '%'], ['2PT', `${s.tm}/${s.ta}`], ['Greens', s.greens], ['Ankles', s.ankles], ['Steals', s.steals], ['Blocks', s.blocks], ['Dunks', s.dunks]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('#ovCareer').textContent = `${career.wins}–${career.games - career.wins} career · streak ${career.streak} · best ${career.best}`;
  $('#ovShare').textContent = G.daily ? 'Challenge a friend' : 'Copy result';
  const ch = G.runChal, oc = $('#ovChal'); oc.hidden = !ch;
  if (ch) {
    const mine = G.score[0] - G.score[1], theirs = ch.s0 - ch.s1, beat = mine > theirs;
    oc.className = beat ? '' : 'lost';
    oc.textContent = beat ? `You beat their ${ch.s0} to ${ch.s1}. Send it back.` : mine === theirs ? `Tied their ${ch.s0} to ${ch.s1}. Run it again.` : `Their ${ch.s0} to ${ch.s1} still stands.`;
  }
  clipButton();
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; }
}

function wire() {
  const click = (sel, fn) => $(sel).addEventListener('click', () => { unlockAudio(); sfx.click(); fn(); });
  for (const b of document.querySelectorAll('[data-diff]')) b.addEventListener('click', () => { G.diff = b.dataset.diff; store.set('iso.diff', G.diff); sfx.click(); renderMenu(); });
  for (const b of document.querySelectorAll('[data-ctl]')) b.addEventListener('click', () => { G.ctl = b.dataset.ctl; store.set('iso.ctl', G.ctl); setScheme(G.ctl); sfx.click(); renderMenu(); });
  for (const b of document.querySelectorAll('[data-look]')) b.addEventListener('click', () => { sfx.click(); cycleLook(b.dataset.look); });
  click('#play', () => startGame({ cfg: DIFF[G.diff] }));
  click('#play2', () => startGame({ cfg: DIFF.pro, twoP: true }));
  click('#playChal', () => startGame({ cfg: G.chal.boss.cfg, daily: G.chal.boss, chal: G.chal }));
  click('#ovClip', () => clipSave());
  click('#playDaily', () => startGame({ cfg: G.boss.cfg, daily: G.boss }));
  click('#how', () => showScreen('howto'));
  click('#howBack', () => (G.attract ? showScreen('menu') : showScreen('pause')));
  click('#mute', () => { setMuted(!isMuted()); renderMenu(); });
  click('#ovAgain', () => {
    if (net.role === 'host') netStart();
    else if (net.role === 'guest') { net.conn.send({ t: 'again' }); $('#ovAgain').textContent = 'Starting'; $('#ovAgain').disabled = true; }
    else startGame({ cfg: G.cfg, daily: G.daily, twoP: G.twoP, chal: G.runChal });
  });
  click('#playOnline', () => openOnline());
  click('#openFb', () => openFeedback('menu')); click('#ovFb', () => openFeedback('over'));
  click('#fbBack', () => showScreen(fb.from)); click('#fbSend', () => sendFeedback());
  for (const b of document.querySelectorAll('[data-mood]')) b.addEventListener('click', () => { fb.mood = b.dataset.mood; sfx.click(); for (const o of document.querySelectorAll('[data-mood]')) o.classList.toggle('on', o === b); });
  click('#onBack', () => { netClose(); showScreen('menu'); });
  click('#onJoin', () => joinOnline($('#onInput').value));
  $('#onInput').addEventListener('keydown', ev => { if (ev.code === 'Enter') joinOnline($('#onInput').value); });
  click('#onCopy', async () => { $('#onCopy').textContent = (await copy(`1v1 me in ${TITLE}: ${inviteURL()}`)) ? 'Copied. Send it.' : 'Copy failed'; setTimeout(() => { $('#onCopy').textContent = 'Copy invite link'; }, 2200); });
  click('#ovMenu', () => { startAttract(); renderMenu(); showScreen('menu'); });
  click('#ovShare', async () => { $('#ovShare').textContent = (await copy(shareText(G.lastWinner === 0))) ? 'Copied!' : 'Copy failed'; });
  click('#resume', () => togglePause());
  click('#pHow', () => showScreen('howto'));
  click('#quit', () => { G.paused = false; startAttract(); renderMenu(); showScreen('menu'); });
  click('#pauseBtn', () => { if (!G.attract && G.mode !== 'over') togglePause(); });
}

initInput(() => { document.body.classList.add('touch'); show('touch'); });
setScheme(G.ctl); G.chal = readChallenge(); applyQuality();
drawQR($('#qrCode'), `https://${SITE}/`);
wire(); renderMenu(); showScreen('menu');
// the boot close-up plays once a day; after that the menu is up instantly
const roomParam = cleanCode(new URLSearchParams(location.search).get('room'));
if (roomParam.length === 4) { startAttract(); joinOnline(roomParam); }
else if (store.get('iso.boot', '') === todayKey()) startAttract(); else { store.set('iso.boot', todayKey()); startBoot(); }
requestAnimationFrame(frame);

// hooks for the reel recorder / debugging
window.__iso = { G, P, ball, net, makeChance, winMul, clip, coach, quality, test: { setupCheck, endGame, clipStop, renderMenu, showScreen }, boot: startBoot, skip: () => skipCine(),
  // advance n frames deterministically (honours hit-stop and slow-mo, like the real loop) and render once
  step(n = 1, dt = 1 / 60) { G.manual = true; for (let i = 0; i < n; i++) { let ts = 1; if (G.hitstop > 0) { G.hitstop -= dt; ts = 0.05; } else if (G.slow > 0) { G.slow -= dt; ts = 0.4; } const d = dt * ts; pollMove(); tick(d); world.update(d, G.time); updateCamera(d); updateHUD(dt); endFrame(); } renderer.render(scene, camera); return G.mode; },
  live() { G.manual = false; }, startGame: d => startGame({ cfg: DIFF[d || 'pro'] }), startDaily: () => startGame({ cfg: G.boss.cfg, daily: G.boss }) };
