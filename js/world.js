// Scene construction: a painted blacktop at night. One warm streetlight, a brick wall with the mural, chain-link
// sides, a paper-cut skyline and a low moon. Flat colour and cel shading throughout: no glow maps, no neon.
import * as THREE from '../vendor/three.module.min.js';
import { SITE, NAME } from './config.js';

export const ARC = 6.75, CORNER_X = 6.6, CORNER_Z = Math.sqrt(ARC * ARC - CORNER_X * CORNER_X);
export const RIM = { x: 0, y: 3.05, z: 0 };
export const PAL = { ink: '#0e0f13', asphalt: '#2b2d36', asphalt2: '#343640', chalk: '#f3f2ee', yolk: '#ffcf1a', brick: '#8a3b26', red: '#f0452a', key: '#2743d3', sky: '#141a3a' };
const DISPLAY = "'Big Shoulders Display', Impact, 'Arial Narrow Bold', sans-serif";

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
let _ramp = null;
function ramp() {
  if (_ramp) return _ramp;
  _ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter; _ramp.needsUpdate = true; return _ramp;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp(), ...extra });
// seeded noise so the court and wall look the same on every load (and in every clip)
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function courtTexture() {
  const S = 2048, s = S / 15, cx = x => (x + 7.5) * s, cz = z => (z + 1.6) * s, R = rng(11);
  const [c, g] = canvas(S, S);
  g.fillStyle = PAL.asphalt; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.09)'; g.fillRect(R() * S, R() * S, 2 + R() * 3, 2 + R() * 3); }
  const arcPath = () => {
    const a = Math.atan2(CORNER_Z, CORNER_X);
    g.beginPath(); g.moveTo(cx(-CORNER_X), cz(-1.6)); g.lineTo(cx(-CORNER_X), cz(CORNER_Z)); g.arc(cx(0), cz(0), ARC * s, Math.PI - a, a, true); g.lineTo(cx(CORNER_X), cz(-1.6));
  };
  // paint blocks: everything inside the arc is a shade lighter, the key is cobalt, the jump circle is yolk
  arcPath(); g.closePath(); g.fillStyle = PAL.asphalt2; g.fill();
  g.fillStyle = PAL.key; g.fillRect(cx(-2.45), cz(-1.6), 4.9 * s, 5.8 * s);
  g.beginPath(); g.arc(cx(0), cz(4.2), 1.8 * s, 0, Math.PI); g.fillStyle = PAL.yolk; g.fill();
  // half-court wordmark, stencilled
  g.save(); g.translate(cx(0), cz(10.3)); g.textAlign = 'center'; g.textBaseline = 'middle';
  { let fs = 2.5; g.font = `900 ${fs * s}px ${DISPLAY}`; while (g.measureText(NAME.join(' ')).width > 13 * s && fs > 0.8) { fs -= 0.05; g.font = `900 ${fs * s}px ${DISPLAY}`; } }
  g.fillStyle = PAL.asphalt2; g.fillText(NAME.join(' '), 0, 0); g.restore();
  // lines
  g.strokeStyle = PAL.chalk; g.lineWidth = 0.09 * s; g.lineCap = 'butt'; g.lineJoin = 'miter';
  g.strokeRect(cx(-7.45), cz(-1.55), 14.9 * s, 13.95 * s);
  g.strokeRect(cx(-2.45), cz(-1.6), 4.9 * s, 5.8 * s);
  g.beginPath(); g.arc(cx(0), cz(4.2), 1.8 * s, 0, Math.PI); g.stroke();
  g.beginPath(); g.arc(cx(0), cz(0), 1.25 * s, 0, Math.PI); g.stroke();
  arcPath(); g.stroke();
  g.beginPath(); g.arc(cx(0), cz(12.4), 1.8 * s, Math.PI, 0); g.stroke();
  for (const side of [-1, 1]) for (const z of [1.2, 2.1, 3.0]) { g.beginPath(); g.moveTo(cx(side * 2.45), cz(z)); g.lineTo(cx(side * 2.75), cz(z)); g.stroke(); }   // lane hash marks
  // wear: paint chips and scuffs
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(43,45,54,${0.25 + R() * 0.5})`; const w = 2 + R() * 7; g.fillRect(R() * S, R() * S, w, w * (0.4 + R())); }
  g.strokeStyle = 'rgba(20,21,26,.16)'; g.lineWidth = 3;
  for (let i = 0; i < 70; i++) { const x = cx(-6 + R() * 12), z = cz(R() * 9), a = R() * 6.28, l = 20 + R() * 90; g.beginPath(); g.moveTo(x, z); g.lineTo(x + Math.cos(a) * l, z + Math.sin(a) * l); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  return tex(c);
}

function fenceTexture() {
  const [c, g] = canvas(64, 64);
  g.strokeStyle = '#c9cbd6'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// brick wall behind the hoop with the painted mural: the name and the link are in every clip and screenshot
function wallTexture(W, H) {
  const px = 96, [c, g] = canvas(W * px, H * px), R = rng(5);
  g.fillStyle = PAL.brick; g.fillRect(0, 0, c.width, c.height);
  const bw = 0.44 * px, bh = 0.15 * px;
  for (let row = 0; row * bh < c.height; row++) for (let col = -1; col * bw < c.width; col++) {
    const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = R();
    g.fillStyle = v < 0.2 ? '#7a3221' : v < 0.4 ? '#96432c' : v < 0.47 ? '#6b2c1e' : PAL.brick; g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
  }
  g.fillStyle = '#4d2015'; g.globalAlpha = 0.5; g.fillRect(0, c.height - 0.5 * px, c.width, 0.5 * px); g.globalAlpha = 1;   // grime at the base
  const paint = (txt, size, x, y, fill, shadow) => {
    g.font = `900 ${size * px}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (shadow) { g.fillStyle = PAL.ink; g.fillText(txt, x * px + size * px * 0.045, y * px + size * px * 0.045); }
    g.fillStyle = fill; g.fillText(txt, x * px, y * px);
  };
  // left of the hoop: the name. right: the link, like a hand-painted shop sign
  // each word is sized to fill the same width, so a long word sits small over a short, huge one
  const fit = (txt, max, cap) => { let fs = cap; g.font = `900 ${fs * px}px ${DISPLAY}`; while (g.measureText(txt).width > max * px && fs > 0.4) { fs -= 0.04; g.font = `900 ${fs * px}px ${DISPLAY}`; } return fs; };
  const s1 = fit(NAME[0], 6.2, 2.2), s2 = fit(NAME[1], 6.2, 2.7), top = (H - (s1 + s2) * 0.86) / 2 + 0.45;
  paint(NAME[0], s1, W * 0.2, top + s1 * 0.43, PAL.chalk, true); paint(NAME[1], s2, W * 0.2, top + s1 * 0.86 + s2 * 0.45, PAL.yolk, true);
  // the link sign: one line for a short domain, two when the address is long
  const site = SITE.toUpperCase(), cut = site.length > 22 && site.indexOf('/') > 0 ? site.indexOf('/') : -1;
  const lines = cut > 0 ? [site.slice(0, cut), site.slice(cut)] : [site], bh2 = lines.length > 1 ? 1.9 : 1.24;
  g.save(); g.translate(W * 0.8 * px, H * 0.54 * px); g.rotate(-0.04);
  g.fillStyle = PAL.ink; g.fillRect(-3.05 * px, (-bh2 / 2 + 0.08) * px, 6.1 * px, bh2 * px); g.fillStyle = PAL.yolk; g.fillRect(-3.12 * px, -bh2 / 2 * px, 6.1 * px, bh2 * px);
  g.fillStyle = PAL.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((ln, k) => {
    let size = 0.9; g.font = `900 ${size * px}px ${DISPLAY}`;
    while (g.measureText(ln).width > 5.7 * px && size > 0.3) { size -= 0.03; g.font = `900 ${size * px}px ${DISPLAY}`; }
    g.fillText(ln, -0.07 * px, (lines.length > 1 ? (k ? 0.4 : -0.42) : -0.03) * px);
  });
  g.restore();
  paint('PLAY IT FREE', 0.46, W * 0.8, H * 0.8, PAL.chalk, true);
  // keep the mortar lines reading through the paint
  g.globalCompositeOperation = 'source-atop'; g.strokeStyle = 'rgba(40,16,10,.3)'; g.lineWidth = 2;
  for (let row = 0; row * bh < c.height; row++) { g.beginPath(); g.moveTo(0, row * bh); g.lineTo(c.width, row * bh); g.stroke(); }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(138,59,38,${0.3 + R() * 0.5})`; g.fillRect(R() * c.width, R() * c.height, 2 + R() * 5, 2 + R() * 3); }
  g.globalCompositeOperation = 'source-over';
  return tex(c);
}

function skylineTexture(seed) {
  const [c, g] = canvas(64, 128), R = rng(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 12) for (let x = 5; x < 58; x += 13) if (R() < 0.09) { g.fillStyle = '#ffd98a'; g.fillRect(x, y, 6, 7); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t;
}

const coneShader = {
  uniforms: { h: { value: 12.6 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform float h; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ float t = clamp((vY + h*0.5)/h, 0.0, 1.0); float f = pow(abs(dot(vN, vV)), 2.5);
      float a = 0.06 * f * (0.15 + 0.85*t*t); gl_FragColor = vec4(vec3(1.0,0.86,0.6)*a, a); }`,
};

