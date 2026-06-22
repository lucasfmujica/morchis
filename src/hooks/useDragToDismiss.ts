'use client';

import { useCallback, useRef, useState } from 'react';

// Drag-down-to-dismiss for a bottom sheet. Spread `handleProps` on the sheet's
// drag handle (the little grabber). `dragY` is how far the sheet should be
// visually offset and `dragging` disables the snap-back transition while the
// finger is down. Calls `onDismiss` once the user drags past the threshold or
// flicks down fast.
//
// Pairs with the guard in PullToRefresh, which bails inside an open sheet so a
// downward drag here never doubles as a page refresh.
export function useDragToDismiss(onDismiss: () => void, threshold = 110) {
  const startY = useRef<number | null>(null);
  const lastY = useRef(0);
  const velocity = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    lastY.current = e.touches[0].clientY;
    velocity.current = 0;
    setDragging(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null) return;
    const y = e.touches[0].clientY;
    velocity.current = y - lastY.current;
    lastY.current = y;
    // Follow downward drags; allow a touch of upward rubber-band so the grab
    // feels alive but the sheet can't be dragged off the top.
    setDragY(Math.max(-10, y - startY.current));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (startY.current === null) return;
    const dismiss = dragY > threshold || velocity.current > 11;
    startY.current = null;
    setDragging(false);
    setDragY(0);
    if (dismiss) onDismiss();
  }, [dragY, threshold, onDismiss]);

  return {
    dragY,
    dragging,
    handleProps: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
