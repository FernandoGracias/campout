import * as THREE from 'three';
import { createNameLabel, updateNameLabel } from './player-labels.js';
import { disposeObject } from './game-utils.js';
import { buildMinigameProp } from './minigame-models.js?v=237';
import { createSledFlight } from './sled-physics.js';
import { createSnowmanTracks } from './snowman-tracks.js';
import { createDecorationControl } from './decoration-control.js?v=232';
import { findWebAnchors, expandWebAnchors } from './decoration-anchors.js?v=236';
import { createPropCollisions } from './prop-collisions.js?v=236';
import { planLightPlacement, lightEndpoints, overlappingLightSpan } from './light-placement.js?v=236';
import { createDecorationGlow } from './decoration-glow.js?v=235';
import { createGhostCatching } from './ghost-catching.js?v=237';

const GAMES = [
  ['tag', 'Tag', 'One camper is IT. Touch someone to pass it on. No immediate tag-backs.'],
  ['freeze-tag', 'Freeze tag', 'Touch opponents to freeze them; touch teammates to thaw them. A frozen team loses 1 point; the other gains 1.'],
  ['hide-seek', 'Hide and seek', '30 seconds to hide, then 3 minutes to seek. Touch hiders to find them. The seeker rotates each round.'],
  ['sledding', 'Sledding', 'Race down the foothill. The skate button mounts or leaves your sled. Steer by looking, push forward, pull back to brake. Hills launch low-gravity jumps.'],
  ['race', 'Race', 'Run through the flags. In winter, put on skates and follow the lake and river around the globe.'],
  ['christmas', 'Christmas decorations', 'Cycle decorations with the side button, then place using the interaction prompt. Creations stay in the world.'],
  ['halloween', 'Halloween decorations', 'Cycle decorations with the side button, then place using the interaction prompt. Creations stay in the world.'],
  ['snowman', 'Build a snowman', 'Start a snowball, walk to roll it bigger, then stack three balls and add a face and hat. Winter required.'],
  ['flashlight-tag', 'Flashlight freeze tag', 'Nighttime team freeze tag. Shine your flashlight on opponents; touch teammates to thaw them.'],
  ['ghost-catching', 'Ghost catching', 'Night only (18:00–06:00). Hold the suction gun on a ghost within 10 units to catch it. Each catch earns your team 1 point.'],
];
const PALETTES = {
  christmas: [['lights', 'String lights'], ['ornament', 'Ornament'], ['wreath', 'Wreath'], ['christmas-tree', 'Christmas tree']],
  halloween: [['pumpkin', 'Pumpkin'], ['lantern', 'Lantern'], ['ghost', 'Ghost'], ['web', 'Cobweb']],
};
const TEAM_MODES = new Set(['freeze-tag', 'flashlight-tag']);
const COMPETITIVE = new Set(['tag', 'freeze-tag', 'hide-seek', 'race', 'sledding', 'flashlight-tag', 'ghost-catching']);
const UP = new THREE.Vector3(0, 1, 0);

