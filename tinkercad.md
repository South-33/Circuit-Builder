# Tinkercad Circuits baseline for an agent-native hardware builder

Status: initial live baseline  
Observed: 2026-08-27  
Source: the open Tinkercad Circuits editor session

## Executive summary

Tinkercad Circuits is a strong baseline for the manual experience. It gives a beginner a visual canvas, a searchable component palette, breadboards, Arduino and micro:bit starter projects, wiring, code editing, simulation controls, a serial monitor, notes, undo/redo, and sharing.

The main weakness is not the visual editor. It is the missing semantic bridge between the editor and an agent.

An agent currently has to reason through UI state, selection state, canvas coordinates, tiny pins, and rendered wires. The page visibly contains useful structure, including component instance IDs, transforms, pin titles, and wire hit geometry, but that structure is not exposed as a stable circuit graph. This is why wiring diagnosis falls back to vision and why a model can miss a wrong connection.

The product opportunity is:

> Keep the shared visual editor, but expose the underlying circuit as a typed, addressable graph.

Tinkercad is a good vocabulary and usability baseline. It is not a complete hardware baseline for the proposed product because the current library does not show ESP32 or Pico support, and the current page did not expose a usable WebMCP tool surface.

## Scope and confidence

This document separates three kinds of information:

- Observed: directly visible or queryable in the live editor.
- Inferred: behavior strongly implied by the UI, but not exhaustively tested.
- Proposed: the MCP and agent features needed for the target product.

The live project was inspected without intentionally changing component values, code, or wiring. Selection, view changes, palette menus, toolbar menus, and simulation controls were inspected. The current open project contains real components and wiring, so destructive interaction was avoided.

## 1. Manual capabilities observed

### 1.1 Workspace and views

The top workspace switcher exposes:

- Circuits
- Schematic
- Components

The current editor shows a warning that the Electronics Lab design can only be edited and have components added in the Lab View. The Circuits workspace is the editable breadboard-style view.

The editor toolbar exposes:

- Zoom to Fit
- Rotate
- Mirror Vertical
- Mirror Horizontal
- View aids toggle
- Layers toggle
- Undo
- Redo

The current editor uses a large visual canvas with a right-side component palette. The code panel can be opened as a split view and collapsed again.

The current project also exposes a project name field in the top bar and an account/profile control.

### 1.2 Component discovery and placement

The component panel provides:

- Search
- Category filtering
- Starter-project filtering
- Drag-and-drop placement into the circuit canvas
- Component selection
- Component-specific property inspection

The search control has a visible hint for the Ctrl+F shortcut.

The component group selector exposes:

- Basic
- All

Starter groups expose:

- Basic
- Arduino
- micro:bit
- Circuit Assemblies
- All

The palette is beginner-friendly because it uses named visual tiles, but placement is still fundamentally a screen interaction. An agent would need to search for a part, select it, drag it to a coordinate, and then orient it manually.

### 1.3 Component library

The live All category showed the following component groups and parts.

General:

- Resistor
- Capacitor
- Polarized Capacitor
- Diode
- Zener Diode
- Inductor

Input:

- Pushbutton
- Potentiometer
- Slideswitch
- Photoresistor
- Photodiode
- Ambient Light Sensor (Phototransistor)
- Flex Sensor
- Force Sensor
- IR sensor
- Ultrasonic Distance Sensor
- Ultrasonic Distance Sensor (4-pin)
- PIR Sensor
- Soil Moisture Sensor
- Tilt Sensor
- Temperature Sensor (TMP36)
- Gas Sensor
- Keypad 4x4
- DIP Switch DPST
- DIP Switch SPST x 4
- DIP Switch SPST x 6

Output:

