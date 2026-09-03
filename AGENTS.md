# Repository instructions

Use `pnpm`. Keep the repo small and keep policy in the layer that owns it.

- `src/app/` is UI only.
- `src/components/` owns the canonical part catalog and geometry.
- `src/circuit/`, `src/breadboard/`, and `src/wires/` own document and physical geometry.
- `src/sim/` owns diagnostics and runtime behavior.
- `src/agent/` owns WebMCP tools, semantic compilation, seating, rail allocation, and routing.
- `scripts/harness/` is the production browser harness. `scripts/testing/` and `scripts/maintenance/` are validation only.

`build-circuit` is the only production construction tool. The model owns topology, functional grouping, board choice, meaningful relative placement/orientation, GPIO choices, and visual critique. Deterministic code owns exact holes, rails, junctions, collision clearance, and detailed routes.

Keep exact coordinates and breadboard holes out of the normal model contract. Electrical correctness and visual readability are separate checks. Do not weaken either to improve a score.

Preserve `THIRD_PARTY_NOTICES.md` and `public/assets/fritzing/ATTRIBUTION.md`. Never commit generated `dist/`, `benchmark-results/`, browser profiles, screenshots, or debug output.

Before finishing:

```bash
pnpm check
pnpm test
pnpm harness:smoke
git diff --check
```
