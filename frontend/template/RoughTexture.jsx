import { useId, useMemo } from 'react';
import rough from 'roughjs';

// Precomputed hand-drawn textures for elements that repeat at list scale
// (quest thumbnails, locked/empty states). Geometry is generated ONCE per
// (variant, seed-bucket) pair via rough.js's generator — no live canvas, no
// per-instance ResizeObserver — then cached and rendered as a plain inline
// SVG. This is the deliberate alternative to a canvas-per-card approach,
// which doesn't hold up once a Capacitor WebView has to redraw 20-30 cards.
//
// `seed` should be something stable per item (e.g. a quest id) so the same
// item always draws the same way across re-renders; different items land in
// different buckets so a list doesn't look like it was stamped with one
// cookie cutter.

const generator = rough.generator();
const BUCKET_COUNT = 5;
const pathCache = new Map();

const VARIANTS = {
  solid: { w: 100, h: 70 },
  hatch: { w: 100, h: 70 },
  xbox: { w: 60, h: 60 },
  // Square, not tall — the actual rendered thread is stretched however
  // tall CSS needs it via preserveAspectRatio="none", but a tall viewBox
  // becomes the SVG's *intrinsic* size, which browsers fall back to when
  // measuring a flex:1 item inside an auto-height flex column (no space to
  // grow into yet). That inflated the whole row before stretch even ran.
  thread: { w: 24, h: 24 },
};

function hashToBucket(value) {
  const s = String(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % BUCKET_COUNT;
}

function buildPaths(variant, bucket) {
  const key = `${variant}:${bucket}`;
  if (pathCache.has(key)) return pathCache.get(key);

  const { w, h } = VARIANTS[variant];
  const seed = bucket * 97 + 13;
  const base = { roughness: 0.85, bowing: 0.7, strokeWidth: 2.2, stroke: 'currentColor', seed };

  let drawables;
  if (variant === 'xbox') {
    drawables = [
      generator.rectangle(4, 4, w - 8, h - 8, base),
      generator.line(9, 9, w - 9, h - 9, { ...base, strokeWidth: 1.6 }),
      generator.line(w - 9, 9, 9, h - 9, { ...base, strokeWidth: 1.6 }),
    ];
  } else if (variant === 'hatch') {
    drawables = [
      generator.rectangle(4, 4, w - 8, h - 8, {
        ...base,
        fill: 'currentColor',
        fillStyle: 'cross-hatch',
        fillWeight: 1,
        hachureGap: 7,
      }),
    ];
  } else if (variant === 'thread') {
    // A gentle meander, not a straight line — reads as a connecting thread
    // between quests rather than a ruler-drawn divider. Alternates lean
    // direction by bucket so a whole list doesn't wave in unison. This tile
    // repeats many times down a tall thread (see the pattern-fill render
    // below), so it deliberately uses much less roughness/bowing than the
    // other one-off textures — the same jitter that reads as "hand-drawn"
    // on a single xbox/hatch fill looks like a jagged heartbeat trace once
    // it's the same jagged tile repeated back-to-back a dozen times.
    const lean = bucket % 2 === 0 ? 5 : -5;
    drawables = [
      generator.curve(
        [
          [w / 2, 0],
          [w / 2 + lean, h * 0.25],
          [w / 2 - lean, h * 0.5],
          [w / 2 + lean, h * 0.75],
          [w / 2, h],
        ],
        { ...base, roughness: 0.3, bowing: 0.25, strokeWidth: 2.4 }
      ),
    ];
  } else {
    drawables = [generator.rectangle(4, 4, w - 8, h - 8, { ...base, fill: 'currentColor', fillStyle: 'solid' })];
  }

  const paths = drawables.flatMap((d) => generator.toPaths(d));
  pathCache.set(key, paths);
  return paths;
}

// `label` makes this a meaningful image for assistive tech (e.g. "Locked —
// Trail Blazer badge"); omit it for purely decorative uses and the SVG is
// hidden from the accessibility tree instead. Cross-hatch/X-box textures
// should almost always be paired with a visible text/icon fallback nearby
// too — the pattern alone isn't enough signal for screen readers or low
// vision.
export function RoughTexture({ variant = 'solid', seed = variant, tone, label, className }) {
  const reactId = useId();
  const bucket = useMemo(() => hashToBucket(seed), [seed]);
  const paths = useMemo(() => buildPaths(variant, bucket), [variant, bucket]);
  const { w, h } = VARIANTS[variant];
  const color = tone ? `var(--tag-${tone})` : 'var(--line)';

  // The thread connects two quest nodes over whatever height the expanded
  // card leaves it — scaling one curve to fit (preserveAspectRatio="none",
  // below) stretched it into a distorted line as soon as a card expanded.
  // Tiling the same curve at its native 24px size via an SVG pattern keeps
  // the motif's proportions fixed and repeats it to fill the height instead.
  //
  // No viewBox here (needed so patternUnits="userSpaceOnUse" tiles at a
  // fixed *pixel* size rather than being stretched along with a viewBox),
  // which means this svg has no intrinsic aspect ratio to size itself by.
  // A percentage height on that lands inside .quest-thread — itself an
  // auto-height flex:1 item — resolves to "auto" per spec instead of the
  // grown flex size, falling back to the ~150px UA-default intrinsic
  // height and inflating the whole row. inset:0 sizes from the *used*
  // (already flex-resolved) box instead, sidestepping that percentage
  // ambiguity entirely.
  if (variant === 'thread') {
    const patternId = `thread-pattern-${reactId}`;
    return (
      <svg
        className={className}
        style={{ color, display: 'block', position: 'absolute', inset: 0 }}
        aria-hidden="true"
      >
        <defs>
          <pattern id={patternId} width={w} height={h} patternUnits="userSpaceOnUse">
            {paths.map((p, i) => (
              <path key={i} d={p.d} fill={p.fill || 'none'} stroke={p.stroke} strokeWidth={p.strokeWidth} />
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      style={{ color, display: 'block', width: '100%', height: '100%' }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill || 'none'} stroke={p.stroke} strokeWidth={p.strokeWidth} />
      ))}
    </svg>
  );
}
