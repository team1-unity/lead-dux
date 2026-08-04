import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { callSubmitFeedbackRequestResponse } from '@shared/fetch.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { IconChevron } from '@shared/icons.jsx';

// Mirrors FEEDBACK_QUESTIONS in functions/main.py by hand, same as every
// other copy of this ladder kept in sync across the app — now an ordered
// array (id + text) instead of a plain object, since the step-through flow
// below needs a stable index to animate against.
const QUESTIONS = [
  { id: 'engagement', text: 'How actively did they participate and engage during the quest?' },
  { id: 'presence', text: 'How present and attentive were they throughout?' },
  { id: 'involvement', text: 'How involved were they in contributing to the group or task?' },
  {
    id: 'initiative',
    text: 'How much initiative did they show — stepping up or helping without being asked?',
  },
  { id: 'attitude', text: 'How positive and cooperative was their attitude?' },
];
const RATING_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Row/viewport geometry for the step-through slider — must match the fixed
// heights set on .feedback-question-viewport/.feedback-question-row in
// style.css. Adapted from the TextMarquee reference's vertical
// translate+fade-mask technique: same idea (a column of rows slid up
// behind a masked viewport), but ROW_HEIGHT/PEEK_HEIGHT replace its
// --origin/--destination/--duration CSS custom properties, since there's
// no infinite loop here to compute a per-item animation phase for. Sized
// to fit a question line + the rating row, not the taller footprint the
// final slide needed back when Submit feedback lived inside it — now that
// Submit sits in .feedback-nav-row instead, the final slide is just a
// short textarea and fits this same smaller height easily.
const ROW_HEIGHT = 132;
const PEEK_HEIGHT = 48;
// The Extra Thoughts + Submit slide lives at this index, one past the
// last rating question — a real 6th step in the same sliding column
// rather than a separate block that fades in below it.
const FINAL_STEP_INDEX = QUESTIONS.length;

