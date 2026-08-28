# Architecture

The app has one live circuit document. Human UI actions and WebMCP tools mutate the same `circuitStore`.

```text
React workbench UI                         WebMCP
       |                                     |
       +------------------+------------------+
                          |
                     circuitStore
                          |
              parts[] + connections[]
                 |               |
          exact geometry    wire geometry
                 |               |
                 +-------+-------+
                         |
                  circuit graph
                         |
              AVR8js + devices
```

## Ownership

- `src/app/` contains React UI and CSS. It may frame or highlight agent work, but circuit decisions do not belong here.
- `src/components/` owns canonical part types, metadata, visuals, pins, dimensions, and Wokwi element registration.
- `src/circuit/` owns document types, store/history, and presets.
- `src/breadboard/` owns physical breadboard geometry and seating.
- `src/wires/` owns exact pin locations and rendered wire geometry.
- `src/sim/` owns graph construction, diagnostics, AVR execution, and device adapters.
- `src/layout/` owns ordinary human-workspace placement helpers.
- `src/agent/core/` owns the agent grid, layout evaluation, common parsing, routing, and benchmark/session metrics.
- `src/agent/profiles/` owns experimental action spaces. Profiles are thin adapters over the same circuit store.
- `src/agent/webmcp.ts` registers the active profile plus common inspection, code, simulation, focus, and benchmark tools.
- `scripts/testing/` owns the regression suite and generated AVR fixtures.
- `scripts/benchmarks/` owns deterministic harness smoke comparisons.
- `scripts/maintenance/` owns repository hygiene checks.

## Agent coordinate system

The internal canvas can remain a large pixel world. Agents should not reason in those pixel coordinates.

- Grid `(0,0)` is the semantic center of the workbench.
- Positive X is right. Positive Y is down.
- One agent planning cell is 32 px.
- Exact pins, breadboard holes, visible workspace dots, and deterministic wire lanes use the separate 9.6 px physical connector pitch.
- New harness profiles use component **center coordinates**, not top-left coordinates.
- Every part has an exact rotated grid footprint derived from real rendered geometry.
- Breadboard-mounted parts should use named physical holes such as `E18` or `+top20` instead of guessed XY coordinates.

The legacy harness keeps its old top-left `grid` field for compatibility. `inspect-circuit` also returns `centerGrid` so experiments can compare both representations.

## Wire policy

Humans can still author visible bend points. Experimental agent profiles are allowed to use different policies:

- Harness A and B deliberately leave route geometry to the model.
- Harness C converts electrical intent into deterministic orthogonal routes.

The deterministic router lives under `src/agent/core/`, not `src/wires/`, because it is an agent-planning policy rather than the rendering model. It routes on the 9.6 px physical lattice while component relationships remain on the coarse 32 px planning grid. Electrical connectivity depends on semantic endpoints, never on the visual route.

## Camera versus scene

Scene coordinates and the camera are separate. Agent mutations dispatch `webmcp:frame-circuit`, and the UI frames the resulting content without rewriting scene geometry. This avoids the old failure where a valid circuit existed off-center in the visible viewport.

## Validation

`evaluateLayout()` is an independent geometry check. It catches part overlap, wires through parts, meaningful crossings/overlap, excessive bends, and extreme route stretch. Do not weaken it to make a harness benchmark pass. Fix the action space, placement, or router instead.

Electrical diagnostics are separate from layout quality. A circuit is only complete when the checks relevant to the task have actually been run.
