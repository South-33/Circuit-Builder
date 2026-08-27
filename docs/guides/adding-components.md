# Adding components

Adding a component should be a predictable metadata + adapter task.

## 1. Pick the closest existing component

Before writing anything, find an existing part with similar rendering and electrical behavior. Examples:

- simple digital input: pushbutton / tilt switch
- analog input: potentiometer / photoresistor
- pulse/timing input: HC-SR04 / IR receiver
- PWM output: servo / DC motor
- I2C device: LCD / SSD1306 / MPU6050
- passive breadboard part: resistor / diode / transistor

Follow that pattern instead of inventing a new subsystem.

## 2. Register the type

Add one string to `src/components/partTypes.ts`.

TypeScript requires `src/components/parts.ts` to then contain a matching `PartDefinition`, so missing catalog metadata becomes a compile error.

## 3. Add visual metadata

Add the `PartDefinition` in `src/components/parts.ts`:

- readable name and category
- stable ID prefix
- Wokwi tag or static asset path
- native visual size and render scale
- sensible defaults
- short pin summary
- `breadboardMount: true` only when the physical pin pitch is compatible with the breadboard
- generic inspector `properties` when users need to configure values
- useful search keywords

Do not shrink breadboard-mount components independently just to make them look smaller. Their rendered pin pitch must stay physically aligned with breadboard holes.

### Wokwi visual

Add exactly one side-effect import to `src/components/registerElements.ts`. `getPartPins()` will read the element's `pinInfo` automatically.

### Static/Fritzing visual

Put artwork under `public/assets/` in an appropriate vendor folder. Add compatible-license attribution. Define explicit semantic pin coordinates in `src/components/parts.ts` if the artwork does not expose `pinInfo`.

## 4. Implement actual behavior

Place simulation code in the closest file under `src/sim/devices/`. Device adapters receive the circuit graph and AVR runner through `DeviceContext`.

Keep each adapter narrow. Do not add per-device branches to React just to simulate behavior.

Set `simulated: true` only when the important behavior works end-to-end. If only the visual is ready, keep the part available with `simulated: false` rather than faking behavior.

## 5. Use generic UI first

Most configuration belongs in the `properties` array in `PartDefinition`. The existing inspector supports number, range, select, and toggle controls.

Only add custom React UI when the component genuinely needs an interaction that cannot be represented by those controls.

## 6. Validate

Run:

```bash
pnpm check
```

Then manually verify:

- tray preview renders
- full component renders at a useful scale
- pin hover/click targets line up with the actual visual pins
- breadboard-mounted parts seat exactly in named holes
- inspector properties update the visual/runtime
- simulation responds correctly when wired to a minimal Arduino sketch
- removing or moving the part does not leave stale circuit state

If the component requires a new Arduino library, confirm the browser compiler supports it before claiming the example works. Prefer a small compatibility layer only for common APIs when it can still drive real simulated pin behavior.