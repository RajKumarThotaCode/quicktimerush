// Mocap-driven baller: Quaternius UAL mannequin (CC0) + Mixamo/UAL clips baked into assets/baller.glb
// by tools/build-baller.mjs. Each clip is split into an UPPER and a LOWER layer so legs can run while
// arms dribble. After the mixer, procedural layers go on top: two-bone arm IK (hand on the ball, jumper
// set point, contests, rim hang), spine lean/twist for moves, scrubbed jump/fall clips synced to game state.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { clone as skClone } from '../vendor/addons/utils/SkeletonUtils.js';

const HEIGHT = 1.98;                                   // standing height in metres (old rig was ~2.0)
const UPPER = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky|neck|Head|spine_03)/;
const LOOP = new Set(['idle', 'uIdle', 'defIdle', 'dribble', 'dribbleL', 'walk', 'run', 'sprint', 'uSprint', 'uWalk', 'slideL', 'slideR', 'cheer', 'victory', 'dance', 'jumpLoop']);
// natural ground speed of each locomotion clip (m/s) so feet don't skate; timeScale = speed / natural
const NATURAL = { walk: 1.5, run: 3.6, sprint: 6.6, slideL: 3.0, slideR: 3.0 };
const REGION = { shirt: /^(spine|clavicle)/, shorts: /^(pelvis|thigh)/, shoe: /^(foot|ball)/ };

let T = null;   // template

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _q = Q(), _q2 = Q(), _q3 = Q();
const UP = new THREE.Vector3(0, 1, 0);

function split(clip) {
  const keep = re => clip.tracks.filter(t => re(t.name.split('.')[0]));
  const U = new THREE.AnimationClip(clip.name + '.U', clip.duration, keep(n => UPPER.test(n)));
  const L = new THREE.AnimationClip(clip.name + '.L', clip.duration, keep(n => !UPPER.test(n)));
  return { U, L, dur: clip.duration };
}

// find crouch / takeoff / landing in a jump clip from the pelvis height, then remove the height gain
// (the game lifts the whole body itself) but keep the crouch.
function analyzeJump(clip, pelvis) {
  const tr = clip.tracks.find(t => t.name === pelvis.name + '.position'); if (!tr) return null;
  const up = pelvis.parent.worldToLocal(pelvis.parent.getWorldPosition(V()).add(UP)).sub(pelvis.parent.worldToLocal(pelvis.parent.getWorldPosition(V()))).normalize();
  const p0 = pelvis.position, v = tr.values, n = tr.times.length, h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = (v[i * 3] - p0.x) * up.x + (v[i * 3 + 1] - p0.y) * up.y + (v[i * 3 + 2] - p0.z) * up.z;
  const max = Math.max(...h), thr = max * 0.35;
  let iUp = h.findIndex(x => x > thr), iDown = n - 1 - [...h].reverse().findIndex(x => x > thr);
  if (iUp < 0) { iUp = Math.floor(n * 0.4); iDown = Math.floor(n * 0.6); }
  let iC = 0; for (let i = 0; i < iUp; i++) if (h[i] < h[iC]) iC = i;
  for (let i = 0; i < n; i++) if (h[i] > 0) { v[i * 3] -= up.x * h[i]; v[i * 3 + 1] -= up.y * h[i]; v[i * 3 + 2] -= up.z * h[i]; }
  const t = tr.times;
  return { crouch: t[iC], up: t[iUp], down: t[iDown], end: clip.duration };
}

export async function loadRig(url) {
  const g = await new GLTFLoader().loadAsync(url);
  const scene = g.scene; scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); }); scene.updateMatrixWorld(true);
  let pelvis = null; scene.traverse(o => { if (o.isBone && o.name === 'pelvis') pelvis = o; });
  const box = new THREE.Box3().setFromObject(scene), scale = HEIGHT / (box.max.y - box.min.y);
  const clips = {}, jumps = {};
  for (const c of g.animations) {
    if (/^jump$/.test(c.name)) jumps[c.name] = analyzeJump(c, pelvis);
    clips[c.name] = split(c);
  }
  // geometry-space size, used to make the ink outline a constant world thickness
  let geoH = 1; scene.traverse(o => { if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; geoH = Math.max(geoH === 1 ? 0 : geoH, b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z); } });
  let headY = 0; scene.traverse(o => { if (o.isBone && o.name === 'Head') headY = o.getWorldPosition(new THREE.Vector3()).y * scale; });
  T = { scene, clips, jump: jumps.jump, scale, geoH, headY };
  return T;
}

