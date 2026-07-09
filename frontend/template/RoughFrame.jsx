import { useEffect, useRef } from 'react';
import rough from 'roughjs';

// Live-rendered rough.js canvas, reserved for rare one-off decorative
// moments (a handful per screen at most — e.g. an empty-state illustration).
// NOT for repeated list elements; see RoughTexture for that. Fixed
// intrinsic size (no ResizeObserver) since a one-off doesn't need to track
// a resizing container the way a card layout would.
export function RoughFrame({ width = 200, height = 160, draw, className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !draw) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const rc = rough.canvas(canvas);
    draw(rc, width, height);
  }, [width, height, draw]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
