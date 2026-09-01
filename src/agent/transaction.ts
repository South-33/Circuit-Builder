import { circuitStore } from '../circuit/store';

/**
 * Agent build calls are atomic: either the complete requested scene is valid
 * and committed, or the pre-call circuit is restored. This prevents an agent
 * correction from leaving a half-built workbench after one bad pin/seat/path.
 */
export async function withCircuitTransaction<T>(work: () => T | Promise<T>): Promise<T> {
  const before = structuredClone(circuitStore.getSnapshot());
  if (before.simulation.status === 'running' || before.simulation.status === 'compiling') {
    throw new Error('Stop the simulation before editing the circuit.');
  }
  try {
    return await work();
  } catch (error) {
    circuitStore.replaceDocument({ parts: before.parts, connections: before.connections });
    if (before.selectedId && (
      before.parts.some((part) => part.id === before.selectedId)
      || before.connections.some((wire) => wire.id === before.selectedId)
    )) {
      circuitStore.select(before.selectedId);
    }
    throw error;
  }
}
