import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { DuckMark } from '@shared/Logo.jsx';

const WIDTH = 1200;
const HEIGHT = 840;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Drawn straight onto a <canvas> rather than a styled DOM node — the point
// is a single self-contained downloadable artifact (see the "Download
// Certificate" button below), so there's nothing to serialize afterward.
// A single crisp inset rule, not a hand-drawn frame — this is the one
// artifact that leaves the app and lands in front of people who've never
// seen its playful in-app voice (a resume, an employer), so it borrows the
// app's own Source Serif 4 / Inter pairing instead of the ink-stamp
// aesthetic used elsewhere.
async function drawCertificate(canvas, { name, issuedAt, ink, paper, duckUrl }) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, WIDTH - 64, HEIGHT - 64);

  await document.fonts.ready;

  ctx.textAlign = 'center';
  ctx.fillStyle = ink;

  ctx.font = "600 22px 'Inter', system-ui, sans-serif";
  ctx.fillText('LEAD-DUX', WIDTH / 2, 150);

  ctx.font = "700 60px 'Source Serif 4', Georgia, serif";
  ctx.fillText('Certificate of Leadership', WIDTH / 2, 240);

  ctx.font = "400 22px 'Inter', system-ui, sans-serif";
  ctx.fillText('This certifies that', WIDTH / 2, 340);

  ctx.font = "700 48px 'Source Serif 4', Georgia, serif";
  ctx.fillText(name, WIDTH / 2, 410);

  ctx.font = "400 22px 'Inter', system-ui, sans-serif";
  ctx.fillText('has achieved Diamond Rank in Lead-Dux,', WIDTH / 2, 470);
  ctx.fillText('completing the full leadership journey from Iron to Diamond.', WIDTH / 2, 500);

  ctx.font = "400 18px 'Inter', system-ui, sans-serif";
  ctx.fillText(`Awarded ${issuedAt}`, WIDTH / 2, 600);

  try {
    const duck = await loadImage(duckUrl);
    const duckWidth = 48;
    const duckHeight = (duckWidth * duck.height) / duck.width;
    const margin = 56;
    ctx.drawImage(duck, WIDTH - margin - duckWidth, HEIGHT - margin - duckHeight, duckWidth, duckHeight);
  } catch {
    // Missing asset shouldn't block the rest of the certificate from rendering.
  }
}

export function Certificate() {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({
        name: data.name || 'Lead-Dux Member',
        certificateIssued: Boolean(data.certificateIssued),
        certificateIssuedAt: data.certificateIssuedAt || null,
      });
    });
  }, [user]);

  useEffect(() => {
    if (!profile || !profile.certificateIssued || !canvasRef.current) return;
    const style = getComputedStyle(document.documentElement);
    const issuedAt = profile.certificateIssuedAt?.toDate
      ? profile.certificateIssuedAt.toDate()
      : new Date();
    // --duck-mark-url holds a raw url(...) token (see style.css), not a
    // value the browser resolves for us — same asset DuckMark uses in
    // Logo.jsx, just unwrapped here since canvas needs a plain path.
    const duckUrlRaw = style.getPropertyValue('--duck-mark-url').trim();
    const duckUrlMatch = duckUrlRaw.match(/url\(["']?([^"')]+)["']?\)/);
    drawCertificate(canvasRef.current, {
      name: profile.name,
      issuedAt: issuedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      ink: style.getPropertyValue('--line').trim(),
      paper: style.getPropertyValue('--paper-card').trim(),
      duckUrl: duckUrlMatch ? duckUrlMatch[1] : '/brand/logo-lockup.png',
    });
  }, [profile]);

  function download() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lead-dux-certificate-${(profile?.name || 'member').replace(/\s+/g, '-').toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (profile === null) return <LoadingSpinner />;
  if (!profile.certificateIssued) return <Navigate to="/profile" replace />;

  return (
    <PageMotion>
      <BackLink to="/profile" label="Profile" />
      <div className="certificate-page">
        {/* This is app-only chrome, not part of the certificate image
            itself — the canvas below (and whatever gets downloaded from
            it) stays deliberately restrained since it's the one artifact
            that leaves the app and lands in front of a stranger. The
            personality lives here instead, where it can't undercut that. */}
        <DuckMark size={56} />
        <p className="duck-caption">You did the thing. Iron to Diamond, the whole way.</p>
        <h1>Your Diamond Certificate</h1>
        <div className="certificate-canvas-wrap">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
        </div>
        <StampButton type="button" variant="primary" onClick={download}>
          Download Certificate
        </StampButton>
      </div>
    </PageMotion>
  );
}
