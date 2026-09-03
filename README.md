# Circuit Builder

A WebMCP electronics workbench where a person and an agent edit the same live circuit. Build with real component geometry, breadboards, Arduino code, diagnostics, and simulation.

## Why WebMCP

The browser exposes one production construction tool, `build-circuit`. The agent describes topology and functional intent. Deterministic code turns that intent into valid breadboard seats, power rails, junctions, orthogonal wiring, diagnostics, and a runnable simulation.

Supporting tools let the agent inspect exact circuit state, update Arduino code, focus parts or pins, and observe simulation results. The WebMCP registration is in [`src/agent/webmcp.ts`](./src/agent/webmcp.ts).

Typical loop: `Plan -> Build -> inspect -> revise -> Verify`.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/` in a WebMCP-enabled browser. Ask the agent to build a circuit, then inspect the shared workbench while it builds, programs, and simulates it.

## Verify

```bash
pnpm check
pnpm test
pnpm harness:smoke
```

Optional deeper audits: `pnpm audit:components` and `pnpm audit:examples`.

The project currently includes 50 components and Arduino Uno simulation.

## License

MIT. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and `public/assets/fritzing/ATTRIBUTION.md` for third-party attribution.
