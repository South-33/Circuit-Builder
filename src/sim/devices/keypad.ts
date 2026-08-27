import { PinState } from 'avr8js';
import type { CircuitPart } from '../../circuit/types';
import {
  addEvent,
  digitalPinForNode,
  getElement,
  pinNode,
  resetInputPin,
  writeExternalPin,
  type DeviceContext,
} from './shared';

type KeyDetail = { row?: number; column?: number; key?: string };

function bindKeypad(context: DeviceContext, part: CircuitPart) {
  const element = getElement(part.id);
  if (!element) return;
  const columnCount = String(part.attrs.columns ?? '4') === '3' ? 3 : 4;
  const rows = Array.from({ length: 4 }, (_, index) =>
    digitalPinForNode(context.graph, context.runner, pinNode(part, `R${index + 1}`)));
  const columns = Array.from({ length: columnCount }, (_, index) =>
    digitalPinForNode(context.graph, context.runner, pinNode(part, `C${index + 1}`)));
  const pressed = new Set<string>();

  const keyId = (row: number, column: number) => `${row}:${column}`;
  const update = () => {
    // Release inputs to their natural pull-up/plain-input level first, then
    // bridge whichever row/column pairs are physically pressed.
    [...rows, ...columns].forEach(resetInputPin);
    for (const id of pressed) {
      const [rowIndex, columnIndex] = id.split(':').map(Number);
      const row = rows[rowIndex];
      const column = columns[columnIndex];
      if (!row || !column) continue;
      const rowState = row.port.pinState(row.bit);
      const columnState = column.port.pinState(column.bit);
      const rowOutput = rowState === PinState.High || rowState === PinState.Low;
      const columnOutput = columnState === PinState.High || columnState === PinState.Low;
      if (rowOutput && !columnOutput) writeExternalPin(column, rowState === PinState.High);
      else if (columnOutput && !rowOutput) writeExternalPin(row, columnState === PinState.High);
    }
  };

  const press: EventListener = (event) => {
    const detail = (event as CustomEvent<KeyDetail>).detail;
    if (Number.isInteger(detail?.row) && Number.isInteger(detail?.column)) {
      pressed.add(keyId(Number(detail.row), Number(detail.column)));
      update();
    }
  };
  const release: EventListener = (event) => {
    const detail = (event as CustomEvent<KeyDetail>).detail;
    if (Number.isInteger(detail?.row) && Number.isInteger(detail?.column)) {
      pressed.delete(keyId(Number(detail.row), Number(detail.column)));
      update();
    }
  };
  addEvent(context, element, 'button-press', press);
  addEvent(context, element, 'button-release', release);
  context.frameUpdaters.push(update);
  context.resetters.push(() => { pressed.clear(); [...rows, ...columns].forEach(resetInputPin); });
  update();
}

export function setupKeypads(context: DeviceContext) {
  for (const part of context.documentState.parts) {
    if (part.type === 'wokwi-membrane-keypad') bindKeypad(context, part);
  }
}