export function createMinigames(world) {
  let state = null, elapsed = 0, sentAt = -1, contactedAt = -1, menuAt = -1;
  let selectedProp = 'lights', removeMode = false, roundKey = '', countdown = '';
  let sledMounted = false, previousSkates = null, gateKey = '', gateProgress = '';
  let sledPose = { lift: 0, pitch: 0 };
  const sledFlight = createSledFlight();
  const props = new Map(), markers = new Map(), sleds = new Map();
  const propCollisions = createPropCollisions();
  const decorationGlow = createDecorationGlow(world);
  let pendingLights = [];
  const gates = new THREE.Group();
  world.globePivot.add(gates);
  const list = document.getElementById('minigames-list');
  const template = list.firstElementChild.cloneNode(true);
  const here = () => UP.clone().applyQuaternion(world.getRotation().clone().invert());
  const member = () => state?.roster?.[world.localId];
  const mode = () => state?.mode;
  const send = message => world.send({ ...message, epoch: state?.epoch });
  const ghostGame = createGhostCatching({ ...world, getState: () => state, send,
    get localId() { return world.localId; },
    disableGlow: world.disableDecorationGlow,
    canUse: () => state?.phase === 'playing' && world.canInteract() && !world.menuOpen() && !locked(),
    getObstacles: () => [world.globe, ...world.getObstacles(), ...obstacles()] });
  const localPoint = () => here().multiplyScalar(world.player.userData.groundY || world.player.position.y);
  const snowTracks = createSnowmanTracks(world.globePivot, surface, world.mobile);
  const decorationControl = createDecorationControl(() => {
    if (!PALETTES[mode()]) return null;
    const choice = PALETTES[mode()].find(p => p[0] === selectedProp);
    return { id: choice[0], name: choice[1], disabled: removeMode || world.menuOpen() || !world.canInteract() };
  }, cycleDecoration, () => {
    if (!PALETTES[mode()] && mode() !== 'snowman') return null;
    return { active: removeMode, disabled: world.menuOpen() || !world.canInteract() };
  }, toggleDelete);
  function cycleDecoration() {
    const palette = PALETTES[mode()];
    if (!palette || removeMode || world.menuOpen() || !world.canInteract()) return false;
    const index = palette.findIndex(([id]) => id === selectedProp);
    const [id, name] = palette[(index + 1) % palette.length];
    selectedProp = id;
    decorationControl.update();
    world.toast(`${name} selected.`, 1500);
    return true;
  }
  function toggleDelete() {
    if ((!PALETTES[mode()] && mode() !== 'snowman') || world.menuOpen() || !world.canInteract()) return false;
    removeMode = !removeMode;
    decorationControl.update();
    world.toast(removeMode ? 'Delete decoration mode. Use the nearby creation prompt to delete.' : 'Delete decoration mode off.', 2500);
    return true;
  }
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
        if (TEAM_MODES.has(id) || id === 'ghost-catching') text += `\nRed ${state.scores.red} · Blue ${state.scores.blue}`;
        if (['race', 'sledding', 'hide-seek'].includes(id)) {
          const racers = Object.values(state.roster).sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.checkpoint - a.checkpoint);
          text += '\n' + racers.map(p => `${p.name}: ${p.spectator ? 'watching' : id === 'hide-seek' ? `${p.score} points${p.found ? ' · found' : ''}` : p.finish !== null ? `${(p.finish / 1000).toFixed(1)}s` : `${Math.max(0, p.checkpoint - (id === 'race' ? 1 : 0))}/${state.course.length - (id === 'race' ? 1 : 0)} checkpoints`}`).join('\n');
        }
      }
      if (vote) text += `\n${vote.yes.length}/${Math.floor(vote.eligible.length / 2) + 1} votes needed · ${Math.max(0, Math.ceil((vote.expiresAt - world.now()) / 1000))}s${vote.yes.includes(world.localId) ? ' · You voted' : ' · Select to vote yes'}`;
      add(id, `${mode() === id ? 'Playing · ' : ''}${title}`, text, 'vote', id);
    }
    if (mode()) {
      const vote = state.vote?.mode === 'camping' ? state.vote : null;
      add('camping', 'Back to camping', vote ? `${vote.yes.length}/${Math.floor(vote.eligible.length / 2) + 1} votes needed · Select to vote yes` : 'Vote to end the current activity for everyone.', 'vote', 'camping');
    }
    list.replaceChildren(fragment);
    world.restoreSelection?.(oldKey);
  }
  function select(row) {
    if (!row) return;
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
    world.winter.stop(); sledFlight.reset(); sledPose = { lift: 0, pitch: 0 };
  }
  function receive(message) {
    if (message.type === 'minigame-snowball') {
      const object = state?.creations.find(o => o.id === message.id);
      const model = object && props.get(object.id);
      if (model?.userData.rolling && object.stage === model.userData.rolling.stage) {
        model.userData.rolling.growth = Math.max(model.userData.rolling.growth, object.growth);
      }
      return;
    }
    if (message.type === 'minigame-notice') { pendingLights = []; world.toast(message.message); return; }
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
      pendingLights = [];
      if (previous === 'sledding') setSledMounted(false);
      removeMode = false;
      selectedProp = PALETTES[mode()]?.[0][0] || 'lights';
      if (previousSkates !== null) { world.winter.setSkates(previousSkates); previousSkates = null; }
      world.restoreVisibility();
      if (COMPETITIVE.has(mode())) { world.preparePlayer(); world.closeMenu(); }
      if (mode() === 'flashlight-tag') world.readyFlashlight();
      world.refreshTeams();
    }
    const key = `${state.epoch}:${state.round}:${world.localId}`;
    if (roundKey !== key) {
      roundKey = key; countdown = ''; sledFlight.reset();
      world.restoreVisibility();
      if (mode() === 'flashlight-tag') world.readyFlashlight();
      if (['race', 'sledding'].includes(mode()) && member() && !member().spectator && state.phase === 'countdown' && state.course.length) {
        if (previousSkates === null) previousSkates = world.winter.skating;
        // Stagger the starting grid along the broad lake mouth / hillside.
        const index = Math.max(0, Object.keys(state.roster).sort().indexOf(world.localId));
        const start = new THREE.Vector3(...state.course[0]);
        const forward = new THREE.Vector3(...state.course[1]).addScaledVector(start, -new THREE.Vector3(...state.course[1]).dot(start)).normalize();
        const side = new THREE.Vector3().crossVectors(start, forward).normalize();
        const position = start.multiplyScalar(20).addScaledVector(side, (index % 3 - 1) * 0.65).addScaledVector(forward, -Math.floor(index / 3) * 0.7).normalize();
        teleport(position.toArray(), state.course[1]);
        if (state.iceRace) world.winter.setSkates(true);
      }
      if (sledAvailable()) {
        if (previousSkates === null) previousSkates = world.winter.skating;
        setSledMounted(true);
      }
    }
    syncProps(); renderMenu(); world.refreshScores();
    ghostGame.sync();
    decorationControl.update();
    if (message.message) world.toast(message.message);
  }
  function syncProps() {
    snowTracks.update(0, world.winter.enabled && world.winter.snowCover > 0.05, world.getSnowfall());
    const ids = new Set((state?.creations || []).map(o => o.id));
    const spans = (state?.creations || []).filter(o => o.kind === 'lights').map(lightEndpoints);
    pendingLights = pendingLights.filter(p => p.until > elapsed && !overlappingLightSpan(...lightEndpoints(p), spans));
    let glowChanged = false;
    for (const [id, model] of props) if (!ids.has(id)) { disposeObject(model); props.delete(id); propCollisions.remove(id); snowTracks.forget(id); glowChanged = true; }
    for (const object of state?.creations || []) {
      let model = props.get(object.id);
      const fresh = !model;
      if (!model) {
        glowChanged = true;
        const origin = new THREE.Vector3(...object.position);
        const inverse = new THREE.Quaternion().setFromUnitVectors(UP, origin.clone().normalize()).invert();
        const local = p => new THREE.Vector3(...p).sub(origin).applyQuaternion(inverse);
        // Existing two-anchor webs get the same support-aware shape using only
        // seeded scenery, so joining clients do not depend on camp sync timing.
        const supports = object.kind === 'web' && object.anchors?.length === 2
          ? expandWebAnchors(origin, object.anchors, { ...world, getWebSupportMeshes: world.getNaturalWebSupportMeshes }) : object.anchors;
        const anchors = supports?.map(a => ({ point: local(a.point), foot: a.foot ? local(a.foot) : null }));
        model = buildMinigameProp(object.kind, { anchors }); props.set(object.id, model); world.globePivot.add(model);
      }
      const position = object.base || object.position;
      place(model, position);
      if (object.kind === 'snowman') {
        const old = model.userData.rolling;
        if (!old || old.stage !== object.stage || old.holder !== object.holder || object.complete) {
          model.userData.rolling = { stage: object.stage, holder: object.holder, growth: object.growth,
            position: new THREE.Vector3(...object.position), lastHolder: null };
        } else old.growth = Math.max(old.growth, object.growth);
        for (let i = 0; i < 3; i++) {
          const b = model.userData.balls[i];
          b.visible = object.complete || i <= object.stage;
          b.userData.rollingHolder = !object.complete && i === object.stage ? object.holder : null;
          b.scale.setScalar(!object.complete && i === object.stage ? 0.25 + 0.75 * object.growth : 1);
          b.position.set(0, [0.5, 1.24, 1.79][i], 0);
          if (!object.complete && i === object.stage) {
            const rolling = model.userData.rolling;
            b.scale.setScalar(0.25 + 0.75 * rolling.growth);
            const p = rolling.position.clone().addScaledVector(rolling.position.clone().normalize(), [0.55, 0.4, 0.28][i] * b.scale.x);
            b.position.copy(p).sub(model.position).applyQuaternion(model.quaternion.clone().invert());
          }
        }
        model.userData.accessories.visible = !!object.complete;
      }
      if (fresh || object.kind === 'snowman') propCollisions.update(object.id, model);
    }
    if (glowChanged) decorationGlow.setModels(props);
  }
  function updateSnowmen(delta) {
    for (const object of state?.creations || []) {
      if (object.kind !== 'snowman' || object.complete || !object.holder) continue;
      const model = props.get(object.id), rolling = model?.userData.rolling;
      if (!rolling) continue;
      const local = object.holder === world.localId;
      const peer = local ? null : world.getPeers()[object.holder];
      const camper = local ? world.player : peer?.mesh;
      if (!camper || !camper.visible || (local ? !world.canInteract() : peer.motion?.sitting || performance.now() - peer.lastUpdateTime > 1500)) continue;
      const inverse = world.getRotation().clone().invert();
      const holder = camper.position.clone().applyQuaternion(inverse);
      const heading = local ? new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing())).applyQuaternion(inverse)
        : new THREE.Vector3(0, 0, 1).applyQuaternion(camper.quaternion).applyQuaternion(inverse);
      const travelled = rolling.lastHolder ? rolling.lastHolder.clone().normalize().distanceTo(holder.clone().normalize()) * 20 : 0;
      rolling.lastHolder = holder.clone();
      const snowy = world.winter.snowCover > 0.05 && !camper.userData.onIce;
      if (!snowy) { snowTracks.forget(object.id); continue; }
      if (snowy && travelled < 1) rolling.growth = Math.min(1, Math.max(object.growth, rolling.growth + travelled / 8));
      const target = holder.clone().addScaledVector(heading, 0.85).normalize();
      const height = Math.max(surface(target), world.winter.iceRadius);
      const position = target.multiplyScalar(height);
      const distance = rolling.position.distanceTo(position);
      const ball = model.userData.balls[object.stage];
      if (distance > 0.001 && distance < 1) {
        const axis = new THREE.Vector3().crossVectors(position.clone().normalize(), position.clone().sub(rolling.position)).normalize()
          .applyQuaternion(model.quaternion.clone().invert());
        ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, distance / ([0.55, 0.4, 0.28][object.stage] * ball.scale.x)));
      }
      rolling.position.copy(position);
      ball.scale.setScalar(0.25 + 0.75 * rolling.growth);
      ball.position.copy(position).addScaledVector(position.clone().normalize(), [0.55, 0.4, 0.28][object.stage] * ball.scale.x)
        .sub(model.position).applyQuaternion(model.quaternion.clone().invert());
      if (snowy) snowTracks.trace({ ...object, position: position.toArray(), growth: rolling.growth });
      if (distance > 0.001 || travelled > 0.001) propCollisions.update(object.id, model);
    }
  }
  function locked() {
    const p = member();
    if (!p || !mode()) return false;
    if (!world.online()) return true;
    if (p.frozen || p.found) return true;
    if (mode() === 'sledding' && !sledMounted && (p.finish !== null || state.phase === 'results')) return false;
    if (p.finish !== null) return true;
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
      action = object.kind === 'snowman' ? 'Delete snowman' : 'Delete decoration';
    } else if (PALETTES[mode()]) action = `Place ${PALETTES[mode()].find(p => p[0] === selectedProp)?.[1] || 'decoration'}`;
    else if (mode() === 'snowman') {
      const ball = state.creations.find(o => o.holder === world.localId && !o.complete);
      const abandoned = state.creations.some(o => o.kind === 'snowman' && !o.complete && !o.holder && localPoint().distanceTo(new THREE.Vector3(...o.position)) < 2);
      const growth = ball ? props.get(ball.id)?.userData.rolling?.growth ?? ball.growth : 0;
      action = !ball ? abandoned ? 'Continue snowman' : 'Start snowball' : growth < 1 ? `Roll snowball · ${Math.floor(growth * 100)}%` : ball.base && here().distanceTo(new THREE.Vector3(...ball.base).normalize()) * 20 > 2 ? 'Roll back to snowman' : ball.stage === 2 ? 'Finish snowman' : 'Stack snowball';
    } else return null;
    const point = (world.isFirstPerson() ? new THREE.Vector3(0, -0.4, -1.4).applyMatrix4(world.camera.matrixWorld)
      : world.player.position.clone().add(new THREE.Vector3(0, 1.6, 0))).project(world.camera);
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
      const position = groundPosition(direction);
      if (selectedProp === 'lights') {
        pendingLights = pendingLights.filter(p => p.until > elapsed);
        if (pendingLights.length >= 12) return true;
        const existing = [...state.creations.filter(o => o.kind === 'lights'), ...pendingLights];
        const placement = planLightPlacement(position, forward, { ...world, groundPosition, actorPosition: localPoint(),
          canPlantPost: d => clearGround(d) || world.winter.enabled && surface(d) < world.winter.iceRadius }, existing);
        if (!placement) { world.toast('No open light connection in reach. Move a little farther along the lights.'); return true; }
        if (send({ type: 'minigame-build', action: 'place', kind: 'lights', ...placement })) pendingLights.push({ kind: 'lights', ...placement, until: elapsed + 5 });
        return true;
      }
      const anchors = selectedProp === 'web' ? findWebAnchors(position, forward, { ...world, groundPosition,
        canPlantPost: d => clearGround(d) || world.winter.enabled && surface(d) < world.winter.iceRadius }) : null;
      if (selectedProp === 'web' && !anchors) { world.toast('No clear support for this web here.'); return true; }
      if (!anchors && !clearGround(direction) && !world.player.userData.onIce) { world.toast('Choose clear ground for this decoration.'); return true; }
      send({ type: 'minigame-build', action: 'place', kind: selectedProp, position: position.toArray(), ...(anchors ? { anchors } : {}) });
    }
    return true;
  }
  function pose() {
    if (!world.online()) return;
    const inverse = world.getRotation().clone().invert();
    send({ type: 'minigame-pose', position: localPoint().toArray(),
      heading: (ghostGame.active() ? ghostGame.getAim() : mode() === 'flashlight-tag' && world.isFirstPerson() ? world.camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing()))).applyQuaternion(inverse).toArray(),
      flashlight: world.flashlightOn(), ice: !!world.player.userData.onIce, skates: world.winter.skating, sledding: ridesSled(),
      snow: world.winter.snowy && !world.player.userData.onIce && world.canInteract(), vacuum: ghostGame.vacuuming() });
  }
  function visibleContact(target, beam) {
    const a = world.player.position.clone().addScaledVector(UP, 0.8);
    const b = target.mesh.position.clone().addScaledVector(target.mesh.position.clone().normalize(), 0.8);
    const direction = b.clone().sub(a), distance = direction.length();
    if (distance > (beam ? 9 : 1.2) || distance < 0.01) return false;
    direction.normalize();
    const aim = world.isFirstPerson() ? world.camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing()));
    if (beam && direction.dot(aim) < Math.cos(Math.PI * 0.08)) return false;
    const ray = new THREE.Raycaster(a, direction, 0, Math.max(0, distance - 0.15));
    return ray.intersectObjects([world.globe, ...world.getObstacles(), ...obstacles()], true).length === 0;
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
      const onSled = ridesSled(id);
      if (onSled && !sled) { sled = buildMinigameProp('sled'); p.mesh.add(sled); sleds.set(id, sled); }
      if (sled) sled.visible = !!onSled;
      if (onSled) {
        p.mesh.rotateX(id === world.localId ? sledPose.pitch : p.mesh.userData.sledPitch || 0);
        p.mesh.userData.leftLeg.rotation.x = p.mesh.userData.rightLeg.rotation.x = -Math.PI / 2;
        p.mesh.userData.leftArm.rotation.x = p.mesh.userData.rightArm.rotation.x = -0.6;
      }
    }
    for (const [id, sled] of sleds) if (!ids.has(id)) { disposeObject(sled); sleds.delete(id); }
  }
  function clearGates() {
    for (const gate of [...gates.children]) disposeObject(gate);
    gateKey = ''; gateProgress = '';
  }
  function updateGate() {
    const p = member();
    const course = state?.course;
    const nextIndex = state?.phase === 'countdown' ? 0 : p?.checkpoint;
    const race = mode() === 'race';
    if (!course?.length || !['race', 'sledding'].includes(mode()) ||
        !race && (p?.spectator || state.phase === 'results' || !course[nextIndex])) {
      if (gates.children.length) clearGates();
      return;
    }
    const key = `${state.epoch}:${state.round}:${race ? 'course' : nextIndex}`;
    const last = course.length - 1;
    const closed = new THREE.Vector3(...course[0]).distanceTo(new THREE.Vector3(...course[last])) < 0.001;
    if (gateKey !== key) {
      clearGates(); gateKey = key;
      const indices = race ? Array.from({ length: course.length - (closed ? 1 : 0) }, (_, i) => i) : [nextIndex];
      for (const index of indices) {
        const gate = buildMinigameProp('gate');
        const label = createNameLabel('', '#f0c040');
        label.material.depthTest = true;
        label.position.set(0, 1.8, 0); label.scale.set(2, 0.5, 1);
        const text = index === 0 ? closed ? 'START / FINISH' : 'START' : index === last ? 'FINISH' : `${index}/${last}`;
        gate.userData.checkpoint = index;
        gate.userData.label = label; gate.userData.text = text;
        gate.userData.flags = gate.children.filter(child => child.isMesh && child.geometry.type === 'BoxGeometry');
        gate.add(label);
        const n = new THREE.Vector3(...course[index]);
        place(gate, groundPosition(n).toArray());
        const from = new THREE.Vector3(...course[index === last ? index - 1 : index]);
        const to = new THREE.Vector3(...course[Math.min(index + 1, last)]);
        const tangent = to.sub(from).applyQuaternion(gate.quaternion.clone().invert());
        gate.rotateY(Math.atan2(tangent.x, tangent.z));
        gates.add(gate);
      }
    }
    const progress = `${nextIndex}:${p?.finish}:${!!p?.spectator}`;
    if (gateProgress === progress) return;
    gateProgress = progress;
    for (const gate of gates.children) {
      const index = gate.userData.checkpoint;
      const active = !p?.spectator && (index === nextIndex || closed && index === 0 && nextIndex === last);
      const passed = !p?.spectator && index < nextIndex && !(closed && index === 0 && p?.finish === null);
      const color = active ? '#f0c040' : passed ? '#78b586' : '#dddddd';
      updateNameLabel(gate.userData.label, gate.userData.text, color);
      for (const flag of gate.userData.flags) flag.material.color.set(color);
    }
  }
  function update(delta) {
    elapsed += delta;
    decorationGlow.update(delta);
    snowTracks.update(delta, world.winter.enabled && world.winter.snowCover > 0.05, world.getSnowfall());
    updateSnowmen(delta);
    ghostGame.update(delta);
    decorationControl.update();
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
    if (state?.iceRace && member() && !member().spectator || ridesSled()) world.winter.setSkates(true);
    updateMarkers(); updateGate();
  }
  function sledMovement(forward, strafe, facing, delta, blocked) {
    if (!ridesSled()) return null;
    const heading = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing)).applyQuaternion(world.getRotation().clone().invert());
    const p = here(), next = p.clone().multiplyScalar(20).addScaledVector(heading, 0.5).normalize();
    const floor = direction => Math.max(surface(direction), world.winter.iceRadius);
    const slope = (floor(p) - floor(next)) / 0.5;
    return world.winter.movement(forward, strafe, facing, delta, blocked || locked(), { slope, airborne: sledFlight.airborne });
  }
  function sledAvailable() {
    return mode() === 'sledding' && !!member() && !member().spectator && world.winter.enabled;
  }
  function ridesSled(id = world.localId) {
    const role = state?.roster?.[id];
    if (mode() !== 'sledding' || !role || role.spectator || !world.winter.enabled) return false;
    if (id === world.localId) return sledMounted;
    const peer = world.getPeers()[id];
    return peer?.motion?.sledding === true && performance.now() - peer.motionReceivedAt < 2000;
  }
  function setSledMounted(value) {
    sledMounted = value;
    world.winter.stop(); world.winter.setSkates(value);
    sledFlight.reset(); sledPose = { lift: 0, pitch: 0 };
    world.player.userData.sledLift = 0;
  }
  function toggleSled() {
    if (!sledAvailable() || world.menuOpen() || !world.canInteract()) return;
    setSledMounted(!sledMounted);
    world.toast(sledMounted ? 'On the sled. Use the sled button again to get off.' : 'Off the sled.', 2500);
    pose();
  }
  function sledHeight(ground, delta) {
    if (!ridesSled()) { sledFlight.reset(); sledPose = { lift: 0, pitch: 0 }; return ground; }
    sledPose = sledFlight.step(ground, world.winter.speed * 20, delta);
    world.player.userData.sledLift = sledPose.lift;
    return sledPose.height;
  }
  function allowMove(rotation) {
    if (!state?.iceRace || !member() || member().spectator || state.phase !== 'playing') return true;
    const direction = UP.clone().applyQuaternion(rotation.clone().invert());
    return surface(direction) < world.winter.iceRadius;
  }
  function blocksMovement(rotation) {
    const height = world.player.position.y;
    const from = here().multiplyScalar(height);
    const to = UP.clone().applyQuaternion(rotation.clone().invert()).multiplyScalar(height);
    return propCollisions.blocks(from, to, world.localId);
  }
  function slowMovement(rotation) {
    const height = world.player.position.y;
    const from = here().multiplyScalar(height);
    const to = UP.clone().applyQuaternion(rotation.clone().invert()).multiplyScalar(height);
    const factor = propCollisions.speedFactor(from, to, world.localId);
    if (factor < 1) {
      const target = rotation.clone();
      rotation.copy(world.getRotation()).slerp(target, factor);
    }
  }
  function sync() { if (world.online()) world.send({ type: 'minigame-sync', active: true, team: world.getTeam() }); }
  function reset() {
    if (previousSkates !== null) world.winter.setSkates(previousSkates);
    previousSkates = null; state = null; roundKey = ''; sledMounted = false;
    ghostGame.sync();
    pendingLights = [];
    sledFlight.reset(); sledPose = { lift: 0, pitch: 0 };
    clearGates();
    world.restoreVisibility(); world.refreshTeams(); world.refreshScores();
    renderMenu(); decorationControl.update();
  }
  renderMenu();
  function obstacles() { return [...props.values()].filter(model => !model.userData.noPlayerCollision); }
  return { receive, select, renderMenu, sync, reset, update, locked, interaction, interact, sledMovement, allowMove,
    blocksMovement, slowMovement, obstacles,
    sledAvailable, toggleSled, ridesSled, sledHeight, cycleDecoration, toggleDelete,
    setVacuum: ghostGame.setVacuum,
    get ghostGame() { return ghostGame.active(); },
    get ghostVacuum() { return ghostGame.vacuuming(); },
    get ghostCanUse() { return ghostGame.active() && state?.phase === 'playing' && world.canInteract() && !world.menuOpen() && !locked(); },
    ghostAim: () => ghostGame.getAim().applyQuaternion(world.getRotation().clone().invert()).toArray(),
    updateHints: inputMode => decorationControl.update(inputMode),
    get sledLift() { return sledPose.lift; }, get sledPitch() { return sledPose.pitch; },
    get competitive() { return COMPETITIVE.has(mode()); },
    get iceRace() { return !!state?.iceRace && !!member() && !member().spectator; },
    get night() { return mode() === 'flashlight-tag'; },
    get blind() { return mode() === 'hide-seek' && state.phase === 'hiding' && state.it === world.localId; },
    get spectator() { return member()?.spectator || member()?.found; },
    get active() { return !!mode(); },
  };
}
