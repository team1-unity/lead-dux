import { useState } from 'react';
import {
  callMakeQuestRecurring,
  callDeleteQuest,
  callDeleteQuestSeries,
  callListQuestAttendees,
  callListQuestReviews,
} from './fetch.jsx';

// All the state/handlers a quest series row needs (attendees, reviews,
// QR scanning, recurring, delete) — factored out of QuestSeriesRow so two
// different presentations (the dense single-row used by the admin
// dashboard, and the org dashboard's list-row/detail-pane split) can share
// one implementation instead of drifting apart. Every action here targets
// whichever occurrence is currently selected, since those are inherently
// per-date (see functions/main.py — nothing about the underlying data
// model changed, only how many dates are visually surfaced at once).
export function useQuestSeriesActions(series, onChanged) {
  const { occurrences } = series;
  const [selectedId, setSelectedId] = useState(occurrences[0].id);
  const selected = occurrences.find((o) => o.id === selectedId) || occurrences[0];
  const isSeries = occurrences.length > 1;

  const [busy, setBusy] = useState(false);
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [attendees, setAttendees] = useState(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurFrequency, setRecurFrequency] = useState('weekly');
  const [recurUntil, setRecurUntil] = useState('');
  const [recurSubmitting, setRecurSubmitting] = useState(false);
  const [recurError, setRecurError] = useState('');
  const [deleteAction, setDeleteAction] = useState(null); // null | 'one' | 'keep' | 'all'
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  function switchDate(id) {
    setSelectedId(id);
    setAttendeesOpen(false);
    setReviewsOpen(false);
    setScanning(false);
    setDeleteAction(null);
  }

  async function toggleAttendees() {
    if (attendeesOpen) {
      setAttendeesOpen(false);
      return;
    }
    setBusy(true);
    try {
      setAttendees(await callListQuestAttendees(selected.id));
      setAttendeesOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReviews() {
    if (reviewsOpen) {
      setReviewsOpen(false);
      return;
    }
    setBusy(true);
    try {
      setReviews(await callListQuestReviews(selected.id));
      setReviewsOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleScanResult() {
    if (attendeesOpen) setAttendees(await callListQuestAttendees(selected.id));
  }

  async function makeRecurring(e) {
    e.preventDefault();
    setRecurError('');
    setRecurSubmitting(true);
    try {
      await callMakeQuestRecurring({ questId: selected.id, frequency: recurFrequency, until: recurUntil });
      setRecurUntil('');
      setRecurring(false);
      await onChanged();
    } catch (err) {
      setRecurError(err.message || 'Something went wrong.');
    } finally {
      setRecurSubmitting(false);
    }
  }

  async function deleteThisDate() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuest(selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function keepOnlyThisDate() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuestSeries(selected.id, selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function deleteAllInSeries() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuestSeries(selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return {
    selected,
    selectedId,
    isSeries,
    switchDate,
    busy,
    attendeesOpen,
    attendees,
    toggleAttendees,
    reviewsOpen,
    reviews,
    toggleReviews,
    scanning,
    setScanning,
    handleScanResult,
    recurring,
    setRecurring,
    recurFrequency,
    setRecurFrequency,
    recurUntil,
    setRecurUntil,
    recurSubmitting,
    recurError,
    makeRecurring,
    deleteAction,
    setDeleteAction,
    deleteSubmitting,
    deleteThisDate,
    keepOnlyThisDate,
    deleteAllInSeries,
  };
}
