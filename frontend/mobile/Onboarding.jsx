import { useState } from 'react';
import { callSubmitOnboarding } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { INTEREST_OPTIONS } from '@shared/interests.js';

export function Onboarding({ name: initialName, onComplete }) {
  const [name, setName] = useState(initialName || '');
  const [age, setAge] = useState('');
  const [interests, setInterests] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (interests.length === 0) {
      setError('Pick at least one interest.');
      return;
    }
    setSubmitting(true);
    try {
      await callSubmitOnboarding({ name, age: Number(age), interests });
      onComplete();
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Tell Us About Yourself">
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label>
          Name
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Age
          <input type="number" required min="1" value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <fieldset>
          <legend>Interests</legend>
          <div className="flex flex-wrap gap-sm" style={{ marginTop: 8 }}>
            {INTEREST_OPTIONS.map((interest) => (
              <TagStamp
                key={interest}
                tone={interest}
                selectable
                selected={interests.includes(interest)}
                onClick={() => toggleInterest(interest)}
              >
                {interest}
              </TagStamp>
            ))}
          </div>
        </fieldset>
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving...' : 'Continue'}
        </StampButton>
      </form>
    </AuthShell>
  );
}
