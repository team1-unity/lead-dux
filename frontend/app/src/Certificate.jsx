import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import rough from 'roughjs';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { StampButton } from '@shared/StampButton.jsx';

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
// Uses roughjs (already a dependency, see RoughFrame.jsx) for the
// hand-drawn border, matching the app's ink-stamp aesthetic instead of a
// crisp corporate rectangle.
async function drawCertificate(canvas, { name, issuedAt, ink, paper, accent, duckUrl }) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const rc = rough.canvas(canvas);
  rc.rectangle(28, 28, WIDTH - 56, HEIGHT - 56, { stroke: ink, strokeWidth: 3, roughness: 1.6 });
  rc.rectangle(44, 44, WIDTH - 88, HEIGHT - 88, { stroke: accent, strokeWidth: 1.5, roughness: 1.2 });

  await document.fonts.ready;

  ctx.textAlign = 'center';
  ctx.fillStyle = ink;

  ctx.font = "400 22px 'DM Sans', sans-serif";
  ctx.fillText('LEADERSHIP QUEST', WIDTH / 2, 150);

  ctx.font = "700 64px 'Crushed', 'Arial Narrow', sans-serif";
  ctx.fillText('Certificate of Leadership', WIDTH / 2, 240);

  ctx.font = "400 22px 'DM Sans', sans-serif";
  ctx.fillText('This certifies that', WIDTH / 2, 340);

  ctx.font = "700 52px 'Cuprum', 'Arial Narrow', sans-serif";
  ctx.fillStyle = accent;
  ctx.fillText(name, WIDTH / 2, 410);

  ctx.font = "400 22px 'DM Sans', sans-serif";
  ctx.fillStyle = ink;
  ctx.fillText('has achieved Diamond Rank in Leadership Quest,', WIDTH / 2, 470);
  ctx.fillText('completing the full leadership journey from Iron to Diamond.', WIDTH / 2, 500);

  ctx.font = "400 18px 'DM Sans', sans-serif";
  ctx.fillText(`Awarded ${issuedAt}`, WIDTH / 2, 600);

  try {
    const duck = await loadImage(duckUrl);
    const duckWidth = 110;
    const duckHeight = (duckWidth * duck.height) / duck.width;
    ctx.drawImage(duck, WIDTH / 2 - duckWidth / 2, HEIGHT - 210, duckWidth, duckHeight);
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
        name: data.name || 'Leadership Quest Member',
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
    // value the browser resolves for us — same theme-aware asset DuckMark
    // uses in Logo.jsx, just unwrapped here since canvas needs a plain path.
    const duckUrlRaw = style.getPropertyValue('--duck-mark-url').trim();
    const duckUrlMatch = duckUrlRaw.match(/url\(["']?([^"')]+)["']?\)/);
    drawCertificate(canvasRef.current, {
      name: profile.name,
      issuedAt: issuedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      ink: style.getPropertyValue('--line').trim(),
      paper: style.getPropertyValue('--paper-card').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      duckUrl: duckUrlMatch ? duckUrlMatch[1] : '/brand/duck-brown.png',
    });
  }, [profile]);

  function download() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leadership-quest-certificate-${(profile?.name || 'member').replace(/\s+/g, '-').toLowerCase()}.png`;
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
