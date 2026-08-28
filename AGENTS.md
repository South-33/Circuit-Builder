# Repository instructions

This repository is intentionally small and explicit. Preserve that shape.

## Before changing code

1. Read `docs/GUIDE.md` for architecture ownership, component catalog guides, and WebMCP agent workbench specifications.
2. Use `pnpm` only.

## Architecture ownership

- `src/app/`: React UI and CSS only. Do not put circuit intelligence here.
- `src/components/`: component catalog, canonical part types, and Wokwi element registration.
- `src/circuit/`: document types, store/history, and known-good presets.
- `src/agent/`: WebMCP tools, compact planning grid, and layout validation.
- `src/breadboard/`: breadboard geometry and physical seating/snapping.
- `src/wires/`: exact pin geometry and rendering of authored wire paths.
- `src/sim/`: AVR runtime, circuit graph, diagnostics, and device adapters.
- `src/layout/`: workspace placement helpers.
- `public/assets/`: runtime artwork only.
- `docs/`: architecture, guides, research, and legal notes.
- `scripts/`: repository checks only.

## Non-negotiable design rules

- Do not add an automatic/smart wire router. Humans and agents author wire paths. The app only snaps endpoints to exact physical pins and validates the result.
- Do not expand the six WebMCP tools unless a genuinely new capability cannot fit an existing tool.
- Prefer batch operations and semantic IDs over mouse automation or raw screenshots.
- Breadboard electrical state is expressed with named holes such as `E20`, `A6`, `+top1`, and `-bottom1`.
- Agent wire routes use explicit grid waypoints. Preserve authored interior paths.
- Keep `src/app/` free of simulator/device-specific logic.
- Never mark a component `simulated: true` unless the simulator actually models its behavior.
- Do not copy AGPL/GPL application code into this MIT project. Research concepts are fine; reimplement cleanly or use compatible upstream code/assets with attribution.
- Do not commit temporary browser profiles, screenshots, build output, debug scripts, or generated scratch files.

## Adding a component

Follow `docs/GUIDE.md` (Section 2: Adding Components). In short:

1. Add the type to `src/components/partTypes.ts`.
2. Add its metadata to `src/components/parts.ts`.
3. If Wokwi-backed, add one import to `src/components/registerElements.ts`. If static artwork, put it under `public/assets/` and add required attribution.
4. Add real simulation behavior in the closest module under `src/sim/devices/`, or set `simulated: false` until implemented.
5. Add inspector properties through component metadata, not custom UI branches when a generic property control is sufficient.
6. Run `pnpm check`.

## Before committing

Run:

```bash
pnpm check
git diff --check
git status --short
```

Keep commits coherent and leave the working tree free of stale/debug artifacts.