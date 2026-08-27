# Architecture

The workbench has one shared semantic circuit document. Human UI actions and WebMCP actions mutate that same state.

```text
React workbench UI                 WebMCP agent tools
        |                                  |
        +-------------+--------------------+
                      |
                 circuit store
                      |
          parts[] + connections[]
             |                |
     exact part/pin       authored wire
       geometry             waypoints
             |                |
             +-------+--------+
                     |
              circuit graph
                     |
        AVR8js + device adapters
```

## Source tree

```text
src/
  main.tsx                 application entrypoint only
  app/
    App.tsx                workbench interaction/UI composition
    styles.css             UI styling
  components/
    partTypes.ts           canonical supported component type list
    parts.ts               component catalog and pin metadata
    registerElements.ts    Wokwi custom-element imports
  circuit/
    types.ts               semantic document types
    store.ts               mutations, undo/redo, selection, focus
    presets.ts             known-good example circuits
  agent/
    webmcp.ts              six WebMCP tools
    layout.ts              planning grid + layout validation
  breadboard/
    geometry.ts            named holes, rails, dimensions
    placement.ts           drag snapping and explicit seating
  wires/
    geometry.ts            exact physical pin coordinates
    path.ts                render authored paths; no autorouting
  layout/
    placement.ts           large workspace and open placement
  sim/
    simulator.ts           simulation lifecycle
    avrRunner.ts           AVR execution
    circuitGraph.ts        electrical connectivity
    diagnostics.ts         circuit diagnostics
    devices/               device-family adapters
```

## Important boundaries

### Component catalog

`src/components/parts.ts` is descriptive metadata: name, artwork/tag, dimensions, defaults, properties, pin summary, and whether a part can mount on a breadboard. It should not contain runtime simulation logic.

`src/components/partTypes.ts` is the canonical type list. `PART_ORDER` is derived from it, so adding a supported type cannot silently disappear from the parts tray.

### Wires

A wire has semantic endpoints (`partId:pin`) and optional authored waypoints. Electrical connectivity depends only on the endpoints. Waypoints control presentation.

There is deliberately no automatic router. The renderer may add a minimal endpoint elbow so an authored grid path lands on the exact physical pin, but it must not redesign the interior path.

### Breadboards

Breadboard holes are semantic pins. Components physically mounted on a breadboard store `seating`, mapping each component pin to a named hole. The circuit graph adds seating edges, so no fake visual wires are needed between a seated lead and its hole.

Agents should prefer the compact anchor form `seat:{breadboardId,pin,hole}`. The workbench aligns that one pin and infers the remaining aligned holes from real geometry.

### Simulation

`src/sim/devices/index.ts` composes small device-family setup functions. Add behavior to the narrowest relevant adapter rather than growing `simulator.ts`.

The current MCU target is Arduino Uno / ATmega328P through AVR8js. Visual support and simulation support are separate claims. A part can render before its simulator adapter exists, but then its catalog entry must say `simulated: false`.

### WebMCP

The six tools are intentionally stable:

- `inspect-circuit`
- `edit-circuit`
- `connect-pins`
- `set-code`
- `simulate`
- `focus`

Prefer extending an existing tool schema to adding overlapping tools.