import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callCreateQuest,
  callCreateRecurringQuest,
  callUpdateQuest,
  callMakeQuestRecurring,
  callAddQuestSeriesCoverPhoto,
  callRemoveQuestSeriesCoverPhoto,
} from '@shared/fetch.jsx';
import { PhotoGallery } from '@shared/PhotoGallery.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { AddPropertyMenu } from '@shared/AddPropertyMenu.jsx';
import { PlaceCombobox } from '@shared/PlaceCombobox.jsx';
import { ConfirmBox } from '@shared/QuestSeriesRow.jsx';
import { ACCOMMODATION_OPTIONS } from '@shared/accommodations.js';
import { detectTimezone } from '@shared/EventDateFields.jsx';
import {
  pickLastQuest,
  buildCarryOverDefaults,
  applyLocationChange,
} from '@shared/questCarryOver.js';
import {
  parseNaturalWhen,
  resolveEndWhen,
  whenToDatetimeLocalString,
  formatWhenRange,
  tzAbbreviation,
  wallClockPartsInZone,
  fullWallClockPartsInZone,
  nextOccurrenceOfPattern,
  parseNaturalDateOnly,
  formatDateOnly,
  dateOnlyToString,
} from '@shared/naturalDate.js';
import { IconCheck } from '@shared/icons.jsx';

const DURATION_MINUTES = 120;
const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// A round-trippable natural-language seed for the When input, generated
// from a resolved when-pattern — e.g. { year, month, day: <a Saturday>,
// hour: 18, minute: 0 } becomes "sat 6pm", which parseNaturalWhen resolves
// right back to the same date. Only used to pre-fill the field; the
// organizer can freely type over it. Takes the full date (not a separate
// `weekday` field — nextOccurrenceOfPattern doesn't return one) and derives
// the weekday itself, rather than trusting a possibly-missing field.
function patternToNaturalText({ year, month, day, hour, minute }) {
  const weekday = new Date(year, month, day).getDay();
  const period = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time =
    minute === 0 ? `${h12}${period}` : `${h12}:${String(minute).padStart(2, '0')}${period}`;
  return `${WEEKDAY_ABBR[weekday]} ${time}`;
}

// Same idea as patternToNaturalText above, but for an arbitrary already-set
// date (editing an existing quest) rather than a recurring weekday pattern
// — M/D/YYYY instead of a weekday name, since there's no guarantee the org
// wants "next <weekday>" semantics for a date that's already fixed. The
// year is included explicitly (parseNaturalWhen's slash-date grammar
// accepts one) rather than relying on its "assume this year unless already
// passed" rollover — a quest being edited isn't guaranteed to be in the
// future relative to right now, so that rollover isn't a safe assumption
// to lean on here the way it is for a brand-new quest.
function dateToSlashNaturalText({ year, month, day, hour, minute }) {
  const period = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time =
    minute === 0 ? `${h12}${period}` : `${h12}:${String(minute).padStart(2, '0')}${period}`;
  return `${month + 1}/${day}/${year} ${time}`;
}

function draftKeyFor(orgUid) {
  return `createQuestDraft:${orgUid}`;
}

// Same upload constraints OrganizationProfile.jsx's logo upload already
// uses — kept as its own small copy rather than a shared import since
// there's nowhere natural yet for the two to share it from.
const COVER_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const COVER_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const COVER_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Editing skips carry-over/draft entirely — the form is seeded straight
// from the quest being edited, not the org's last quest or a leftover
// sessionStorage draft (which is create-flow-only; see the draft-save
// effect below, also skipped in edit mode).
function computeEditInitialState(quest, seriesCoverPhotos) {
  const tz = quest.timezone || detectTimezone();
  let whenText = '';
  if (quest.eventDate) {
    const eventDateObj = quest.eventDate.toDate ? quest.eventDate.toDate() : new Date(quest.eventDate);
    whenText = dateToSlashNaturalText(fullWallClockPartsInZone(eventDateObj, tz));
  }
  // Already part of a series (recurrenceFrequency set) — surface that as
  // a prefilled "Recurring" property instead of leaving it invisible, even
  // though the pattern itself isn't editable from here (see this
  // component's own module note on canMakeRecurring/isSeries). Until is
  // reformatted into the same slash text the field parses back out of
  // (parseNaturalDateOnly), not just displayed, so it round-trips exactly
  // like a freshly-typed value would.
  let frequency = 'weekly';
  let untilText = '';
  if (quest.recurrenceFrequency) {
    frequency = quest.recurrenceFrequency;
    if (quest.recurrenceUntil) {
      const untilDateObj = quest.recurrenceUntil.toDate
        ? quest.recurrenceUntil.toDate()
        : new Date(quest.recurrenceUntil);
      const { year, month, day } = fullWallClockPartsInZone(untilDateObj, tz);
      untilText = `${month + 1}/${day}/${year}`;
    }
  }
  return {
    title: quest.title || '',
    description: quest.description || '',
    whenText,
    whenCarried: false,
    location: quest.location || '',
    placeId: quest.placeId || null,
    lat: quest.lat ?? null,
    lng: quest.lng ?? null,
    locationCarried: false,
    accommodationTags: quest.accommodationTags || [],
    accommodationDetails: quest.accommodationDetails || '',
    accessCarried: false,
    timezone: tz,
    capacity: quest.capacity != null ? String(quest.capacity) : '',
    tags: (quest.tags || []).join(', '),
    coverPhotos: seriesCoverPhotos || [],
    addedProperties: {
      capacity: quest.capacity != null,
      tags: (quest.tags || []).length > 0,
      recurring: Boolean(quest.recurrenceFrequency),
      coverImage: (seriesCoverPhotos || []).length > 0,
    },
    frequency,
    untilText,
    restoredFromDraft: false,
  };
}

