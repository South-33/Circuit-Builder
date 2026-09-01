# Architecture

The human UI and WebMCP tools share one live `circuitStore` document.

```text
React workbench ─┐
                 ├─ circuitStore ─ exact part/wire geometry ─ circuit graph ─ AVR + devices
WebMCP harness ──┘
```

`scripts/harness/run.mjs` is a browser-independent shell adapter for agents such as Antigravity. It launches the real app headlessly and calls the same registered tool definitions, so CLI benchmarks cannot drift into a second circuit implementation. Each scenario emits the exact call transcript, final inspection, and PNG render.

## Ownership

- `src/app/`: React UI, camera, selection, and temporary visual marks.
- `src/components/`: canonical parts, dimensions, pins, properties, and visuals.
- `src/circuit/`: document types, store/history, and presets.
- `src/breadboard/`: named-hole geometry and physical seating.
- `src/wires/`: exact pin and rendered wire geometry. It does not choose agent routes.
- `src/sim/`: graph, diagnostics, AVR runtime, and device adapters.
- `src/layout/`: ordinary workspace helpers and independent layout evaluation.
- `src/agent/`: the single block-grid action space, parsing, transactions, and deterministic routing policy.

## Agent geometry

Grid `(0,0)` is the workbench center. Positive X is right and positive Y is down. One cell is the 9.6 px physical connector pitch.

Components reserve rounded-up integer blocks by top-left cell without stretching their canonical visual geometry. The block grid is not wire geometry: the router leaves each exact pin on its physical axis and navigates around exact component rectangles. Breadboard-mounted parts use named holes such as `E18` or `+top20`.

Exact pin axes do not have to share one grid phase. Coarse placement remains integer-cell based, while manual connected-pin snapping and the agent's explicit `align` action may slide a component inside that plan to match one real pin axis exactly. Otherwise the router preserves the phase difference with a full 9.6 px terminal lead and meaningful interior legs, never a tiny adapter notch.

Layout quality measures cancelled travel as backtracking. A leftward run followed later by an equally long rightward run is still a visible U-shaped detour even when its net horizontal displacement is zero.

Multi-terminal nets compile to ordinary electrical edges with a retained semantic `netId`. This keeps simulation simple while letting layout quality distinguish one intentional shared terminal lead from an accidental overlap between unrelated wires.

The router reserves shared net trunks before ordinary two-terminal signals. This makes the physical routing order match the composition policy: power and ground establish the distribution structure, then local signals fit into the remaining channels.

The model chooses topology, coarse component placement/orientation, optional exact pin-axis alignment, and sparse corridor checkpoints. The harness chooses detailed orthogonal routes and can shift an existing lane for a small visual correction. Electrical connectivity always uses semantic endpoints, never the drawn route.

## Feedback

`inspect-circuit` is exact machine-readable state. The workbench render is for composition judgment. `focus` adds temporary marks to specific parts, wires, or pins so visual grounding stays sparse.

`evaluateLayout()` independently reports overlap, crossings, backtracking, excessive bends, and routes through components. Electrical diagnostics are separate. Do not weaken either check to improve an experiment score.