// ---------- IK helpers ----------
function swingTo(bone, childWorld, wantWorld) {          // rotate bone (world space) so child points at wantWorld
  const p = bone.getWorldPosition(_a);
  const v1 = _b.subVectors(childWorld, p).normalize(), v2 = _c.subVectors(wantWorld, p).normalize();
  _q.setFromUnitVectors(v1, v2);
  bone.getWorldQuaternion(_q2); _q.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q));
  bone.updateMatrixWorld(true);
}
function twoBone(arm, palm, pole, w, aimDir = null) {
  if (w <= 0.001) return;
  const { up, lo, hand, tip, la, lb } = arm;
  const q0u = up.quaternion.clone(), q0l = lo.quaternion.clone(), q0h = hand.quaternion.clone();
  // wrist target = palm target minus the current wrist->palm offset
  const off = tip.getWorldPosition(V()).sub(hand.getWorldPosition(V()));
  const target = V().copy(palm).sub(off);
  const S = up.getWorldPosition(V()), dir = V().subVectors(target, S);
  const c = clamp(dir.length(), 0.05, (la + lb) * 0.999); dir.normalize();
  const cosA = clamp((la * la + c * c - lb * lb) / (2 * la * c), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pp = V().copy(pole).addScaledVector(dir, -pole.dot(dir)); if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0); pp.normalize();
  const elbow = V().copy(S).addScaledVector(dir, la * cosA).addScaledVector(pp, la * sinA);
  swingTo(up, lo.getWorldPosition(V()), elbow);
  swingTo(lo, hand.getWorldPosition(V()), V().copy(S).addScaledVector(dir, c));
  if (aimDir) swingTo(hand, arm.knuckle.getWorldPosition(V()), hand.getWorldPosition(V()).add(aimDir));
  if (w < 0.999) {
    up.quaternion.slerpQuaternions(q0u, up.quaternion.clone(), w);
    lo.quaternion.slerpQuaternions(q0l, lo.quaternion.clone(), w);
    hand.quaternion.slerpQuaternions(q0h, hand.quaternion.clone(), w);
    up.updateMatrixWorld(true);
  }
}
function worldRotate(bone, axis, angle) {                // extra rotation about a world axis
  if (Math.abs(angle) < 1e-4) return;
  _q.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q2); _q.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q));
}

