import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@shared/firebaseapp.jsx';
import { DEMO_STUDENT_EMAIL, DEMO_PASSWORD } from '@shared/demoConfig.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { callDemoSeedShowcase } from '@shared/fetch.jsx';

// No UI of its own — signs the visitor into the fixed Jordan Ortiz demo
// student account (see @shared/demoConfig.js) and hands off to the real
// app at "/". Same reasoning as DemoOrg.jsx: this is a real, fully
// signed-in session, so Home, Quests (with a real RSVP button), Map,
// Journal (with a real reflection editor), search, and Edit Profile's duck
// picker all just work — nothing here to keep in sync with the real UI
// because it never diverges from it in the first place. See DemoOps.jsx
// for the presenter's backstage screen (QR code, live RSVP/check-in feed,
// Seed/Reset) — that page never signs in as anyone.
export function DemoStud() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  const enter = useCallback(() => {
    setError('');
    signInWithEmailAndPassword(auth, DEMO_STUDENT_EMAIL, DEMO_PASSWORD)
      .then(() => navigate('/', { replace: true }))
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

  if (!error) return <LoadingSpinner label="Entering as Jordan Ortiz…" />;

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