- LED
- LED RGB
- Light bulb
- NeoPixel
- NeoPixel Ring 12
- NeoPixel Ring 16
- NeoPixel Ring 24
- NeoPixel Strip 4
- NeoPixel Strip 6
- NeoPixel Strip 8
- NeoPixel Strip 10
- NeoPixel Strip 12
- NeoPixel Strip 16
- NeoPixel Strip 20
- Vibration Motor
- DC Motor
- DC Motor with encoder
- Micro Servo
- Hobby Gearmotor
- Piezo
- IR remote
- 7 Segment Display
- LCD 16 x 2
- LCD 16 x 2 (I2C)
- 7-Segment Clock Display

Power:

- 9V Battery
- 1.5V Battery
- Coin Cell 3V Battery
- Solar Cell
- Potato Battery
- Lemon Battery

Breadboards:

- Breadboard
- Breadboard Small
- Breadboard Mini

Microcontrollers:

- micro:bit
- micro:bit with Breakout
- Arduino Uno R3
- ATtiny

Instruments:

- Multimeter
- Power Supply
- Function Generator
- Oscilloscope

Integrated Circuits:

- Timer
- Dual Timer
- 741 Operational Amplifier
- Quad comparator
- Dual comparator
- Optocoupler

Power Control:

- NPN Transistor (BJT)
- PNP Transistor (BJT)
- Small Signal nMOS Transistor
- Small Signal pMOS Transistor
- nMOS Transistor (MOSFET)
- pMOS Transistor (MOSFET)
- TIP120
- Relay SPDT
- Relay DPDT
- 5V Regulator (LM7805)
- 3.3V Regulator (LD1117V33)
- H-bridge Motor Driver

Connectors:

- 8 Pin Header
- USB standard A

Logic:

- Quad NAND gate
- Quad NOR gate
- Quad AND gate
- Quad OR gate
- Quad XOR gate
- Hex Inverter
- Inverting Schmitt Trigger
- Quad NAND Schmitt Trigger
- Triple 3-Input NAND gate
- Triple 3-Input AND gate
- Triple 3-Input NOR gate
- Dual 4-Input NAND gate
- Dual 4-Input AND gate
- Dual J-K Flip-Flop
- Dual D Flip-Flop
- 4-Bit Latch
- 4-Bit Binary Counter
- 4-Bit Adder
- 8-Bit Shift Register
- Johnson Decade Counter
- 7-Segment Decoder
- 8-port I2C expander

The palette also includes Text as a utility item.

Important target-product gap:

- No ESP32 was visible in the live Microcontrollers or All lists.
- No Raspberry Pi Pico was visible in the live Microcontrollers or All lists.
- The visible microcontroller choices were Arduino Uno R3, ATtiny, micro:bit, and micro:bit with Breakout.

This makes Tinkercad useful for interaction design, but not sufficient as the hardware support baseline for an ESP32-first product.

### 1.4 Starter projects

Arduino starters observed:

- Breadboard
- Blink
- Fade
- Button
- Debounce
- State Change Detection
- Analog Input
- Digital Read Serial
- Analog Read Serial
- Servo
- Tone Keyboard
- Tone Melody
- Tone Multiple
- Tone Pitch Follower
- Ultrasonic Range Finder
- Neopixel
- 2 wire LCD
- LCD
- Analog In, Serial Out
- Calibration
- Smoothing
- Read Analog Voltage
- Blink Without Delay
- Input Serial Pullup
- Moisture
- Voltage Meter
- Infrared Receiver

micro:bit starters observed:

- Breadboard
- Alarm
- Analog
- Compass
- Gestures
- Light
- Moisture
- Radio
- Servo
- micro:bit breakout

Circuit assembly starters observed:

- Glow Circuit Assembly
- Move Circuit Assembly
- Spin Circuit Assembly

Starter projects are valuable for beginners because they encode working patterns. For an agent, they also suggest a useful source of reusable templates and test fixtures.

### 1.5 Selection, identity, and properties

Selecting a component opens an inspector panel.

Common property:

- Name

Properties verified on actual components in the open project:

