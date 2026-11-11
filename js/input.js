// Keyboard + touch input. Movement is camera-relative: up = toward the hoop (-z).
// Two solo schemes (setScheme): 'simple' = WASD + K tech + L/Space shoot; 'pro' = the full set below.
// Solo: WASD/arrows move, Space hold = shoot / tap = pump fake, Shift sprint,
// Offense: J cross left · K stepback · L cross right · I drive · E = move by stick direction.
// Defense: J/L/I = shadowbox guess (left/right/drive) · K steal (+ step-up guess) · Space contest. Beaten? any of them = recover dash.
// 2P on one keyboard: P1 WASD + F shoot + G move + LShift sprint; P2 arrows + L shoot + K move + RShift sprint.
export const input = { move: { x: 0, z: 0 }, moveKey: null, tapAct: false, sprintHeld: false, shootHeld: false, shootPressed: false, actPressed: false, pausePressed: false, touch: false };
export const input2 = { move: { x: 0, z: 0 }, moveKey: null, sprintHeld: false, shootHeld: false, shootPressed: false, actPressed: false };
const keys = new Set();
const MAP1 = { shoot: ['Space'], act: ['KeyE'], crossL: ['KeyJ'], step: ['KeyK'], crossR: ['KeyL'], drive: ['KeyI'], sprint: ['ShiftLeft', 'ShiftRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] };
const MAP2P = [
  { shoot: ['KeyF', 'Space'], act: ['KeyG', 'KeyE'], sprint: ['ShiftLeft'], up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  { shoot: ['KeyL', 'Period', 'Enter'], act: ['KeyK', 'Comma'], sprint: ['ShiftRight', 'Slash'], up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
];
// Simple scheme: WASD move, K = tech (dribble move by stick direction on offense, steal / recover on defense), L or Space = shoot / jump.
const MAP_SIMPLE = { shoot: ['Space', 'KeyL'], act: ['KeyK', 'KeyE'], sprint: ['ShiftLeft', 'ShiftRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], simple: true };
let scheme = 'simple';
const solo = () => (scheme === 'simple' ? MAP_SIMPLE : MAP1);
let maps = [MAP_SIMPLE, null];
export function setScheme(s) { scheme = s === 'pro' ? 'pro' : 'simple'; if (!maps[1]) maps = [solo(), null]; }
export const getScheme = () => scheme;
const GAME = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
let stick = { id: null, x: 0, z: 0 }, stickOn = false, stickRun = false;
export function setTwoPlayer(on) { maps = on ? MAP2P : [solo(), null]; for (const i of [input, input2]) { i.shootHeld = false; } }
const players = () => [[input, maps[0]], [input2, maps[1]]].filter(p => p[1]);

function setShoot(down, inp = input) {
  if (down && !inp.shootHeld) inp.shootPressed = true;
  inp.shootHeld = down;
}

export function initInput(onTouch) {
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (GAME.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    for (const [inp, m] of players()) {
      if (m.shoot.includes(e.code)) setShoot(true, inp);
      if (m.act.includes(e.code)) { inp.actPressed = true; if (m.simple) inp.tapAct = true; }
      for (const mk of ['crossL', 'step', 'crossR', 'drive']) if (m[mk] && m[mk].includes(e.code)) { inp.moveKey = mk; inp.actPressed = true; }
    }
    if (e.code === 'Escape' || e.code === 'KeyP') input.pausePressed = true;
  });
  addEventListener('keyup', e => {
    keys.delete(e.code);
    for (const [inp, m] of players()) if (m.shoot.includes(e.code) && !m.shoot.some(k => keys.has(k))) setShoot(false, inp);
  });
  addEventListener('blur', () => { keys.clear(); setShoot(false, input); setShoot(false, input2); });

  const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
  const R = 52;
  const moveStick = e => {
    const r = stickEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    stick.x = dx / R; stick.z = dy / R;
  };
  stickEl.addEventListener('pointerdown', e => { stick.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); moveStick(e); });
  stickEl.addEventListener('pointermove', e => { if (e.pointerId === stick.id) moveStick(e); });
  const endStick = e => { if (e.pointerId !== stick.id) return; stick = { id: null, x: 0, z: 0 }; knob.style.transform = ''; };
  stickEl.addEventListener('pointerup', endStick); stickEl.addEventListener('pointercancel', endStick);

  const bShoot = document.getElementById('bShoot'), bAct = document.getElementById('bAct');
  bShoot.addEventListener('pointerdown', e => { bShoot.setPointerCapture(e.pointerId); setShoot(true); });
  for (const ev of ['pointerup', 'pointercancel']) bShoot.addEventListener(ev, () => setShoot(false));
  bAct.addEventListener('pointerdown', () => { input.actPressed = true; input.tapAct = true; });

  const coarse = matchMedia('(pointer: coarse)').matches;
  const enableTouch = () => { if (input.touch) return; input.touch = true; onTouch(); };
  if (coarse) enableTouch();
  addEventListener('touchstart', enableTouch, { once: true, passive: true });
  document.addEventListener('contextmenu', e => { if (input.touch) e.preventDefault(); });
}

const any = list => list.some(k => keys.has(k));
export function pollMove() {
  for (const [inp, m] of players()) {
    let x, z;
    inp.sprintHeld = any(m.sprint);
    if (inp === input && stick.id !== null) {
      x = stick.x; z = stick.z; const l = Math.hypot(x, z);
      // hysteresis on both edges: a thumb resting near a threshold used to flip between states every frame
      stickOn = l > (stickOn ? 0.14 : 0.24); stickRun = stickOn && l > (stickRun ? 0.7 : 0.93);
      if (!stickOn) { x = z = 0; } else { if (stickRun) inp.sprintHeld = true; const s = Math.max(l, 0.55) / l; x *= s; z *= s; const l2 = Math.hypot(x, z); if (l2 > 1) { x /= l2; z /= l2; } }   // light pushes still move at a useful speed
    } else if (inp === input && stick.id === null && (stickOn || stickRun)) { stickOn = stickRun = false; x = z = 0; }
    else {
      x = (any(m.right) ? 1 : 0) - (any(m.left) ? 1 : 0); z = (any(m.down) ? 1 : 0) - (any(m.up) ? 1 : 0);
      const l = Math.hypot(x, z); if (l > 0) { x /= l; z /= l; }
    }
    inp.move.x = x; inp.move.z = z;
  }
}

export function endFrame() { input.shootPressed = input.actPressed = input.pausePressed = false; input2.shootPressed = input2.actPressed = false; input.moveKey = input2.moveKey = null; input.tapAct = false; }
