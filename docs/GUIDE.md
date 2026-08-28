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

### Recommended Agent Loop
1. Inspect the workspace or target prompt/image.
2. Place major parts and seat breadboard components in an atomic or batch `edit-circuit` call.
3. Route wires with dedicated orthogonal parallel lanes using `connect-pins`.
4. Upload sketch with `set-code`.
5. Probe power nets with `inspect-circuit` (`netOf`).
6. Run `simulate` to verify AVR execution and check DRC diagnostics.

---

## 4. Research & Third-Party Notices

### Research: Tinkercad Circuits Baseline
- **Strengths**: Intuitive visual breadboarding, Arduino simulation, component inspector, beginner-friendly palette.
- **Weakness Solved**: Tinkercad lacked a semantic, addressable graph for AI agents, forcing visual guessing. Our workbench provides a typed graph, 2D planning grid, and atomic tool contracts.

### Third-Party Notices & Attribution
- **Wokwi Elements**: MIT Licensed. Custom elements for interactive microcontrollers, sensors, and displays.
- **AVR8js**: MIT Licensed. Web-based AVR ATmega328P instruction-set simulator.
- **Fritzing Graphics**: CC-BY-SA 3.0 / MIT. SVG component vector artwork used in breadboard rendering.
