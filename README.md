# WebMCP Hardware Lab

A browser electronics workbench where people and agents edit the same live circuit document.

## What works

- Visual part placement, exact semantic pins, editable wires, and breadboard seating.
- Arduino C++ execution on an AVR8js Uno simulation with supported devices.
- Separate electrical diagnostics and visual layout evaluation.
- One WebMCP block-grid action that can build a scene, update selected items, or tune one wire lane.
- Exact machine-readable inspection plus optional sparse pin/wire marks on the rendered workbench.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/`.

## Headless agent harness

Agents without an embedded browser use the same production WebMCP tools through a headless shell adapter:

```bash
pnpm harness:list
pnpm harness -- --input scripts/harness/examples/servo-control-open.json
pnpm harness:smoke
```

A scenario is a JSON `calls` array of WebMCP tool names and inputs. Each run starts the real Vite app in headless Chrome or Edge, calls the registered tools, and writes an ignored output directory containing `report.json` and `render.png`. This is not a second implementation of the harness. The examples include one accepted motor reference and one intentionally unresolved servo challenge so future agents can compare good and bad shapes.

## Agent model

One grid cell is one 9.6 px breadboard-hole pitch. Components expose integer `WxH` placement footprints and canonical pin names grouped by side. The model chooses topology, placement, orientation, and optional sparse route corridors. The harness routes directly from exact physical pin axes around exact component rectangles.

The starter component geometry is embedded in `build-circuit`; other component geometry is available on demand through `inspect-circuit`. Use `focus` for temporary visual pin markers instead of asking a model to infer small pins from an unmarked screenshot.

See [`docs/guides/agent-harnesses.md`](./docs/guides/agent-harnesses.md) for the action contract and experiment loop.

## Validation

```bash
pnpm check
pnpm test
pnpm harness:smoke
pnpm audit:components
pnpm audit:examples
```

Useful docs:

- [`AGENTS.md`](./AGENTS.md) for repository rules.
- [`docs/architecture/overview.md`](./docs/architecture/overview.md) for ownership and data flow.
- [`docs/guides/adding-components.md`](./docs/guides/adding-components.md) for catalog work.

## Upstream building blocks

- `@wokwi/elements`, MIT, for component visuals and pin metadata.
- `avr8js`, MIT, for the ATmega328P CPU/peripherals.
- Adapted device implementations are listed in [`docs/legal/THIRD_PARTY_NOTICES.md`](./docs/legal/THIRD_PARTY_NOTICES.md).
- Adapted Fritzing assets are listed in [`public/assets/fritzing/ATTRIBUTION.md`](./public/assets/fritzing/ATTRIBUTION.md).

The MCU runtime currently targets one Arduino Uno per simulation.
