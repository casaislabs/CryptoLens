import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * VirtualizedTokenGrid
 * - Virtualizes a grid of cards using react-window at row level.
 * - Calculates columns per breakpoint to emulate Tailwind grid: 1/2/3/4 columns.
 * - Fixed row height for stable performance.
 */
export default function VirtualizedTokenGrid({
  items = [],
  renderItem,
  rowHeight = 220,
  height = 600,
  overscanCount = 4,
  className = '',
}) {
  const containerRef = useRef(null);
  const [columns, setColumns] = useState(4);
  const [ListComp, setListComp] = useState(null);

  // Compute columns by window width (Tailwind-like breakpoints)
  useEffect(() => {
    function computeColumns() {
      if (typeof window === 'undefined') return;
      const w = window.innerWidth || 1280;
      if (w < 640) setColumns(1);
      else if (w < 1024) setColumns(2);
      else if (w < 1280) setColumns(3);
      else setColumns(4);
    }
    computeColumns();
    window.addEventListener('resize', computeColumns);
    return () => window.removeEventListener('resize', computeColumns);
  }, []);

  // Load react-window client-side and set the List component
  useEffect(() => {
    let mounted = true;
    import('react-window')
      .then((m) => {
        if (mounted) setListComp(() => m.FixedSizeList);
      })
      .catch(() => {
        // swallow import errors; ErrorBoundary/Suspense fallback will handle display
      });
    return () => {
      mounted = false;
    };
  }, []);

  const rowCount = useMemo(() => {
    return Math.ceil(items.length / columns);
  }, [items.length, columns]);

  const Row = ({ index, style }) => {
    const start = index * columns;
    const end = Math.min(start + columns, items.length);
    const rowItems = items.slice(start, end);
    return (
      <div style={{ ...style, width: '100%' }} className="px-1">
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {rowItems.map((item, i) => renderItem(item, start + i))}
        </div>
      </div>
    );
  };

  // Fallback grid while react-window loads or if it fails
  if (!ListComp) {
    return (
      <div ref={containerRef} className={className}>
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {items.map((item, idx) => renderItem(item, idx))}
        </div>
      </div>
    );
  }

  const List = ListComp;
  return (
    <div ref={containerRef} className={className}>
      <List
        height={height}
        itemCount={rowCount}
        itemSize={rowHeight}
        overscanCount={overscanCount}
        width={"100%"}
      >
        {Row}
      </List>
    </div>
  );
}