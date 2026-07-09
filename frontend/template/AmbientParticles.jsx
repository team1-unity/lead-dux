const TONES = [
  'community', 'education', 'environment', 'outdoors', 'technology',
  'youth', 'fitness', 'food-security', 'arts',
];

// Deterministic "random" spread (not Math.random()) so particles don't
// clump on any given render, but still feel organic rather than gridded.
const PARTICLES = Array.from({ length: 9 }, (_, i) => ({
  id: i,
  left: (i * 41 + 7) % 100,
  size: 5 + ((i * 3) % 4) * 2,
  delay: (i % 5) * -2.6,
  duration: 16 + (i % 4) * 3,
  tone: TONES[(i * 2) % TONES.length],
}));

// Slow-drifting pastel dust, purely CSS-animated (no JS loop, no canvas) —
// a small dose of ambient life behind a screen's real content. Fixed,
// pointer-events: none, and hidden under prefers-reduced-motion so it never
// gets in the way of the actual UI.
export function AmbientParticles() {
  return (
    <div className="ambient-particles" aria-hidden="true">
      {PARTICLES.map((p) => (
        <span
          key={p.id}
          className="ambient-particle"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: `var(--tag-${p.tone})`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