| Component | Inspector fields observed |
| --- | --- |
| Arduino Uno R3 | Name |
| Breadboard Small | Name |
| 9V Battery | Name |
| IR remote | Name |
| DC Motor | Name |
| NPN Transistor (BJT) | Name |
| IR sensor | Name |
| Diode | Name |
| Resistor | Name, Resistance, resistance unit |
| LED | Name, Color |

The resistor unit selector showed:

- pΩ
- nΩ
- μΩ
- mΩ
- Ω
- kΩ
- MΩ
- GΩ

The LED color selector showed:

- Green
- Yellow
- Orange
- Blue
- Red
- White

The exact property set is component-specific. The agent API should expose properties using typed schemas, not a generic unvalidated key/value bag.

### 1.6 Copy, delete, undo, redo, and orientation

The top toolbar exposes:

- Copy
- Paste
- Delete
- Undo
- Redo
- Rotate
- Mirror Vertical
- Mirror Horizontal

These actions are selection-dependent. When a component is selected, copy, delete, and rotate become enabled. This is a usability issue for an agent because an action can silently depend on hidden selection state.

The agent version should address components by stable ID and should never require an implicit selection to mutate an object.

### 1.7 Wiring

The editor displays wires as colored routed paths between terminals and breadboard locations.

The toolbar exposes a wire color selector with:

- Black
- Red
- Orange
- Yellow
- Green
- Turquoise
- Blue
- Purple
- Pink
- Brown
- Grey
- White

The wire type selector exposes:

- Normal
- Hookup
- Alligator
- Automatic

The current canvas includes:

- Arduino pin labels such as D0 through D13, A0 through A5, 3.3V, 5V, Vin, GND, SDA, and SCL
- Component terminal labels such as Anode, Cathode, Base, Collector, Emitter, Positive, Negative, Power, GND, and Out
- Breadboard holes and power rails
- Colored wires with rounded or routed segments

Manual wiring is the most important pain point for the proposed product. The visual editor is good at showing a finished circuit, but it does not give an agent a direct, reliable operation such as:

Connect Arduino D5 to motor driver IN1.

An agent currently has to locate tiny pin targets, manage zoom and canvas coordinates, choose a wire route, and verify the result visually.

### 1.8 Code editing

The code panel exposes:

- Text mode
- Blocks mode
- Blocks + Text mode
- Programmable-device selector
- Code download
- Library panel
- Font-size control
- Serial Monitor

The live project contains one programmable device:

- 1 (Arduino Uno R3)

The code editor is CodeMirror-based. The code is rendered as line-numbered text in the DOM, with a hidden editing textarea behind the editor.

The code mode selector showed:

- Blocks
- Blocks + Text
- Text

The library panel showed:

- Adafruit LED Backpack
- Adafruit LiquidCrystal
- EEPROM
- IRremote
- LiquidCrystal
- LiquidCrystal I2C
- Keypad
- NeoPixel
- Servo
- SoftwareSerial
- Wire
- SD
- SPI
- Stepper

The current code panel includes an Arduino C++ program using IRremote and digital motor control. The editor can therefore support a workflow where the agent edits code and maps code variables to visible component pins.

Agent limitation:

- The code editor does not expose a semantic code patch tool.
- A browser agent must deal with CodeMirror focus, cursor state, and text replacement.
- A full replacement can destroy user edits.
- A line-level patch with validation would be safer and easier to explain.

### 1.9 Serial Monitor

The Serial Monitor exposes:

- Output area
- Text input
- Send
- Clear
- Graph toggle

The Send control is disabled until there is input. This is a useful interaction pattern for an agent because serial input can be treated as a simulation event:

- send_serial_input(device_id, text)

The graph toggle suggests that simulation output can be inspected as a time series, not only as text.

### 1.10 Simulation

The editor exposes a Start Simulation control. Its internal UI contains:

- Play state
- Stop state
- Spinner state

The live circuit includes interactive parts such as an IR remote and motors, so the intended workflow is:

1. Place and wire parts.
2. Write code.
3. Start the simulation.
4. Interact with input parts.
5. Observe outputs, serial output, and graph data.
6. Stop or revise the design.

During this inspection, an automated click on Start Simulation did not produce a visible running state or a user-facing error. Console logs contained initialization warnings, but no clear simulation diagnostic appeared in the editor. This should be treated as a baseline usability issue to retest in a clean project, not as proof that Tinkercad simulation is generally broken.

For the proposed product, simulation must expose structured results:

- compile status
- runtime status
- diagnostics
- pin values
- signal transitions
- sensor input events
- actuator output state
- serial output
- time-series traces

### 1.11 Notes, annotations, and view aids

The toolbar exposes:

- Add annotation
- Show or hide annotations
- View aids
- Layers

Notes are useful for a shared build-with-me workflow. An agent could use them for:

- build steps
- warnings
- physical assembly notes
- test checkpoints
- explanations attached to a component or wire

The proposed product should keep user-authored notes separate from agent-generated diagnostics, while allowing both to point to the same circuit object IDs.

### 1.12 Sharing and export

The Send To dialog showed:

- Picture of your design
- Download action for the picture
- Autodesk Fusion handoff
- Electrical design files with a .BRD option
- Invite people

The sharing copy says that people with the link may view and make changes.

This gives Tinkercad a basic collaboration and export story. The proposed agent-native product should extend it with:

- shareable circuit revisions
- change history
- agent action history
- reviewable diffs
- export to a physical build guide
- export to a structured circuit interchange format

## 2. What the live page reveals about its internal structure

The current page is visually driven, but its rendered DOM reveals useful structure.

Observed in the live canvas:

- One main circuit SVG canvas.
- 22 component SVG roots in the current project.
- Each component root has a type-like class such as cgfx__arduino-uno-r3, cgfx__breadboard-arduinokit, cgfx__resistor, or cgfx__led.
- Each component instance is wrapped in a group with an ID-like value and a transform.
- Transforms include translation, rotation, and scale.
- Arduino pin targets carry titles such as D2, D3, GND, 5V, A0, SDA, and SCL.
- Component terminals carry titles such as Anode, Cathode, Base, Collector, Emitter, and Terminal 1.
- The current project has 40 wire groups and 63 wire-segment hit paths.
- Visible wire paths are rendered in a separate canvas layer from the invisible wire hit areas.
- Wire hit paths contain route geometry but no direct human-readable source-pin or destination-pin metadata.
- The current canvas exposes hundreds of terminal and breadboard-hole elements because the breadboard is rendered at hole level.

The important conclusion is:

> The browser can see enough geometry to click, but geometry is not the same as connectivity.

The agent should not be asked to reconstruct the circuit graph from SVG paths. The simulator should expose the graph from its own model.

The page also exposes a CodeMirror code surface:

- code lines are represented as text nodes
- line numbers are separate visible elements
- a hidden textarea receives edits
- the current code can be read as a sequence of lines

This is sufficient for browser automation, but not sufficient for safe code collaboration. A first-class code document model is still needed.

No usable page-defined WebMCP tool surface was available from the current Tinkercad tab. The product should therefore treat WebMCP as a capability to add around the editor or simulator, not as an existing Tinkercad integration.

## 3. Strengths and weaknesses as a product baseline

### Strengths

- Very approachable visual editor.
- Familiar breadboard representation.
- Searchable and categorized parts.
- Broad beginner and intermediate component library.
- Built-in Arduino and micro:bit starter projects.
- Code, blocks, and mixed code modes.
- Simulation is integrated into the same surface.
- Serial Monitor and graph affordances exist.
- Component inspectors make common values easy to change.
- Undo and redo reduce the cost of experimentation.
- Notes, layers, and annotations support teaching and collaboration.
- Sharing is simple enough for a classroom or project team.

### Weaknesses