// Everything the form starts from: a restored in-progress draft (if this
// browser tab left one mid-edit this session), otherwise carried-over
// Where/Access/When from the org's last quest, otherwise blank/sane
// defaults. Pure aside from the sessionStorage read, so it's only ever
// called once per mount (see the lazy useState/useRef below).
function computeInitialState(quests, orgUid) {
  const raw = sessionStorage.getItem(draftKeyFor(orgUid));
  if (raw) {
    try {
      return { ...JSON.parse(raw), restoredFromDraft: true };
    } catch {
      // Corrupt/old-shape draft — fall through to fresh defaults below.
    }
  }

  const lastQuest = pickLastQuest(quests);
  const carry = buildCarryOverDefaults(lastQuest);
  // Only prefill When when there's a real pattern to carry over from a past
  // quest — with nothing to base a guess on (a brand-new org's first quest,
  // or after "Start blank"), the field starts genuinely empty rather than
  // silently assuming "next Saturday 6pm" on the organizer's behalf.
  let whenText = '';
  if (carry.whenPattern?.eventDate) {
    const rawDate = carry.whenPattern.eventDate;
    const asDate = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
    const tz = carry.whenPattern.timezone || detectTimezone();
    whenText = patternToNaturalText(nextOccurrenceOfPattern(wallClockPartsInZone(asDate, tz)));
  }

  return {
    title: '',
    description: '',
    whenText,
    whenCarried: Boolean(carry.whenPattern),
    location: carry.location,
    placeId: carry.placeId,
    lat: carry.lat,
    lng: carry.lng,
    locationCarried: carry.carriedLocation,
    accommodationTags: carry.accommodationTags,
    accommodationDetails: carry.accommodationDetails,
    accessCarried: carry.carriedAccess,
    timezone: carry.timezone || detectTimezone(),
    capacity: '',
    tags: '',
    coverPhotos: [],
    addedProperties: { capacity: false, tags: false, coverImage: false },
    frequency: 'weekly',
    untilText: '',
    restoredFromDraft: false,
  };
}

const ADD_PROPERTY_ITEMS = [
  { key: 'recurring', label: 'Recurring' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'tags', label: 'Tags' },
  { key: 'coverImage', label: 'Cover image' },
  { key: 'coHost', label: 'Co-host', disabled: true },
];

