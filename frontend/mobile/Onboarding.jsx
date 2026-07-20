import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { callSubmitOnboarding } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { INTEREST_OPTIONS } from '@shared/interests.js';
import { PlaceAutocompleteInput } from '@shared/PlaceAutocompleteInput.jsx';
import { EXPERIENCE_LEVELS, TIME_AVAILABILITY, GROUP_PREFERENCES, MOTIVATIONS, LEADER_GOAL_OPTIONS } from '@shared/leadershipProfile.js';

const OTHER_MAX_LENGTH = 120;

// One entry per question-step (step 0 is the Basics step below, handled
// separately since it has three fields, not one). `options` accepts either
// plain strings (value === label, e.g. LEADER_GOAL_OPTIONS) or {value,
// label} objects (the rest) — QuestionStep normalizes both.
const QUESTION_STEPS = [
  { key: 'experienceLevel', legend: 'Where are you at with leadership?', options: EXPERIENCE_LEVELS },
  { key: 'timeAvailability', legend: 'How much time can you give?', options: TIME_AVAILABILITY },
  { key: 'groupPreference', legend: 'How do you like to work?', options: GROUP_PREFERENCES },
  { key: 'motivation', legend: 'What brings you here?', options: MOTIVATIONS },
  { key: 'leaderGoal', legend: 'What kind of leader do you want to become?', options: LEADER_GOAL_OPTIONS },
];
const TOTAL_STEPS = QUESTION_STEPS.length + 1;

// One single-select pill question. Picking a preset is the advance action
// itself (see onSelect in Onboarding below) — there's no separate
// "Continue" for that case. Picking "Other" instead reveals a text input
// and holds on this step until that's filled in, since there's nothing to
// advance with yet.
function QuestionStep({ legend, options, value, otherValue, onSelect, onOtherChange }) {
  const isOther = value === 'other';
  const otherInputRef = useRef(null);

  useEffect(() => {
    if (isOther) otherInputRef.current?.focus();
  }, [isOther]);

  return (
    <div className="flex flex-col gap-md">
      <div className="choice-row" role="group" aria-label={legend}>
        {options.map((opt) => {
          const optValue = typeof opt === 'string' ? opt : opt.value;
          const optLabel = typeof opt === 'string' ? opt : opt.label;
          return (
            <StampButton
              key={optValue}
              type="button"
              className="choice-pill"
              data-active={value === optValue}
              onClick={() => onSelect(optValue)}
            >
              {optLabel}
            </StampButton>
          );
        })}
        <StampButton type="button" className="choice-pill" data-active={isOther} onClick={() => onSelect('other')}>
          Other
        </StampButton>
      </div>
      {isOther && (
        <input
          ref={otherInputRef}
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Type your own answer..."
          maxLength={OTHER_MAX_LENGTH}
        />
      )}
    </div>
  );
}

