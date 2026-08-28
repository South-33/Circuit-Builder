import React, { useState } from 'react';

export type BlockItem = {
  id: string;
  kind: 'builtin-led' | 'pin-digital' | 'pin-analog' | 'servo' | 'speaker-tone' | 'speaker-off' | 'serial-print' | 'wait' | 'comment';
  param1: string | number;
  param2: string | number;
};

export type BlockCategory = 'Output' | 'Input' | 'Notation' | 'Control' | 'Math' | 'Variables';

export function BlocksWorkspace({
  onGenerateCode,
}: {
  onGenerateCode?: (code: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<BlockCategory>('Output');
  const [startBlocks, setStartBlocks] = useState<BlockItem[]>([
    { id: 'b1', kind: 'comment', param1: 'Initialize pins and peripherals', param2: '' },
    { id: 'b2', kind: 'serial-print', param1: 'System Ready', param2: 'true' },
  ]);
  const [loopBlocks, setLoopBlocks] = useState<BlockItem[]>([
    { id: 'b3', kind: 'builtin-led', param1: 'HIGH', param2: '' },
    { id: 'b4', kind: 'wait', param1: 1, param2: 'secs' },
    { id: 'b5', kind: 'builtin-led', param1: 'LOW', param2: '' },
    { id: 'b6', kind: 'wait', param1: 1, param2: 'secs' },
  ]);

  const addBlockToLoop = (kind: BlockItem['kind']) => {
    const newBlock: BlockItem = {
      id: `block_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      kind,
      param1: kind === 'builtin-led' ? 'HIGH' : kind === 'pin-digital' ? '13' : kind === 'wait' ? 1 : 'Message',
      param2: kind === 'pin-digital' ? 'HIGH' : kind === 'wait' ? 'secs' : '',
    };
    setLoopBlocks((prev) => [...prev, newBlock]);
  };

  const removeBlock = (id: string, inStart = false) => {
    if (inStart) {
      setStartBlocks((prev) => prev.filter((b) => b.id !== id));
    } else {
      setLoopBlocks((prev) => prev.filter((b) => b.id !== id));
    }
  };

  const renderBlock = (b: BlockItem, inStart = false) => {
    switch (b.kind) {
      case 'builtin-led':
        return (
          <div className="block-pill block-output" key={b.id}>
            <span>set built-in LED to</span>
            <select
              value={b.param1}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param1: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            >
              <option value="HIGH">HIGH</option>
              <option value="LOW">LOW</option>
            </select>
            <button type="button" className="block-del" onClick={() => removeBlock(b.id, inStart)}>×</button>
          </div>
        );
      case 'pin-digital':
        return (
          <div className="block-pill block-output" key={b.id}>
            <span>set pin</span>
            <input
              type="text"
              className="block-num-input"
              value={b.param1}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param1: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            />
            <span>to</span>
            <select
              value={b.param2}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param2: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            >
              <option value="HIGH">HIGH</option>
              <option value="LOW">LOW</option>
            </select>
            <button type="button" className="block-del" onClick={() => removeBlock(b.id, inStart)}>×</button>
          </div>
        );
      case 'serial-print':
        return (
          <div className="block-pill block-output" key={b.id}>
            <span>print to serial monitor</span>
            <input
              type="text"
              className="block-text-input"
              value={b.param1}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param1: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            />
            <button type="button" className="block-del" onClick={() => removeBlock(b.id, inStart)}>×</button>
          </div>
        );
      case 'wait':
        return (
          <div className="block-pill block-control" key={b.id}>
            <span>wait</span>
            <input
              type="number"
              className="block-num-input"
              value={b.param1}
              onChange={(e) => {
                const val = Number(e.target.value);
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param1: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            />
            <select
              value={b.param2}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param2: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            >
              <option value="secs">secs</option>
              <option value="millis">millis</option>
            </select>
            <button type="button" className="block-del" onClick={() => removeBlock(b.id, inStart)}>×</button>
          </div>
        );
      case 'comment':
        return (
          <div className="block-pill block-notation" key={b.id}>
            <span>comment</span>
            <input
              type="text"
              className="block-text-input"
              value={b.param1}
              onChange={(e) => {
                const val = e.target.value;
                const update = (list: BlockItem[]) => list.map((item) => item.id === b.id ? { ...item, param1: val } : item);
                inStart ? setStartBlocks(update) : setLoopBlocks(update);
              }}
            />
            <button type="button" className="block-del" onClick={() => removeBlock(b.id, inStart)}>×</button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="blocks-workspace">
      {/* Category selector */}
      <div className="blocks-categories-bar">
        {(['Output', 'Input', 'Notation', 'Control', 'Math', 'Variables'] as BlockCategory[]).map((cat) => (
          <button
            type="button"
            key={cat}
            className={`block-cat-btn cat-${cat.toLowerCase()}${selectedCategory === cat ? ' active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            <span className="cat-dot" />
            <span>{cat}</span>
          </button>
        ))}
      </div>

      {/* Blocks Palette */}
      <div className="blocks-palette">
        <div className="palette-title">{selectedCategory} Blocks</div>
        <div className="palette-items">
          {selectedCategory === 'Output' && (
            <>
              <button type="button" className="palette-block block-output" onClick={() => addBlockToLoop('builtin-led')}>
                + set built-in LED to [HIGH]
              </button>
              <button type="button" className="palette-block block-output" onClick={() => addBlockToLoop('pin-digital')}>
                + set pin [13] to [HIGH]
              </button>
              <button type="button" className="palette-block block-output" onClick={() => addBlockToLoop('serial-print')}>
                + print to serial monitor [msg]
              </button>
            </>
          )}
          {selectedCategory === 'Control' && (
            <button type="button" className="palette-block block-control" onClick={() => addBlockToLoop('wait')}>
              + wait [1] secs
            </button>
          )}
          {selectedCategory === 'Notation' && (
            <button type="button" className="palette-block block-notation" onClick={() => addBlockToLoop('comment')}>
              + comment [text]
            </button>
          )}
          {(selectedCategory === 'Input' || selectedCategory === 'Math' || selectedCategory === 'Variables') && (
            <div className="palette-empty-note">Click blocks from Output, Control, or Notation to add to circuit loop.</div>
          )}
        </div>
      </div>

      {/* Assembly Canvas */}
      <div className="blocks-assembly-area">
        {/* On Start block */}
        <div className="block-hat-container">
          <div className="block-hat hat-start">on start</div>
          <div className="block-hat-body">
            {startBlocks.map((b) => renderBlock(b, true))}
          </div>
        </div>

        {/* Forever block */}
        <div className="block-hat-container">
          <div className="block-hat hat-forever">forever</div>
          <div className="block-hat-body">
            {loopBlocks.map((b) => renderBlock(b, false))}
          </div>
        </div>
      </div>
    </div>
  );
}
