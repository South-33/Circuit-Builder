# Agent circuit-building contract

The agent should behave like a careful person laying out a circuit on graph paper. The workbench supplies exact electrical semantics and a compact planning grid. The agent owns the spatial design.

## Recommended loop

1. Call `inspect-circuit` with the default compact response.
2. Infer the electrical topology before worrying about exact visual placement.
3. Place the major components in one `edit-circuit` batch using `grid:{x,y}`.
4. Seat breadboard components with `seat:{breadboardId,pin,hole}` when possible.
5. Request pins only for the parts currently being wired: `includePins:true, pinPartIds:[...]`.
6. Draw wires explicitly with `connect-pins` and `gridWaypoints`.
7. Inspect the planning grid and layout quality report.
8. Repair avoidable overlaps, crossings, component collisions, and unnecessary bends.
9. Set code and start simulation.
10. Finish only after electrical diagnostics and the intended behavior pass.

## Placement rules

- Keep the recognizable organization of a reference image when useful, but do not copy cramped spacing blindly.
- Move components farther apart when that creates simpler wire lanes.
- Place large/major parts first: board, breadboard, motors/displays, then small passive parts.
- Put related parts near one another.
- Breadboard-mounted parts belong in named holes, not approximate pixels.

Breadboard names:

- terminal strips: `A1..E<n>` and `F1..J<n>`
- top rails: `+top1`, `-top1`, etc.
- bottom rails: `+bottom1`, `-bottom1`, etc.

Example compact placement:

```json
{
  "type": "wokwi-ir-receiver",
  "id": "ir1",
  "seat": {"breadboardId":"bb1", "pin":"GND", "hole":"E20"}
}
```

The workbench aligns `GND` to `E20` and infers the other pins from real geometry.

## Wire rules

Think like plumbing or road lanes:

- Prefer long straight horizontal/vertical runs.
- Use the fewest practical 90-degree bends.
- Give every independent wire its own traceable lane.
- Parallel related wires in neighboring lanes instead of overlapping them.
- Avoid running through unrelated component bodies.
- Avoid crossings when a nearby free lane exists.
- Leave room around crowded Arduino headers before turning into long runs.
- Branch toward the destination late when that keeps a bundle easy to read.
- Use conventional colors when applicable: power red, ground dark/black; make signals distinguishable.

Example:

```json
{
  "from": "uno1:5V",
  "to": "bb1:+top1",
  "role": "power",
  "gridWaypoints": [
    {"x":10,"y":16},
    {"x":10,"y":7},
    {"x":18,"y":7}
  ]
}
```

Those interior grid points are authoritative. The app will not later reroute them. It only joins the authored path to the exact source/destination pin geometry.

## Reading layout feedback

The layout validator reports issues such as:

- component overlap
- wire through component
- wire overlap
- wire crossing
- diagonal agent-authored waypoint runs
- excessive bends
- unnecessarily long routes

Treat it as feedback, not an optimizer. The agent should decide how to repair the layout.

## Screenshot reconstruction

For an image reference:

1. identify components and electrical roles
2. infer connections/pin usage
3. recreate the broad spatial grouping
4. improve spacing where necessary for readable wiring
5. route explicitly
6. validate
7. simulate

The goal is a circuit that is electrically correct, visually recognizable, and easier to trace than a blind pixel-for-pixel copy.