// The one-time flow between signup and the quest feed, one section at a
// time — Basics (name/age/interests) first, then one screen per leadership-
// profile question, so it reads as a short quest of its own rather than a
// long form. Beyond name/age/interests, this captures experience level,
// time availability, group preference, motivation, and what kind of leader
// someone wants to become — richer signal for a future recommendation step
// to match quests to where someone actually is, not just their interest
// tags. Picking a preset auto-advances to the next section; picking
// "Other" reveals a text field and a Continue/Finish button instead.
export function Onboarding({ name: initialName, onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName || '');
  const [age, setAge] = useState('');
  const [location, setLocation] = useState('');
  const [placeId, setPlaceId] = useState(null);
  const [interests, setInterests] = useState([]);
  const [experienceLevel, setExperienceLevel] = useState('');
  const [experienceLevelOther, setExperienceLevelOther] = useState('');
  const [timeAvailability, setTimeAvailability] = useState('');
  const [timeAvailabilityOther, setTimeAvailabilityOther] = useState('');
  const [groupPreference, setGroupPreference] = useState('');
  const [groupPreferenceOther, setGroupPreferenceOther] = useState('');
  const [motivation, setMotivation] = useState('');
  const [motivationOther, setMotivationOther] = useState('');
  const [leaderGoalChoice, setLeaderGoalChoice] = useState('');
  const [leaderGoalOther, setLeaderGoalOther] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const reduce = useReducedMotion();

  // Keyed by QUESTION_STEPS[i].key so the generic step renderer/handlers
  // below don't need a switch over five near-identical cases.
  const questionState = {
    experienceLevel: [experienceLevel, setExperienceLevel, experienceLevelOther, setExperienceLevelOther],
    timeAvailability: [timeAvailability, setTimeAvailability, timeAvailabilityOther, setTimeAvailabilityOther],
    groupPreference: [groupPreference, setGroupPreference, groupPreferenceOther, setGroupPreferenceOther],
    motivation: [motivation, setMotivation, motivationOther, setMotivationOther],
    leaderGoal: [leaderGoalChoice, setLeaderGoalChoice, leaderGoalOther, setLeaderGoalOther],
  };

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  async function finishOnboarding(resolvedLeaderGoal) {
    setError('');
    setSubmitting(true);
    try {
      await callSubmitOnboarding({
        name,
        age: Number(age),
        location,
        placeId,
        interests,
        experienceLevel,
        experienceLevelOther,
        timeAvailability,
        timeAvailabilityOther,
        groupPreference,
        groupPreferenceOther,
        motivation,
        motivationOther,
        leaderGoal: resolvedLeaderGoal,
      });
      onComplete();
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  // A preset pill IS the advance action — no separate Continue click for
  // that case. "Other" just records the choice and stays put; the form's
  // own submit (the Continue/Finish button, or Enter in the other-text
  // field) is what advances once there's actually text to advance with.
  function selectQuestionOption(questionKey, optionValue, isLastQuestion) {
    setError('');
    questionState[questionKey][1](optionValue);
    if (optionValue !== 'other') {
      if (isLastQuestion) finishOnboarding(optionValue);
      else setStep((s) => s + 1);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (step === 0) {
      if (!name.trim()) {
        setError('Enter your name.');
        return;
      }
      if (!age || Number(age) <= 0) {
        setError('Enter a valid age.');
        return;
      }
      if (interests.length === 0) {
        setError('Pick at least one interest.');
        return;
      }
      if (!placeId) {
        setError('Select your neighborhood or city from the suggestions.');
        return;
      }
      setStep(1);
      return;
    }

    const question = QUESTION_STEPS[step - 1];
    const [value, , otherValue] = questionState[question.key];
    if (value !== 'other' || !otherValue.trim()) {
      setError('Type your own answer to continue.');
      return;
    }

    const isLastQuestion = step === TOTAL_STEPS - 1;
    if (isLastQuestion) finishOnboarding(otherValue.trim());
    else setStep((s) => s + 1);
  }

  const title = step === 0 ? 'Tell Us About Yourself' : QUESTION_STEPS[step - 1].legend;
  const currentIsOther = step > 0 && questionState[QUESTION_STEPS[step - 1].key][0] === 'other';
  // The bottom button only ever needs to exist for Basics (always) or a
  // question step once "Other" is picked — every other case already
  // advanced the moment a preset was clicked.
  const showContinueButton = step === 0 || currentIsOther;

  function renderStepContent() {
    if (step === 0) {
      return (
        <>
          <label>
            Name
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Age
            <input type="number" required min="1" value={age} onChange={(e) => setAge(e.target.value)} />
          </label>
          <label>
            Your neighborhood or city
            <PlaceAutocompleteInput
              ariaLabel="Your neighborhood or city"
              placeholder="Search for a place..."
              onSelect={({ location: selectedLocation, placeId: selectedPlaceId }) => {
                setLocation(selectedLocation);
                setPlaceId(selectedPlaceId);
              }}
            />
            {placeId && <p className="field-optional">{location}</p>}
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
        </>
      );
    }

    const question = QUESTION_STEPS[step - 1];
    const [value, , otherValue, setOtherValue] = questionState[question.key];
    const isLastQuestion = step === TOTAL_STEPS - 1;
    return (
      <QuestionStep
        legend={question.legend}
        options={question.options}
        value={value}
        otherValue={otherValue}
        onOtherChange={setOtherValue}
        onSelect={(optionValue) => selectQuestionOption(question.key, optionValue, isLastQuestion)}
      />
    );
  }

  return (
    <AuthShell title={title}>
      <p className="field-optional" style={{ marginTop: -8, marginBottom: 12 }}>
        Step {step + 1} of {TOTAL_STEPS}
      </p>
      <div className="onboarding-progress">
        <div className="onboarding-progress-fill" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -10 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex flex-col gap-md"
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>

        {error && <p className="box-danger">{error}</p>}

        <div className="flex gap-sm">
          {step > 0 && (
            <StampButton type="button" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              Back
            </StampButton>
          )}
          {showContinueButton && (
            <StampButton type="submit" variant="primary" disabled={submitting} style={{ flex: 1 }}>
              {submitting ? 'Saving...' : step === TOTAL_STEPS - 1 ? 'Finish' : 'Continue'}
            </StampButton>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
