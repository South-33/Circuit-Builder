# Hardware Lab Workbench & WebMCP Developer Guide

This single document is the authoritative guide to the project architecture, component catalog, WebMCP agent workbench, and research notes.

---

## 1. Architecture & Boundaries

The workbench has one shared semantic circuit document. Human UI actions and WebMCP agent actions mutate that same state.

```text
React workbench UI                 WebMCP agent tools
        |                                  |
        +-------------+--------------------+
                      |
                 circuit store
                      |
           parts[] + connections[]
              |                |
      exact part/pin       authored wire
        geometry             waypoints
              |                |
              +-------+--------+
                      |
               circuit graph
                      |
         AVR8js + device adapters
```

### Directory Ownership
- `src/main.tsx`: Application entrypoint only.
- `src/app/`: React UI and CSS only. Does not contain circuit simulation or graph logic.
- `src/components/`: Component catalog, canonical part types, and Wokwi element registration.
- `src/circuit/`: Semantic document types, mutations store, history (undo/redo), and presets.
- `src/agent/`: WebMCP tools (`webmcp.ts`), compact planning grid, and layout validation (`layout.ts`).
- `src/breadboard/`: Breadboard geometry, named hole coordinate mapping, and physical seating.
- `src/wires/`: Exact pin geometry and rendering of authored wire paths. No automatic rerouter.
- `src/sim/`: AVR8js runtime, circuit graph, electrical diagnostics, and modular device adapters (`sim/devices/`).
- `src/layout/`: Large workspace placement helpers.
- `public/assets/`: Runtime artwork (Fritzing SVGs) and attribution.
- `scripts/`: Verification, repository checks, and autonomous benchmark harness.

### Non-Negotiable Boundaries
1. **Wires**: A wire has semantic endpoints (`partId:pin`) and optional authored waypoints. Electrical connectivity depends only on endpoints. There is no automatic router; the agent or user owns the wire path.
2. **Breadboards**: Breadboard holes are semantic pins. Components physically mounted on a breadboard store `seating`, mapping component pins to named holes.
3. **Simulation**: Device adapters under `src/sim/devices/` connect peripherals to the AVR8js MCU via `DeviceContext`. Visual support and simulation support are separate claims (`simulated: true` vs `simulated: false`).
4. **WebMCP**: The six core tools (`inspect-circuit`, `edit-circuit`, `connect-pins`, `set-code`, `simulate`, `focus`) are stable and expressive.

---

## 2. Adding Components

Adding a component is a structured metadata and adapter task:

### 1. Register the Type
Add the canonical type name to `src/components/partTypes.ts` in `PART_TYPES`.

### 2. Add Visual Metadata
Add the `PartDefinition` in `src/components/parts.ts`:
- Name, category, ID prefix, and search keywords.
- Wokwi element tag or static SVG asset path (`public/assets/fritzing/`).
- Dimensions, render scale, and pin metadata.
- `breadboardMount: true` only when pin pitch aligns with standard 0.1" (2.54mm) breadboard holes.
- Inspector `properties` for user-configurable attributes.

### 3. Register Custom Element
If backed by a Wokwi element, add one import in `src/components/registerElements.ts`.

### 4. Implement Simulation Adapter
Place peripheral simulation hooks in the closest adapter in `src/sim/devices/` (`analog.ts`, `basic.ts`, `i2c.ts`, `sensors.ts`, etc.). If behavior is not yet modeled, set `simulated: false`.

### 5. Validate
Run `pnpm check` and `node scripts/test-circuits.mjs`.

---

## 3. WebMCP Agent Workbench Contract

The agent behaves like a careful engineer laying out a circuit on graph paper. The workbench supplies exact electrical semantics, a compact planning grid, and deterministic diagnostics.

### The Six WebMCP Tools
1. **`inspect-circuit`**: Reads live parts, authored wires, code, diagnostics, simulation status, and 2D spatial map. Supports `netOf: "uno1:5V"` to probe electrical nets and `partIds` for selective inspection.
2. **`edit-circuit`**: Places, moves, nudges (`nudge: { dx, dy }`), rotates (`rotate`, `rotateBy`), seats on breadboard, or updates attributes. Supports whole-circuit atomic assembly.
3. **`connect-pins`**: Creates or rewires orthogonal Manhattan wire routes using `gridWaypoints`. Supports in-place rerouting by `id`.
4. **`set-code`**: Replaces the Arduino C++ sketch on the Uno.
5. **`simulate`**: Compiles firmware to AVR machine code, starts/stops execution, and checks runtime state.
6. **`focus`**: Visually highlights components, wires, or sketch lines in the workspace.

### 3.1 Grid Coordinate Convention

The agent planning grid uses **centered coordinates** — grid (0, 0) is the visual center of the workspace:

```
canvas_x = grid_x × 32 + 1600
canvas_y = grid_y × 32 + 1000

grid_x = round((canvas_x − 1600) / 32)
grid_y = round((canvas_y − 1000) / 32)
```

