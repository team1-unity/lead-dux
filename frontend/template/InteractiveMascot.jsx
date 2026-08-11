import { useCallback, useRef } from 'react';
import { motion, animate, useMotionValue, useReducedMotion } from 'framer-motion';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ---- Tunable constants ------------------------------------------------
// Named and grouped by which interaction they belong to, so retuning
// "how far does it lean toward the cursor" is a one-line change here
// instead of a hunt through the JSX below.

// Idle breathing: deliberately subtle — a static mascot should read as
// "alive," not "glitching." Scales from the bottom edge (see the img's own
// transformOrigin below), not the center — growing from the ground up
// means the feet stay planted on the same line every frame and only the
// body rises, reading as breathing-while-standing. A center-origin scale
// (the default) would grow the image both up AND down at once, plus this
// used to pair with a small vertical float on top of that — between the
// two, the whole duck visibly drifted rather than staying grounded.
const IDLE_BREATHE_SCALE = 1.015;
const IDLE_BREATHE_DURATION = 3.4; // seconds, one full breath

// Hover: base squash/tilt before cursor-tracking adds any more, kept well
// under "cartoon character" territory.
const HOVER_SCALE = 1.03;
const HOVER_SPRING = { type: 'spring', stiffness: 300, damping: 20, mass: 0.6 };

// Cursor tracking: how far the pointer can wander from the mascot's own
// center before its influence is clamped, and how much of that offset
// actually reaches the transform. This is what keeps "lean toward the
// cursor" from ever reading as "flung toward the cursor."
const TRACK_MAX_OFFSET_PX = 60;
// Rotation now pivots from the feet, not the center (see the outer div's
// transformOrigin) — the same angle sweeps a wider arc at the top of the
// duck with a bottom pivot than it did with a center one (longer lever
// arm), which is what made this read as leaning too far once that changed.
const TRACK_ROTATE_DEG = 2; // rotation at full clamp offset
const TRACK_TRANSLATE_FACTOR = 0.12; // fraction of offset that becomes x/y drift
const TRACK_SCALE_BUMP = 0.02; // extra scale on top of HOVER_SCALE at full offset
const TRACK_SPRING = { type: 'spring', stiffness: 150, damping: 15, mass: 0.8 };

// Mouse leave: noticeably underdamped compared to the tracking spring —
// that's what produces the small overshoot/wobble on release rather than
// a flat snap back to rest.
const LEAVE_SPRING = { type: 'spring', stiffness: 260, damping: 12, mass: 0.7 };

// Click: an asymmetric squash (wider, shorter), not a uniform shrink —
// that asymmetry is what reads as "rubber toy" rather than "button press."
const CLICK_SQUASH_X = 1.08;
const CLICK_SQUASH_Y = 0.9;
const CLICK_SPRING = { type: 'spring', stiffness: 500, damping: 15, mass: 0.5 };

// A mascot image that leans toward the cursor, squashes on click, and
// breathes gently at rest. Two nested motion elements rather than one:
// the outer div owns the reactive stuff (hover/cursor-tracking/tap,
// driven by raw motion values so tracking and leave-release can each use
// their own spring), the inner img owns the always-on idle loop. Nesting
// lets their transforms compose for free instead of having to manually
// combine two animation sources fighting over the same `scale`/`y`.
export function InteractiveMascot({ imageSrc, alt = '', width = 140, className, onClick }) {
  const reduce = useReducedMotion();
  const containerRef = useRef(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const scale = useMotionValue(1);

  const handlePointerMove = useCallback((e) => {
    if (reduce || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = clamp(e.clientX - (rect.left + rect.width / 2), -TRACK_MAX_OFFSET_PX, TRACK_MAX_OFFSET_PX);
    const dy = clamp(e.clientY - (rect.top + rect.height / 2), -TRACK_MAX_OFFSET_PX, TRACK_MAX_OFFSET_PX);
    const pull = Math.hypot(dx, dy) / (TRACK_MAX_OFFSET_PX * Math.SQRT2);
    animate(x, dx * TRACK_TRANSLATE_FACTOR, TRACK_SPRING);
    animate(y, dy * TRACK_TRANSLATE_FACTOR, TRACK_SPRING);
    animate(rotate, (dx / TRACK_MAX_OFFSET_PX) * TRACK_ROTATE_DEG, TRACK_SPRING);
    animate(scale, HOVER_SCALE + pull * TRACK_SCALE_BUMP, TRACK_SPRING);
  }, [reduce]);

  const handleHoverStart = useCallback(() => {
    if (reduce) return;
    animate(scale, HOVER_SCALE, HOVER_SPRING);
  }, [reduce]);

  const handleHoverEnd = useCallback(() => {
    animate(x, 0, LEAVE_SPRING);
    animate(y, 0, LEAVE_SPRING);
    animate(rotate, 0, LEAVE_SPRING);
    animate(scale, 1, LEAVE_SPRING);
  }, []);

  return (
    <motion.div
      ref={containerRef}
      className={className}
      // Opts out of App.jsx's global click sound — this mascot plays its
      // own quack on click instead (see mobile/Home.jsx's playQuack), and
      // both firing on the same click would double up.
      data-no-click-sound=""
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onHoverStart={handleHoverStart}
      onHoverEnd={handleHoverEnd}
      whileTap={reduce ? undefined : { scaleX: CLICK_SQUASH_X, scaleY: CLICK_SQUASH_Y, transition: CLICK_SPRING }}
      style={{
        display: 'inline-block',
        width,
        x,
        y,
        rotate,
        scale,
        // Bottom-anchored, same reasoning as the idle breathe on the img
        // below: hover's scale bump and the click squash both grow/shrink
        // from here now, so the feet stay planted rather than lifting off
        // the ground on hover or popping upward mid-squash. Tracking's own
        // lean (rotate) pivots from the same point too, which if anything
        // reads more natural than pivoting from the belly — a real lean
        // pivots at the feet, not the center of mass.
        transformOrigin: 'bottom center',
        cursor: onClick ? 'pointer' : undefined,
        touchAction: 'manipulation',
      }}
    >
      <motion.img
        src={imageSrc}
        alt={alt}
        draggable={false}
        style={{ display: 'block', width: '100%', height: 'auto', transformOrigin: 'bottom center' }}
        animate={reduce ? undefined : { scale: [1, IDLE_BREATHE_SCALE, 1] }}
        transition={
          reduce ? undefined : { duration: IDLE_BREATHE_DURATION, repeat: Infinity, ease: 'easeInOut' }
        }
      />
    </motion.div>
  );
}
