# Agent harness experiments

The app exposes one harness profile per browser tab. Select it with the URL query parameter:

| URL | Harness | What the model controls |
| --- | --- | --- |
| `/?harness=legacy` | Legacy control | Existing CRUD placement plus manual wire waypoints. |
| `/?harness=a` | A: Procedural Grid | Ordered MineBench-style place/move/rotate/seat/connect operations. |
| `/?harness=b` | B: Blueprint Grid | One holistic snapped 2D blueprint with exact centers and exact wire paths. |
| `/?harness=c` | C: Semantic Solver | Relative placement intent and electrical connections. Geometry and routing are solved deterministically. |

Aliases such as `?harness=procedural`, `?harness=blueprint`, and `?harness=semantic` also work.

Only the active mutating action space is registered. This is intentional. An agent should not have to choose between three competing ways to place the same component during one run.

## Shared tools

Experimental profiles expose a small common surface:

- `inspect-circuit` reads exact state, diagnostics, the ASCII planning map, part `centerGrid`, and active harness metadata.
- `build-circuit` is the active A/B/C construction tool. Its schema and description change with the selected harness.
- `set-code` changes the Arduino sketch.
- `simulate` starts or stops AVR execution.
- `focus` highlights exact UI items.
- `benchmark-run` starts or finishes an experiment log.

The legacy control keeps `edit-circuit` and `connect-pins` instead of `build-circuit`.

## Grid representation

The returned ASCII map is exact state feedback, not a second circuit document.

The ASCII map and A/B component coordinates use the coarse 32 px planning grid. Exact pin locations are not rounded to that grid. Breadboard holes and Harness C routes use the 9.6 px physical connector lattice, so a clean route can still attach to the true pin center even when that point falls between planning cells.

```text
 -4 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
 -3 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
 -2 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
 -1 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
  0 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
  1 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
  2 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
  3 | ..EEEEEEEEEE...AAAAAAAAAAAA...BBBB...
  4 | ........***********..................
```

The legend maps each character to a part ID/type. `*` is a wire and `X` is a meaningful crossing. `map.spans` gives exact grid footprints.

Do not make the model paint individual cells as its normal action language. The grid is primarily a compact spatial observation and correction surface.

## Harness A: Procedural Grid

Use this to test whether a strong model can do the geometry itself when the API is tiny and regular.

One `build-circuit` call contains ordered operations:

```json
{
  "replace": true,
  "operations": [
    { "op": "place", "id": "bb", "type": "breadboard-half", "center": { "x": 0, "y": 0 } },
    { "op": "place", "id": "bat", "type": "battery-9v", "center": { "x": 0, "y": -8 }, "rotate": 90 },
    { "op": "connect", "from": "bat:+", "to": "bb:+top20", "role": "power", "via": [{ "x": 3, "y": -5 }, { "x": 3, "y": -4 }] }
  ]
}
```

The model owns exact center positions, orientation, and optional orthogonal wire turn points.

## Harness B: Blueprint Grid

Use this to test the user's holistic matrix/blueprint idea without forcing cell-by-cell painting.

```json
{
  "replace": true,
  "parts": [
    { "id": "bb", "type": "breadboard-half", "center": { "x": 0, "y": 0 } },
    { "id": "bat", "type": "battery-9v", "center": { "x": 0, "y": -8 }, "rotate": 90 }
  ],
  "connections": [
    { "from": "bat:+", "to": "bb:+top20", "role": "power", "path": [{ "x": 3, "y": -5 }, { "x": 3, "y": -4 }] }
  ]
}
```

The model submits the whole scene as one coherent spatial object and can replace it on the next pass.

## Harness C: Semantic Solver

Use this to test whether the model should specify relationships while deterministic code handles geometry.

```json
{
  "replace": true,
  "parts": [
    { "id": "bb", "type": "breadboard-half", "anchor": true },
    { "id": "uno", "type": "wokwi-arduino-uno", "relative": { "to": "bb", "side": "left", "gap": 3 } },
    { "id": "bat", "type": "battery-9v", "relative": { "to": "bb", "side": "above", "gap": 2, "portsFace": true }, "rotate": "auto" }
  ],
  "connections": [
    { "from": "bat:+", "to": "bb:+top20", "role": "power" }
  ]
}
```

The harness resolves relative placement, tries right-angle rotations when `portsFace` is requested, avoids component overlap, and autoroutes all requested connections as a group of orthogonal lanes.

## Logging a real agent run

At the beginning:

```json
{ "action": "start", "label": "reference-01-model-x-harness-a" }
```

At the end:

```json
{ "action": "finish", "notes": "Any short observations about what was difficult or corrected." }
```

The report includes layout score/issues, electrical diagnostic counts, content center offset, total wire length, bends, tool-call count, failures, traffic, latency, and the call log. `finish` also persists the run in browser localStorage for the same origin and stores it at `window.__webmcp_last_run__` for that tab. The browser keeps the most recent 100 runs.

To inspect recent persisted run summaries from any harness tab on the same origin:

```json
{ "action": "history" }
```

Generated local smoke logs from `pnpm benchmark:harnesses` are written under `benchmark-results/` and ignored by git.

## Fair comparison protocol

For a real model comparison:

1. Use the same reference image/task, model, temperature/settings, and system-prompt budget.
2. Start each run from an empty workbench in a fresh tab with one harness URL.
3. Give each agent the same evaluation prompt. Do not describe the expected winning strategy.
4. Run at least five attempts per harness. One lucky render is not enough.
5. Save the `benchmark-run finish` report and a final screenshot.
6. Compare deterministic metrics first, then do blind visual preference judging on the final renders.
7. Test visual-refinement loops only after the best two action spaces are known. Keep the no-visual-feedback condition as a control.

`pnpm benchmark:harnesses` is only an implementation smoke test with fixed known-good inputs. It must not be reported as evidence that one harness is better for LLMs.

## Prompt template for an evaluation agent

Use the same text for each harness, changing only the URL and run label:

```text
Open the supplied Hardware Lab URL and use only the WebMCP tools registered by that page.
Start from an empty workbench.

Call benchmark-run with action=start and the supplied run label.
Rebuild the reference circuit as faithfully as possible. Preserve electrical correctness, the reference's major spatial relationships and orientations, a compact centered composition, and clean readable cable management.

Use the active harness exactly as exposed. Do not switch harnesses, invent unavailable tools, or bypass WebMCP by directly mutating application state. Inspect exact state when useful. You may use the visible rendered result for a small targeted correction, but do not repeatedly tweak without a reason.

Before finishing, inspect the circuit, run any relevant electrical/simulation checks, and correct blocking errors. Then call benchmark-run with action=finish and a short note about any correction you made.

Return the final benchmark report unchanged.
```
