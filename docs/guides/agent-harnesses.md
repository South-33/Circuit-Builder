# Agent harness

The app exposes one production WebMCP action space. Its goal is to make circuit construction feel like arranging blocks, not drawing pixels.

For an agent environment without an embedded browser, `pnpm harness -- --input <scenario.json>` runs a JSON sequence of these exact tools in headless Chrome or Edge and saves `report.json` plus `render.png`. `pnpm harness:list` prints the live schemas. Keep benchmark scenarios in `scripts/harness/examples/`; generated artifacts belong in ignored `benchmark-results/`.

## Model contract

- One cell is 9.6 px, the physical breadboard-hole pitch.
- A component is a rounded integer collision shadow placed by its top-left cell. Artwork and cosmetic contours are not planning geometry.
- The inventory is pin-first: each terminal has an outward side and exact integer `x,y` offset at 10 terminal units per placement cell. The renderer's canonical physical pin remains the source of truth.
- The compiler creates a straight outward lead on the exact pin axis, then routes orthogonally around exact component rectangles.
- Directional pin leads and interior route legs are at least one cell long. When a connection should be visually straight, `align` may slide the component by a fractional cell so the two real pin axes match exactly.
- A two-terminal signal normally specifies only semantic endpoints. An ordinary component terminal is never an invisible junction. Shared power and ground use a real breadboard rail with one source feed and distinct consumer holes.
- `wire()` means one direct physical cable. With one breadboard present, `net(..., "signal", endpoints)` means the compiler should land up to five endpoints on distinct holes in one connected strip.
- `rail()` is distribution, not automatic organization. Choose the rail on the same side as its consumers. For a compact switching stage, use adjacent connected strips and explicit short rail drops; do not make one rail branch cross the whole breadboard.
- `bridge(id, boardId, "+|-", "left|right")` joins split top/bottom rails around one board edge. Choose the quiet edge nearest the supply instead of drawing a vertical wire through the work area.
- Rail hole labels are not uniform x-coordinates because physical rails contain gaps. Give `rail()` semantic endpoints and let canonical geometry choose the aligned holes instead of guessing numbered holes.
- Block non-overlap is not enough near active terminals. Keep at least one clear routing cell outside each used pin bank so a nearby component does not close the only clean exit lane.
- The compiler owns obstacle avoidance, bends, and lane separation.
- The agent owns topology, terminal-facing orientation, functional group order, and rare meaningful cable corridors.

`build-circuit` supports four scales without adding more tools:

```js
const uno = part("uno", "arduino-uno", {"at":[-35,-12]})
const board = part("board", "breadboard-half", {"at":[-3,10]})
const servo = part("servo", "servo", {"at":[33,-4]})
const pot = part("pot", "potentiometer", {"at":[6,32],"rotate":180})
align("pot.VCC", "board.+top8", "x")
wire("pwm", "uno.9", "servo.PWM", "signal")
net("sense", "signal", ["pot.SIG","uno.A0"])
rail("power", "board", "+top", "uno.5V", ["pot.VCC","servo.V+"])
rail("ground", "board", "-top", "uno.GND.2", ["pot.GND","servo.GND"])
```

The `program` field accepts this deliberately small declarative language without evaluating JavaScript. Bare calls, `const name =` assignments, dot or colon endpoints, relative placement, breadboard seating, wires, nets, and rails compile through the same transaction and exact router. Declarations may appear anywhere. It is not general JavaScript: use only the listed calls with JSON literals, and never invent object constraints or rely on return values.

- Large change: `replace:true` submits a whole scene.
- Medium change: `replace:false` moves or adds selected parts/wires and reroutes wires attached to moved parts. A compiler-proposed placement edit includes `reroute:"all"` so its predicted mechanical issue report matches the applied result.
- Fine placement: `align:[{from,to,axis}]` moves the component named by `from`; `to` stays fixed. Use `x` for a vertical connection and `y` for a horizontal connection. Example: `align:[{"from":"pot:VCC","to":"uno:5V","axis":"x"}]`.
- Small change: `tune:[{wireId,lane,by}]` shifts the longest horizontal or vertical lane by an integer number of cells.

Use the optional fifth `wire()` argument, such as `[[15,-10],[-16,-10]]`, only when a route needs a meaningful corridor such as the open channel between a battery and breadboard. It is not a full path and does not include pin positions.

The build description contains only the starter kit. `inspect-circuit.catalogTypes` progressively reveals exact footprints and canonical pin names grouped by side for other components.

Placement follows one short composition policy: arrange functional groups by flow, but let pin-side fit win over a conventional left-to-right layout. Treat terminals as the component's important feature. Face each used bank toward its destination, preserve terminal order across a cable boundary, and move or rotate a part whenever that removes a reversal. A breadboard is an electrical region, not empty routing canvas: external cables stay outside and enter at a named hole, strip, or rail. Keep vertical supply boundaries out of horizontal signal spans. Reserve parallel power and ground lanes at group edges and use short local rail drops. When one occupied lane causes a corrective jog, move the complete functional pin group together instead of tuning one wire. Detailed wire geometry remains compiler-owned.

Before building, reason in this order:

1. Identify the supply source, shared electrical reference, controller, switching stages, and loads. Controllers and externally powered stages need a common ground when one drives the other.
   Keep topology minimal. A USB-powered controller normally does not also need the external load battery connected to VIN unless the task asks for standalone battery power.