- No semantic netlist or connection graph is available to the agent.
- Wire geometry is visible, but wire endpoints are not exposed as a reliable text model.
- Breadboard connectivity is visually implicit and easy to misread.
- Long wires and dense layouts create tiny, ambiguous targets.
- Selection state is hidden and actions depend on it.
- Placement and orientation are coordinate-heavy.
- Component names default to simple numbers, which makes explanations harder.
- Part properties are inconsistent and not exposed through a common typed schema.
- Code editing is a text-surface operation, not a patch-aware operation.
- Simulation diagnostics were not surfaced clearly during this inspection.
- Board/device support does not match the ESP32 and Pico target.
- A shared link can allow edits, but an agent needs revision and conflict semantics.
- The current page did not expose a usable WebMCP surface.

## 4. Agent-native capabilities that would matter most

The highest-value change is to make every important editor object addressable by stable ID and understandable as structured data.

### 4.1 Read capabilities

The agent should be able to call:

- get_workspace_state
- list_components
- get_component
- list_component_pins
- get_pin
- list_wires
- get_wire
- list_nets
- get_net
- get_breadboard_connectivity
- get_supported_components
- get_programmable_devices
- get_code
- get_code_diagnostics
- get_simulation_state
- get_simulation_events
- get_serial_output
- list_annotations
- get_selection

The returned data should include stable IDs, not screen coordinates alone.

Example component record:

- id: component_17
- type: dc_motor
- name: left_motor
- position: x, y
- orientation: 180 degrees
- properties: typed values
- pins: pin_1, pin_2
- visual_anchor: canvas coordinates for highlighting

Example pin record:

- id: pin_1
- component_id: component_17
- name: terminal_1
- electrical_role: motor_input
- direction: passive
- connected_net_id: net_4
- screen_anchor: current visible location

Example wire record:

- id: wire_12
- source: arduino_1.D5
- destination: motor_left.terminal_1
- net_id: net_4
- route: grid points or routed segments
- color: green
- type: normal
- status: valid

### 4.2 Write capabilities

The agent should be able to call:

- add_component
- remove_component
- move_component
- rotate_component
- mirror_component
- update_component_properties
- rename_component
- connect_pins
- disconnect_pins
- reroute_wire
- set_wire_style
- apply_code_patch
- replace_code
- include_library
- start_simulation
- stop_simulation
- send_serial_input
- add_annotation
- update_annotation
- focus_object
- highlight_objects
- set_view

The key difference from computer use is that mutations address objects and pins directly:

- connect_pins(source_pin_id, destination_pin_id)
- move_component(component_id, position)
- rotate_component(component_id, degrees)
- apply_code_patch(device_id, patch)

The agent should not need to click a tiny screen target or depend on what is currently selected.

### 4.3 Analysis capabilities

The agent should be able to ask the simulator and circuit graph questions such as:

- validate_circuit
- find_unconnected_pins
- find_floating_inputs
- find_power_shorts
- find_ground_shorts
- find_missing_common_ground
- find_wrong_board_pin
- find_pin_conflicts
- find_overloaded_outputs
- find_missing_flyback_diode
- trace_signal
- explain_net
- explain_compile_error
- compare_code_to_wiring
- compare_virtual_to_physical_checklist

These checks should return deterministic evidence:

- object IDs
- pin IDs
- measured or inferred values
- the rule that failed
- a short explanation
- a suggested fix
- a visual focus target

### 4.4 Visual feedback capabilities

Structured results are most useful when the user can see the same object highlighted in the editor.

Every diagnostic should optionally return:

- highlight component IDs
- highlight pin IDs
- highlight wire IDs
- zoom-to-object request
- annotation text
- severity
- explanation

For the user's wire-debugging example, the agent should be able to return:

- Error: motor driver input is connected to Arduino D4, but the code drives D5.
- Evidence: wire_12 connects arduino_1.D4 to driver_1.IN1.
- Expected: arduino_1.D5.
- Focus: wire_12, arduino_1.D4, driver_1.IN1.
- Suggested action: reconnect to arduino_1.D5.

