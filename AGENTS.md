# Repository instructions

Use `pnpm`. Keep the repo small and keep policy in the layer that owns it.

- `src/app/` is UI only.
- `src/components/` owns the canonical part catalog and geometry.
- `src/circuit/`, `src/breadboard/`, and `src/wires/` own document and physical geometry.
- `src/sim/` owns diagnostics and runtime behavior.
- `src/agent/` owns WebMCP tools, the direct scene script, geometry inspection, and construction validation.
- `scripts/harness/` is the production browser harness. `scripts/testing/` and `scripts/maintenance/` are validation only.

`build-circuit` is the only production construction tool. The model owns topology, component placement/orientation, breadboard holes, GPIO choices, wire colors, every visible wire bend, and visual critique. Deterministic code owns canonical component geometry, endpoint resolution, electrical diagnostics, hard physical validation, and simulation.

Use the direct scene contract rather than adding another planner or auto-router. Exact coordinates and breadboard holes are allowed when they help the model express the literal scene, but prefer symbolic endpoints and `x(endpoint)` / `y(endpoint)` axes over copying decimals. Electrical correctness and visual readability are separate checks. Do not weaken either to improve a score.

Preserve `THIRD_PARTY_NOTICES.md` and `public/assets/fritzing/ATTRIBUTION.md`. Never commit generated `dist/`, `benchmark-results/`, browser profiles, screenshots, or debug output.

Before finishing:

```bash
pnpm check
pnpm test
pnpm harness:smoke
git diff --check
```
