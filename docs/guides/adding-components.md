# Adding components

Keep component additions metadata-driven. Do not add one-off UI branches when the existing generic systems can describe the part.

1. Add the canonical type to `src/components/partTypes.ts`.
2. Add its `PartDefinition` to `src/components/parts.ts`, including name, category, dimensions, scale, pins, defaults, searchable keywords, and inspector properties.
3. If it is backed by `@wokwi/elements`, register the custom element in `src/components/registerElements.ts`.
4. If it uses static artwork, place the asset under `public/assets/` and preserve the required attribution/license information.
5. Set `breadboardMount: true` only when the physical pin pitch and geometry really fit the breadboard model.
6. Add simulation behavior in the closest module under `src/sim/devices/`. Keep `simulated: false` until the behavior is actually modeled.
7. Add or update tests for pin aliases, geometry, diagnostics, and simulation behavior as appropriate.
8. Run `pnpm check` and `pnpm test`.

Agent geometry should come from the same part metadata and pin geometry used by the UI. Do not create a second hand-maintained table of fake sizes or pin positions for a harness.