2. Assign quiet edges for supply entry and rail bridges before placing signal cables. Do not run a supply boundary through the middle of an active board region.
   Keep conductors from one source connector on the same nearest board edge. A battery below the board feeds both bottom rails; move power locally to the load stage instead of routing one battery lead through the board to a top rail. For unrelated nets, choose top versus bottom by combined source-and-consumer distance.
3. Assign every multi-terminal peripheral one board-edge zone, then face and align its connector as one cable. Minimize the combined rough distance of every active pin. Do not place a three-wire peripheral near its signal pin alone when that makes its two distribution wires span the scene. If moving the load makes its terminal bank horizontal or vertical with the destination bank, move it instead of routing each conductor around the mismatch.
4. Seat local components so every rail drop can use the same physical x-axis where possible. Let `rail()` resolve real hole geometry; do not infer coordinates from labels. If a rail gap causes one elbow, compare translating the complete functional group one cell left and right before changing any wire.
   A `:mount` component must use `seat()` whenever the scene contains a breadboard. Free placement is only valid in a breadboard-free scene.
   Plan connected strips before choosing seats: A-E holes with the same number are connected, F-J with the same number are connected, and the trench separates them. Put mounted pins that belong to one net on one strip instead of drawing a jumper between them.
5. Render once and challenge every bend. A bend is valid only for a pin exit, component obstacle, board-edge entry, lane separation, or an intentional functional corridor.
6. Keep the controller and main distribution board in one working band when their active pin banks permit it. Do not move the whole controller above or below the board merely to repair one wire.
   Prefer the conventional upright controller to the left of the board. Never rotate a large controller for one signal; rotation must simplify most active connections without worsening power or ground.

Good and bad shapes:

- Bad: battery below the board, then one power wire straight through the board interior. Good: enter the nearest lower rail and use one outside-edge `bridge()` to the upper rail.
- Bad: keep a motor fixed and repair both leads with elbows. Good: move and `align` its terminal bank so both leads stay straight.
- Bad: select a neighboring rail hole to satisfy artwork-facing direction on a seated part. Good: route from the seated breadboard hole axis and choose the aligned rail hole.
- Bad: repair one ground elbow while leaving its stage fixed on an incompatible rail phase. Good: translate the transistor, diode, resistor, boundary strips, and load together until their local drops share real rail axes.
- Bad: remove a shared ground because its visible route is ugly. Good: preserve the required common reference and relocate its physical rail entry.
- Bad: force every external terminal through the same rigid connector escape. Good: a flexible motor lead turns once on the motor axis and runs directly along the rail axis. A rigid header still preserves its outward side and uses the board boundary when a direct route would cross the board.
- Bad: place a potentiometer beside A0 while its power and ground cross the workspace. Good: place the whole three-wire bundle beside one distribution edge and accept one clean signal corridor back to A0.
- Bad: cram 8+ components or a multi-pin display onto a 30-column `breadboard-half`. Good: select full 63-column `breadboard` with 3-sector zoning (Inputs cols 5–20, Displays/ICs cols 28–38, Expansions cols 45–60) and keep seated passives clear of button/IC casings. Collision between seated bodies triggers a blocking `seated-part-collision` compiler error.

## Visual feedback

Exact state and layout diagnostics come from `inspect-circuit`. They catch mechanical violations but do not certify visual quality. The rendered workbench is judged directly: every component location and every bend must have a functional explanation, power pairs should read together, and moving a part must not reveal an obviously simpler route. `focus` can temporarily mark selected parts, wires, and exact endpoints such as `uno:9`; avoid labeling every pin at once.

Before accepting a render, compare moving each external part one coarse cell left, right, up, and down, plus every sensible rotation. Reject the layout when one change removes a reversal, perimeter run, board crossing, or split functional group without causing a worse conflict. In particular, reject a controller moved into a separate row merely to repair one connection, mountable parts floating around a breadboard, a battery occupying the controller-to-board gap, or a flexible load lead with more than one unexplained corner.

For a source with multiple conductors, compare the combined rough distance from its terminals to the distribution points at every open board edge. Place it at the shortest clear edge. A battery beneath the controller is wrong when moving it beneath or beside the breadboard shortens both supply wires.
When a battery is below the breadboard, its terminal bank should normally fall inside the board's horizontal span.
Preserve connector order across a cable. Project the connector toward its destination and assign the adjacent entry lanes in the same terminal order. If power and ground exchange sides, move or rotate the source or choose different rail-entry lanes; do not route one conductor around the other.
Connector direction comes first: when a source sits below a board, its rigid terminal bank should face upward. Do not turn it sideways merely to avoid a crossing; slide it along the board edge or choose different entry lanes while keeping the connector aimed at the board.
Keep that paired cable on one board edge. Enter the two nearest rails together, then use a short local drop or an outside-edge bridge if a consumer needs the far side. Splitting the pair across top and bottom makes one conductor cross the board and destroys the cable's visual flow.

## Experiment loop

1. Build once from the block contract.
2. Inspect diagnostics and layout quality.
3. Look at one framed render and explain every component location and bend. A numeric layout score is never visual acceptance.
4. Apply a verified `suggestedEdit` when offered. Use `align` for an otherwise-straight endpoint elbow, then one targeted `tune` or `via` only after placement and topology are clean.
5. Record the result and scale the task only after the smaller case is reliable.

Electrical correctness and visual quality remain separate. Never treat a clean render as proof that the circuit simulates correctly.
