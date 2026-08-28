import React from 'react';
import type { CircuitPart } from '../circuit/types';
import { PART_DEFINITIONS } from '../components/parts';

type GroupedComponent = {
  names: string[];
  quantity: number;
  description: string;
};

export function ComponentsView({ parts }: { parts: CircuitPart[] }) {
  const groups: GroupedComponent[] = [];
  const typeCounters: Record<string, number> = {};

  // Assign RefDes and group
  const refDesMap: Record<string, string> = {
    'wokwi-arduino-uno': 'U',
    'breadboard': 'BB',
    'breadboard-half': 'BB',
    'wokwi-resistor': 'R',
    'wokwi-led': 'D',
    'wokwi-rgb-led': 'D',
    'rectifier-diode': 'D',
    'zener-diode': 'D',
    'npn-transistor': 'T',
    'pnp-transistor': 'T',
    'battery-9v': 'BAT',
    'battery-aa': 'BAT',
    'battery-coin-cell': 'BAT',
    'dc-motor': 'M',
    'wokwi-servo': 'M',
    'wokwi-stepper-motor': 'M',
    'wokwi-pushbutton': 'SW',
    'wokwi-slide-switch': 'SW',
    'wokwi-potentiometer': 'POT',
    'wokwi-buzzer': 'BZ',
  };

  const groupedMap = new Map<string, { names: string[]; count: number; description: string }>();

  for (const part of parts) {
    const def = PART_DEFINITIONS[part.type];
    const prefix = refDesMap[part.type] || def.idPrefix.toUpperCase();
    typeCounters[prefix] = (typeCounters[prefix] || 0) + 1;
    const refDes = `${prefix}${typeCounters[prefix]}`;

    let desc = def.name;
    if (part.type === 'wokwi-resistor') {
      const ohms = Number(part.attrs.value ?? 220);
      desc = ohms >= 1e6 ? `${ohms / 1e6} MΩ Resistor` : ohms >= 1e3 ? `${ohms / 1e3} kΩ Resistor` : `${ohms} Ω Resistor`;
    } else if (part.type === 'wokwi-led') {
      const color = String(part.attrs.color ?? 'Red');
      desc = `${color.charAt(0).toUpperCase() + color.slice(1)} LED`;
    } else if (part.type === 'npn-transistor') {
      desc = 'NPN Transistor (BJT)';
    } else if (part.type === 'pnp-transistor') {
      desc = 'PNP Transistor (BJT)';
    } else if (part.type === 'battery-9v') {
      desc = '9V Battery';
    } else if (part.type === 'battery-aa') {
      desc = '1.5V AA Battery';
    } else if (part.type === 'battery-coin-cell') {
      desc = '3V Coin Cell Battery';
    }

    const groupKey = `${part.type}:${desc}`;
    const existing = groupedMap.get(groupKey);
    if (existing) {
      existing.names.push(refDes);
      existing.count += 1;
    } else {
      groupedMap.set(groupKey, { names: [refDes], count: 1, description: desc });
    }
  }

  for (const item of groupedMap.values()) {
    groups.push({
      names: item.names,
      quantity: item.count,
      description: item.description,
    });
  }

  const exportCsv = () => {
    let csv = 'Name,Quantity,Component\n';
    for (const g of groups) {
      csv += `"${g.names.join(' ')}",${g.quantity},"${g.description}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'component_list.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="components-view-page">
      <div className="components-view-header">
        <h2>Component List</h2>
        <button type="button" className="csv-download-btn" onClick={exportCsv}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download CSV
        </button>
      </div>
      <div className="components-view-table-wrap">
        <table className="components-view-table">
          <thead>
            <tr>
              <th style={{ width: '20%' }}>Name</th>
              <th style={{ width: '15%' }}>Quantity</th>
              <th>Component</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-table-cell">No components on canvas.</td>
              </tr>
            ) : (
              groups.map((g, idx) => (
                <tr key={idx}>
                  <td className="refdes-cell">{g.names.join('\n')}</td>
                  <td>{g.quantity}</td>
                  <td>{g.description}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
