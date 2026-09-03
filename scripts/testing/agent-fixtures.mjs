// SPDX-License-Identifier: MIT

/**
 * A moderately dense block-grid reference scene.
 *
 * The point of this fixture is not to encode a preferred model strategy. It
 * proves the block-world contract can express the same kind of Arduino +
 * breadboard + potentiometer + servo + LED circuit used in real harness runs
 * without a semantic solver or autorouter.
 */
export const BLOCK_SERVO_CONTROL_INPUT = Object.freeze({
  replace: true,
  parts: [
    { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
    { id: 'bb', type: 'breadboard-half', at: [0, 0] },
    { id: 'pot', type: 'potentiometer', at: [14, -10] },
    { id: 'servo', type: 'servo', at: [38, 3] },
    { id: 'r1', type: 'resistor', seat: { breadboardId: 'bb', pin: '1', hole: 'E8' }, attrs: { value: 220 } },
    { id: 'led', type: 'led', seat: { breadboardId: 'bb', pin: 'A', hole: 'A14' }, attrs: { color: 'red' } },
  ],
  wires: [
    // Rightmost Uno bottom pin gets the highest lane; pins farther left get
    // progressively lower lanes. This avoids the fan-out crossings that the
    // original C benchmark exposed around the Uno power header.
    { id: 'feed5v', from: 'uno:5V', to: 'bb:+bottom1', role: 'power', path: [[-18, 25], [4, 25], [4, 20]] },
    { id: 'feedgnd', from: 'uno:GND.2', to: 'bb:-bottom1', role: 'ground', path: [[-17, 24], [3, 24], [3, 19]] },
    { id: 'a0', from: 'uno:A0', to: 'bb:E18', role: 'signal' },

    // Breadboard rails are the power/ground trunks. Loads branch from the
    // rails instead of fanning multiple long wires out of Uno 5V/GND.
    { id: 'jump5v', from: 'bb:+bottom24', to: 'bb:+top24', role: 'power', path: [[31, 20], [31, 2]] },
    { id: 'jumpgnd', from: 'bb:-bottom25', to: 'bb:-top25', role: 'ground', path: [[32, 19], [32, 1]] },
    { id: 'potv', from: 'pot:VCC', to: 'bb:+top20', role: 'power' },
    { id: 'potg', from: 'pot:GND', to: 'bb:-top21', role: 'ground' },
    { id: 'servov', from: 'bb:+top23', to: 'servo:V+', role: 'power', path: [[30, 2], [35, 2], [35, 9], [37, 9]] },
    { id: 'servog', from: 'bb:-top22', to: 'servo:GND', role: 'ground', path: [[29, 1], [36, 1], [36, 8], [37, 8]] },

    // Signals use separate lanes. The pot signal enters a breadboard strip and
    // A0 reaches the same strip from below, which keeps the board visually
    // compact without requiring an arbitrary wire junction feature.
    { id: 'pots', from: 'pot:SIG', to: 'bb:A18', role: 'signal' },
    { id: 'servop', from: 'uno:9', to: 'servo:PWM', role: 'signal', path: [[-18, -12], [37, -12], [37, 10]] },
    { id: 'drive', from: 'uno:6', to: 'bb:A8', role: 'signal', path: [[-14, -4], [10, -4], [10, 5], [11, 5]] },
    { id: 'ledg', from: 'led:C', to: 'bb:-top5', role: 'ground' },
  ],
});

/** Pin-first servo scene with honest breadboard power distribution. */
export const DENSE_NET_SERVO_INPUT = Object.freeze({
  replace: true,
  program: [
    'const uno = part("uno","arduino-uno",{"at":[-35,-12]})',
    'const board = part("board","breadboard-half",{"at":[-3,10]})',
    'const servo = part("servo","servo",{"at":[33,-4]})',
    'const pot = part("pot","potentiometer",{"at":[6,32],"rotate":180})',
    'align("pot.VCC","board.+top8","x")',
    'net("pot-sig","signal",["pot.SIG","uno.A0"])',
    'wire("servo-pwm","uno.9","servo.PWM","signal")',
    'rail("logic-5v","board","+top","uno.5V",["pot.VCC","servo.V+"])',
    'rail("logic-ground","board","-top","uno.GND.2",["pot.GND","servo.GND"])',
  ].join('\n'),
});

/** One real switched load, expressed as board regions instead of long cables. */
export const MOTOR_SWITCH_INPUT = Object.freeze({
  replace: true,
  program: [
    'const uno = part("uno","arduino-uno",{"at":[-37,0]})',
    'const board = part("board","breadboard-half",{"at":[-5,0]})',
    'const motor = part("motor","dc-motor",{"at":[34,5]})',
    'const battery = part("battery","battery-9v",{"at":[4,-18],"rotate":90})',
    'const q = part("q","npn-transistor",{})',
    'const resistor = part("resistor","resistor",{"attrs":{"value":1000}})',
    'const diode = part("diode","rectifier-diode",{"rotate":180})',
    'seat("q","board","B","E24")',
    'seat("resistor","board","2","A20")',
    'seat("diode","board","A","A25")',
    'align("motor.2","q.C","y")',
    'rail("supply","board","+top","battery.+",["motor.1","diode.C"])',
    'rail("return","board","-top","battery.-",["q.E"])',
    'wire("logic-ground","uno.GND.2","board:-bottom3","ground")',
    'bridge("ground-bridge","board","-","left")',
    'wire("motor-switch","motor.2","q.C","signal")',
    'wire("drive","uno.9","resistor.1","signal")',
    'wire("base-link","resistor.2","q.B","signal")',
  ].join('\n'),
});
