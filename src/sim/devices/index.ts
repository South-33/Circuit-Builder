import type { CircuitDocument } from '../../circuit/types';
import type { AVRRunner } from '../avrRunner';
import type { CircuitGraph } from '../circuitGraph';
import { setupAnalogDevices } from './analog';
import { setupBasicDevices } from './basic';
import { setupKeypads } from './keypad';
import { setupMotionDevices } from './motion';
import { setupSensorDevices } from './sensors';
import { setupInfraredDevices } from './infrared';
import { setupI2CDevices } from './i2c';
import type { DeviceContext } from './shared';

export type DeviceRuntime = {
  frame: () => void;
  reset: () => void;
  cleanup: () => void;
};

export function setupDevices(
  documentState: Pick<CircuitDocument, 'parts' | 'connections'>,
  graph: CircuitGraph,
  runner: AVRRunner,
): DeviceRuntime {
  const context: DeviceContext = {
    documentState,
    graph,
    runner,
    frameUpdaters: [],
    cleanups: [],
    resetters: [],
  };

  setupBasicDevices(context);
  setupAnalogDevices(context);
  setupMotionDevices(context);
  setupKeypads(context);
  setupSensorDevices(context);
  setupInfraredDevices(context);
  setupI2CDevices(context);

  return {
    frame: () => {
      for (const update of context.frameUpdaters) update();
    },
    reset: () => {
      for (const reset of context.resetters) reset();
    },
    cleanup: () => {
      for (const cleanup of context.cleanups.splice(0)) cleanup();
    },
  };
}
