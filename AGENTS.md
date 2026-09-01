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
- `src/agent/`: the single physical block grid, parsing, deterministic routing, transactions, and WebMCP tools.
- `scripts/testing/`: regression suite and AVR fixture tooling.
- `scripts/harness/`: headless adapter and small committed scenarios for the exact production WebMCP tools.
- `scripts/maintenance/`: repo hygiene checks.
- `benchmark-results/`: local generated benchmark/audit output. Do not commit it.

## Agent/harness rules

- Grid `(0,0)` is the workbench center. Components use rounded blocks by top-left cell. Wires leave canonical pins on their exact axes; the 9.6 px grid is only a lane-spacing convention and a language for optional corridor hints.
- Keep exact visual pins canonical. The block grid is the coarse plan; connected-pin snapping or explicit `align` may slide a component by a fractional cell to share one exact pin axis. Route around exact component rectangles.
- Exact pin axes may have arbitrary sub-cell phases. Directional terminal leads and interior routing legs must remain at least one 9.6 px lane long; never reintroduce rounded ports or tiny adapter jogs.
- Do not create duplicate hand-maintained component size/pin tables for agents. Use canonical component and wire geometry.
- Keep one mutating action space. The model owns topology, block placement, and optional sparse corridors; the compiler owns detailed routes.
- Expanded multi-terminal net edges retain `netId`; same-net edges may reuse their trunk during routing, while only a shared lead at their common semantic terminal is exempt from overlap scoring.
- `inspect-circuit` exact state is primary feedback. Rendered browser feedback and sparse focus marks are for visual judging, not rediscovering known geometry.
- `evaluateLayout()` is independent evaluation. Never lower penalties, hide crossings, or relax checks just to improve a harness score.
- Electrical correctness and visual/layout quality are separate. Do not claim either passed unless the relevant check actually ran.
- Breadboard electrical state uses named holes such as `E20`, `A6`, `+top1`, and `-bottom1`.
- Preserve semantic wire endpoints even when visual routes change.
- Keep `src/app/` free of simulator/device-specific logic.
- Never mark a component `simulated: true` until its behavior is actually modeled.

## Experiment discipline

- Prove a small circuit first, then scale density. Do not add routing machinery until a smaller black-box agent run shows why it is needed.
- Keep exact-state and visual-refinement observations separate so the value of screenshots can be measured.

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
pnpm audit:components
pnpm audit:examples
git diff --check
git status --short
```

Fix the implementation when a real check fails. Do not weaken the check to make the run green.