export function buildWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.sky, 40, 120);

  scene.add(new THREE.HemisphereLight(0x8f9be0, 0x2a2420, 1.55));
  const spot = new THREE.SpotLight(0xffd9a3, 2.6, 0, 0.72, 0.55, 0);
  spot.position.set(0, 13.2, 4.5); spot.target.position.set(0, 0, 3.6);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.camera.near = 5; spot.shadow.camera.far = 22;
  scene.add(spot, spot.target);
  const rimLight = new THREE.DirectionalLight(0x9db4ff, 0.7); rimLight.position.set(-6, 9, -10); scene.add(rimLight);   // moonlight from behind, lifts silhouettes off the wall

  // ground + court
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x1d1e25 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshLambertMaterial({ map: courtTexture() }));
  court.rotation.x = -Math.PI / 2; court.position.set(0, 0.004, 5.9); court.receiveShadow = true; scene.add(court);

  // hoop: steel pole, white board with ink edge, orange rim
  const metal = toon(0x3a3d4a), ink = new THREE.MeshBasicMaterial({ color: PAL.ink });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.95, 12), metal); pole.position.set(0, 1.97, -2.05);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.65), metal); arm.position.set(0, 3.75, -1.25);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.05), toon(0xf3f2ee)); board.position.set(0, 3.45, -0.4);
  const boardBack = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.17, 0.04), ink); boardBack.position.set(0, 3.45, -0.43);
  const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.45), new THREE.MeshBasicMaterial({ color: 0xff7a1a })); sq.position.set(0, 3.3, -0.372);
  const sqIn = new THREE.Mesh(new THREE.PlaneGeometry(0.49, 0.35), new THREE.MeshBasicMaterial({ color: 0xf3f2ee })); sqIn.position.set(0, 3.3, -0.371);
  const rimM = toon(0xff5a1f);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.022, 8, 32), rimM); rim.rotation.x = Math.PI / 2; rim.position.set(RIM.x, RIM.y, RIM.z);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), rimM); bracket.position.set(0, 3.03, -0.3);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.44, 12, 4, true), new THREE.MeshBasicMaterial({ color: 0xf3f2ee, wireframe: true }));
  const netPivot = new THREE.Group(); netPivot.position.set(0, RIM.y, 0); net.position.y = -0.22; netPivot.add(net);
  for (const m of [pole, arm, board, bracket, rim]) m.castShadow = true;
  scene.add(pole, arm, board, boardBack, sq, sqIn, rim, bracket, netPivot);

  // streetlight on a pole with an arm over the key
  const lpole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 13.4, 10), metal); lpole.position.set(-9.4, 6.7, 4.5);
  const larm = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.14, 0.14), metal); larm.position.set(-4.7, 13.35, 4.5);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.35, 20), metal); head.position.set(0, 13.4, 4.5);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
  lens.rotation.x = Math.PI / 2; lens.position.set(0, 13.22, 4.5);
  scene.add(lpole, larm, head, lens);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(8.6, 12.6, 40, 1, true),
    new THREE.ShaderMaterial({ ...coneShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  cone.position.set(0, 13.2 - 6.3, 4.1); scene.add(cone);

  // moths in the light
  const N = 90, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { const r = Math.sqrt(Math.random()) * 3.2, a = Math.random() * 6.28; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 7 + Math.random() * 5.5; pos[i * 3 + 2] = 4.5 + Math.sin(a) * r; seed[i] = Math.random() * 100; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff1d0, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false })));

  // brick wall with the mural behind the hoop; chain-link down both sides
  const WW = 22, WH = 5.4;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshBasicMaterial({ map: wallTexture(WW, WH), color: 0xd9d9d9 }));
  wall.position.set(0, WH / 2, -3.4); wall.receiveShadow = true; scene.add(wall);
  const coping = new THREE.Mesh(new THREE.BoxGeometry(WW + 0.3, 0.2, 0.5), toon(0x4a4d5c)); coping.position.set(0, WH + 0.1, -3.5); scene.add(coping);
  const ft = fenceTexture();
  const fenceMat = (w) => { const t = ft.clone(); t.needsUpdate = true; t.repeat.set(w / 0.35, 4.2 / 0.35); return new THREE.MeshBasicMaterial({ color: 0x8087a0, map: t, alphaMap: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }); };
  const fence = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 4.2), fenceMat(w)); m.position.set(x, 2.1, z); m.rotation.y = ry; scene.add(m); };
  fence(18, -9.2, 5.7, Math.PI / 2); fence(18, 9.2, 5.7, Math.PI / 2);
  const rail = (len, x, z, ry) => { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), metal); r.position.set(x, 4.2, z); r.rotation.y = ry; scene.add(r); };
  rail(18, -9.2, 5.7, Math.PI / 2); rail(18, 9.2, 5.7, Math.PI / 2);
  for (const x of [-9.2, 9.2]) for (const z of [-3.2, 1.3, 5.8, 10.3, 14.7]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), metal); p.position.set(x, 2.1, z); scene.add(p); }

  // scoreboard bolted to the wall: the score is part of the world, so it shows up in clips
  const [sc, sg] = canvas(512, 192), scoreTex = tex(sc);
  const sbBack = new THREE.Mesh(new THREE.BoxGeometry(2.56, 1.04, 0.12), ink); sbBack.position.set(2.75, 4.02, -3.3); scene.add(sbBack);
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: scoreTex })); sb.position.set(2.75, 4.02, -3.23); scene.add(sb);
  // the board sits above the mural's link sign on the right
  function setScore(a = 0, b = 0, nameA = 'YOU', nameB = 'CPU', colA = PAL.yolk, colB = PAL.red) {
    sg.fillStyle = PAL.ink; sg.fillRect(0, 0, 512, 192);
    sg.fillStyle = colA; sg.fillRect(8, 8, 244, 176); sg.fillStyle = colB; sg.fillRect(260, 8, 244, 176);
    sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillStyle = PAL.ink;
    sg.font = `900 132px ${DISPLAY}`; sg.fillText(String(a), 130, 112); sg.fillText(String(b), 382, 112);
    sg.font = `900 34px ${DISPLAY}`; sg.fillText(String(nameA).slice(0, 9), 130, 30); sg.fillText(String(nameB).slice(0, 9), 382, 30);
    scoreTex.needsUpdate = true;
  }
  setScore();

  // paper-cut skyline in two layers, a low moon, a few stars
  const layer = (z, col, hMin, hMax, n, spread, seed) => {
    const R = rng(seed), wt = skylineTexture(seed);
    for (let i = 0; i < n; i++) {
      const w = 4 + R() * 6, h = hMin + R() * (hMax - hMin), t = wt.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(w / 3.5)), Math.max(1, Math.round(h / 7))); t.offset.set(R(), R());
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, fog: false }));
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6 }));
      const x = -spread + (i + R() * 0.6) * (2 * spread / n);
      m.position.set(x, h / 2, z); win.position.set(x, h / 2, z + 0.05); scene.add(m, win);
    }
  };
  layer(-62, 0x232a55, 16, 44, 22, 95, 3);
  layer(-34, 0x0c0f22, 9, 26, 20, 70, 8);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {     // blocks down the sides, behind the fences
    const h = 9 + ((i * 7 + (side > 0 ? 3 : 0)) % 11), m = new THREE.Mesh(new THREE.BoxGeometry(6, h, 8), new THREE.MeshBasicMaterial({ color: 0x0c0f22 }));
    m.position.set(side * 26, h / 2, -8 + i * 9); scene.add(m);
  }
  const moon = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshBasicMaterial({ color: 0xf6e7b4, fog: false })); moon.position.set(-24, 30, -80); scene.add(moon);
  const SN = 140, sp = new Float32Array(SN * 3), SR = rng(21);
  for (let i = 0; i < SN; i++) { sp[i * 3] = -110 + SR() * 220; sp[i * 3 + 1] = 28 + SR() * 60; sp[i * 3 + 2] = -85; }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf3f2ee, size: 2.2, sizeAttenuation: false, fog: false })));

  // bench by the side fence
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 2.6), toon(0x9a6a3a)); bench.position.set(8.5, 0.46, 7); bench.castShadow = true; scene.add(bench);
  for (const z of [5.9, 8.1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.08), metal); l.position.set(8.5, 0.22, z); scene.add(l); }

  let netKick = 0, rimShake = 0;
  return {
    scene, rim, netPivot, setScore,
    swish() { netKick = 1; },
    clank() { rimShake = 1; },
    update(dt, t) {
      netKick = Math.max(0, netKick - dt * 2.6);
      netPivot.scale.y = 1 + Math.sin(netKick * 9) * 0.35 * netKick;
      netPivot.rotation.z = Math.sin(t * 1.3) * 0.02 + Math.sin(rimShake * 30) * 0.06 * rimShake;
      rimShake = Math.max(0, rimShake - dt * 3);
      rim.position.y = RIM.y + Math.sin(rimShake * 40) * 0.012 * rimShake;
      const p = dustGeo.attributes.position.array;
      for (let i = 0; i < N; i++) { const s = seed[i]; p[i * 3] += Math.sin(t * 2.1 + s) * dt * 0.7; p[i * 3 + 1] += Math.cos(t * 1.7 + s * 2) * dt * 0.5; p[i * 3 + 2] += Math.cos(t * 2.4 + s) * dt * 0.7; }
      dustGeo.attributes.position.needsUpdate = true;
    },
  };
}