// ---- look: cel shading, ink outline, hair ----
let _ramp = null;
function ramp() {                                         // 3-step toon ramp
  if (_ramp) return _ramp;
  const d = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  _ramp = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat); _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter; _ramp.needsUpdate = true; return _ramp;
}
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp(), ...extra });
function inkMaterial(width) {
  const m = new THREE.MeshBasicMaterial({ color: 0x0e0f13, side: THREE.BackSide });
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed += normalize(normal) * ${width.toFixed(5)};`); };
  return m;
}
const HAIR_COLOR = 0x1a1512;
function buildHair(style, r, bandMat) {
  const g = new THREE.Group(), mat = toon(HAIR_COLOR), add = (geo, x, y, z, m = mat) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const cap = (h = 0.5, s = 1.06) => { const o = add(new THREE.SphereGeometry(r * s, 18, 10, 0, Math.PI * 2, 0, Math.PI * h), 0, 0, 0); o.rotation.x = -0.32; return o; };
  if (style === 'Buzz') cap(0.46, 1.09);
  else if (style === 'Fade') { cap(0.4, 1.05); const top = add(new THREE.CylinderGeometry(r * 0.7, r * 0.84, r * 0.34, 16), 0, r * 0.8, -r * 0.1); top.rotation.x = -0.18; }
  else if (style === 'Afro') { cap(0.5, 1.08); const a = add(new THREE.SphereGeometry(r * 1.42, 18, 14), 0, r * 0.55, -r * 0.22); a.scale.set(1.05, 0.95, 1); }
  else if (style === 'Bun') { cap(0.48, 1.05); add(new THREE.SphereGeometry(r * 0.42, 12, 10), 0, r * 1.02, -r * 0.62); }
  else if (style === 'Locs') {
    cap(0.5, 1.07);
    for (let i = 0; i < 13; i++) {
      const a = Math.PI * (0.42 + 1.16 * i / 12), len = r * (1.15 + (i % 3) * 0.22);     // around the back, ear to ear
      const l = add(new THREE.CapsuleGeometry(r * 0.13, len, 3, 6), Math.cos(a) * r * 0.98, r * 0.1 - len * 0.45, -Math.sin(a) * r * 0.98 - r * 0.05);
      l.rotation.z = Math.cos(a) * 0.18; l.rotation.x = -Math.sin(a) * 0.14;
    }
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.3 + 0.4 * i / 4); add(new THREE.CapsuleGeometry(r * 0.13, r * 0.5, 3, 6), Math.cos(a) * r * 0.55, r * 0.98, -r * 0.1 + (i % 2) * r * 0.2).rotation.z = Math.PI / 2 - a; }
  }
  if (bandMat) { const b = add(new THREE.CylinderGeometry(r * 0.98, r * 1.02, r * 0.26, 20, 1, true), 0, r * 0.05, -r * 0.02, bandMat); b.rotation.x = -0.22; bandMat.side = THREE.DoubleSide; }
  g.scale.setScalar(0.97);
  return g;
}

function numberPlane(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.font = "900 104px 'Big Shoulders Display', Impact, sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.lineJoin = 'round'; g.strokeStyle = '#0e0f13'; g.strokeText(String(n), 64, 68); g.fillStyle = '#f3f2ee'; g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
}

// ---------- the baller ----------
export function makeRigBaller(color, skin, number = 0) {
  const root = new THREE.Group();
  const model = skClone(T.scene); model.scale.setScalar(T.scale); root.add(model);
  const bones = {}; let mesh = null;
  model.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // one vertex-coloured material per player: jersey / shorts / skin / shoes by each vertex's main bone
  const meshes = []; model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp() });
  const ink = inkMaterial(0.014 * T.geoH / HEIGHT), outlines = [];
  const regions = [];
  for (const m of meshes) {
    m.geometry = m.geometry.clone(); m.material = mat; mesh = m;
    const o = new THREE.SkinnedMesh(m.geometry, ink); o.bind(m.skeleton, m.bindMatrix); o.frustumCulled = false;
    o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale); m.parent.add(o); outlines.push(o);
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count;
    const reg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const name = m.skeleton.bones[best].name;
      reg[i] = REGION.shirt.test(name) ? 0 : REGION.shorts.test(name) ? 1 : REGION.shoe.test(name) ? 3 : 2;
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    regions.push([g, reg]);
  }
  const cols = [new THREE.Color(color), new THREE.Color(0x191a21), new THREE.Color(skin), new THREE.Color(0xf3f2ee)];
  function paint() {
    for (const [g, reg] of regions) { const a = g.attributes.color; for (let i = 0; i < reg.length; i++) { const c = cols[reg[i]]; a.setXYZ(i, c.r, c.g, c.b); } a.needsUpdate = true; }
  }
  paint();

  root.updateMatrixWorld(true);
  const tipOf = (hand, knuckle) => { const t = new THREE.Object3D(); hand.add(t); t.position.copy(hand.worldToLocal(knuckle.getWorldPosition(V()).lerp(hand.getWorldPosition(V()), 0.25))); return t; };
  const arm = s => {
    const a = { up: bones['upperarm_' + s], lo: bones['lowerarm_' + s], hand: bones['hand_' + s], knuckle: bones['middle_01_' + s] };
    a.la = a.up.getWorldPosition(V()).distanceTo(a.lo.getWorldPosition(V()));
    a.lb = a.lo.getWorldPosition(V()).distanceTo(a.hand.getWorldPosition(V()));
    a.tip = tipOf(a.hand, a.knuckle); return a;
  };
  const arms = { P: arm('l'), N: arm('r') };   // P = character's left (+x at rest), as in the old rig
  // jersey number on the back, riding the chest bone
  const chest = bones.spine_03, cy = chest.getWorldPosition(V()).y;
  const back = numberPlane(number); back.position.set(0, cy + 0.04, -0.175); back.rotation.y = Math.PI; root.add(back); chest.attach(back);

  // hair + headband ride the Head bone
  const headR = (HEIGHT - T.headY) * 0.5, bandMat = toon(color);
  const hairAnchor = new THREE.Group(); hairAnchor.position.set(0, T.headY + headR * 1.24, headR * 0.04); root.add(hairAnchor); bones.Head.attach(hairAnchor);
  let hair = null;
  function setLook({ hair: style = 'Fade', skin: sk, band = true } = {}) {
    if (hair) { hairAnchor.remove(hair); hair.traverse(o => o.geometry && o.geometry.dispose()); }
    hair = buildHair(style, headR, band ? bandMat : null); hairAnchor.add(hair);
    if (sk != null) { cols[2].set(sk); paint(); }
  }
  setLook({ hair: 'Fade' });

  // actions: two per clip (upper / lower)
  const mixer = new THREE.AnimationMixer(model);
  const L = {}, U = {}, t = {}, wL = {}, wU = {};
  for (const [k, c] of Object.entries(T.clips)) {
    L[k] = mixer.clipAction(c.L); U[k] = mixer.clipAction(c.U);
    for (const a of [L[k], U[k]]) { a.play(); a.enabled = false; a.setEffectiveWeight(0); }
    t[k] = 0; wL[k] = 0; wU[k] = 0;
  }
  wL.idle = wU.idle = 1;
  const st = { stumbleMax: 0, prevStumble: 0, prevSpecial: null, overPick: null };

  function blend(w, tgt, k) {
    let sum = 0;
    for (const n in w) { w[n] += ((tgt[n] || 0) - w[n]) * k; if (w[n] < 0.002) w[n] = 0; sum += w[n]; }
    if (sum < 1e-3) { w.idle = 1; sum = 1; }
    for (const n in w) w[n] /= sum;
  }

  const rig = {
    root, isRig: true, arms, model, bones,
    setColor(c) { cols[0].set(c); bandMat.color.set(c); paint(); },
    setLook, setOutline(on) { for (const o of outlines) o.visible = on; },
    // e = game entity, c = context from main.js (has, defending, near, won, ball, time, mode, landT, scripted)
    update(e, c, dt) {
      const sp = Math.hypot(e.vx, e.vz), face = e.face;
      const F = _d.set(Math.sin(face), 0, Math.cos(face)), Lf = _e.set(Math.cos(face), 0, -Math.sin(face));
      const fv = e.vx * F.x + e.vz * F.z, lv = e.vx * Lf.x + e.vz * Lf.z;
      const air = e.y > 0.05 || e.shooting || e.hangT > 0;
      const tl = {}, tu = {}; let rate = 12;
      let scrub = {};                                        // clip -> fixed time this frame

      // ---- pick clips ----
      if (e.stumble > st.prevStumble + 0.01) st.stumbleMax = e.stumble;
      st.prevStumble = e.stumble;
      let special = null;
      if (e.stumble > 0) {
        const p = 1 - e.stumble / (st.stumbleMax || 1);
        if (st.stumbleMax >= 0.6) { special = 'ankles'; scrub.ankles = p < 0.55 ? lerp(0.2, 1.35, p / 0.55) : lerp(2.3, 3.3, (p - 0.55) / 0.45); }
        else { special = 'stumble'; scrub.stumble = lerp(0.15, 0.9, p); }
        rate = 30;
      } else if (c.won === true && !air) special = c.mode === 'over' ? (st.overPick ||= Math.random() < 0.5 ? 'victory' : 'dance') : 'cheer';
      else if (c.won === false && !air) special = 'defeated';
      if (c.mode !== 'over') st.overPick = null;
      if (special && special !== st.prevSpecial) t[special] = 0;
      st.prevSpecial = special;

      if (special) { tl[special] = tu[special] = 1; }
      else {
        // lower body
        if (air) {
          const J = T.jump; let jt;
          if (e.shooting) jt = lerp(J.crouch, J.up + 0.08, clamp(e.meter / (c.green || 0.78), 0, 1));
          else jt = lerp(J.up + 0.05, J.down - 0.03, clamp(0.5 - e.vy / 8, 0, 1));
          scrub.jump = jt; tl.jump = 1; rate = 25;
        } else if (c.landT > 0) {
          const J = T.jump; scrub.jump = lerp(J.down, Math.min(J.end, J.down + 0.3), 1 - c.landT / 0.18); tl.jump = 1; rate = 30;
        } else if (sp < 0.35) {
          tl[c.defending ? 'defIdle' : c.has ? (e.hand > 0 ? 'dribbleL' : 'dribble') : 'idle'] = 1;
        } else {
          const lateral = Math.abs(lv) > Math.abs(fv) * 1.1 && (c.defending || c.has);
          if (lateral) tl[lv > 0 ? 'slideL' : 'slideR'] = 1;
          else if (e.sprint && sp > 4) tl.sprint = 1;
          else if (sp < 1.9 && !c.defending) tl.walk = 1;
          else tl.run = 1;
          if (c.defending && sp < 1.2) { tl.defIdle = 1 - sp / 1.2; }
        }
        // upper body
        if (c.has && !e.shooting) tu[e.hand > 0 ? 'dribbleL' : 'dribble'] = 1;
        else if (c.defending && !air) tu.defIdle = 1;
        else if (air) { tu.jump = 1; scrub.jump ??= T.jump.up; }
        else Object.assign(tu, tl);
        if (e.bumpCd > 0.3 && c.has) { tu.hit = 1; scrub.hit = clamp((0.6 - e.bumpCd) / 0.3, 0, 1) * T.clips.hit.dur; }
      }

      // ---- advance clip times ----
      for (const k in t) {
        if (!(wL[k] > 0 || wU[k] > 0 || tl[k] || tu[k])) continue;
        const dur = T.clips[k].dur;
        if (k in scrub) { t[k] = Math.min(scrub[k], dur - 1e-3); continue; }
        let r = 1;
        if (NATURAL[k]) r = clamp((k.startsWith('slide') ? Math.abs(lv) : sp) / NATURAL[k], 0.55, 1.7) * (k === 'run' && fv < -0.5 && !e.sprint ? -1 : 1);
        if (k === 'dribble' || k === 'dribbleL') r = c.near ? 1.35 : 1.1;
        t[k] += dt * r;
        t[k] = LOOP.has(k) ? ((t[k] % dur) + dur) % dur : Math.min(t[k], dur - 1e-3);
      }
      const k = 1 - Math.exp(-dt * rate);
      blend(wL, tl, k); blend(wU, tu, k);
      for (const n in t) {
        const a = L[n], b = U[n];
        a.enabled = wL[n] > 0; b.enabled = wU[n] > 0;
        if (a.enabled) { a.setEffectiveWeight(wL[n]); a.time = t[n]; }
        if (b.enabled) { b.setEffectiveWeight(wU[n]); b.time = t[n]; }
      }
      mixer.update(0);

      // ---- root ----
      root.position.set(e.x, e.y, e.z);
      root.updateMatrixWorld(true);

      // ---- procedural spine: lean + twist for moves ----
      let lean = 0, twist = 0;
      if (!special) {
        if (e.dashT > 0 && e.moveKind === 'STEPBACK') lean = -0.3;
        else if (e.dashT > 0 && ['CROSS', 'SLIDE', 'DRIVE', 'RECOVER'].includes(e.moveKind)) { twist = Math.sign(e.dx * Lf.x + e.dz * Lf.z) * 0.45; lean = 0.15; }
        if (e.dashDelay > 0) { lean = -0.18; twist = 0.25 * e.hand; }
        if (e.reachT > 0) { lean = 0.45; twist = -0.3; }
        if (c.has && c.near && !e.shooting) lean += 0.1;
      }
      st.lean = lerp(st.lean || 0, lean, 1 - Math.exp(-dt * 18)); st.twist = lerp(st.twist || 0, twist, 1 - Math.exp(-dt * 18));
      if (Math.abs(st.lean) > 1e-3 || Math.abs(st.twist) > 1e-3) {
        worldRotate(bones.spine_01, Lf, st.lean * 0.5); worldRotate(bones.spine_02, Lf, st.lean * 0.5);
        worldRotate(bones.spine_02, UP, st.twist * 0.6); worldRotate(bones.spine_03, UP, st.twist * 0.4);
        root.updateMatrixWorld(true);
      }

      // ---- arm IK ----
      const R = V().copy(Lf).negate(), base = V().set(e.x, e.y, e.z);
      const at = (u, f, l) => V().copy(base).addScaledVector(UP, u).addScaledVector(F, f).addScaledVector(Lf, l);
      const ballP = c.ball;
      st.ikP = st.ikP || 0; st.ikN = st.ikN || 0;
      let gP = 0, gN = 0, palmP = null, palmN = null, poleP = null, poleN = null, aimP = null, aimN = null;
      if (!special) {
        if (e.hangT > 0 && c.rim) {                                         // hanging on the rim
          const toMe = V().set(e.x - c.rim.x, 0, e.z - c.rim.z).normalize();
          palmN = V().copy(c.rim).addScaledVector(toMe, 0.2).addScaledVector(Lf, -0.17); palmP = V().copy(c.rim).addScaledVector(toMe, 0.2).addScaledVector(Lf, 0.17);
          gP = gN = 1; poleP = V().copy(Lf).addScaledVector(UP, -0.5); poleN = V().copy(R).addScaledVector(UP, -0.5);
        } else if (e.shooting) {
          const s2 = smooth((clamp(e.meter / (c.green || 0.78), 0, 1.2) - 0.25) / 0.6);
          if (e.lay) {
            const B = at(lerp(1.5, 2.45, s2), lerp(0.35, 0.5, s2), -0.12);
            palmN = V().copy(B).addScaledVector(UP, -0.1); palmP = V().copy(B).addScaledVector(Lf, 0.13).addScaledVector(UP, -0.02);
          } else {
            const B = at(lerp(1.25, 2.2, s2), lerp(0.42, 0.22, s2), lerp(-0.05, -0.12, s2));
            palmN = V().copy(B).addScaledVector(F, -0.11).addScaledVector(UP, -0.05); palmP = V().copy(B).addScaledVector(Lf, 0.12);
            aimN = V().copy(UP).multiplyScalar(lerp(0.2, 0.7, s2)).addScaledVector(F, lerp(0.8, -0.7, s2));
          }
          gP = gN = 1; poleN = V().copy(F).multiplyScalar(0.5).addScaledVector(UP, -0.8).addScaledVector(R, 0.25); poleP = V().copy(Lf).addScaledVector(UP, -0.4);
        } else if (e.followT > 0) {                                         // hold the follow-through
          palmN = at(2.2, 0.5, -0.12); palmP = at(1.95, 0.3, 0.2); gN = 1; gP = 0.7;
          aimN = V().copy(F).multiplyScalar(0.6).addScaledVector(UP, -0.8);
          poleN = V().copy(F).multiplyScalar(0.3).addScaledVector(UP, -0.8); poleP = V().copy(Lf).addScaledVector(UP, -0.5);
        } else if (air && !c.has) {                                         // contest / block: both hands up
          palmP = at(2.55, 0.28, 0.24); palmN = at(2.55, 0.28, -0.24); gP = gN = 1;
          poleP = V().copy(Lf).addScaledVector(F, 0.3); poleN = V().copy(R).addScaledVector(F, 0.3);
        } else if (e.reachT > 0) {                                          // steal swipe
          palmN = at(0.95, 0.9, -0.05); gN = 1; poleN = V().copy(R).addScaledVector(UP, -0.4);
        } else if (c.has && ballP) {                                        // hand rides the top of the dribble
          const rel = V().subVectors(ballP, base), side = rel.dot(Lf), h = ballP.y - e.y;
          const w = smooth((h - 0.38) / 0.38) * smooth(Math.abs(side) / 0.12);
          const palm = V().copy(ballP).addScaledVector(UP, 0.115);
          const aim = V().copy(F).multiplyScalar(0.6).addScaledVector(UP, -0.4);
          if (side > 0) { palmP = palm; gP = w; poleP = V().copy(Lf).addScaledVector(F, -0.6).addScaledVector(UP, -0.2); aimP = aim; }
          else { palmN = palm; gN = w; poleN = V().copy(R).addScaledVector(F, -0.6).addScaledVector(UP, -0.2); aimN = aim; }
        }
      }
      const kk = 1 - Math.exp(-dt * (e.shooting || e.followT > 0 || (c.has && !e.shooting) ? 40 : 16));
      st.ikP += (gP - st.ikP) * kk; st.ikN += (gN - st.ikN) * kk;
      st.palmP = palmP ? (st.palmP ? st.palmP.lerp(palmP, 0.7) : palmP.clone()) : st.palmP;
      st.palmN = palmN ? (st.palmN ? st.palmN.lerp(palmN, 0.7) : palmN.clone()) : st.palmN;
      if (st.palmP && st.ikP > 0.002) twoBone(arms.P, st.palmP, poleP || V().copy(Lf).addScaledVector(UP, -0.5), st.ikP, aimP);
      if (st.palmN && st.ikN > 0.002) twoBone(arms.N, st.palmN, poleN || V().copy(R).addScaledVector(UP, -0.5), st.ikN, aimN);
      root.updateMatrixWorld(true);
    },
  };
  return rig;
}

export const rigReady = () => !!T;
