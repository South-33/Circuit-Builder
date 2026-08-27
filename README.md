# WebMCP Hardware Lab

A small browser-based electronics workbench built for the WebMCP Challenge. The UI is intentionally beginner-friendly and canvas-first, while an agent can operate the exact same circuit through semantic WebMCP tools instead of mouse automation or screenshot reasoning.

## What works

- Place and drag parts on a shared circuit canvas.
- Connect exact semantic pins with visible wires.
- Edit Arduino C++ in the built-in code panel.
- Compile real Arduino sketches to AVR HEX and run them with `avr8js`.
- Simulate an Arduino Uno with LEDs, RGB LEDs, resistors, breadboards, pushbuttons, slide switches, potentiometers, buzzers, and 7-segment displays.
- Show `Serial` output in the code panel.
- Detect blocking power shorts and common LED wiring mistakes.
- Highlight exact parts, wires, and code lines for teaching or diagnosis.
- Undo and redo manual or agent changes.

The starter circuit is a real blinking LED project, so **Start Simulation** works immediately after launch.

## WebMCP tools

The page registers six tools when `document.modelContext` is available:

| Tool | Purpose |
| --- | --- |
| `inspect-circuit` | Read parts, pins, wires, code, diagnostics, and simulation state. |
| `edit-circuit` | Batch place, move, update, remove, or replace parts. |
| `connect-pins` | Batch-create validated semantic wires such as `uno1:13` to `led1:A`. |
| `set-code` | Replace a board's complete Arduino sketch. |
| `simulate` | Start or stop the live AVR simulation. |
| `focus` | Pulse exact parts/wires and highlight a code line range for the user. |

This keeps image-to-circuit workflows low-latency. An agent can usually build the physical layout in one `edit-circuit` call, wire it in one `connect-pins` call, set code, then start the simulation.

## Run locally

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

## Architecture

```text
Tinkercad-inspired UI
        |
parts[] + connections[]
        |
small semantic circuit graph
        |
AVR8js Arduino runtime
        |
Wokwi component elements

same live state <-> WebMCP tools
```

There is no separate agent document and no computer-use layer. Manual edits and WebMCP calls mutate the same store and immediately update the same canvas.

## Upstream building blocks

- [`@wokwi/elements`](https://github.com/wokwi/wokwi-elements), MIT. Used for electronic component visuals and semantic pin metadata.
- [`avr8js`](https://github.com/wokwi/avr8js), MIT. Used for the ATmega328P CPU and peripherals.
- Arduino source is compiled through the HEXI build endpoint used by the official AVR8js browser demo. Successful builds are cached locally to make repeat simulation starts fast.

The application is not based on the Velxio application code. Velxio was used only as a reference while evaluating simulator approaches. The interaction style is inspired by Tinkercad Circuits, but no Tinkercad code or assets are included.

## MVP boundary

The real MCU runtime currently targets one Arduino Uno per simulation. The circuit document and WebMCP layer are intentionally generic enough to add more boards later without expanding the agent tool surface.