// Draft persistence — so an accidental refresh, tab close, or just
// collapsing the accordion row (which unmounts this component, per
// PendingFeedbackList.jsx's single-expand accordion) doesn't lose progress
// mid-form. Keyed by request.id, which is stable and never reused for a
// new request (request_quest_feedback rejects a second request for the
// same quest+uid forever), so there's no risk of an old draft resurfacing
// against an unrelated request. localStorage, not component state, since
// it needs to survive the component actually unmounting.
function draftKey(requestId) {
  return `feedbackDraft:${requestId}`;
}
function loadDraft(requestId) {
  try {
    const raw = localStorage.getItem(draftKey(requestId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveDraft(requestId, draft) {
  try {
    localStorage.setItem(draftKey(requestId), JSON.stringify(draft));
  } catch {
    // Private browsing / storage disabled / quota exceeded — draft
    // persistence is a convenience, not a requirement for submitting.
  }
}
function clearDraft(requestId) {
  try {
    localStorage.removeItem(draftKey(requestId));
  } catch {
    // ignore, same reasoning as saveDraft
  }
}

// Expanded, inline content for one pending feedback request — extracted as
// its own component (per the redesign ask) so PendingFeedbackList.jsx can
// swap this for a Dialog/modal later without touching the step-through
// logic itself. Renders inline today; nothing here assumes it's mounted
// inside an accordion versus a modal.
export function FeedbackRequestPanel({ request, onSubmitted }) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = loadDraft(request.id)?.currentIndex;
    return typeof saved === 'number' ? Math.min(Math.max(saved, 0), FINAL_STEP_INDEX) : 0;
  });
  const [answers, setAnswers] = useState(() => loadDraft(request.id)?.answers ?? {});
  const [extraThoughts, setExtraThoughts] = useState(() => loadDraft(request.id)?.extraThoughts ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const reduce = useReducedMotion();

  useEffect(() => {
    saveDraft(request.id, { currentIndex, answers, extraThoughts });
  }, [request.id, currentIndex, answers, extraThoughts]);

  // Picking a rating always advances to the next slide, whether it's a
  // first-time answer or the org travelled back (goBack below) to change
  // an earlier one — advancing off the last question lands on
  // FINAL_STEP_INDEX (Extra thoughts + Submit).
  function selectRating(question, value) {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    setCurrentIndex((prev) => Math.min(prev + 1, FINAL_STEP_INDEX));
  }

  function goBack() {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }
  function goNext() {
    setCurrentIndex((prev) => Math.min(prev + 1, FINAL_STEP_INDEX));
  }
  const canGoBack = currentIndex > 0;
  // Reaching FINAL_STEP_INDEX requires every question before it to already
  // be answered (goNext/auto-advance both gate on that), so there's
  // nothing further to check once the org is on the final slide itself.
  const canGoNext = currentIndex < FINAL_STEP_INDEX && answers[QUESTIONS[currentIndex].id] != null;

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      await callSubmitFeedbackRequestResponse({
        questId: request.questId,
        uid: request.uid,
        answers,
        extraThoughts: extraThoughts.trim() || undefined,
      });
      clearDraft(request.id);
      onSubmitted();
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  // The reference computes --origin (stacked below the viewport) and
  // --destination (final resting spot) per item, then lets a @keyframes
  // loop animate between them forever. Here there's only one thing to
  // solve for: how far to shift the whole column so the current question
  // sits in the viewport's opaque band, holding back PEEK_HEIGHT of travel
  // so the just-answered question above stays partly visible (faded by
  // the mask in style.css) instead of sliding fully out of frame.
  const offsetY = currentIndex * ROW_HEIGHT - PEEK_HEIGHT;

  return (
    <div className='feedback-panel'>
      {error && <p className='box-danger'>{error}</p>}

      <div className='feedback-question-viewport' style={{ height: ROW_HEIGHT + PEEK_HEIGHT }}>
        <motion.div
          className='feedback-question-column'
          animate={{ y: -offsetY }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 32 }}
        >
          {QUESTIONS.map((question, index) => {
            const answer = answers[question.id];
            const isActive = index === currentIndex;
            return (
              <div
                key={question.id}
                className='feedback-question-row'
                style={{ height: ROW_HEIGHT }}
              >
                <p className={`feedback-question-text${isActive ? ' is-active' : ''}`}>
                  {question.text}
                </p>
                <div className='feedback-rating-row' role='radiogroup' aria-label={question.text}>
                  {RATING_VALUES.map((value) => {
                    const checked = answer === value;
                    return (
                      <button
                        key={value}
                        type='button'
                        role='radio'
                        aria-checked={checked}
                        tabIndex={isActive ? 0 : -1}
                        className={`feedback-rating-btn${checked ? ' is-checked' : ''}`}
                        disabled={!isActive}
                        onClick={() => selectRating(question, value)}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* FINAL_STEP_INDEX's slide — same row height/translate mechanic
              as the 5 questions above, just with different content. Only
              reachable once every question has a rating (goNext/auto-
              advance both gate on that), so there's no separate
              allAnswered check needed here. */}
          {(() => {
            const isActive = currentIndex === FINAL_STEP_INDEX;
            return (
              <div
                className='feedback-question-row feedback-final-row'
                style={{ height: ROW_HEIGHT }}
              >
                <label
                  className='visually-hidden'
                  htmlFor={`feedback-extra-thoughts-${request.id}`}
                >
                  Extra thoughts (optional)
                </label>
                <textarea
                  id={`feedback-extra-thoughts-${request.id}`}
                  className='feedback-final-textarea'
                  placeholder='Extra thoughts (optional)'
                  value={extraThoughts}
                  onChange={(e) => setExtraThoughts(e.target.value)}
                  tabIndex={isActive ? 0 : -1}
                  disabled={!isActive}
                />
              </div>
            );
          })()}
        </motion.div>
      </div>

      {/* Back is always here; once the final slide is reached Next is
          swapped for Submit feedback, so submitting sits centered right
          next to Back instead of stranded on its own below the textarea. */}
      <div className='feedback-nav-row'>
        <button type='button' className='feedback-nav-btn' onClick={goBack} disabled={!canGoBack}>
          <IconChevron className='feedback-nav-icon feedback-nav-icon--up' width={16} height={16} />
          Back
        </button>
        {currentIndex === FINAL_STEP_INDEX ? (
          <StampButton
            type='button'
            variant='primary'
            className='feedback-submit-btn'
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </StampButton>
        ) : (
          <button type='button' className='feedback-nav-btn' onClick={goNext} disabled={!canGoNext}>
            Next
            <IconChevron className='feedback-nav-icon' width={16} height={16} />
          </button>
        )}
      </div>
    </div>
  );
}