function AccessChip({ selected, onClick, children }) {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={selected}
      className='tag-stamp'
      data-selectable='true'
      data-selected={selected ? 'true' : 'false'}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// The document-style "create a quest" page — see the design spec this was
// built from: one required field (title), everything else defaulted,
// carried over from the org's last quest, or added on demand via "+ Add a
// property". Same data model/API as the old form (callCreateQuest /
// callCreateRecurringQuest) — this is a UX/UI rewrite only.
//
// `editingQuest`, when passed, switches the whole form into edit mode for
// that one existing occurrence instead of creating a new one — no carry-
// over/draft (seeded straight from the quest instead), and calls
// callUpdateQuest instead of callCreateQuest/callCreateRecurringQuest.
// Touching the When field is the one edit with a real consequence — see
// whenChanged below — so it's gated behind its own confirmation instead of
// submitting immediately. "Recurring" is still addable here (via
// callMakeQuestRecurring, same call org/Quests.jsx's own — currently
// unused-in-the-UI — useQuestSeriesActions.makeRecurring already wraps),
// turning this one occurrence into the first date of a new series, but
// only when `canMakeRecurring` says it isn't already part of one — a
// series' overall pattern (frequency/until) isn't editable here once it
// exists, same granularity delete already draws between "this date" and
// "the whole series."
export function CreateQuestForm({
  quests,
  onCreated,
  onCancel,
  editingQuest,
  canMakeRecurring = true,
  seriesCoverPhotos = [],
}) {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const initialRef = useRef(null);
  if (!initialRef.current) {
    initialRef.current = editingQuest
      ? computeEditInitialState(editingQuest, seriesCoverPhotos)
      : computeInitialState(quests, user.uid);
  }

  const [form, setForm] = useState(initialRef.current);
  const [startedBlank, setStartedBlank] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState('');
  // A brand-new quest with nothing carried over has no placeId yet, so it
  // should start in "searching" mode — but editing an existing quest
  // always has a real location to show back, even on the (older) data
  // that predates placeId being required, so this always starts showing
  // that current value instead of a blank search box. Clicking it (see
  // onFocus below) still opens the same search to replace it.
  const [editingLocation, setEditingLocation] = useState(
    editingQuest ? false : !initialRef.current.placeId,
  );
  const [placeKey, setPlaceKey] = useState(0);
  const [accessNoteOpen, setAccessNoteOpen] = useState(
    Boolean(initialRef.current.accommodationDetails),
  );
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [view, setView] = useState('form'); // 'form' | 'success'
  const [confirmingReschedule, setConfirmingReschedule] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef(false);
  const lastQuest = useMemo(() => pickLastQuest(quests), [quests]);

  function patch(partial) {
    setForm((f) => ({ ...f, ...partial }));
  }

  // "Saves as you write" — a debounced local draft (this browser tab, this
  // session only). There's no backend draft-save endpoint, so this is
  // honestly just sessionStorage, not a synced/cross-device draft — it's
  // enough to make "nothing to lose" true across an accidental reload or a
  // navigate-away-and-back, which is the actual promise being made here.
  // Create-flow only — editing an existing quest never touches this key,
  // so a half-finished edit can't bleed into (or get overwritten by) the
  // next new-quest draft.
  useEffect(() => {
    if (editingQuest) return undefined;
    const id = setTimeout(() => {
      sessionStorage.setItem(draftKeyFor(user.uid), JSON.stringify(form));
      if (!announcedRef.current) {
        announcedRef.current = true;
        setAnnouncement('Draft saved');
      }
    }, 500);
    return () => clearTimeout(id);
  }, [form, user.uid, editingQuest]);

  function clearDraft() {
    sessionStorage.removeItem(draftKeyFor(user.uid));
  }

  // Whether the organizer has touched the When field at all since the form
  // opened — string equality against the pre-filled value, not an instant-
  // level comparison. A false positive (retyping to the exact same time)
  // just means an unnecessary confirmation step, not a data problem; a
  // false negative (silently missing a real change) is the one that'd
  // actually matter, and string equality can't produce one — if whenText
  // hasn't changed at all, nothing about the date could have either.
  const whenChanged = Boolean(editingQuest) && form.whenText !== initialRef.current.whenText;

  // Prefilled from an existing series (see computeEditInitialState) rather
  // than something the organizer just added — frequency/until aren't
  // editable here for a quest already part of a series (see this
  // component's own module note), so the row shows for context only.
  const recurringIsReadOnly = Boolean(editingQuest) && !canMakeRecurring;

  const resolvedWhen = useMemo(() => parseNaturalWhen(form.whenText), [form.whenText]);
  const resolvedEnd = resolvedWhen ? resolveEndWhen(resolvedWhen, DURATION_MINUTES) : null;
  const whenHint = resolvedWhen ? formatWhenRange(resolvedWhen, resolvedEnd) : null;
  // An explicit timezone typed into the When field ("...est") takes
  // precedence over the carried-over/manually-edited timezone field — the
  // typed text is the more specific, more recent signal.
  const effectiveTimezone = resolvedWhen?.timezone || form.timezone;
  const tzAbbrev = tzAbbreviation(effectiveTimezone);
  const browserTz = detectTimezone();
  const showTzEditor =
    !resolvedWhen?.timezone && effectiveTimezone && effectiveTimezone !== browserTz;

  const resolvedUntil = useMemo(() => parseNaturalDateOnly(form.untilText), [form.untilText]);
  const untilHint = resolvedUntil ? formatDateOnly(resolvedUntil) : null;

  function startBlank() {
    setForm({
      title: '',
      description: '',
      whenText: '',
      whenCarried: false,
      location: '',
      placeId: null,
      lat: null,
      lng: null,
      locationCarried: false,
      accommodationTags: [],
      accommodationDetails: '',
      accessCarried: false,
      timezone: browserTz,
      capacity: '',
      tags: '',
      coverPhotos: [],
      addedProperties: { capacity: false, tags: false, coverImage: false },
      frequency: 'weekly',
      untilText: '',
      restoredFromDraft: false,
    });
    setStartedBlank(true);
    setEditingLocation(true);
    setAccessNoteOpen(false);
    setPlaceKey((k) => k + 1);
    clearDraft();
  }

  function onLocationSelected(selection) {
    setForm((f) => applyLocationChange(f, selection));
    setEditingLocation(false);
    setErrors((e) => ({ ...e, location: undefined }));
  }

  function toggleAccommodationTag(value) {
    setForm((f) => ({
      ...f,
      accommodationTags: f.accommodationTags.includes(value)
        ? f.accommodationTags.filter((v) => v !== value)
        : [...f.accommodationTags, value],
      accessCarried: false,
    }));
    setErrors((e) => ({ ...e, access: undefined }));
  }

  function addProperty(key) {
    patch({ addedProperties: { ...form.addedProperties, [key]: true } });
  }

  // Un-adding a property clears its own value(s) back to blank/default too —
  // not just the addedProperties flag — so if it's added again later it
  // starts fresh rather than showing whatever was typed before removal.
  // When/Where/Access are permanent fixtures of the form and never reach
  // this path (they have no remove control).
  function removeProperty(key) {
    setForm((f) => {
      const next = { ...f, addedProperties: { ...f.addedProperties, [key]: false } };
      if (key === 'capacity') next.capacity = '';
      if (key === 'tags') next.tags = '';
      if (key === 'coverImage') next.coverPhotos = [];
      if (key === 'recurring') {
        next.frequency = 'weekly';
        next.untilText = '';
      }
      return next;
    });
    setErrors((e) => ({ ...e, [key === 'recurring' ? 'until' : key]: undefined }));
  }

  // Appends to the series' cover-photo set — there's no cap on how many an
  // org can add (see add_quest_series_cover_photo), so unlike the old
  // single-cover-photo version this never replaces what's already there.
  async function uploadCoverPhoto(file) {
    setCoverError('');
    if (!COVER_CONTENT_TYPES.includes(file.type)) {
      setCoverError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
      return;
    }
    if (file.size > COVER_MAX_SIZE_BYTES) {
      setCoverError('Photo must be smaller than 10MB.');
      return;
    }
    setUploadingCover(true);
    try {
      const ext = COVER_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
      const path = `questCovers/${user.uid}/${Date.now()}.${ext}`;
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
      const url = await getDownloadURL(storageRef(storage, path));
      setForm((f) => ({ ...f, coverPhotos: [...f.coverPhotos, url] }));
    } catch (err) {
      setCoverError(err.message || 'Something went wrong uploading that photo.');
    } finally {
      setUploadingCover(false);
    }
  }

  // Removed locally only — nothing's sent to remove_quest_series_cover_photo
  // until Publish/Save actually diffs form.coverPhotos against
  // seriesCoverPhotos (see handleSubmit), same as every other field here.
  function removeCoverPhoto(url) {
    setForm((f) => ({ ...f, coverPhotos: f.coverPhotos.filter((u) => u !== url) }));
  }

  function validate() {
    const next = {};
    if (!form.title.trim()) next.title = 'Give this quest a title.';
    if (!resolvedWhen)
      next.when = 'Try something like "sat 6pm", "aug 2 6-9pm est", or "12/25 2pm".';
    if (!form.placeId) next.location = 'Select a location from the suggestions.';
    if (form.accommodationTags.length === 0)
      next.access = 'Select at least one accessibility accommodation.';
    if (form.addedProperties.recurring && !recurringIsReadOnly && !resolvedUntil)
      next.until = 'Try something like "aug 30" or "12/31".';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    // The one edit with a real consequence (clears this quest's RSVPs,
    // notifies whoever was on it — see update_quest's own module note)
    // gets its own confirmation step rather than submitting immediately.
    if (editingQuest && whenChanged && !confirmingReschedule) {
      setConfirmingReschedule(true);
      return;
    }

    const start = whenToDatetimeLocalString(resolvedWhen);
    const end = whenToDatetimeLocalString(resolvedEnd);
    const base = {
      title: form.title.trim(),
      description: form.description.trim(),
      tags: form.addedProperties.tags
        ? form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      eventDate: start,
      eventEndTime: end,
      timezone: effectiveTimezone,
      location: form.location,
      placeId: form.placeId,
      lat: form.lat,
      lng: form.lng,
      capacity: form.addedProperties.capacity && form.capacity ? Number(form.capacity) : null,
      accommodationTags: form.accommodationTags,
      accommodationDetails: form.accommodationDetails.trim() || null,
    };

    // Whatever the cover-image property currently resolves to — every URL
    // uploaded this session plus whatever was already there, or none at all
    // if the whole property was removed — diffed below against what the
    // series already had, so photos nobody touched don't get a pointless
    // add/remove call each.
    const nextCoverPhotos = form.addedProperties.coverImage ? form.coverPhotos : [];
    const addedCoverPhotos = nextCoverPhotos.filter((url) => !seriesCoverPhotos.includes(url));
    const removedCoverPhotos = seriesCoverPhotos.filter((url) => !nextCoverPhotos.includes(url));

    async function syncCoverPhotos(seriesId) {
      for (const url of addedCoverPhotos) {
        await callAddQuestSeriesCoverPhoto({ seriesId, coverPhotoUrl: url });
      }
      for (const url of removedCoverPhotos) {
        await callRemoveQuestSeriesCoverPhoto({ seriesId, coverPhotoUrl: url });
      }
    }

    if (editingQuest) {
      // Not optimistic, unlike create below — an edit can fail for reasons
      // specific to the quest's current state (e.g. capacity below the
      // existing RSVP count), so this waits for the real result rather
      // than assuming success and rolling back.
      setSubmitting(true);
      setSubmitError('');
      try {
        await callUpdateQuest({ ...base, questId: editingQuest.id });
        // Update first, expand into a series second — make_quest_recurring
        // copies this quest's *current* fields onto every new occurrence
        // it generates, so anything just changed above (title, location,
        // ...) needs to already be saved before this runs, not after.
        // Guarded on canMakeRecurring, not just addedProperties.recurring —
        // the latter is also true when this quest was ALREADY part of a
        // series (see computeEditInitialState's prefill), and calling
        // make_quest_recurring again on an existing series isn't a thing
        // this form does.
        if (form.addedProperties.recurring && canMakeRecurring) {
          await callMakeQuestRecurring({
            questId: editingQuest.id,
            frequency: form.frequency,
            until: dateOnlyToString(resolvedUntil),
          });
        }
        // Cover photos live on the series (questSeries/{seriesId}), not
        // this one occurrence's own doc — see add_quest_series_cover_photo
        // — so they're synced via their own calls rather than through
        // `base` above.
        await syncCoverPhotos(editingQuest.seriesId || editingQuest.id);
        onCreated();
      } catch (err) {
        setSubmitError(err.message || 'Something went wrong.');
        setConfirmingReschedule(false);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Optimistic: publish reads as instant (crossfade straight to the
    // success screen) while the actual call happens in the background. A
    // failure rolls back to the form with an inline error rather than
    // leaving the organizer looking at a success screen for a quest that
    // doesn't exist.
    setSubmitting(true);
    setSubmitError('');
    setView('success');
    try {
      let created;
      if (form.addedProperties.recurring) {
        created = await callCreateRecurringQuest({
          ...base,
          frequency: form.frequency,
          until: dateOnlyToString(resolvedUntil),
        });
      } else {
        created = await callCreateQuest(base);
      }
      // A one-off quest's seriesId is just its own questId (see
      // functions/main.py's create_quest); create_recurring_quest returns
      // the real shared seriesId directly.
      await syncCoverPhotos(created.seriesId || created.questId);
      clearDraft();
    } catch (err) {
      setView('form');
      setSubmitError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  function onFormKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  if (view === 'success' && !editingQuest) {
    return (
      <AnimatePresence mode='wait'>
        <motion.div
          key='success'
          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          className='quest-form-success'
        >
          <IconCheck className='quest-form-success-icon' />
          <h2>Quest published!</h2>
          <p>&ldquo;{form.title.trim()}&rdquo; is live.</p>
          <div className='flex flex-col gap-sm' style={{ alignItems: 'flex-start' }}>
            <button
              type='button'
              className='quest-form-ghost-btn'
              disabled
              title="Editing an existing quest isn't available yet"
            >
              + Add tags
            </button>
            <button
              type='button'
              className='quest-form-ghost-btn'
              disabled
              title="Editing an existing quest isn't available yet"
            >
              + Add cover image
            </button>
          </div>
          <StampButton
            type='button'
            variant='primary'
            style={{ marginTop: 16 }}
            onClick={() => onCreated()}
          >
            Done
          </StampButton>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <form className='create-quest-doc' onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
      <div className='visually-hidden' aria-live='polite'>
        {announcement}
      </div>

      {lastQuest && !startedBlank && !editingQuest && (
        <div className='quest-form-carryover-banner'>
          {/* <span className='quest-form-sage-dot' aria-hidden='true' /> */}
          {/* <span>Filled in from your last quest</span> */}
          <button type='button' className='quest-form-ghost-btn' onClick={startBlank}>
            Start blank
          </button>
        </div>
      )}

      {/* Everything between the (pinned) carry-over banner above and the
          (pinned) footer below scrolls internally once it outgrows the
          form's set height — adding properties makes you scroll to see
          them, it doesn't keep growing the page. */}
      <div className='quest-form-scroll'>
        <label className='visually-hidden' htmlFor='quest-title'>
          Title
        </label>
        <input
          id='quest-title'
          className='quest-form-title-input'
          placeholder='Untitled quest'
          autoFocus
          value={form.title}
          onChange={(e) => {
            patch({ title: e.target.value });
            setErrors((er) => ({ ...er, title: undefined }));
          }}
        />
        {errors.title && <p className='quest-form-error'>{errors.title}</p>}

        <div className='quest-form-properties'>
          <div className='quest-form-row'>
            <label className='quest-form-row-label' htmlFor='quest-when'>
              When
            </label>
            <div className='quest-form-row-value'>
              <input
                id='quest-when'
                type='text'
                className={form.whenCarried ? 'quest-form-carried' : undefined}
                value={form.whenText}
                aria-describedby={form.whenCarried ? 'quest-when-carried-hint' : undefined}
                onChange={(e) => patch({ whenText: e.target.value, whenCarried: false })}
                placeholder='e.g. sat 6pm, aug 2 6-9pm est, 12/25 2pm'
              />
              {form.whenCarried && (
                <span id='quest-when-carried-hint' className='visually-hidden'>
                  carried over from your last quest
                </span>
              )}
              <AnimatePresence mode='wait'>
                {whenHint ? (
                  <motion.p
                    key={whenHint}
                    className='quest-form-hint'
                    aria-live='polite'
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.15 }}
                  >
                    {whenHint}{' '}
                    <span className='field-optional'>
                      {showTzEditor ? (
                        <input
                          type='text'
                          aria-label='Timezone'
                          value={form.timezone}
                          onChange={(e) => patch({ timezone: e.target.value })}
                          className='quest-form-tz-input'
                        />
                      ) : (
                        // Either it matches the browser's own zone (nothing worth
                        // surfacing as editable), or it came from an explicit
                        // abbreviation typed right into the When text ("...est") —
                        // editing that means editing the text itself, not this.
                        tzAbbrev
                      )}
                    </span>
                  </motion.p>
                ) : (
                  form.whenText && (
                    <motion.p
                      key='invalid'
                      className='quest-form-hint field-optional'
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      Not recognized yet — try "sat 6pm", "aug 2 6-9pm est", or "12/25 2pm".
                    </motion.p>
                  )
                )}
              </AnimatePresence>
              {errors.when && <p className='quest-form-error'>{errors.when}</p>}
              {whenChanged && !confirmingReschedule && (
                <p className='quest-form-error'>
                  Changing this clears everyone's RSVP and notifies them — you'll be asked to
                  confirm before saving.
                </p>
              )}
              {confirmingReschedule && (
                <ConfirmBox
                  message="This clears every current RSVP for this date and notifies each of those attendees that it changed — they'll need to RSVP again if they still want to attend. This can't be undone."
                  confirmLabel={submitting ? 'Saving...' : 'Yes, reschedule'}
                  submitting={submitting}
                  onConfirm={handleSubmit}
                  onCancel={() => setConfirmingReschedule(false)}
                />
              )}
            </div>
          </div>

          <div className='quest-form-row'>
            <label className='quest-form-row-label' htmlFor='quest-where'>
              Where
            </label>
            <div className='quest-form-row-value'>
              {editingLocation ? (
                <PlaceCombobox
                  key={placeKey}
                  id='quest-where'
                  ariaLabel='Quest location'
                  placeholder='Search for an address or venue...'
                  onSelect={onLocationSelected}
                />
              ) : (
                <input
                  id='quest-where'
                  type='text'
                  readOnly
                  className={form.locationCarried ? 'quest-form-carried' : undefined}
                  value={form.location}
                  aria-describedby={form.locationCarried ? 'quest-where-carried-hint' : undefined}
                  onFocus={() => setEditingLocation(true)}
                  placeholder='Empty'
                />
              )}
              {form.locationCarried && (
                <span id='quest-where-carried-hint' className='visually-hidden'>
                  carried over from your last quest
                </span>
              )}
              {errors.location && <p className='quest-form-error'>{errors.location}</p>}
            </div>
          </div>

          <div className='quest-form-row'>
            <span className='quest-form-row-label' id='quest-access-label'>
              Access
            </span>
            <div className='quest-form-row-value'>
              <div
                role='group'
                aria-labelledby='quest-access-label'
                aria-describedby={form.accessCarried ? 'quest-access-carried-hint' : undefined}
                className='flex flex-wrap gap-sm items-center'
              >
                {ACCOMMODATION_OPTIONS.map((option) => (
                  <AccessChip
                    key={option.value}
                    selected={form.accommodationTags.includes(option.value)}
                    onClick={() => toggleAccommodationTag(option.value)}
                  >
                    {option.label}
                  </AccessChip>
                ))}
                <button
                  type='button'
                  className='quest-form-ghost-btn'
                  aria-expanded={accessNoteOpen}
                  onClick={() => setAccessNoteOpen((v) => !v)}
                >
                  Add info
                </button>
              </div>
              {form.accessCarried && (
                <span id='quest-access-carried-hint' className='visually-hidden'>
                  carried over from your last quest
                </span>
              )}
              {errors.access && <p className='quest-form-error'>{errors.access}</p>}
              {accessNoteOpen && (
                <motion.div
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                >
                  <label className='visually-hidden' htmlFor='quest-access-note'>
                    Additional accessibility details
                  </label>
                  <textarea
                    id='quest-access-note'
                    className='quest-form-description-input quest-form-access-note'
                    placeholder='Empty'
                    value={form.accommodationDetails}
                    onChange={(e) =>
                      patch({ accommodationDetails: e.target.value, accessCarried: false })
                    }
                  />
                </motion.div>
              )}
            </div>
          </div>

          {form.addedProperties.recurring && (
            <motion.div
              className='quest-form-row'
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            >
              <div className='quest-form-row-label'>
                {/* Already part of an existing series (prefilled from
                    computeEditInitialState, not user-added) — nothing to
                    remove here, since this form can't cancel a series'
                    recurrence, only turn a standalone quest into one. */}
                {recurringIsReadOnly ? (
                  <span>Recurring</span>
                ) : (
                  <button
                    type='button'
                    className='quest-form-label-remove'
                    aria-label='Remove Recurring property'
                    onClick={() => removeProperty('recurring')}
                  >
                    Recurring
                  </button>
                )}
              </div>
              <div className='quest-form-row-value flex flex-col gap-sm'>
                <label>
                  Frequency
                  <select
                    value={form.frequency}
                    onChange={(e) => patch({ frequency: e.target.value })}
                    disabled={recurringIsReadOnly}
                  >
                    <option value='daily'>Daily</option>
                    <option value='weekly'>Weekly</option>
                    <option value='monthly'>Monthly</option>
                  </select>
                </label>
                <div>
                  <label htmlFor='quest-until'>
                    Until
                    <input
                      id='quest-until'
                      type='text'
                      value={form.untilText}
                      onChange={(e) => patch({ untilText: e.target.value })}
                      placeholder='e.g. aug 30, 12/31'
                      disabled={recurringIsReadOnly}
                    />
                  </label>
                  <AnimatePresence mode='wait'>
                    {untilHint ? (
                      <motion.p
                        key={untilHint}
                        className='quest-form-hint'
                        aria-live='polite'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.15 }}
                      >
                        {untilHint}
                      </motion.p>
                    ) : (
                      form.untilText && (
                        <motion.p
                          key='invalid'
                          className='quest-form-hint field-optional'
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          Not recognized yet — try "aug 30" or "12/31".
                        </motion.p>
                      )
                    )}
                  </AnimatePresence>
                  {errors.until && <p className='quest-form-error'>{errors.until}</p>}
                </div>
              </div>
            </motion.div>
          )}

          {form.addedProperties.capacity && (
            <motion.div
              className='quest-form-row'
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            >
              <div className='quest-form-row-label'>
                <button
                  type='button'
                  className='quest-form-label-remove'
                  aria-label='Remove Capacity property'
                  onClick={() => removeProperty('capacity')}
                >
                  Capacity
                </button>
              </div>
              <div className='quest-form-row-value'>
                <label className='visually-hidden' htmlFor='quest-capacity'>
                  Capacity
                </label>
                <input
                  id='quest-capacity'
                  type='number'
                  min='1'
                  placeholder='Unlimited'
                  value={form.capacity}
                  onChange={(e) => patch({ capacity: e.target.value })}
                />
              </div>
            </motion.div>
          )}

          {form.addedProperties.tags && (
            <motion.div
              className='quest-form-row'
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            >
              <div className='quest-form-row-label'>
                <button
                  type='button'
                  className='quest-form-label-remove'
                  aria-label='Remove Tags property'
                  onClick={() => removeProperty('tags')}
                >
                  Tags
                </button>
              </div>
              <div className='quest-form-row-value'>
                <label className='visually-hidden' htmlFor='quest-tags'>
                  Tags
                </label>
                <input
                  id='quest-tags'
                  type='text'
                  placeholder='Empty'
                  value={form.tags}
                  onChange={(e) => patch({ tags: e.target.value })}
                />
              </div>
            </motion.div>
          )}

          {form.addedProperties.coverImage && (
            <motion.div
              className='quest-form-row'
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            >
              <div className='quest-form-row-label'>
                <button
                  type='button'
                  className='quest-form-label-remove'
                  aria-label='Remove Cover image property'
                  onClick={() => removeProperty('coverImage')}
                >
                  Cover image
                </button>
              </div>
              <div className='quest-form-row-value'>
                {form.coverPhotos.length > 0 && (
                  <PhotoGallery photos={form.coverPhotos} onDelete={(i) => removeCoverPhoto(form.coverPhotos[i])} />
                )}
                <label className='quest-form-ghost-btn stamp-btn' style={{ display: 'inline-block', width: 'fit-content' }}>
                  {uploadingCover ? 'Uploading...' : '+ Add a photo'}
                  <input
                    type='file'
                    accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
                    disabled={uploadingCover}
                    className='visually-hidden'
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadCoverPhoto(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {/* Shown here, not per-occurrence — a series-wide gallery
                    (see add_quest_series_cover_photo's own note), same as
                    title/tags/description already effectively are. */}
                {(recurringIsReadOnly || form.addedProperties.recurring) && (
                  <p className='field-optional'>Applies to every date in this series.</p>
                )}
                {coverError && <p className='box-danger'>{coverError}</p>}
              </div>
            </motion.div>
          )}

          <AddPropertyMenu
            items={ADD_PROPERTY_ITEMS.filter(
              (it) =>
                (!form.addedProperties[it.key] || it.disabled) &&
                !(it.key === 'recurring' && editingQuest && !canMakeRecurring),
            )}
            onSelect={addProperty}
          />
        </div>

        <hr className='quest-form-divider' />

        <label className='visually-hidden' htmlFor='quest-description'>
          Description
        </label>
        {/* Auto-grows with a CSS grid trick, not JS scrollHeight measuring:
            the wrapper is a 1-cell grid; the textarea and an invisible
            ::after (styled identically, see style.css) both occupy that
            cell, and `data-replicated-value` mirrors the textarea's value
            into the ::after's `content` so the cell (and the textarea with
            it) grows to fit. React re-renders that attribute on every
            keystroke, so it stays correct with no extra effect needed —
            including on first render from a restored/carried-over value. */}
        <div className='quest-form-description-wrap' data-replicated-value={form.description}>
          <textarea
            id='quest-description'
            className='quest-form-description-input'
            placeholder="Tell people what this quest is. Who's it for, what will you do, what should they bring?"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </div>
      </div>

      {submitError && <p className='box-danger'>{submitError}</p>}

      <div className='quest-form-footer'>
        <StampButton type='submit' variant='primary' disabled={submitting || confirmingReschedule}>
          {editingQuest ? (submitting ? 'Saving...' : 'Save changes') : 'Publish quest'}
        </StampButton>
        {/* <span className='field-optional'>Saves as you write · nothing to lose</span> */}
        <button
          type='button'
          className='quest-form-ghost-btn'
          style={{ marginLeft: 'auto' }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
