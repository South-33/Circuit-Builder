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
          <div className="note-header">
            <span className="note-drag-handle">⠿</span>
            <button
              type="button"
              className="note-delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete note"
            >
              ×
            </button>
          </div>
          <textarea
            className="note-textarea"
            value={note.text}
            placeholder="Write your note here."
            onChange={(e) => onUpdate({ text: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            rows={2}
          />
          <div className="note-tail" />
        </div>
      )}

      {/* Anchor pin with collapse/expand button */}
      <button
        type="button"
        className="note-anchor-pin"
        onClick={(e) => {
          e.stopPropagation();
          onUpdate({ collapsed: !note.collapsed });
        }}
        title={note.collapsed ? 'Expand note' : 'Collapse note'}
        aria-label={note.collapsed ? 'Expand note' : 'Collapse note'}
      >
        <span className="pin-icon">{note.collapsed ? '+' : '−'}</span>
      </button>
    </div>
  );
}
