import { useCallback, useRef } from 'react';

const STEP = 0.05;

// A custom-built slider, not a styled <input type="range"> — native range
// inputs render wildly differently across browsers even with heavy CSS
// overrides (thumb/track pseudo-elements are two entirely separate,
// non-standard selector sets per engine), where a plain div-based track/
// fill/thumb draws identically everywhere and matches this app's own
// ink-card look directly instead of fighting a native control for it.
// Pointer-driven (not drag-and-drop) so a single tap anywhere on the track
// jumps straight to that value, same as most real volume sliders; arrow
// keys/Home/End cover keyboard access since this is a real
// role="slider", not a decorative one.
export function VolumeSlider({ icon, label, value, onChange }) {
  const trackRef = useRef(null);

  const updateFromClientX = useCallback(
    (clientX) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
      onChange(Math.min(1, Math.max(0, ratio)));
    },
    [onChange],
  );

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }

  function handlePointerMove(e) {
    // buttons is a bitmask; 1 means the primary button is still held,
    // same check a manual drag (as opposed to setPointerCapture firing a
    // stray move) would need anyway.
    if (e.buttons !== 1) return;
    updateFromClientX(e.clientX);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(1, value + STEP));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(0, value - STEP));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(1);
    }
  }

  const percent = Math.round(value * 100);

  return (
    <div className="volume-slider-row">
      <span className="volume-slider-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="volume-slider-label">{label}</span>
      <div
        ref={trackRef}
        className="volume-slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <div className="volume-slider-fill" style={{ width: `${percent}%` }} />
        <div className="volume-slider-thumb" style={{ left: `${percent}%` }} />
      </div>
      <span className="volume-slider-value">{percent}%</span>
    </div>
  );
}
