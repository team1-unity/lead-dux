import { useState } from 'react';
import { callSubmitOnboarding } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

// Fixed vocabulary rather than free-text, so it actually lines up with
// quest tags for the relevance sort in Quests.jsx.
const INTEREST_OPTIONS = [
  'environment', 'community', 'outdoors', 'education',
  'technology', 'youth', 'arts', 'food security', 'fitness',
];

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
    <div className="box">
      <h1>Tell us about yourself</h1>
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
          <div className="flex flex-wrap gap-sm">
            {INTEREST_OPTIONS.map((interest) => (
              <label key={interest}>
                <input
                  type="checkbox"
                  checked={interests.includes(interest)}
                  onChange={() => toggleInterest(interest)}
                />
                {interest}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p className="box-danger">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
