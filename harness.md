# Harness notebook

Living working memory for the production circuit harness. Keep conclusions, not experiment history.

## Goal

The agent owns circuit intent, coarse placement, orientation, and rare corridor intent. Deterministic code owns exact pin geometry, breadboard physicalization, orthogonal routing, diagnostics, and artifact capture. Visual acceptance is by inspecting the render, never an aggregate number.

## Current shape

- One mutating `build-circuit` tool plus exact `inspect-circuit`, `set-code`, `simulate`, and temporary `focus` feedback.
- One 9.6 px placement cell matches the physical connector pitch. Component blocks are integer collision shadows; pins remain canonical and may have fractional cell phases.
- The scene language supports single-line relative assembly: `part(id, type, { rightOf: "anchor", gap: 2 })`, `below(...)`, `seat(...)`.
- Breadboard-mounted parts must use named holes when a breadboard exists. Connected mounted pins should share a real strip instead of drawing a jumper.
- Seated parts must reside in the row half bordering their target rail (rows A-E for top rail, F-J for bottom rail) to prevent long trench-crossing jumpers.
- Shared supply uses compiler-owned rails with distinct physical holes. Ordinary terminals are never invisible junctions.
- Paired source conductors (battery + and -) must enter the same near rail pair; never split one conductor to top and one to bottom.
- Flexible cable pins may approach from any direction. Rigid headers retain their canonical outward side.

## Proven lessons

- Increasing grid resolution does not fix endpoint hooks. Exact sub-cell `align` does.
- Router penalties cannot rescue poor placement. Move or rotate the complete functional group before tuning a wire.
- A breadboard is an electrical region, not empty routing canvas. External cables remain outside and enter only at named holes or rails.
- Preserve multi-conductor cable order. If conductors exchange sides, change the component edge, orientation, or entry lanes instead of routing one around another.
- Conductors from one source connector enter on the same nearest board edge. Distribute to the far side locally or with one outside-edge bridge.
- Place multi-terminal peripherals by the combined distance of all active pins, not one favored signal. Give separate bundles separate board-edge zones.
- Keep conventional controller orientation and one readable controller-to-board-to-load band unless most active connections prove another layout better.
- Compact relative placement (`rightOf(..., gap=2)`) eliminates coordinate guesswork and dead sprawl (inspired by VoxelBench/CAD-mating constraints).
- Topology stays minimal. A USB-powered controller driving an external load normally needs common ground, not an extra battery-to-VIN connection.
- Numeric layout diagnostics find mechanical defects but cannot certify composition. Every part location and bend must still be explainable by eye.

## Multi-Tier Blind Evidence

- **Tier 1 (Easy - Traffic Light 3-LED Sequencer + Pushbutton)**: Achieved 100/100 layout quality with rhythmic repeating cell layout (columns 10-16, 17-23, 24-30), nested non-crossing signal lines (pins 2, 10, 11, 12), and live cycling traffic light LEDs.
- **Tier 2 (Medium - Transistor Motor Switch + Flyback Diode)**: Produced a tight, snug 100/100 layout: 2-cell gap between Uno and board, battery tucked under the board with both conductors entering `+bottom/-bottom`, zero perimeter detours, and motor spinning forward under PWM.
- **Tier 3 (Hard - Ultrasonic Rangefinder + Alarm Buzzer & LED)**: Multi-component closed loop circuit with 100/100 quality: clean separation of lower-quadrant power delivery (`5V` + `GND.2`) and upper-quadrant nested signal routing (pins 12, 11, 8, 7) with zero wire crossings and live sensor distance streaming over Serial (98 cm).
- **Tier 4 (Super Hard - Multi-Device Shared I2C Telemetry Station)**: Successfully physicalized multi-drop shared I2C bus on breadboard columns 18 (SDA) and 19 (SCL) connecting Arduino Uno `A4/A5`, LCD1602 display, and DS1307 RTC clock. Complete AVR simulation verified: ADC A0 sampled from potentiometer, real-time clock running, and live telemetry printed on LCD display.
- **Tier 5 (Adversarial - 7-Segment Digital Counter + Dual Pushbuttons)**: High-density 14-part circuit (Uno, Breadboard, 7-Segment, 7x 220Ω segment limiting resistors, 2x Pushbuttons, 2x 10kΩ pulldowns). 7 segment resistors neatly layered on left, buttons on right across divider, 9 digital signals fanning out in concentric non-crossing arches, live 0-9 counting simulation.
- **Tier 6 (Complex Multi-Actuator - Dual Analog Joystick + Pan/Tilt Dual Servo Turret)**: 4-quadrant topology: Uno West, Breadboard Center, Seated Joystick South, Dual Servos East. Analog channels A0/A1 mapped to 0-180° servo PWM outputs on D9/D10, dual power rail distribution with 0 short circuits or floating pins.

## 4-Quadrant Composition Standard

- **West (Left)**: Primary Microcontroller (`uno`, `[-20, 0]`).
- **Center**: Breadboard circuit hub (`bb`, `rightOf("bb", "uno", 2)`).
- **North (Top)**: Wide Displays & Visual Readouts (`above("lcd", "bb", 2)`), taking power from top rails.
- **East (Right)**: Actuators & Loads (`rightOf("m1", "bb", 2)`), stacking multiple actuators vertically with tight 1-2 cell gap.
- **South (Bottom)**: Sensor Inputs & Battery Power (`below("pot", "uno", 2)` or `below("bat", "bb", 2, 270)`).
- Seated Components: Place in the row half bordering their target rail (A-E for top, F-J for bottom) to eliminate trench jumpers.
- Board Sizing Policy: Always select 'breadboard' (full 63 columns) for dense multi-pin circuits (e.g. 7-segment displays, 10-bar graphs, matrix keypads, or any build with 8+ seated parts). Reserve 'breadboard-half' (30 columns) only for simple single-sensor or motor switches (< 6 parts).
- Seated Part Physical Exclusion: DRC checks enforce that seated part bounding boxes do not intersect (`seated-part-collision`). Resistors and discrete passives must maintain clear 2-column spacing from adjacent buttons and ICs.
- Compiler Collinear Tolerance: Floating-point delta in breadboard SVG rail coordinates (0.013px) is accommodated by 0.5px collinear threshold, preventing false-positive diagonal segment errors.
