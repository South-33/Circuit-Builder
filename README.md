# Circuit Builder

A browser electronics workbench built for WebMCP. People and agents work on the same live circuit, with real component geometry, breadboards, wiring, Arduino code, diagnostics, and simulation.

## WebMCP

There is one production construction tool: `build-circuit`.

The agent describes topology and high-level intent with semantic JavaScript. Deterministic code owns exact breadboard holes, rails, junctions, clearance, orthogonal routing, diagnostics, and simulation. Supporting tools inspect the circuit, update code, focus the workbench, and run simulation.

The normal agent loop is:

`Plan -> Build -> inspect -> revise intent -> Verify`

The semantic API includes `part`, `connect`, `net`, `power`, `ground`, `stage`, `flow`, `code`, `near`, `rotate`, and `mount`. Exact placement and seating exist only as escape hatches.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/`.

## Harness

```bash
pnpm harness:list
pnpm harness:smoke
pnpm harness --input scripts/harness/examples/ir-motor-hard.json --out benchmark-results/demo-motor
```

Generated renders and reports are written to ignored `benchmark-results/`.

## Validate

```bash
pnpm check
pnpm test
pnpm audit:components
pnpm audit:examples
```

The catalog currently contains 50 components. The MCU runtime targets one Arduino Uno per simulation.

## License

MIT. Third-party attributions are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and `public/assets/fritzing/ATTRIBUTION.md`.