- Positive X goes right, positive Y goes down.
- Small integer coords near zero are the working area: a typical circuit fits within ±20 cells on each axis.
- Use `grid: { x, y }` in `edit-circuit` to place parts at exact positions.
- `inspect-circuit` returns each part's `grid` (top-left cell) and `gridSize: { w, h }` (cells occupied). The part's footprint spans from `grid.x` to `grid.x + gridSize.w − 1` and `grid.y` to `grid.y + gridSize.h − 1`.

### 3.2 Wire Routing Rules

Think of wires as **cable management, not free-form lines**. The goal is uniform, traceable paths that look like the third-party reference image: straight runs, one directional change, no crossing over components.

**Rules — enforce all of them:**

1. **Maximum 2 bends per wire.** Most connections need 0 or 1. More than 2 is always a sign of a bad route.
2. **Exit perpendicular, then travel.** Leave a pin horizontally if it faces left/right, vertically if it faces up/down. Make the first segment short (1–2 cells), then travel the long distance.
3. **Horizontal then vertical (H-then-V) or vertical then horizontal (V-then-H).** Pick one pattern and stick to it per wire. Never mix both after the exit.
4. **One wire per lane.** Give each wire its own row (for horizontal runs) or its own column (for vertical runs). Do not stack wires on the same row/column.
5. **Never cross a component body.** Look at `map.spans` in the layout response to see which cells each part occupies. Route around those cells.
6. **Use `routingHints`.** The layout response includes `routingHints.clearLaneAbove/Below/Left/Right` — the nearest grid row/column that is completely free of parts. Use these as wire highways.
7. **Power and ground wires run along the outermost clear lanes.** Signal wires use inner lanes. This mirrors real-world cable management.
8. **Straight connection = no waypoints.** If two pins are roughly aligned (same row or column), omit `gridWaypoints` entirely — the wire draws straight automatically.

**Example good route (Arduino at 0,0 → LED at 8,−3):**
```json
{ "from": "uno1:13", "to": "led1:A",
  "gridWaypoints": [{"x":0,"y":−4}, {"x":8,"y":−4}] }
```
One bend: go up to a clear lane (row −4), travel right. Clean.

**Example bad route (avoid):**
```json
{ "gridWaypoints": [{"x":2,"y":0},{"x":2,"y":3},{"x":5,"y":3},{"x":5,"y":−1},{"x":8,"y":−1}] }
```
Four bends, snaking through the layout. Flagged as `too-many-bends`.

### 3.3 Component Footprint

Every part returned by `inspect-circuit` includes `gridSize: { w, h }`. The part occupies cells:
- **x range:** `grid.x` to `grid.x + gridSize.w − 1`
- **y range:** `grid.y` to `grid.y + gridSize.h − 1`

Key footprints to remember:
| Component | Typical gridSize |
|-----------|-----------------|
| Arduino Uno | 9 × 7 |
| Breadboard (full) | 23 × 7 |
| Half Breadboard | 11 × 7 |
| 9V Battery | 4 × 7 |
| Potentiometer | 3 × 3 |
| LED | 2 × 2 |
| Resistor | 2 × 1 |
| NPN Transistor | 1 × 1 |

Place parts so their footprints don't overlap (except breadboard-mounted components using `seat`). The map legend `spans` field gives you each part's exact bounding box after placement.

### 3.4 NPN Transistor Pattern

The NPN transistor (`npn-transistor`) appears in the diagnostics with this warning when wired without a base resistor:
> "NPN Transistor base (B) has no current-limiting resistor. Add a 1kΩ resistor between the Arduino pin and Base to protect the MCU."

**Always add a 1kΩ resistor in series between the Arduino digital pin and the transistor base.** The correct wiring:

```
Arduino pin → [1kΩ resistor] → NPN Base (B)
Load (motor/LED/relay) → NPN Collector (C)
NPN Emitter (E) → GND
```

Without this resistor the MCU output pin drives the base directly. The diagnostic will fire and the quality score will drop.

### Recommended Agent Loop
1. Inspect the workspace or target prompt/image.
2. Place major parts and seat breadboard components in an atomic or batch `edit-circuit` call.
3. **Read the returned layout** — check `map.spans` for part footprints and `routingHints` for clear lanes.
4. Route wires with dedicated orthogonal parallel lanes using `connect-pins`. Max 2 bends per wire. Use clear lanes from `routingHints`.
5. Upload sketch with `set-code`.
6. Probe power nets with `inspect-circuit` (`netOf`).
7. Run `simulate` to verify AVR execution and check DRC diagnostics.

---

## 4. Research & Third-Party Notices

### Research: Tinkercad Circuits Baseline
- **Strengths**: Intuitive visual breadboarding, Arduino simulation, component inspector, beginner-friendly palette.
- **Weakness Solved**: Tinkercad lacked a semantic, addressable graph for AI agents, forcing visual guessing. Our workbench provides a typed graph, 2D planning grid, and atomic tool contracts.

### Third-Party Notices & Attribution
- **Wokwi Elements**: MIT Licensed. Custom elements for interactive microcontrollers, sensors, and displays.
- **AVR8js**: MIT Licensed. Web-based AVR ATmega328P instruction-set simulator.
- **Fritzing Graphics**: CC-BY-SA 3.0 / MIT. SVG component vector artwork used in breadboard rendering.
