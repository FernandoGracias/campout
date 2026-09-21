import * as THREE from 'three';
import { createNameLabel, updateNameLabel } from './player-labels.js';
import { disposeObject } from './game-utils.js';
import { buildMinigameProp } from './minigame-models.js';

const GAMES = [
  ['tag', 'Tag', 'One camper is IT. Touch someone to pass it on. No immediate tag-backs.'],
  ['freeze-tag', 'Freeze tag', 'Touch opponents to freeze them; touch teammates to thaw them. A frozen team loses 1 point; the other gains 1.'],
  ['hide-seek', 'Hide and seek', '30 seconds to hide, then 3 minutes to seek. Touch hiders to find them. The seeker rotates each round.'],
  ['sledding', 'Sledding', 'Race down the foothill on a sled. Steer by looking, push forward, pull back to brake. Winter required.'],
  ['race', 'Race', 'Run through the flags. In winter, put on skates and follow the lake and river around the globe.'],
  ['christmas', 'Christmas decorations', 'Choose a decoration here, then place it with the interaction prompt. Creations stay in the world.'],
  ['halloween', 'Halloween decorations', 'Choose a decoration here, then place it with the interaction prompt. Creations stay in the world.'],
  ['snowman', 'Build a snowman', 'Start a snowball, walk to roll it bigger, then stack three balls and add a face and hat. Winter required.'],
  ['flashlight-tag', 'Flashlight freeze tag', 'Nighttime team freeze tag. Shine your flashlight on opponents; touch teammates to thaw them.'],
];
const PALETTES = {
  christmas: [['lights', 'String lights'], ['ornament', 'Ornament'], ['wreath', 'Wreath'], ['christmas-tree', 'Christmas tree']],
  halloween: [['pumpkin', 'Pumpkin'], ['lantern', 'Lantern'], ['ghost', 'Ghost'], ['web', 'Cobweb']],
};
const TEAM_MODES = new Set(['freeze-tag', 'flashlight-tag']);
const COMPETITIVE = new Set(['tag', 'freeze-tag', 'hide-seek', 'race', 'sledding', 'flashlight-tag']);
const UP = new THREE.Vector3(0, 1, 0);

