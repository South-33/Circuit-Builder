import type { CircuitDocument } from '../../circuit/types';
import { diagnoseCircuit } from '../../sim/diagnostics';
import { evaluateLayout } from './layout';

export function buildMutationSummary(state: Pick<CircuitDocument, 'parts' | 'connections'>) {
  const quality = evaluateLayout(state);
  const diagnostics = diagnoseCircuit(state);
  return {
    parts: state.parts.length,
    wires: state.connections.length,
    quality,
    diagnostics: {
      errors: diagnostics.filter((item) => item.severity === 'error').length,
      warnings: diagnostics.filter((item) => item.severity === 'warning').length,
    },
  };
}
