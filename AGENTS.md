This is the project's AGENTS.md

# Repository instructions

Keep this repo small, explicit, and easy for a weaker implementation agent to navigate.

## Read first

1. `docs/architecture/overview.md`
2. `docs/guides/agent-harnesses.md` for any WebMCP/agent work
3. `docs/guides/adding-components.md` for component work

Use `pnpm` only.

## Directory ownership

- `src/app/`: React UI and CSS. No circuit/simulation policy.
- `src/components/`: canonical parts, dimensions, pins, properties, and element registration.
- `src/circuit/`: document types, store/history, and presets.
- `src/breadboard/`: named-hole geometry and physical seating.
- `src/wires/`: exact pin/wire rendering geometry. It does not decide agent routing policy.
- `src/sim/`: graph, diagnostics, AVR runtime, and device adapters.
- `src/layout/`: ordinary workspace placement helpers.
- `src/agent/core/`: shared agent grid, geometry checks, deterministic router, parsing, and run metrics.
- `src/agent/profiles/`: mutually exclusive experimental action spaces A/B/C.
- `src/agent/webmcp.ts`: WebMCP registration and common tools.
- `scripts/testing/`: regression suite and AVR fixture tooling.
- `scripts/benchmarks/`: harness implementation smoke comparisons.
- `scripts/maintenance/`: repo hygiene checks.
- `benchmark-results/`: local generated benchmark/audit output. Do not commit it.

## Agent/harness rules

- Grid `(0,0)` is the semantic workbench center. New harness coordinates refer to component centers.
- The agent planning grid is coarse: one planning cell is 32 px. Keep that conversion in `src/agent/core/grid.ts` as the single source of truth.
- Pins, breadboard holes, visible workspace dots, and Harness C routing use the separate 9.6 px physical connector lattice. Never force physical geometry onto the 32 px planning grid.
- Do not create duplicate hand-maintained component size/pin tables for agents. Use canonical component and wire geometry.
- Harness A and B intentionally let the model own layout/routing geometry. Harness C intentionally uses deterministic placement/routing helpers. Do not make them converge into the same interface before the experiment is evaluated.
- Only one mutating harness action space should be registered per page. Avoid giving the model several equivalent tools and asking it to choose.
- `inspect-circuit` exact state and the ASCII grid are primary feedback. Rendered browser feedback is useful for visual judging, not for rediscovering geometry the app already knows.
- `evaluateLayout()` is independent evaluation. Never lower penalties, hide crossings, or relax checks just to improve a harness score.
- Electrical correctness and visual/layout quality are separate. Do not claim either passed unless the relevant check actually ran.
- Breadboard electrical state uses named holes such as `E20`, `A6`, `+top1`, and `-bottom1`.
- Preserve semantic wire endpoints even when visual routes change.
- Keep `src/app/` free of simulator/device-specific logic.
- Never mark a component `simulated: true` until its behavior is actually modeled.

## Experiment discipline

- `pnpm benchmark:harnesses` is only a deterministic smoke test with fixed known-good inputs. It does not prove one harness is better for an LLM.
- Real model comparisons use fresh tabs with `?harness=a`, `?harness=b`, `?harness=c`, or `?harness=legacy`, plus `benchmark-run start/finish`.
- Use the same task/model/settings for each profile and run multiple attempts.
- Keep visual-refinement-loop experiments separate until the action-space comparison is done.

## Adding a component

Follow `docs/guides/adding-components.md`. In short, update the canonical type/catalog, register visuals, add real simulator behavior or leave `simulated: false`, add tests, and reuse the same geometry everywhere.

## Licensing and cleanup

- Do not copy AGPL/GPL application code into this project. Research concepts are fine. Reimplement cleanly or use compatible upstream code/assets with attribution.
- Preserve `docs/legal/THIRD_PARTY_NOTICES.md` and `public/assets/fritzing/ATTRIBUTION.md` when touching adapted code/assets.
- Do not commit temporary browser profiles, screenshots, build output, debug scripts, or generated benchmark JSON.

## Before finishing a change

Run:

```bash
pnpm check
pnpm test
pnpm benchmark:harnesses
pnpm audit:components
pnpm audit:examples
git diff --check
git status --short
```

Fix the implementation when a real check fails. Do not weaken the check to make the run green.
