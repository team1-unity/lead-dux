import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@shared/firebaseapp.jsx';
import { DEMO_ORG_EMAIL, DEMO_PASSWORD } from '@shared/demoConfig.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { callDemoSeedShowcase } from '@shared/fetch.jsx';

// No UI of its own on purpose — signs the visitor into the fixed DGI demo
// org account (see @shared/demoConfig.js) and hands off straight to the
// real /org dashboard. A hand-built lookalike page can only ever
// approximate the real org app and drifts the moment that UI changes;
// actually signing in as a real (if fixed) account can't drift at all —
// every nav item, the real "Generate/View QR Code" button, real Edit
// Profile/duck picker, everything just works because it IS the real app.
// See DemoOps.jsx for the presenter's own backstage control screen
// (QR display, live RSVP/check-in feed, Seed/Reset) — that page never
// signs in as anyone.
export function DemoOrg() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  const enter = useCallback(() => {
    setError('');
    signInWithEmailAndPassword(auth, DEMO_ORG_EMAIL, DEMO_PASSWORD)
      .then(() => navigate('/org', { replace: true }))
      .catch((err) => setError(err.message || 'Could not enter the demo.'));
  }, [navigate]);

  useEffect(enter, [enter]);

  async function handleSeed() {
    setSeeding(true);
    try {
      await callDemoSeedShowcase();
      enter();
    } catch (err) {
      setError(err.message || 'Could not seed demo data.');
    } finally {
      setSeeding(false);
    }
  }

  if (!error) return <LoadingSpinner label="Entering as Digital Girl Inc…" />;

  return (
    <PageMotion>
      <div className="ink-card">
        <p className="box-danger">{error}</p>
        <StampButton type="button" variant="primary" onClick={handleSeed} disabled={seeding} style={{ marginTop: 10 }}>
          {seeding ? 'Seeding…' : 'Seed Demo Data'}
        </StampButton>
      </div>
    </PageMotion>
  );
}
