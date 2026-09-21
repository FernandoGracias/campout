import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const networking = moduleSource.slice(moduleSource.indexOf('const SIGNAL_SERVER'), moduleSource.indexOf('// --- GAME INITIALIZATION'));
const credentials = { iceServers: [{ urls: 'turn:test', username: 'initial', credential: 'temporary' }], refreshAfterMs: 3000000 };
const tick = () => new Promise(resolve => setImmediate(resolve));

function browser() {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', value: '', disabled: false, addEventListener() {} });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    handlers = new Map();
    sent = [];
    constructor(url) { this.url = url; }
    addEventListener(type, fn) { this.handlers.set(type, fn); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.handlers.get('close')?.({ reason: 'test closed' }); }
    message(data) { this.handlers.get('message')({ data: JSON.stringify(data) }); }
  }
  class PC {
    signalingState = 'stable';
    offers = [];
    constructor(config) { this.config = structuredClone(config); }
    setConfiguration(config) { this.config = structuredClone(config); }
    async createOffer(options) { this.offers.push(options); return { type: 'offer', sdp: 'valid' }; }
    async setLocalDescription(sdp) { this.localDescription = sdp; this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(sdp) {
      if (sdp.sdp === 'bad') throw new Error('Invalid SDP');
      this.remoteDescription = sdp;
      this.signalingState = sdp.type === 'answer' ? 'stable' : 'have-remote-offer';
    }
    async createAnswer() { return { type: 'answer', sdp: 'valid' }; }
    async addIceCandidate() {}
    createDataChannel() { return { readyState: 'open', bufferedAmount: 0, close() {} }; }
    close() { this.signalingState = 'closed'; }
  }
  const context = vm.createContext({
    window: { location: { search: '' } },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    showToast() {},
    createLobbyWeather: () => ({ sync() {} }),
    createLaunchPreview: () => ({ dispose() {} }),
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    console: { error() {}, log() {}, warn() {} },
    WebSocket: Socket, RTCPeerConnection: PC,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++timerId, clearInterval() {},
    AbortSignal,
  });
  vm.runInContext(networking, context);
  vm.runInContext("roomId = '0123456789ab'; showLobby();", context);
  const ws = context.window.__mp.signalingWs;
  ws.handlers.get('open')();
  return { context, ws, element, timers };
}

async function admitted() {
  const fixture = browser();
  fixture.ws.message({ type: 'room-info', id: 'middle', seed: 0, ...credentials });
  fixture.ws.message({ type: 'ready' });
  await tick();
  return fixture;
}

