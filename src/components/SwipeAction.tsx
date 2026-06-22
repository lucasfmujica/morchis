'use client';

import { useRef, useState } from 'react';

// Swipe-left-to-delete wrapper for a list row, factored from the swipe pattern
// in extractos/[id]/review-client.tsx (DraftCard). The row content renders on
// top of a red "Borrar" affordance that's revealed as the user drags left.
//
// `touch-action: pan-y` lets the browser keep owning vertical scroll while we
// own horizontal drags, so wrapping rows in a scrolling list doesn't fight the
// scroll. A direction lock (horizontal vs vertical) decided in the first few
// pixels keeps a near-vertical flick from nudging the row sideways.
interface SwipeActionProps {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}

const TRIGGER = 80; // px past which releasing commits the delete
const DIR_LOCK = 8; // px of travel before we decide the gesture's axis

export function SwipeAction({ children, onDelete, disabled }: SwipeActionProps) {
  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  if (disabled) return <>{children}</>;

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    axis.current = null;
    swiped.current = false;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return;
    const ddx = e.touches[0].clientX - startX.current;
    const ddy = e.touches[0].clientY - startY.current;
    if (axis.current === null && (Math.abs(ddx) > DIR_LOCK || Math.abs(ddy) > DIR_LOCK)) {
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
    }
    if (axis.current !== 'h') return;
    const next = Math.min(0, ddx); // left-only
    if (next < -6) swiped.current = true;
    setDx(next);
  }

  function onTouchEnd() {
    setDragging(false);
    const commit = dx < -TRIGGER;
    startX.current = null;
    axis.current = null;
    setDx(0);
    if (commit) onDelete();
  }

  // Suppress the tap that follows a swipe so the row doesn't also open to edit.
  function onClickCapture(e: React.MouseEvent) {
    if (swiped.current) {
      e.preventDefault();
      e.stopPropagation();
      swiped.current = false;
    }
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClickCapture={onClickCapture}
    >
      {/* Delete affordance behind the row, revealed on left-swipe. */}
      <div
        className="absolute inset-0 flex items-center justify-end pr-5"
        style={{ background: '#FF7F6B', opacity: dx < 0 ? 1 : 0 }}
      >
        <span className="text-white font-black text-sm">🗑️ Borrar</span>
      </div>
      <div
        style={{
          background: '#FFFFFF',
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 0.2s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