The editor should render that as a visible red highlight on the exact wire and pins, with an optional one-click repair.

### 4.5 Transactions and safety

Mutating tools should support:

- dry_run
- idempotency key
- expected_revision
- atomic multi-step changes
- validation before commit
- undo token
- change summary
- explicit user approval for high-impact batches

Example:

1. Plan a motor-driver subcircuit.
2. Show the proposed parts and connections.
3. Validate electrical rules.
4. Commit as one revision.
5. Return an undo token and visual focus.

This is safer than making ten independent browser edits and leaving the user to guess which edit failed.

## 5. Suggested MCP tool surface

The following is a practical first version, not a final protocol.

### Read tools

| Tool | Purpose |
| --- | --- |
| get_circuit | Return the current circuit revision, components, wires, nets, code devices, and simulation state. |
| list_components | Filter by type, name, board, or region. |
| get_component | Return typed properties, transform, pins, and visual anchor. |
| list_pins | Return all pins for a component or all pins in the circuit. |
| list_connections | Return source pin, destination pin, net, wire style, and route. |
| get_breadboard_map | Return hole IDs, row/column labels, rails, and current electrical equivalence groups. |
| get_code | Return the code document, device ID, mode, libraries, and revision. |
| get_diagnostics | Return compile, wiring, simulation, and electrical diagnostics. |
| get_simulation | Return running state, event stream, pin values, serial output, and traces. |
| list_parts | Return supported parts and typed configuration schemas. |

### Write tools

| Tool | Purpose |
| --- | --- |
| add_component | Add a typed part with optional name, position, orientation, and properties. |
| update_component | Change typed properties, name, position, or orientation. |
| remove_component | Remove a component and optionally its attached wires. |
| connect_pins | Create a connection between two addressable pins with automatic or explicit routing. |
| disconnect | Remove one wire or one connection from a net. |
| set_wire | Change route, color, or wire type. |
| apply_code_patch | Apply a line-aware patch to a selected programmable device. |
| set_code | Replace a code document only when the caller explicitly requests replacement. |
| include_library | Add a supported library and return the resulting code change. |
| run_simulation | Compile and start the simulation, returning structured status. |
| stop_simulation | Stop the current simulation. |
| send_serial | Send input to the selected serial channel. |
| annotate | Add or update a note linked to circuit object IDs. |
| focus | Center the visual editor on objects, pins, nets, or diagnostics. |
| highlight | Highlight objects and pins with severity and explanation. |

### Analysis tools

| Tool | Purpose |
| --- | --- |
| validate_circuit | Run electrical and structural checks. |
| diagnose_connection | Explain why a specific signal or net is wrong. |
| trace_signal | Trace a signal from a board pin through wires, breadboard holes, and components. |
| compare_code_wiring | Compare pin references in code with actual circuit connections. |
| generate_build_steps | Convert the verified virtual design into a physical assembly checklist. |

## 6. Example tool contracts

### Connecting two pins

Request:

- source_pin: arduino_1.D5
- destination_pin: motor_driver_1.IN1
- routing: automatic
- wire_type: normal
- color: green
- validate_before_commit: true

Response:

- revision: 42
- wire_id: wire_12
- net_id: net_4
- status: valid
- changes: one wire added
- focus: wire_12, arduino_1.D5, motor_driver_1.IN1
- undo_token: undo_42

### Diagnosing a mismatch between code and wiring

Response:

- diagnostic_id: diag_8
- severity: error
- rule: code_pin_must_match_wire
- message: Code drives D5, but the motor driver input is wired to D4.
- evidence:
  - code_reference: LEFT_MOTOR = 5
  - actual_connection: arduino_1.D4 to motor_driver_1.IN1
- suggested_fix:
  - disconnect: wire_12
  - connect: arduino_1.D5 to motor_driver_1.IN1
- focus:
  - highlight: wire_12
  - highlight: arduino_1.D4
  - highlight: motor_driver_1.IN1

### Applying code safely

Request:

