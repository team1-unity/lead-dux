import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@shared/AuthContext.jsx';
import { callDeleteAccount } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { getStoredTheme, applyTheme } from '@shared/theme.js';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

function ThemePicker() {
  const [theme, setTheme] = useState(getStoredTheme());

  function choose(value) {
    applyTheme(value);
    setTheme(value);
  }

  return (
    <section className="ink-card">
      <h2>Display</h2>
      <p style={{ marginTop: 0 }}>Choose how Leadership Quest looks on this device.</p>
      <div className="theme-option-row">
        {THEME_OPTIONS.map((opt) => (
          <StampButton
            key={opt.value}
            type="button"
            className="theme-option"
            data-active={theme === opt.value}
            onClick={() => choose(opt.value)}
          >
            {opt.label}
          </StampButton>
        ))}
      </div>
    </section>
  );
}

// Deleting an account is destructive and permanent, so it's gated behind a
// typed confirmation rather than a single click or a plain window.confirm
// — the cascade wording below tells the caller exactly what they're about
// to lose before they can even reach the confirm button.
function DangerZone() {
  const { role, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const cascadeCopy =
    role === 'organization'
      ? 'This permanently deletes your organization profile and every quest you posted.'
      : "This removes you from every quest you've RSVP'd to.";

  async function deleteAccount() {
    setSubmitting(true);
    setError('');
    try {
      await callDeleteAccount();
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <section className="ink-card" data-danger="true">
      <h2>Danger zone</h2>
      {!confirming ? (
        <StampButton type="button" variant="danger" onClick={() => setConfirming(true)}>
          Delete account
        </StampButton>
      ) : (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{ overflow: 'hidden' }}
        >
          <div className="flex flex-col gap-md" style={{ paddingTop: 4 }}>
            <p style={{ margin: 0 }}>{cascadeCopy} This cannot be undone.</p>
            <label>
              Type DELETE to confirm
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </label>
            {error && <p className="box-danger">{error}</p>}
            <div className="flex gap-sm">
              <StampButton
                type="button"
                variant="danger"
                disabled={confirmText !== 'DELETE' || submitting}
                onClick={deleteAccount}
              >
                {submitting ? 'Deleting...' : 'Permanently delete'}
              </StampButton>
              <StampButton
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText('');
                  setError('');
                }}
                disabled={submitting}
              >
                Cancel
              </StampButton>
            </div>
          </div>
        </motion.div>
      )}
    </section>
  );
}

// Purely app preferences and the one destructive account action — identity,
// interests, and organization status all live on Profile instead (see
// Profile.jsx). Not wrapped in narrow-content: at desktop width each
// section spans the full dashboard-style width rather than floating a
// mobile-width form in the middle of a wide page.
export function Settings() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <TopBar title="Settings" />
      <div className="settings-grid">
        <ThemePicker />
        <DangerZone />
      </div>
    </PageMotion>
  );
}