export function createMinigames(world) {
  let state = null, elapsed = 0, sentAt = -1, contactedAt = -1, menuAt = -1;
  let selectedProp = 'lights', removeMode = false, roundKey = '', countdown = '';
  let sledSpeed = 0, previousSkates = null, gateKey = '';
  const props = new Map(), markers = new Map(), sleds = new Map();
  const gate = buildMinigameProp('gate');
  const gateLabel = createNameLabel('START', '#f0c040');
  gateLabel.material.depthTest = true;
  gateLabel.position.set(0, 1.8, 0); gateLabel.scale.set(2, 0.5, 1);
  gate.add(gateLabel); gate.visible = false; world.globePivot.add(gate);
  const list = document.getElementById('minigames-list');
  const template = list.firstElementChild.cloneNode(true);
  const here = () => UP.clone().applyQuaternion(world.getRotation().clone().invert());
  const member = () => state?.roster?.[world.localId];
  const mode = () => state?.mode;
  const send = message => world.send({ ...message, epoch: state?.epoch });
  const localPoint = () => here().multiplyScalar(world.player.userData.groundY || world.player.position.y);
  function surface(direction) {
    world.globePivot.updateWorldMatrix(true, false);
    const d = direction.clone().normalize().applyQuaternion(world.getRotation());
    const ray = new THREE.Raycaster(d.clone().multiplyScalar(32), d.clone().negate(), 0, 20);
    const hit = ray.intersectObject(world.globe, false)[0];
    return hit ? hit.point.length() : 20;
  }
  function place(object, position) {
    const p = new THREE.Vector3(...position), n = p.clone().normalize();
    object.position.copy(p);
    object.quaternion.setFromUnitVectors(UP, n);
  }
  function groundPosition(direction) {
    const n = direction.clone().normalize();
    const height = Math.max(surface(n), world.winter.enabled ? world.winter.iceRadius : world.waterRadius);
    return n.multiplyScalar(height + 0.02);
  }
  function clearGround(direction) {
    if (surface(direction) < world.waterRadius + 0.08) return false;
    const p = direction.clone().normalize().multiplyScalar(20);
    return !world.getColliders().some(c => p.distanceTo(world.latLonToWorld(c.lat, c.lon)) < c.radius + 0.65);
  }
  function tangentBasis(center) {
    const x = new THREE.Vector3().crossVectors(center, Math.abs(center.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
    return [x, new THREE.Vector3().crossVectors(center, x).normalize()];
  }
  function courseFor(game) {
    if (game === 'race' && world.winter.enabled) return [];
    if (game === 'sledding') {
      const top = world.latLonToWorld(-0.3, 2.5).normalize(), [x, z] = tangentBasis(top);
      let best = null, bestDrop = 0;
      for (let turn = 0; turn < 48; turn++) {
        const direction = x.clone().multiplyScalar(Math.cos(turn * Math.PI / 24)).addScaledVector(z, Math.sin(turn * Math.PI / 24));
        const route = [], height = surface(top);
        let lastHeight = height;
        for (let step = 0; step <= 12; step++) {
          const p = top.clone().multiplyScalar(20).addScaledVector(direction, step * 0.9).normalize();
          const nextHeight = surface(p);
          if (!clearGround(p) || nextHeight > lastHeight + 0.15) break;
          route.push(p.toArray()); lastHeight = nextHeight;
        }
        if (route.length >= 9 && height - lastHeight > Math.max(1, bestDrop)) { best = route; bestDrop = height - lastHeight; }
      }
      return best;
    }
    // Find a clear loop on the existing land, sampling the real terrain and
    // colliders. No terrain edits and no straight-line route through the lake.
    const origin = here(), [x, z] = tangentBasis(origin);
    for (let attempt = 0; attempt < 80; attempt++) {
      const angle = attempt * 2.4, offset = Math.floor(attempt / 8) * 2;
      const center = origin.clone().multiplyScalar(20).addScaledVector(x, Math.cos(angle) * offset).addScaledVector(z, Math.sin(angle) * offset).normalize();
      const [a, b] = tangentBasis(center), radius = 3.5 + attempt % 3;
      const route = [];
      for (let i = 0; i <= 48; i++) {
        const theta = i / 48 * Math.PI * 2;
        const p = center.clone().multiplyScalar(20).addScaledVector(a, Math.cos(theta) * radius).addScaledVector(b, Math.sin(theta) * radius).normalize();
        if (!clearGround(p)) break;
        route.push(p.toArray());
      }
      if (route.length === 49) return route.filter((_, i) => i % 2 === 0);
    }
    return null;
  }
  function renderMenu() {
    const oldKey = world.getSelectedKey?.();
    const fragment = document.createDocumentFragment();
    const add = (key, title, description, action, value) => {
      const row = template.cloneNode(true);
      row.dataset.key = key; row.dataset.action = action; row.dataset.value = value;
      row.firstElementChild.textContent = title;
      row.lastElementChild.textContent = description;
      row.lastElementChild.style.whiteSpace = 'pre-line';
      fragment.append(row);
    };
    for (const [id, title, description] of GAMES) {
      const vote = state?.vote?.mode === id ? state.vote : null;
      let text = description;
      if (mode() === id) {
        text += `\n${state.phase === 'hiding' ? 'Hiding' : state.phase === 'results' ? 'Results' : state.phase === 'countdown' ? 'Starting' : 'Playing'} · Round ${state.round}`;
        if (state.it) text += ` · ${state.roster[state.it]?.name || 'Camper'} is ${id === 'tag' ? 'IT' : 'seeking'}`;
        if (TEAM_MODES.has(id)) text += `\nRed ${state.scores.red} · Blue ${state.scores.blue}`;
        if (['race', 'sledding', 'hide-seek'].includes(id)) {
          const racers = Object.values(state.roster).sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.checkpoint - a.checkpoint);
          text += '\n' + racers.map(p => `${p.name}: ${p.spectator ? 'watching' : id === 'hide-seek' ? `${p.score} points${p.found ? ' · found' : ''}` : p.finish !== null ? `${(p.finish / 1000).toFixed(1)}s` : `${p.checkpoint}/${state.course.length} checkpoints`}`).join('\n');
        }
      }
      if (vote) text += `\n${vote.yes.length}/${Math.floor(vote.eligible.length / 2) + 1} votes needed · ${Math.max(0, Math.ceil((vote.expiresAt - world.now()) / 1000))}s${vote.yes.includes(world.localId) ? ' · You voted' : ' · Select to vote yes'}`;
      add(id, `${mode() === id ? 'Playing · ' : ''}${title}`, text, 'vote', id);
    }
    if (mode()) {
      const vote = state.vote?.mode === 'camping' ? state.vote : null;
      add('camping', 'Back to camping', vote ? `${vote.yes.length}/${Math.floor(vote.eligible.length / 2) + 1} votes needed · Select to vote yes` : 'Vote to end the current activity for everyone.', 'vote', 'camping');
    }
    for (const [id, name] of PALETTES[mode()] || []) add(`prop-${id}`, `${selectedProp === id && !removeMode ? 'Selected · ' : ''}${name}`, 'Select, close this menu, and place using the interaction prompt.', 'prop', id);
    if (PALETTES[mode()] || mode() === 'snowman') add('remove', removeMode ? 'Selected · Remove creation' : 'Remove creation', 'Remove a nearby creation you placed. The world creator can remove any creation.', 'remove', '');
    list.replaceChildren(fragment);
    world.restoreSelection?.(oldKey);
  }
  function select(row) {
    if (!row) return;
    if (row.dataset.action === 'prop') { selectedProp = row.dataset.value; removeMode = false; world.closeMenu(); return; }
    if (row.dataset.action === 'remove') { removeMode = !removeMode; world.closeMenu(); return; }
    const game = row.dataset.value;
    if (game === mode()) { world.toast(GAMES.find(g => g[0] === game)?.[2] || ''); return; }
    if (!world.online()) { world.toast('Mini games need the updated room server and an active connection.'); return; }
    let course = [];
    if (['race', 'sledding'].includes(game) && !state?.vote) {
      course = courseFor(game);
      if (!course) { world.toast('No clear course here. Try open ground away from the lake and camps.'); return; }
    }
    send({ type: 'minigame-vote', mode: game, course });
  }
  function teleport(direction, faceTarget = null) {
    world.preparePlayer();
    const n = new THREE.Vector3(...direction).normalize();
    world.getRotation().setFromUnitVectors(n, UP);
    if (faceTarget) {
      const next = new THREE.Vector3(...faceTarget).applyQuaternion(world.getRotation());
      world.setFacing(Math.atan2(next.x, next.z));
    }
    world.winter.stop(); sledSpeed = 0;
  }
  function receive(message) {
    if (message.type === 'minigame-notice') { world.toast(message.message); return; }
    if (message.type === 'minigame-correction') {
      if (state?.epoch === message.epoch && state.iceRace && Array.isArray(message.position)) {
        teleport(message.position, state.course[member()?.checkpoint]); world.toast(message.message);
      }
      return;
    }
    const next = message.state;
    if (!next || !Number.isSafeInteger(next.revision) || state && next.revision < state.revision) return;
    const previous = mode();
    state = next;
    if (previous !== mode()) {
      removeMode = false;
      selectedProp = PALETTES[mode()]?.[0][0] || 'lights';
      if (previousSkates !== null && !state.iceRace) { world.winter.setSkates(previousSkates); previousSkates = null; }
      world.restoreVisibility();
      if (COMPETITIVE.has(mode())) { world.preparePlayer(); world.closeMenu(); }
      if (mode() === 'flashlight-tag') world.readyFlashlight();
      world.refreshTeams();
    }
    const key = `${state.epoch}:${state.round}:${world.localId}`;
    if (roundKey !== key) {
      roundKey = key; countdown = ''; sledSpeed = 0;
      world.restoreVisibility();
      if (mode() === 'flashlight-tag') world.readyFlashlight();
      if (['race', 'sledding'].includes(mode()) && member() && !member().spectator && state.phase === 'countdown' && state.course.length) {
        if (state.iceRace && previousSkates === null) previousSkates = world.winter.skating;
        // Stagger the starting grid along the broad lake mouth / hillside.
        const index = Math.max(0, Object.keys(state.roster).sort().indexOf(world.localId));
        const start = new THREE.Vector3(...state.course[0]);
        const forward = new THREE.Vector3(...state.course[1]).addScaledVector(start, -new THREE.Vector3(...state.course[1]).dot(start)).normalize();
        const side = new THREE.Vector3().crossVectors(start, forward).normalize();
        const position = start.multiplyScalar(20).addScaledVector(side, (index % 3 - 1) * 0.65).addScaledVector(forward, -Math.floor(index / 3) * 0.7).normalize();
        teleport(position.toArray(), state.course[1]);
        if (state.iceRace) world.winter.setSkates(true);
      }
    }
    syncProps(); renderMenu(); world.refreshScores();
    if (message.message) world.toast(message.message);
  }
  function syncProps() {
    const ids = new Set((state?.creations || []).map(o => o.id));
    for (const [id, model] of props) if (!ids.has(id)) { disposeObject(model); props.delete(id); }
    for (const object of state?.creations || []) {
      let model = props.get(object.id);
      if (!model) { model = buildMinigameProp(object.kind); props.set(object.id, model); world.globePivot.add(model); }
      const position = object.base || object.position;
      place(model, position);
      if (object.kind === 'snowman') {
        for (let i = 0; i < 3; i++) {
          const b = model.userData.balls[i];
          b.visible = object.complete || i <= object.stage;
          b.scale.setScalar(!object.complete && i === object.stage ? 0.25 + 0.75 * object.growth : 1);
          b.position.set(0, [0.5, 1.24, 1.79][i], 0);
          if (!object.complete && i === object.stage) {
            const p = new THREE.Vector3(...object.position).sub(model.position).applyQuaternion(model.quaternion.clone().invert());
            b.position.copy(p); b.position.y += [0.55, 0.4, 0.28][i] * b.scale.x;
          }
        }
        model.userData.accessories.visible = !!object.complete;
      }
    }
  }
  function locked() {
    const p = member();
    if (!p || !mode()) return false;
    if (!world.online()) return true;
    if (p.frozen || p.found || p.finish !== null) return true;
    if (state.phase === 'countdown' || state.phase === 'results') return !p.spectator;
    return mode() === 'hide-seek' && state.phase === 'hiding' && state.it === world.localId;
  }
  function nearbyRemoval() {
    const position = localPoint();
    return (state?.creations || []).filter(o => o.owner === world.localId || world.canEditWorld())
      .filter(o => position.clone().normalize().distanceTo(new THREE.Vector3(...(o.base || o.position)).normalize()) * 20 < 2)
      .sort((a, b) => position.distanceTo(new THREE.Vector3(...a.position)) - position.distanceTo(new THREE.Vector3(...b.position)))[0];
  }
  function interaction() {
    if (!mode() || world.menuOpen() || locked() || !world.canInteract()) return null;
    let action;
    if (removeMode) {
      const object = nearbyRemoval();
      if (!object) return null;
      action = 'Remove creation';
    } else if (PALETTES[mode()]) action = `Place ${PALETTES[mode()].find(p => p[0] === selectedProp)?.[1] || 'decoration'}`;
    else if (mode() === 'snowman') {
      const ball = state.creations.find(o => o.holder === world.localId && !o.complete);
      const abandoned = state.creations.some(o => o.kind === 'snowman' && !o.complete && !o.holder && localPoint().distanceTo(new THREE.Vector3(...o.position)) < 2);
      action = !ball ? abandoned ? 'Continue snowman' : 'Start snowball' : ball.growth < 1 ? `Roll snowball · ${Math.floor(ball.growth * 100)}%` : ball.base && here().distanceTo(new THREE.Vector3(...ball.base).normalize()) * 20 > 2 ? 'Roll back to snowman' : ball.stage === 2 ? 'Finish snowman' : 'Stack snowball';
    } else return null;
    const point = world.player.position.clone().add(new THREE.Vector3(0, 1.6, 0)).project(world.camera);
    return { type: 'minigame', action, screen: point };
  }
  function interact() {
    if (!interaction()) return false;
    if (removeMode) {
      const object = nearbyRemoval();
      if (object) send({ type: 'minigame-build', action: 'remove', id: object.id });
    } else if (mode() === 'snowman') send({ type: 'minigame-build', action: 'snowball' });
    else {
      const forward = new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing())).applyQuaternion(world.getRotation().clone().invert());
      const direction = here().multiplyScalar(20).addScaledVector(forward, 1.1).normalize();
      if (!clearGround(direction) && !world.player.userData.onIce) { world.toast('Choose clear ground for this decoration.'); return true; }
      send({ type: 'minigame-build', action: 'place', kind: selectedProp, position: groundPosition(direction).toArray() });
    }
    return true;
  }
  function pose() {
    if (!world.online()) return;
    const inverse = world.getRotation().clone().invert();
    send({ type: 'minigame-pose', position: localPoint().toArray(),
      heading: new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing())).applyQuaternion(inverse).toArray(),
      flashlight: world.flashlightOn(), ice: !!world.player.userData.onIce, skates: world.winter.skating,
      snow: world.winter.snowy && !world.player.userData.onIce });
  }
  function visibleContact(target, beam) {
    const a = world.player.position.clone().addScaledVector(UP, 0.8);
    const b = target.mesh.position.clone().addScaledVector(target.mesh.position.clone().normalize(), 0.8);
    const direction = b.clone().sub(a), distance = direction.length();
    if (distance > (beam ? 9 : 1.2) || distance < 0.01) return false;
    direction.normalize();
    if (beam && direction.dot(new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing()))) < Math.cos(Math.PI * 0.08)) return false;
    const ray = new THREE.Raycaster(a, direction, 0, Math.max(0, distance - 0.15));
    return ray.intersectObjects([world.globe, ...world.getObstacles()], true).length === 0;
  }
  function contacts() {
    if (!['tag', 'freeze-tag', 'flashlight-tag', 'hide-seek'].includes(mode()) || !['playing', 'seeking'].includes(state.phase) || locked() || member()?.spectator) return;
    if (['tag', 'hide-seek'].includes(mode()) && state.it !== world.localId) return;
    for (const [id, peer] of Object.entries(world.getPeers())) {
      const target = state.roster[id];
      if (!target || target.spectator || target.found || !peer.mesh.visible) continue;
      const sameTeam = target.team === member()?.team;
      if (TEAM_MODES.has(mode()) && (sameTeam ? !target.frozen : target.frozen)) continue;
      const beam = mode() === 'flashlight-tag' && !sameTeam;
      if (beam && !world.flashlightOn()) continue;
      if (visibleContact(peer, beam)) { send({ type: 'minigame-contact', target: id }); break; }
    }
  }
  function updateMarkers() {
    const campers = [[world.localId, { mesh: world.player, nameLabel: world.localLabel }], ...Object.entries(world.getPeers())];
    const ids = new Set(campers.map(([id]) => id));
    for (const [id, label] of markers) if (!ids.has(id)) { disposeObject(label); markers.delete(id); }
    for (const [id, p] of campers) {
      const role = state?.roster?.[id];
      const text = mode() === 'tag' && state.it === id ? 'IT' : role?.frozen ? 'FROZEN' : mode() === 'hide-seek' && state.it === id ? 'SEEKER' : '';
      let label = markers.get(id);
      if (text && !label) { label = createNameLabel(text, '#f0c040'); label.material.depthTest = true; world.scene.add(label); markers.set(id, label); }
      if (label) {
        label.visible = !!text && p.mesh.visible;
        if (text) {
          updateNameLabel(label, text, role?.frozen ? '#8bd7ff' : '#f0c040');
          label.position.copy(p.mesh.position).addScaledVector(p.mesh.position.clone().normalize(), 1.8);
          label.scale.set(1.5, 0.375, 1);
        }
      }
      if (mode() === 'hide-seek') {
        p.nameLabel.visible = false;
        if (role?.found || role?.spectator) { p.mesh.visible = false; if (p.torch) p.torch.visible = false; }
      }
      if (role?.frozen) {
        for (const limb of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm']) p.mesh.userData[limb].rotation.set(0, 0, 0);
      }
      let sled = sleds.get(id);
      const onSled = mode() === 'sledding' && role && !role.spectator;
      if (onSled && !sled) { sled = buildMinigameProp('sled'); p.mesh.add(sled); sleds.set(id, sled); }
      if (sled) sled.visible = !!onSled;
      if (onSled) {
        p.mesh.userData.leftLeg.rotation.x = p.mesh.userData.rightLeg.rotation.x = -Math.PI / 2;
        p.mesh.userData.leftArm.rotation.x = p.mesh.userData.rightArm.rotation.x = -0.6;
      }
    }
    for (const [id, sled] of sleds) if (!ids.has(id)) { disposeObject(sled); sleds.delete(id); }
  }
  function updateGate() {
    const p = member();
    const index = state?.phase === 'countdown' ? 0 : p?.checkpoint;
    const direction = state?.course?.[index];
    gate.visible = !!direction && ['race', 'sledding'].includes(mode()) && !p?.spectator && state.phase !== 'results';
    if (!gate.visible) return;
    const key = `${state.epoch}:${index}`;
    if (gateKey === key) return;
    gateKey = key;
    const n = new THREE.Vector3(...direction);
    place(gate, groundPosition(n).toArray());
    const next = new THREE.Vector3(...state.course[Math.min(index + 1, state.course.length - 1)]);
    const tangent = next.sub(n).applyQuaternion(gate.quaternion.clone().invert());
    gate.rotateY(Math.atan2(tangent.x, tangent.z));
    updateNameLabel(gateLabel, index === 0 ? 'START' : index === state.course.length - 1 ? 'FINISH' : `${index}/${state.course.length - 1}`, '#f0c040');
  }
  function update(delta) {
    elapsed += delta;
    if (mode() && world.online() && elapsed - sentAt > 0.12) { sentAt = elapsed; pose(); }
    if (elapsed - contactedAt > 0.22) { contactedAt = elapsed; contacts(); }
    if (world.menuOpen() && elapsed - menuAt > 1) { menuAt = elapsed; renderMenu(); }
    if (state && ['countdown', 'hiding'].includes(state.phase)) {
      const seconds = Math.max(0, Math.ceil((state.startsAt - world.now()) / 1000));
      if (seconds !== countdown && (seconds <= 5 || state.phase === 'hiding' && seconds % 10 === 0)) {
        countdown = seconds;
        if (seconds > 0) world.toast(state.phase === 'hiding' ? `${seconds}s to hide` : String(seconds), 950);
      }
    }
    if (state?.iceRace && member() && !member().spectator) world.winter.setSkates(true);
    updateMarkers(); updateGate();
  }
  function sledMovement(forward, strafe, facing, delta, blocked) {
    if (mode() !== 'sledding' || !member() || member().spectator) return null;
    if (blocked || locked()) { sledSpeed = 0; return new THREE.Vector2(); }
    const heading = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing)).applyQuaternion(world.getRotation().clone().invert());
    const p = here(), next = p.clone().multiplyScalar(20).addScaledVector(heading, 0.5).normalize();
    const slope = (surface(p) - surface(next)) / 0.5;
    sledSpeed = THREE.MathUtils.clamp(sledSpeed + (slope * 0.25 + Math.max(0, -forward) * 0.12 - Math.max(0, forward) * 0.8 - 0.035) * delta, 0, 0.46);
    const steering = facing - strafe * 0.5;
    return new THREE.Vector2(-Math.cos(steering), -Math.sin(steering)).multiplyScalar(sledSpeed);
  }
  function allowMove(rotation) {
    if (!state?.iceRace || !member() || member().spectator || state.phase !== 'playing') return true;
    const direction = UP.clone().applyQuaternion(rotation.clone().invert());
    return surface(direction) < world.winter.iceRadius;
  }
  function sync() { if (world.online()) world.send({ type: 'minigame-sync', active: true, team: world.getTeam() }); }
  function reset() {
    if (previousSkates !== null) world.winter.setSkates(previousSkates);
    previousSkates = null; state = null; roundKey = ''; gateKey = ''; sledSpeed = 0;
    world.restoreVisibility(); world.refreshTeams(); world.refreshScores();
    renderMenu();
  }
  renderMenu();
  return { receive, select, renderMenu, sync, reset, update, locked, interaction, interact, sledMovement, allowMove,
    get competitive() { return COMPETITIVE.has(mode()); },
    get iceRace() { return !!state?.iceRace && !!member() && !member().spectator; },
    get night() { return mode() === 'flashlight-tag'; },
    get blind() { return mode() === 'hide-seek' && state.phase === 'hiding' && state.it === world.localId; },
    get spectator() { return member()?.spectator || member()?.found; },
    get active() { return !!mode(); },
  };
}