- device_id: arduino_1
- base_revision: code_18
- patch:
  - replace LEFT_MOTOR = 4 with LEFT_MOTOR = 5
- validate:
  - compile
  - compare_code_wiring

Response:

- code_revision: code_19
- compile: passed
- wiring_check: passed
- focus: arduino_1.D5, motor_driver_1.IN1

## 7. Build-with-me workflow

The target experience should support this sequence:

1. The user describes a goal, such as an RC car with an ESP32.
2. The agent proposes a parts list and asks for missing constraints such as motor voltage, battery, and control method.
3. The agent places the selected components into the shared workspace.
4. The agent assigns stable names such as controller, left_motor, right_motor, and motor_driver.
5. The agent connects pins using semantic IDs.
6. The agent validates power, ground, signal, and driver requirements.
7. The agent writes code as an explainable patch.
8. The agent compiles and runs the simulation.
9. The user interacts with the virtual inputs.
10. The agent diagnoses failures from structured evidence.
11. The editor highlights the exact component, pin, or wire involved.
12. The agent generates physical build steps using the same IDs and nets.
13. The user checks off each physical step while the virtual design remains visible.

The virtual and physical instructions should derive from the same circuit graph. That prevents a common failure mode where the simulation works but the physical wiring guide describes a slightly different circuit.

## 8. MVP priority

The smallest useful agent-native layer should include:

1. get_circuit
2. list_components
3. list_connections
4. get_code
5. get_diagnostics
6. add_component
7. connect_pins
8. apply_code_patch
9. validate_circuit
10. highlight

The first demo should be deliberately narrow:

- one supported microcontroller
- one breadboard
- one LED or motor driver
- deterministic pin and net inspection
- one deliberate wiring error
- one diagnostic that highlights the wrong wire
- one one-click repair

If this works reliably, it proves the core idea better than a large AI-generated project.

## 9. Baseline decision

Tinkercad should be used as the usability reference for:

- beginner-friendly palette design
- visual breadboard layout
- simple component inspectors
- integrated code and simulation
- serial interaction
- annotations and sharing

Tinkercad should not be copied as the agent interface. The agent layer needs:

- a canonical circuit graph
- stable component and pin IDs
- typed component schemas
- direct netlist operations
- code patches
- validation and diagnostics
- visual focus and highlighting
- transactions, revisions, and undo

Velxio is a better candidate for the implementation baseline if it already supports the target boards and exposes a model that can be wrapped without reconstructing the circuit from rendered pixels. The next technical checkpoint is to fork Velxio, run a small ESP32 or Pico circuit, and inspect whether its internal state has first-class components, pins, wires, code, and simulation events.

## 10. Follow-up investigation checklist

- Verify the exact Velxio license and contribution requirements.
- Fork and run Velxio locally.
- Confirm ESP32 and Pico board support with real compilation and simulation.
- Locate the canonical circuit model in Velxio.
- Determine whether breadboard hole connectivity is explicit or computed.
- Identify a stable object-ID strategy.
- Define the minimal circuit interchange schema.
- Add read-only circuit introspection before adding write tools.
- Implement one semantic connect-pins operation.
- Implement one diagnostic with visual highlighting.
- Add code patching with compile validation.
- Test user edits and agent edits in the same workspace.
- Add revision and undo semantics.
- Create a small benchmark of intentionally broken circuits.

## Appendix: current live-project snapshot

The open project used for this baseline contained:

- 1 Arduino Uno R3
- 2 small breadboards
- 1 9V battery
- 1 IR remote
- 2 DC motors
- 4 NPN transistors
- 1 IR sensor
- 5 resistors
- 3 LEDs
- 2 diodes
- 40 wire objects
- 63 rendered wire hit segments
- 1 Arduino code device
- 46 lines of visible code

The exact component instance IDs and canvas transforms were available in the rendered page, but those IDs are implementation details of the current Tinkercad session. A future product should expose stable IDs as part of its public circuit model.
