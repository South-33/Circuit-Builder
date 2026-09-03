# Repository instructions

Use `pnpm`. Keep the repository small and keep policy in the layer that owns it.

## Structure

- `src/app/`: React UI only.
- `src/components/`: canonical component catalog, dimensions, pins, properties, registration.
- `src/circuit/`: document model, store, history, presets.
- `src/breadboard/`: named-hole geometry and seating.
- `src/wires/`: exact wire/pin rendering geometry.
- `src/sim/`: graph, diagnostics, AVR runtime, simulated devices.
- `src/layout/`: ordinary workspace placement helpers.
- `src/agent/`: semantic compiler, deterministic physicalizer/router, transactions, WebMCP tools.
- `scripts/harness/`: headless runner for the production WebMCP surface.
- `scripts/testing/`: regression suite and committed fixtures.
- `scripts/maintenance/`: repo/component/render checks.

## Circuit-agent rules

- `build-circuit` is the only production construction harness.
- The model owns topology, component and board choice, functional stages, meaningful relative placement/orientation, GPIO choices, and visual critique.
- Deterministic code owns exact seats, rail/domain assignment, strip junctions, collision clearance, connector defaults, and detailed routes.
- Keep exact coordinates and breadboard holes out of the normal model contract. `place` and `seat` are escape hatches.
- Electrical correctness and visual readability are separate checks. Never weaken diagnostics or layout evaluation to improve a score.
- Preserve semantic wire endpoints when visual routes change.
- Keep independent positive power domains isolated. Prefer one common-ground backbone across multiple boards.
- Use the smallest board that still leaves readable functional stages and routing space.
- Keep `src/app/` free of simulator/device-specific policy.
- Never mark a component simulated until its behavior is implemented.

## Components

For a new component, update the canonical type/catalog, register its visual element or asset, add real simulation behavior or leave it unsimulated, and add tests. Reuse canonical geometry everywhere.

## Licensing and generated files

Do not copy incompatible application code. Preserve `THIRD_PARTY_NOTICES.md` and `public/assets/fritzing/ATTRIBUTION.md`. Do not commit `dist/`, `benchmark-results/`, browser profiles, screenshots, or debug output.

## Before finishing

```bash
pnpm check
pnpm test
pnpm audit:components
pnpm audit:examples
git diff --check
git status --short
```
