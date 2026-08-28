import React, { useRef, useState } from 'react';

export type CanvasNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  collapsed: boolean;
};

export function NotesLayer({
  notes,
  visible,
  onUpdateNote,
  onDeleteNote,
}: {
  notes: CanvasNote[];
  visible: boolean;
  onUpdateNote: (id: string, partial: Partial<CanvasNote>) => void;
  onDeleteNote: (id: string) => void;
}) {
  if (!visible || notes.length === 0) return null;

  return (
    <div className="canvas-notes-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 28 }}>
      {notes.map((note) => (
        <NoteBubble
          key={note.id}
          note={note}
          onUpdate={(partial) => onUpdateNote(note.id, partial)}
          onDelete={() => onDeleteNote(note.id)}
        />
      ))}
    </div>
  );
}

function NoteBubble({
  note,
  onUpdate,
  onDelete,
}: {
  note: CanvasNote;
  onUpdate: (partial: Partial<CanvasNote>) => void;
  onDelete: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; noteX: number; noteY: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.stopPropagation();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    onUpdate({
      x: dragStartRef.current.noteX + dx,
      y: dragStartRef.current.noteY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
      setIsDragging(false);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  return (
    <div
      className={`canvas-note-item${note.collapsed ? ' collapsed' : ''}${isDragging ? ' dragging' : ''}`}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!note.collapsed && (
        <div className="note-card">
          <div
            className="note-editable"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Write your note here."
            onBlur={(e) => onUpdate({ text: e.currentTarget.innerText })}
            onInput={(e) => onUpdate({ text: e.currentTarget.innerText })}
            onPointerDown={(e) => e.stopPropagation()}
            tabIndex={0}
          >
            {note.text}
          </div>
          <div className="note-tail" />
        </div>
      )}

      {/* Anchor pin with exact mathematically centered +/- SVG (Double-click / double-tap to toggle) */}
      <button
        type="button"
        className="note-anchor-pin"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onUpdate({ collapsed: !note.collapsed });
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        title={note.collapsed ? 'Double-click to open note' : 'Double-click to close note'}
        aria-label={note.collapsed ? 'Double-click to open note' : 'Double-click to close note'}
      >
        <svg viewBox="0 0 20 20" width="20" height="20">
          <circle cx="10" cy="10" r="9" fill="#ffffff" stroke="#1e293b" strokeWidth="1.5" />
          <line x1="6" y1="10" x2="14" y2="10" stroke="#1e293b" strokeWidth="1.6" strokeLinecap="round" />
          {note.collapsed && (
            <line x1="10" y1="6" x2="10" y2="14" stroke="#1e293b" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>
    </div>
  );
}
