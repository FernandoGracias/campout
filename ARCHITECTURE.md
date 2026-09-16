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
