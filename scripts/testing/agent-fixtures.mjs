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
    { id: 'a0', from: 'uno:A0', to: 'bb:E16', role: 'signal', path: [[-13, 23], [19, 23], [19, 9]] },

    // Breadboard rails are the power/ground trunks. Loads branch from the
    // rails instead of fanning multiple long wires out of Uno 5V/GND.
    { id: 'jump5v', from: 'bb:+bottom24', to: 'bb:+top24', role: 'power', path: [[31, 20], [31, 2]] },
    { id: 'jumpgnd', from: 'bb:-bottom25', to: 'bb:-top25', role: 'ground', path: [[32, 19], [32, 1]] },
    { id: 'potv', from: 'pot:VCC', to: 'bb:+top14', role: 'power', path: [[19, -1], [19, 2]] },
    { id: 'potg', from: 'pot:GND', to: 'bb:-top12', role: 'ground', path: [[17, -1], [17, 1]] },
    { id: 'servov', from: 'bb:+top23', to: 'servo:V+', role: 'power', path: [[30, 2], [35, 2], [35, 9], [37, 9]] },
    { id: 'servog', from: 'bb:-top22', to: 'servo:GND', role: 'ground', path: [[29, 1], [36, 1], [36, 8], [37, 8]] },

    // Signals use separate lanes. The pot signal enters a breadboard strip and
    // A0 reaches the same strip from below, which keeps the board visually
    // compact without requiring an arbitrary wire junction feature.
    { id: 'pots', from: 'pot:SIG', to: 'bb:A16', role: 'signal', path: [[18, -1], [18, 5]] },
    { id: 'servop', from: 'uno:9', to: 'servo:PWM', role: 'signal', path: [[-18, -12], [37, -12], [37, 10]] },
    { id: 'drive', from: 'uno:6', to: 'bb:A8', role: 'signal', path: [[-14, -4], [10, -4], [10, 5], [11, 5]] },
    { id: 'ledg', from: 'bb:E13', to: 'bb:-bottom12', role: 'ground', path: [[16, 9], [17, 9], [17, 19]] },
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
    'const uno = part("uno","arduino-uno",{"at":[-32,8]})',
    'const board = part("board","breadboard-half",{"at":[0,8]})',
    'place("battery",8,30,270)',
    'place("motor",38,10,0)',
    'const battery = part("battery","battery-9v",{})',
    'const motor = part("motor","dc-motor",{})',
    'const q = part("q","npn-transistor",{})',
    'const diode = part("diode","rectifier-diode",{})',
    'const resistor = part("resistor","resistor",{"attrs":{"value":1000}})',
    'seat("q","board","C","J25")',
    'seat("diode","board","A","A25")',
    'seat("resistor","board","1","E18")',
    'align("battery.+","board.+bottom6","x")',
    'align("motor.2","board.B25","y")',
    'wire("battery-plus","battery.+","board.+bottom6","power")',
    'bridge("power-bridge","board","+","left")',
    'wire("battery-ground","battery.-","board.-bottom7","ground")',
    'rail("motor-power","board","+top","board.+top6",["diode.C","motor.1"])',
    'wire("logic-ground","uno.GND.2","board.-bottom2","ground")',
    'wire("transistor-ground","q.E","board.-bottom20","ground")',
    'wire("motor-return","motor.2","board.B25","power")',
    'wire("return-bridge","board.E25","board.F25","power")',
    'wire("drive-in","uno.5","board.A18","signal")',
    'wire("drive-base","board.E24","board.F24","signal")',
  ].join('\n'),
});
