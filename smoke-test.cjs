/* Smoke test: auth rate limit, async pbkdf2, reconnect token, payload fuzzing, full game round */
const path = require('path');
const { io } = require(path.join('F:/energy-duel/client/node_modules/socket.io-client'));

const BASE = 'http://127.0.0.1:3100';
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: token ? { token } : {}, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

function emitAck(s, event, data) {
  return new Promise(resolve => s.emit(event, data, resolve));
}

(async () => {
  // ---- 1. Auth: register + login (async pbkdf2) ----
  const uname = 'smk' + Date.now().toString(36).slice(-6);
  const reg = await post('/api/auth/register', { username: uname, password: 'testpass123' });
  check('register success', reg.body.success === true && !!reg.body.token);
  const login = await post('/api/auth/login', { identifier: uname, password: 'testpass123' });
  check('login success', login.body.success === true && !!login.body.token);
  const badLogin = await post('/api/auth/login', { identifier: uname, password: 'wrong' });
  check('wrong password rejected', badLogin.body.success === false);

  // ---- 2. Rate limit: 10/min per IP (already used ~3 attempts) ----
  let lastStatus = 0;
  for (let i = 0; i < 10; i++) {
    const r = await post('/api/auth/login', { identifier: uname, password: 'x' });
    lastStatus = r.status;
  }
  check('auth rate limit kicks in (429)', lastStatus === 429);

  // ---- 3. Room create + reconnect token ----
  const s1 = await connect(login.body.token);
  const created = await emitAck(s1, 'create_room', { nickname: '烟测甲', roomType: 'multi' });
  check('create_room returns reconnectToken', !!created.reconnectToken && created.reconnectToken.length === 32);

  // ---- 4. Rejoin with wrong token rejected ----
  const sEvil = await connect();
  const evil = await emitAck(sEvil, 'rejoin_room', { roomCode: created.roomCode, playerId: created.playerId, reconnectToken: 'deadbeef'.repeat(4) });
  check('rejoin with wrong token rejected', evil.success === false);
  const evilNoToken = await emitAck(sEvil, 'rejoin_room', { roomCode: created.roomCode, playerId: created.playerId });
  check('rejoin without token rejected', evilNoToken.success === false);

  // ---- 5. Payload fuzzing — server must survive ----
  sEvil.emit('submit_move', { moveId: 'yun', targets: 'not-an-array' });
  sEvil.emit('submit_move', { moveId: 123, targets: [1, 2, {}] });
  sEvil.emit('chat_message', { content: { evil: true }, scope: 'all' });
  sEvil.emit('chat_message', 'just-a-string');
  sEvil.emit('create_room', null);
  sEvil.emit('join_room', { nickname: ['x'], roomCode: 42 });
  sEvil.emit('rejoin_room', { roomCode: {}, playerId: null });
  sEvil.emit('set_llm_config', { endpoint: 123, apiKey: null, model: {} }, () => {});
  sEvil.emit('switch_team', { playerId: { $gt: '' } });
  sEvil.emit('add_bot', { level: 'godmode' });
  await sleep(500);
  const health = await fetch(BASE + '/health').then(r => r.json());
  check('server survives malformed payloads', health.status === 'ok');

  // ---- 6. LLM endpoint SSRF validation ----
  const ssrf1 = await emitAck(sEvil, 'set_llm_config', { endpoint: 'http://169.254.169.254/latest/meta-data', apiKey: 'k', model: 'm' });
  check('http endpoint rejected', ssrf1.success === false);
  const ssrf2 = await emitAck(sEvil, 'set_llm_config', { endpoint: 'https://192.168.1.1/api', apiKey: 'k', model: 'm' });
  check('private IP endpoint rejected', ssrf2.success === false);
  const ssrf3 = await emitAck(sEvil, 'set_llm_config', { endpoint: 'https://localhost:8080', apiKey: 'k', model: 'm' });
  check('localhost endpoint rejected', ssrf3.success === false);

  // ---- 7. Second player joins, game runs a full round ----
  const s2 = await connect();
  const joined = await emitAck(s2, 'join_room', { nickname: '烟测乙', roomCode: created.roomCode });
  check('join_room success + token', joined.success === true && !!joined.reconnectToken);

  const s1Events = { phase: [], over: null };
  s1.on('phase_change', d => s1Events.phase.push(d.phase));
  s1.on('game_over', d => { s1Events.over = d; });

  s1.emit('add_bot', { level: 'easy' });
  await sleep(200);
  s1.emit('start_game');
  await sleep(500);
  check('game started (thinking phase)', s1Events.phase.includes('thinking'));

  // Both humans submit 运, bot auto-submits → round resolves
  s1.emit('submit_move', { moveId: 'yun', targets: [] });
  s2.emit('submit_move', { moveId: 'yun', targets: [] });
  await sleep(1000);
  check('result phase reached after all submitted', s1Events.phase.includes('result'));

  // ---- 8. Legit rejoin with correct token (simulate refresh) ----
  s1.disconnect();
  await sleep(300);
  const s1b = await connect(login.body.token);
  const rejoin = await emitAck(s1b, 'rejoin_room', { roomCode: created.roomCode, playerId: created.playerId, reconnectToken: created.reconnectToken });
  check('rejoin with correct token succeeds', rejoin.success === true);

  // ---- 9. Chat still works + validation ----
  let chatOk = false;
  s2.on('chat_broadcast', m => { if (m.content === '你好') chatOk = true; });
  s1b.emit('chat_message', { content: '你好', scope: 'all' });
  await sleep(400);
  check('chat broadcast works', chatOk);

  // ---- 10. Nickname validation ----
  const s3 = await connect();
  s3.emit('create_room', { nickname: 'a'.repeat(30), roomType: 'duo' }, () => {});
  let nickErr = false;
  s3.on('error', d => { if (d.message.includes('昵称')) nickErr = true; });
  await sleep(300);
  check('overlong nickname rejected', nickErr);

  const finalHealth = await fetch(BASE + '/health').then(r => r.json());
  check('server healthy at end', finalHealth.status === 'ok');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
