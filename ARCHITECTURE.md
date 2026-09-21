# Campout modules

Campout uses native browser ES modules and the Three.js import map in `index.html`.
There is no build step. Deploy the HTML, CSS and JavaScript files together.

| Module | Responsibility |
| --- | --- |
| `index.html` | Screen markup, room/network coordination, game initialization, input and frame loop |
| `world.js` | Seeded terrain, lakes/rivers, trees, rocks, flowers and water |
| `globe-utils.js` | Shared radial positioning and latitude/longitude conversion |
| `character.js` | Camper model, animation limb references, beard/hair appearance |
| `tent.js` | All four tent models and their grounding metadata |
| `swimming.js` | Local/remote swimming transitions and poses |
| `player-labels.js` | Name-label creation and texture updates |
| `game-utils.js` | Seeded randomness, team colors and resource disposal |
| `sky-lighting.js` | Shared time-of-day lighting/color calculations |
| `seasonal-sky.js` | Seasonal sky shader and regional cloud field |
| `winter.js` | Seasonal equipment, snow/ice, projectile simulation and room-event reconciliation |
| `winter-physics.js` | Ice impulses, orbit integration and ballistic targeting |
| `minigames.js` | Existing-menu voting, interactions, game roles, courses and sled movement |
| `minigame-models.js` | Static decoration, snowman, checkpoint and sled models |
| `sled-physics.js` | Low-gravity radial flight and terrain-driven takeoff/landing |
| `snowman-tracks.js` | Bounded terrain-conforming rolling tracks with GPU fading |
| `decoration-control.js` | Cycling decoration side button and active-input hints |
| `pinecones.js` | Cone geometry, inventory, pickup and raycast resting positions |
| `pinecone-fire.js` | Pooled fire/smoke trails and impact embers in planet coordinates |
| `fire-particles.js` | Fire and smoke motion shared by campfires and pinecones |
| `launch-preview.js` | Disposable lobby renderer using the shared world/character/tent builders |
| `lobby-weather.js` | Lobby controls for the shared room environment |
| `launch-screen.css` | Desktop and mobile preview/menu layout |

## Behavior-preserving extraction

World generation retains its seeded random call order. Gameplay passes the same
random generator onward to campsite construction. The lobby has its own random
generator and renderer, so previewing never advances gameplay state. Its renderer,
animation frame, listeners and GPU resources are disposed before entering play.

The mobile lobby reserves the top third for the preview; the lower two-thirds
scroll independently. Both views share the same controls as desktop.

## Immediate projectile collisions

Snowballs and pinecones use the same swept collision path on every client.
Contact immediately stops flight: snowballs burst and pinecones bounce locally.
The client then reports the hit; the server accepts the first valid report and
deduplicates the rest for shared scoring/inventory. Neither a delayed throw echo
nor a room snapshot restarts a locally collided projectile. Recent snapshot
catch-up checks player collisions instead of skipping them until the present.

Flaming pinecones use the campfire's particle motion. Flight directs fire backward;
black smoke stays behind in planet coordinates, expands and fades. Impacts leave
a short-lived ember burst. Particle pools are bounded and trails outlive removal
of the projectile itself.

Pinecones retain their land support offset. In water, a raycast against the actual
water triangles places the laid-down cone's center on the surface. The same rule
is used for landing, bounce endpoints and restored room snapshots.

## Persistent room settings and ownership

The room server persists weather and time settings with the room, including when
the last camper disconnects. The creator receives a per-world ownership token at
creation, saved locally and presented on reconnect. Only that creator can update
the server's room settings. World/weather controls are hidden entirely for joining
campers in both menus; their character and tent controls remain available.

Deploy `campout-server` before the v221 frontend. Include `src/room-settings.js`
and `src/projectiles.js` in the server deployment. Newly created worlds have
creator ownership from creation; legacy worlds can migrate a creator who still
has creator state, but cannot recover ownership from a session that never stored it.

A held pinecone ignites for 30 seconds only when its geometry bounds touch an
actual campfire flame particle, including shared fires. Sitting/proximity alone
does not ignite it. Fire, smoke and embers render as square particles.
Its burning deadline is stored by the room and shared in inventory/flight events.
Pinecones tumble in flight, and water impacts extinguish them.

## World-wide minigames

Deploy the matching `campout-server` changes before this frontend. The ready
handshake advertises `minigameProtocol: 1`; older servers are never sent unknown
minigame messages. Both repositories have changes for this feature.

`campout-server/src/minigames.js` owns a serialized state machine for votes,
roles, freeze/thaw, scoring, rounds, race progress and creations. Every camper
inside the world has one vote; a strict majority starts, switches or ends a mode.
Votes expire after 30 seconds. Join/departure updates eligibility. Races and
hide-and-seek admit late arrivals as spectators; other modes admit them directly.
Tag and freeze games end when fewer than two campers remain.

The existing Mini Games modal holds all nine modes, ballot counts, descriptions,
results and Back to camping. Decoration choices use a circular side button with
the selected item's SVG icon: click/tap, C or controller RB cycles the choices
(including removal). Hints show only the active input method. The existing camp interaction
prompt handles placement, removal and snowball stacking with E, controller A or
touch. Name-label sprites provide overhead IT/SEEKER/FROZEN markers. Hide-and-seek
suppresses player labels and clears the seeker's scene while counting. Team freeze
games reuse the existing hats and team scoreboard; scores can go below zero.

Winter Race uses 12 fixed flag sites spaced by distance along the existing
meandering river and across the lake. The start flag doubles as the finish after
a full globe lap. All flags stay in place through the race and its results;
the next checkpoint is gold and passed checkpoints turn green. Movement stays on the ice and skates
are equipped for the race, then restored. Summer footraces select a clear land
loop; sledding selects a clear downhill foothill route using actual terrain and
colliders. Courses do not modify the world geometry. Checkpoint flags reuse
in-world labels, with progress/results in the existing menu.

In sledding mode, the skate control becomes the sled toggle (I / controller LB /
touch, shown separately per input mode). Mounting forces the existing skate
momentum state on, with the sled replacing blade visuals; dismounting clears it.
The control remains available after finishing, so campers can get off and walk.
Slope acceleration feeds that same momentum state. A low-gravity radial flight
integrator carries uphill velocity over crests and lands on the current terrain
or ice surface. Bounded sled/lift/pitch motion is shared with peers, and sled
checkpoints only count while mounted with skating enabled.

Creations persist with the room (maximum 100). Snowballs grow with travel, and
stacking anchors the lower balls while the next ball is rolled. Campers can
resume abandoned snowmen. Rolling sections leave widening terrain-conforming
grooves visible to each connected camper. New segments alone upload geometry;
existing tracks fade on the GPU in a bounded shared pool, and thaw clears them.
Only an object's creator or the world owner may remove
it, and only nearby. Live modes/ballots are transient across a Worker restart;
creations survive. Mode changes preserve the underlying weather and time settings;
flashlight freeze tag renders nighttime and allows switched-off flashlights to
recharge. Other competitive modes do not permit camp entry or projectile actions.

As with existing projectiles, browsers simulate terrain and line-of-sight. The
room checks socket identity, membership, epochs, timing, bounded positions and
speed, contact range, beam direction, ordered checkpoints and creation ownership.
This is not server-side terrain simulation or a cheat-proof movement system.
