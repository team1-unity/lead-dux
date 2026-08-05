import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconSearch } from './icons.jsx';

// A search field with two flourishes on top of a plain controlled <input>:
// cycling placeholder hints (rotates every 3s, pauses while the tab isn't
// visible) and a canvas "dissolve into dust" animation that plays when the
// current text is submitted (Enter), then clears it. Adapted from
// Aceternity UI's PlaceholdersAndVanishInput (a Next.js/TypeScript/
// Tailwind/shadcn component) into this app's own plain React + hand-
// authored CSS + already-installed framer-motion — no Tailwind/shadcn/
// TypeScript pulled in just for this.
//
// Fully controlled (value/onChange), unlike the original (which kept its
// own internal value state mirrored via onChange) — this field also
// drives live filtering as it's typed (see Quests.jsx), so there's only
// ever one source of truth for the text, never a parent/child copy to
// desync. Submitting (Enter) doesn't stop that live filtering or apply
// anything new — everything already typed filtered instantly, keystroke
// by keystroke. It plays the dissolve as a satisfying "done searching"
// flourish and clears the box afterward, same as the original component's
// own actual behavior, just reframed: "clear with style," not "confirm."
export function VanishSearchInput({ value, onChange, placeholders, ariaLabel }) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    function start() {
      intervalRef.current = setInterval(() => {
        setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
      }, 3000);
    }
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible' && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else if (document.visibilityState === 'visible' && !intervalRef.current) {
        start();
      }
    }
    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [placeholders]);

  const canvasRef = useRef(null);
  const dustRef = useRef([]);
  const inputRef = useRef(null);
  const [animating, setAnimating] = useState(false);

  // Snapshots the current text into an 800x800 offscreen buffer (drawn at
  // 2x the real font size, then scaled back down 50% via CSS — crisper
  // dust specks than drawing at 1x would give) and records every non-
  // transparent pixel as one dust particle to animate below. The real
  // input's own computed text color is read straight off the DOM rather
  // than hardcoded, so the dust matches whichever theme (light/dark/
  // system — see Settings.jsx's ThemePicker) is active without any extra
  // color-inversion logic.
  const draw = useCallback(() => {
    if (!inputRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 800;
    ctx.clearRect(0, 0, 800, 800);
    const computed = getComputedStyle(inputRef.current);
    const fontSize = parseFloat(computed.getPropertyValue('font-size'));
    ctx.font = `${fontSize * 2}px ${computed.fontFamily}`;
    ctx.fillStyle = computed.color;
    ctx.fillText(value, 8, fontSize * 1.5);

    const { data } = ctx.getImageData(0, 0, 800, 800);
    const particles = [];
    for (let y = 0; y < 800; y++) {
      const rowStart = 4 * y * 800;
      for (let x = 0; x < 800; x++) {
        const i = rowStart + 4 * x;
        if (data[i + 3] !== 0) {
          particles.push({
            x,
            y,
            r: 1,
            color: `rgba(${data[i]}, ${data[i + 1]}, ${data[i + 2]}, ${data[i + 3]})`,
          });
        }
      }
    }
    dustRef.current = particles;
  }, [value]);

  function animate(startX) {
    function frame(pos) {
      requestAnimationFrame(() => {
        const next = [];
        for (const particle of dustRef.current) {
          if (particle.x < pos) {
            next.push(particle);
            continue;
          }
          if (particle.r <= 0) continue;
          particle.x += Math.random() > 0.5 ? 1 : -1;
          particle.y += Math.random() > 0.5 ? 1 : -1;
          particle.r -= 0.05 * Math.random();
          next.push(particle);
        }
        dustRef.current = next;
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(pos, 0, 800, 800);
          for (const particle of dustRef.current) {
            if (particle.x <= pos) continue;
            ctx.beginPath();
            ctx.rect(particle.x, particle.y, particle.r, particle.r);
            ctx.fillStyle = particle.color;
            ctx.strokeStyle = particle.color;
            ctx.stroke();
          }
        }
        if (dustRef.current.length > 0) {
          frame(pos - 8);
        } else {
          onChange('');
          setAnimating(false);
        }
      });
    }
    frame(startX);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (animating || !value.trim()) return;
    setAnimating(true);
    draw();
    // draw() above is async-by-closure (it reads `value` from this render,
    // dustRef is populated synchronously though) — safe to read dustRef
    // right after calling it since draw() itself runs synchronously.
    const maxX = dustRef.current.reduce((max, p) => (p.x > max ? p.x : max), 0);
    animate(maxX);
  }

  return (
    <form className='vanish-search-field' onSubmit={handleSubmit}>
      <IconSearch className='vanish-search-icon' />
      <div className='vanish-search-input-wrap'>
        <canvas
          ref={canvasRef}
          className={animating ? 'vanish-search-canvas is-animating' : 'vanish-search-canvas'}
        />
        <input
          ref={inputRef}
          type='text'
          value={value}
          onChange={(e) => {
            if (!animating) onChange(e.target.value);
          }}
          aria-label={ariaLabel}
          className={animating ? 'vanish-search-input is-animating' : 'vanish-search-input'}
        />
        <div className='vanish-search-placeholder-layer'>
          <AnimatePresence mode='wait'>
            {!value && (
              <motion.p
                key={`placeholder-${currentPlaceholder}`}
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -15, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'linear' }}
              >
                {placeholders[currentPlaceholder]}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </form>
  );
}