test('complete browser module parses', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: moduleSource, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('snowball deltas update the current section and reject stale rounds or stages', async () => {
  const { context, ws } = await admitted();
  const received = [];
  context.snapshot = { revision: 1, epoch: 7, creations: [{ id: 'ball', kind: 'snowman', stage: 0, holder: 'camper', complete: false, growth: 0, position: [0, 20, 0] }] };
  vm.runInContext('minigameProtocol = 1; sharedMinigame = snapshot;', context);
  context.window.receiveMinigameEvent = m => received.push(m);
  const delta = { type: 'minigame-snowball', epoch: 7, revision: 2, id: 'ball', stage: 0, holder: 'camper', position: [0.5, 20, 0], growth: 0.1 };
  ws.message(delta); await tick();
  assert.equal(context.snapshot.creations[0].growth, 0.1);
  assert.equal(context.snapshot.revision, 2);
  for (const bad of [{ revision: 1 }, { epoch: 6, revision: 3 }, { stage: 1, revision: 3 }, { holder: 'other', revision: 3 }]) ws.message({ ...delta, ...bad });
  await tick();
  assert.equal(received.length, 1);
  assert.equal(context.snapshot.revision, 2);
});

test('bump packets carry a shared 3D axis and dispatch without changing peer membership', () => {
  const { context } = browser();
  const sent = [];
  const received = [];
  context.channel = { readyState: 'open', send: data => sent.push(JSON.parse(data)) };
  context.window.receiveBump = (id, msg) => received.push({ id, msg });
  vm.runInContext("setupDataChannel('camper', channel); sendBump('camper', { x: 0, y: 0.6, z: 0.8 });", context);
  assert.deepEqual(sent, [{ type: 'bump', dx: 0, dz: 0, axis: [0, 0.6, 0.8] }]);
  context.channel.onmessage({ data: JSON.stringify(sent[0]) });
  assert.equal(received[0].id, 'camper');
  assert.deepEqual(Array.from(received[0].msg.axis), [0, 0.6, 0.8]);
  for (const axis of [null, [0, 0, 0], [0, 2, 0], [0, 1], ['0', 1, 0]]) {
    context.channel.onmessage({ data: JSON.stringify({ type: 'bump', dx: 0, dz: 0, axis }) });
  }
  assert.equal(received.length, 1);
  assert.equal(vm.runInContext('dataChannels.camper === channel', context), true);
});

test('simultaneous bumps do not restart the reaction or send another impulse', () => {
  const axis = { clone() { return this; }, negate() { return this; } };
  let now = 0;
  let sends = 0;
  const context = vm.createContext({
    performance: { now: () => now }, axis,
    winter: { collide: () => false, stop() {} }, sittingFireId: null, minigames: null,
    otherPlayers: { camper: {} }, remoteCampStates: {}, isSleeping: false,
    walkingToTent: true, playerBounceState: null, sendBump() { sends++; },
  });
  vm.runInContext(moduleSource.slice(moduleSource.indexOf('const BUMP_DURATION'),
    moduleSource.indexOf('window.receiveBump =')), context);
  vm.runInContext("startPlayerBump('camper', axis, true); playerBounceState.elapsed = 0.2; startPlayerBump('camper', axis, false);", context);
  assert.equal(context.playerBounceState.elapsed, 0.2);
  assert.equal(context.otherPlayers.camper.bump.elapsed, 0);
  assert.equal(context.walkingToTent, false);
  assert.equal(sends, 1);
  context.playerBounceState = null;
  now = 700;
  vm.runInContext("startPlayerBump('camper', axis, true)", context);
  assert.equal(context.playerBounceState, null);
  now = 900;
  vm.runInContext("startPlayerBump('camper', axis, true)", context);
  assert.equal(sends, 2);
});

test('sled motion accepts bounded lift and pitch and strips malformed airborne data', () => {
  const { context } = browser();
  const received = [];
  context.received = received;
  context.channel = { readyState: 'open', bufferedAmount: 0, send() {} };
  vm.runInContext("handleGameMessage = (id, data) => received.push(data); setupDataChannel('camper', channel);", context);
  const motion = { phase: 0, rate: 0, amplitude: 0.5, waddle: 0.04, swing: 0, roll: 0,
    flashlight: false, skating: true, sledding: true, sledLift: 2, sledPitch: -0.4, ghostVacuum: true, ghostAim: [0, 1, 0] };
  const send = m => context.channel.onmessage({ data: JSON.stringify({ type: 'pos', qx: 0, qy: 0, qz: 0, qw: 1, facing: 0, motion: m }) });
  send(motion);
  assert.equal(received.at(-1).motion.sledLift, 2);
  for (const invalid of [{ sledLift: -1 }, { sledLift: 9 }, { sledLift: null }, { sledPitch: 1 }, { sledding: 'true' },
    { ghostVacuum: 'true' }, { ghostAim: [0, 0, 0] }, { ghostAim: [2, 0, 0] }, { ghostAim: [0, null, 1] }]) {
    send({ ...motion, ...invalid });
    assert.equal(received.at(-1).motion, undefined);
  }
});

test('retreat starts at contact and travels the same distance at different frame rates', () => {
  const context = vm.createContext({});
  vm.runInContext('const BUMP_TRAVEL_TIME = 0.28; ' + moduleSource.slice(
    moduleSource.indexOf('function bumpTravel('), moduleSource.indexOf('// Apply after the ordinary pose')), context);
  const travel = context.bumpTravel;
  assert.equal(travel(0), 0);
  assert.equal(travel(0.28), 1);
  assert.equal(travel(2), 1);
  for (const fps of [30, 60, 144]) {
    let distance = 0;
    let previous = 0;
    for (let frame = 1; frame <= fps; frame++) {
      const current = travel(frame / fps);
      assert.ok(current >= previous);
      distance += 0.32 * (current - previous);
      previous = current;
    }
    assert.ok(Math.abs(distance - 0.32) < 1e-12);
  }
});

test('client joins before receiving TURN credentials and waits for readiness and team assignment', async () => {
  const { context, ws, element } = browser();
  assert.match(ws.url, /\/api\/room\/0123456789ab$/);
  assert.equal(ws.sent[0].type, 'join');
  assert.equal(ws.sent[0].id, undefined);
  assert.equal(element('btn-enter-world').disabled, true);
  ws.message({ type: 'room-info', id: 'middle', seed: 0, ...credentials });
  await tick();
  assert.equal(context.window.__mp.localPlayerId, 'middle');
  assert.equal(ws.sent.at(-1).type, 'ready');
  assert.equal(element('btn-enter-world').disabled, true);
  ws.message({ type: 'ready' });
  await tick();
  assert.equal(element('btn-enter-world').disabled, true);
  vm.runInContext("teamAssignments.middle = 'red'; updateTeamLobby();", context);
  assert.equal(element('btn-enter-world').disabled, false);
  assert.equal(element('lobby-seed-display').textContent, 'seed: 0');
});

test('renewal updates existing connections, keeps direct-first policy and selects one restart initiator', async () => {
  const { context, ws, timers } = await admitted();
  ws.message({ type: 'peer-joined', id: 'a', name: 'A' });
  ws.message({ type: 'answer', from: 'a', sdp: { type: 'answer', sdp: 'valid' } });
  ws.message({ type: 'peer-joined', id: 'z', name: 'Z' });
  await tick();
  ws.sent.length = 0;
  ws.message({ type: 'turn-creds', ...credentials, iceServers: [{ urls: 'turn:test', username: 'renewed', credential: 'new' }] });
  await tick();
  for (const pc of Object.values(context.window.__mp.peerConnections)) {
    assert.equal(pc.config.iceServers[0].username, 'renewed');
    assert.equal(pc.config.iceTransportPolicy, 'all');
  }
  assert.equal(context.window.__mp.peerConnections.a.offers.at(-1).iceRestart, true);
  assert.equal(ws.sent.filter(m => m.type === 'offer').length, 1);
  assert.equal(ws.sent.find(m => m.type === 'restart-request').target, 'z');
  assert.ok([...timers.values()].some(timer => timer.delay === 3000000));
});

test('bad SDP from one peer does not disconnect the room or other peers', async () => {
  const { context, ws } = await admitted();
  ws.message({ type: 'peer-joined', id: 'z', name: 'Z' });
  ws.message({ type: 'peer-joined', id: 'y', name: 'Y' });
  ws.message({ type: 'offer', from: 'z', sdp: { type: 'offer', sdp: 'bad' } });
  await tick();
  assert.equal(ws.readyState, 1);
  assert.equal(context.window.__mp.peerConnections.z, undefined);
  assert.ok(context.window.__mp.peerConnections.y);
});

test('disconnect closes peer connections and cancels renewal', async () => {
  const { context, ws, timers, element } = await admitted();
  ws.message({ type: 'peer-joined', id: 'z', name: 'Z' });
  await tick();
  const pc = context.window.__mp.peerConnections.z;
  ws.close();
  assert.equal(pc.signalingState, 'closed');
  assert.equal(Object.keys(context.window.__mp.peerConnections).length, 0);
  assert.equal(timers.size, 0);
  assert.equal(element('btn-enter-world').disabled, true);
});
