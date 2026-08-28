# WebMCP Hardware Lab

A browser electronics workbench where people and agents edit the same live circuit document. The UI stays visual and beginner-friendly, while WebMCP exposes exact parts, pins, breadboard holes, diagnostics, code, simulation, and experimental layout action spaces.

## What works

- Drag/place parts and snap breadboard-mounted components to real named holes.
- Connect exact semantic pins with visible editable wires.
- Edit Arduino C++ and run it on an AVR8js Uno simulation.
- Simulate common digital/analog parts, sensors, motors, keypad/encoder inputs, IR, and selected I2C devices.
- Detect blocking electrical mistakes and common wiring warnings.
- Undo/redo human and agent edits in the same store.
- Inspect exact circuit state through WebMCP instead of relying on screenshot-only reasoning.
- Compare several agent layout harnesses against the same grid, renderer, simulator, and evaluator.

## Run locally

```bash
pnpm install
pnpm dev
```

Then choose a harness per browser tab:

```text
http://localhost:5173/?harness=legacy
http://localhost:5173/?harness=a
http://localhost:5173/?harness=b
http://localhost:5173/?harness=c
```

## Agent harnesses

| Harness | Main action space | Purpose |
| --- | --- | --- |
| Legacy | `edit-circuit` + `connect-pins` | Existing control interface. |
| A: Procedural Grid | `build-circuit` ordered operations | Test a small MineBench-style discrete geometry language. |
| B: Blueprint Grid | `build-circuit` whole scene | Test holistic exact 2D blueprint generation. |
| C: Semantic Solver | `build-circuit` relationships + nets | Test model intent with deterministic placement/routing. |

A/B/C share the same centered 32 px **planning grid** for component layout, with component positions expressed as centers. Exact pins, breadboard holes, the visible dot grid, and Harness C wire routing use the separate 9.6 px physical connector lattice. `inspect-circuit` exposes both scales and returns structured state plus a compact ASCII planning map.

Every profile also has `benchmark-run`. Use `action=start` before a real agent attempt and `action=finish` at the end to capture layout score/issues, electrical diagnostics, centering, wire length/bends, call failures, traffic, latency, and the call log. Finished runs are kept in browser localStorage; `action=history` returns recent summaries.

See [`docs/guides/agent-harnesses.md`](./docs/guides/agent-harnesses.md) for schemas, comparison protocol, and the evaluation-agent prompt template.

## Validation

```bash
pnpm check
pnpm test
pnpm benchmark:harnesses
pnpm audit:components
pnpm audit:examples
```

`pnpm audit:components` checks every catalog part against the physical connector lattice and real browser rendering. `pnpm audit:examples` renders each built-in circuit in authored and autorouted form, scores its layout, and checks wire/component interaction layering. `pnpm benchmark:harnesses` uses fixed known-good inputs only; it is not an LLM benchmark. Real model comparisons should use separate browser tabs and `benchmark-run` reports.

## Architecture

```text
React workbench                 active WebMCP harness
      |                                |
      +---------------+----------------+
                      |
                 circuitStore
                      |
         exact parts + semantic nets
            |                 |
      geometry/layout      circuit graph
            |                 |
       rendered wires     AVR8js/devices
```

Useful docs:

- [`AGENTS.md`](./AGENTS.md) for implementation-agent rules.
- [`docs/architecture/overview.md`](./docs/architecture/overview.md) for ownership and data flow.
- [`docs/guides/agent-harnesses.md`](./docs/guides/agent-harnesses.md) for A/B/C.
- [`docs/guides/adding-components.md`](./docs/guides/adding-components.md) for catalog work.
- [`docs/research/harness-experiments.md`](./docs/research/harness-experiments.md) for the experiment rationale.

## Upstream building blocks

- `@wokwi/elements`, MIT, for component visuals and pin metadata.
- `avr8js`, MIT, for the ATmega328P CPU/peripherals.
- Selected I2C device implementations contain adaptations noted in [`docs/legal/THIRD_PARTY_NOTICES.md`](./docs/legal/THIRD_PARTY_NOTICES.md).
- Selected breadboard, motor, battery, transistor, and diode artwork comes from the Fritzing parts library. See [`public/assets/fritzing/ATTRIBUTION.md`](./public/assets/fritzing/ATTRIBUTION.md).

The real MCU runtime currently targets one Arduino Uno per simulation. The circuit document is generic enough to add more boards later.