function numberPlane(n) {
  const [c, g] = canvas(128, 128);
  g.font = "900 92px Impact, 'Arial Black', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(String(n), 64, 70); g.fillStyle = '#fff'; g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, depthWrite: false }));
}

// Jointed baller: pelvis > abdomen > chest > neck > head, shoulder > elbow > wrist, hip > knee > ankle.
// Rest pose: limbs hang straight down, character faces +z. Local +x is the character's left side ("P").
export function makeBaller(color, skin, number = 0) {
  const root = new THREE.Group();
  const jersey = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 0.7 });
  const skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const shoeM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, emissive: color, emissiveIntensity: 0.35 });
  const sockM = new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.85 });
  const cap = (r, len, mat, y) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.y = y; return m; };
  const joint = (parent, x, y, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const pelvis = joint(root, 0, 0.95);
  const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.3, 14), dark); shorts.position.y = 0.0; shorts.scale.z = 0.85; pelvis.add(shorts);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 14), jersey); waist.position.y = 0.15; waist.scale.z = 0.85; pelvis.add(waist);
  const abdomen = joint(pelvis, 0, 0.14);
  const belly = cap(0.2, 0.12, jersey, 0.1); belly.scale.set(1.1, 1, 0.75); abdomen.add(belly);
  const chest = joint(abdomen, 0, 0.2);
  const torso = cap(0.24, 0.2, jersey, 0.16); torso.scale.set(1.22, 1, 0.74); chest.add(torso);
  const num = numberPlane(number); num.position.set(0, 0.16, -0.186); num.rotation.y = Math.PI; chest.add(num);
  const numF = numberPlane(number); numF.scale.setScalar(0.7); numF.position.set(0, 0.2, 0.186); chest.add(numF);
  const neck = joint(chest, 0, 0.42);
  neck.add(cap(0.058, 0.06, skinM, 0.03));
  const head = joint(neck, 0, 0.12);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 14), skinM); skull.position.y = 0.06; skull.scale.set(0.95, 1.05, 1); head.add(skull);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.04, 18), jersey); band.position.y = 0.11; head.add(band);

  const arm = side => {
    const sh = joint(chest, 0.29 * side, 0.32);
    sh.add(cap(0.08, 0.02, jersey, -0.01));                                   // shoulder cap / sleeve
    sh.add(cap(0.06, 0.18, skinM, -0.15));                                    // upper arm
    const el = joint(sh, 0, -0.3);
    el.add(cap(0.052, 0.17, skinM, -0.13));                                   // forearm
    const wr = joint(el, 0, -0.28);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), skinM); hand.position.y = -0.05; hand.scale.set(0.8, 1.1, 0.6); wr.add(hand);
    const tip = joint(wr, 0, -0.08);                                          // palm point (ball contact)
    return { sh, el, wr, tip };
  };
  const leg = side => {
    const hip = joint(pelvis, 0.12 * side, -0.04);
    const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.22, 12), dark); shortLeg.position.y = -0.09; hip.add(shortLeg);
    hip.add(cap(0.085, 0.24, skinM, -0.2));                                   // thigh
    const knee = joint(hip, 0, -0.42);
    knee.add(cap(0.068, 0.26, skinM, -0.19));                                 // shin
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.07, 0.12, 10), sockM); sock.position.y = -0.34; knee.add(sock);
    const ankle = joint(knee, 0, -0.42);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.28), shoeM); shoe.position.set(0, -0.03, 0.05); ankle.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.025, 0.29), new THREE.MeshStandardMaterial({ color: 0x111111 })); sole.position.set(0, -0.075, 0.05); ankle.add(sole);
    return { hip, knee, ankle };
  };
  const m = { root, pelvis, abdomen, chest, neck, head, arms: { P: arm(1), N: arm(-1) }, legs: { P: leg(1), N: leg(-1) } };
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  num.castShadow = numF.castShadow = false;
  return m;
}

export function makeRing(color) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  r.rotation.x = -Math.PI / 2; r.position.y = 0.02; return r;
}

export function makeBall() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#f07a1c'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = PAL.ink; g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(192, 0); g.lineTo(192, 128); g.stroke();
  g.beginPath(); g.ellipse(128, 64, 40, 64, 0, 0, Math.PI * 2); g.stroke();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), toon(0xffffff, { map: tex(c) }));
  const o = new THREE.Mesh(new THREE.SphereGeometry(0.133, 20, 14), new THREE.MeshBasicMaterial({ color: PAL.ink, side: THREE.BackSide })); m.add(o);
  m.castShadow = true; return m;
}
