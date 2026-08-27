// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
// Source: wokwi/avr8js demo, kept intentionally small.

export function loadHex(source: string, target: Uint8Array) {
  for (const line of source.split('\n')) {
    if (line[0] === ':' && line.slice(7, 9) === '00') {
      const bytes = Number.parseInt(line.slice(1, 3), 16);
      const address = Number.parseInt(line.slice(3, 7), 16);
      for (let index = 0; index < bytes; index++) {
        target[address + index] = Number.parseInt(line.slice(9 + index * 2, 11 + index * 2), 16);
      }
    }
  }
}

