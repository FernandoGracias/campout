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

## Projectile confirmation

The room authority and the receiver report projectile impacts. Every client can
predict a snowball's **visual** contact, immediately hiding the projectile and
showing the impact without waiting for the round trip. Scores still come only
from accepted room events. Confirmation does not repeat a predicted impact effect;
a delayed prediction requests a room snapshot to reconcile with authoritative state.

Pinecones retain their land support offset. In water, a raycast against the actual
water triangles places the laid-down cone's center on the surface. The same rule
is used for landing, bounce endpoints and restored room snapshots.
