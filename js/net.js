// Online play plumbing: a WebRTC data channel between two browsers, set up through the public PeerJS broker.
// Nothing here is loaded or contacted until a player opens "Play a friend online".
// The broker only sees a random room code; game data goes directly between the two devices.
const PREFIX = 'qtrush-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no look-alikes (0/O, 1/I/L)
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  loading ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => { loading = null; rej(new Error('load')); }; document.head.append(s);
  });
  return loading;
}

// Host: claim a room code and wait. onConn(conn) fires when a friend's channel is open.
export async function hostRoom(onConn, onError) {
  await loadPeer();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newCode(), peer = new window.Peer(PREFIX + code);
    const ok = await new Promise(res => {
      peer.on('open', () => res(true));
      peer.on('error', err => { if (err.type === 'unavailable-id') res(false); else { onError(err); res(null); } });
    });
    if (ok === false) { peer.destroy(); continue; }       // code taken, roll another
    if (ok === null) { peer.destroy(); return null; }
    peer.on('connection', conn => conn.on('open', () => onConn(conn)));
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* gone */ } });
    return { peer, code };
  }
  onError(new Error('no-code')); return null;
}

// Guest: connect to a friend's room code. Resolves with { peer, conn } once the channel is open.
export async function joinRoom(code, timeoutMs = 15000) {
  await loadPeer();
  const peer = new window.Peer();
  return new Promise((res, rej) => {
    const fail = why => { clearTimeout(timer); peer.destroy(); rej(new Error(why)); };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    peer.on('error', err => fail(err.type === 'peer-unavailable' ? 'no-room' : err.type || 'error'));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + cleanCode(code), { reliable: true, serialization: 'json' });
      conn.on('open', () => { clearTimeout(timer); res({ peer, conn }); });
    });
  });
}
