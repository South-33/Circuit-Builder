# Harness notebook

Living working memory for the production circuit harness. Keep conclusions, not experiment history.

## Goal

The agent owns circuit intent, coarse placement, orientation, and rare corridor intent. Deterministic code owns exact pin geometry, breadboard physicalization, orthogonal routing, diagnostics, and artifact capture. Visual acceptance is by inspecting the render, never an aggregate number.

## Current shape

- One mutating `build-circuit` tool plus exact `inspect-circuit`, `set-code`, `simulate`, and temporary `focus` feedback.
- One 9.6 px placement cell matches the physical connector pitch. Component blocks are integer collision shadows; pins remain canonical and may have fractional cell phases.
- The scene language is deliberately small: `part`, relative placement, `seat`, `align`, `wire`, `net`, `rail`, and `bridge`.
- Breadboard-mounted parts must use named holes when a breadboard exists. Connected mounted pins should share a real strip instead of drawing a jumper.
- Shared supply uses compiler-owned rails with distinct physical holes. Ordinary terminals are never invisible junctions.
- Flexible cable pins may approach from any direction. Rigid headers retain their canonical outward side.

## Proven lessons

- Increasing grid resolution does not fix endpoint hooks. Exact sub-cell `align` does.
- Router penalties cannot rescue poor placement. Move or rotate the complete functional group before tuning a wire.
- A breadboard is an electrical region, not empty routing canvas. External cables remain outside and enter only at named holes or rails.
- Preserve multi-conductor cable order. If conductors exchange sides, change the component edge, orientation, or entry lanes instead of routing one around another.
- Conductors from one source connector enter on the same nearest board edge. Distribute to the far side locally or with one outside-edge bridge.
- Place multi-terminal peripherals by the combined distance of all active pins, not one favored signal. Give separate bundles separate board-edge zones.
- Keep conventional controller orientation and one readable controller-to-board-to-load band unless most active connections prove another layout better.
- Topology stays minimal. A USB-powered controller driving an external load normally needs common ground, not an extra battery-to-VIN connection.
- Numeric layout diagnostics find mechanical defects but cannot certify composition. Every part location and bend must still be explainable by eye.

## Last blind evidence

- A fresh Terra-low motor build reached an accepted visual shape: upright Uno left, compact seated switch stage, motor right, battery pair entering together at the nearest lower edge, and no scene-height source wire or crossing.
- Servo plus potentiometer generalized the coarse placement rule: the potentiometer moved from beneath the Uno to a board-edge zone. Remaining crossings came from independently physicalized power and ground branches, so ordered multi-rail cable compilation is the next focused experiment.

## Next experiment

Prove ordered multi-rail cable physicalization on the small servo plus potentiometer scene. Separate agent placement from deterministic routing responsibility:

1. Run a fresh blind scene through `pnpm harness`.
2. Inspect `render.png` directly and record the exact objection.
3. If placement is wrong, improve general composition guidance.
4. If placement is right but branches cross, change deterministic rail/cable compilation.
5. Re-run the same blind task, then generalize once to the motor scene.

Do not add a new tool, global grid, duplicate geometry table, learned model, or generic solver until this smaller failure proves it is necessary.
