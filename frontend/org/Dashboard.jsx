import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callCreateQuest,
  callCreateRecurringQuest,
  callUpdateOrganizationTags,
} from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings } from '@shared/questSeries.js';
import { QuestSeriesRow } from '@shared/QuestSeriesRow.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { EventDateFields, detectTimezone } from '@shared/EventDateFields.jsx';
import { hashTone } from '@shared/tagTones.js';
import { IconPlus } from '@shared/icons.jsx';

// Lets an organization set the location areas and activity/event types it
// operates in — separate from a single quest's own tags, these describe
// the org itself (for future browse/filter-by-org features).
function OrgTags({ org, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [ltagInput, setLtagInput] = useState((org.ltag || []).join(', '));
  const [etagInput, setEtagInput] = useState((org.etag || []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const ltag = ltagInput.split(',').map((t) => t.trim()).filter(Boolean);
      const etag = etagInput.split(',').map((t) => t.trim()).filter(Boolean);
      await callUpdateOrganizationTags({ ltag, etag });
      onSaved({ ltag, etag });
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    const ltag = org.ltag || [];
    const etag = org.etag || [];
    return (
      <div className="ink-card">
        <div className="section-heading">
          <h3 style={{ margin: 0 }}>Locations &amp; Activities</h3>
          <StampButton type="button" onClick={() => setEditing(true)} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
            Edit
          </StampButton>
        </div>
        {ltag.length === 0 && etag.length === 0 ? (
          <p className="data-stat" style={{ margin: '10px 0 0' }}>Not set yet.</p>
        ) : (
          <div className="quest-tags" style={{ marginTop: 10 }}>
            {ltag.map((t) => <TagStamp key={`l-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
            {etag.map((t) => <TagStamp key={`e-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ink-card">
      <h3 style={{ marginTop: 0 }}>Locations &amp; Activities</h3>
      <form onSubmit={save} className="flex flex-col gap-md">
        <label>
          Location areas (comma separated)
          <input value={ltagInput} onChange={(e) => setLtagInput(e.target.value)} placeholder="Downtown, Riverside" />
        </label>
        <label>
          Activity types (comma separated)
          <input value={etagInput} onChange={(e) => setEtagInput(e.target.value)} placeholder="Cleanup, Workshop" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <div className="flex gap-sm">
          <StampButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </StampButton>
          <StampButton type="button" onClick={() => setEditing(false)} disabled={submitting}>
            Cancel
          </StampButton>
        </div>
      </form>
    </div>
  );
}

// A lightweight second query rather than lifting OrgQuests' own state up —
// the org's quest count is small enough that a second read is cheap, and
// it keeps the sidebar and the main list decoupled from each other.
function OrgStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))).then((snap) => {
      const quests = snap.docs.map((d) => d.data());
      const totalRsvps = quests.reduce((sum, q) => sum + (q.rsvpd || []).length, 0);
      setStats({ questCount: quests.length, totalRsvps });
    });
  }, [user]);

  if (!stats) return null;

  return (
    <div className="stat-hero-row" style={{ marginBottom: 0 }}>
      <div className="stat-hero-tile" style={{ background: 'var(--brand-green)' }}>
        <span className="stat-hero-number">{stats.questCount}</span>
        <span className="stat-hero-label">Quests posted</span>
      </div>
      <div className="stat-hero-tile" style={{ background: 'var(--brand-blue)' }}>
        <span className="stat-hero-number">{stats.totalRsvps}</span>
        <span className="stat-hero-label">Total RSVPs</span>
      </div>
    </div>
  );
}

function OrgQuests() {
  const { user } = useAuth();
  const [quests, setQuests] = useState(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [timezone, setTimezone] = useState(detectTimezone());
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [seriesAggregates, setSeriesAggregates] = useState(new Map());

  async function load() {
    const [questsSnap, seriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))),
      getDocs(collection(db, 'questSeries')),
    ]);
    setQuests(questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setSeriesAggregates(new Map(seriesSnap.docs.map((d) => [d.id, d.data()])));
  }

  useEffect(() => {
    load();
  }, [user]);

  const seriesList = useMemo(
    () => (quests ? attachSeriesRatings(groupBySeries(quests), seriesAggregates) : []),
    [quests, seriesAggregates],
  );

  const visibleSeries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter((s) => s.primary.title.toLowerCase().includes(q));
  }, [seriesList, search]);

  async function createQuest(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const base = {
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        eventDate,
        eventEndTime: eventEndTime || null,
        timezone,
        location,
        capacity: capacity ? Number(capacity) : null,
      };
      if (isRecurring) {
        await callCreateRecurringQuest({ ...base, frequency, until });
      } else {
        await callCreateQuest(base);
      }
      setTitle('');
      setDescription('');
      setTags('');
      setEventDate('');
      setEventEndTime('');
      setLocation('');
      setCapacity('');
      setIsRecurring(false);
      setUntil('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!quests) return <LoadingSpinner label="Loading your quests..." />;

  return (
    <>
      {!creating ? (
        <button type="button" className="quest-create-toggle" onClick={() => setCreating(true)}>
          <IconPlus /> Create a quest
        </button>
      ) : (
        <AnimatePresence>
          <motion.section
            className="ink-card"
            style={{ marginBottom: 16, overflow: 'hidden' }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <h2>Create a quest</h2>
            <form onSubmit={createQuest} className="flex flex-col gap-md">
              <label>
                Title
                <input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Description
                <textarea required value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label>
                Tags (comma separated)
                <input value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
              <label>
                Location
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="123 Main St or venue name" />
              </label>
              <label>
                Capacity (optional)
                <input
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="Unlimited"
                />
              </label>
              <EventDateFields
                eventDate={eventDate}
                eventEndTime={eventEndTime}
                timezone={timezone}
                onEventDateChange={setEventDate}
                onEventEndTimeChange={setEventEndTime}
                onTimezoneChange={setTimezone}
              />
              <label className="flex items-center gap-sm">
                <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                Recurring event
              </label>
              {isRecurring && (
                <>
                  <label>
                    Repeats
                    <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <label>
                    Until
                    <input type="date" required value={until} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                </>
              )}
              {error && <p className="box-danger">{error}</p>}
              <div className="flex gap-sm">
                <StampButton type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Creating...' : isRecurring ? 'Create recurring quest' : 'Create quest'}
                </StampButton>
                <StampButton type="button" onClick={() => setCreating(false)} disabled={submitting}>
                  Cancel
                </StampButton>
              </div>
            </form>
          </motion.section>
        </AnimatePresence>
      )}

      <div className="section-heading" style={{ marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>Your quests</h2>
        <span className="data-stat">{seriesList.length} total</span>
      </div>

      {seriesList.length > 0 && (
        <input
          type="search"
          placeholder="Search your quests..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12, width: '100%' }}
          aria-label="Search your quests"
        />
      )}

      {seriesList.length === 0 ? (
        <p>You haven't created any quests yet.</p>
      ) : visibleSeries.length === 0 ? (
        <p>No quests match "{search}".</p>
      ) : (
        <div className="ink-card data-list">
          {visibleSeries.map((series) => (
            <QuestSeriesRow key={series.seriesId} series={series} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (snap.exists()) setOrg(snap.data());
    });
  }, [user]);

  return (
    <PageMotion>
      <TopBar title={org ? org.name : 'Organization'} hero />
      <div className="dash-grid">
        <aside className="dash-sidebar">
          <OrgStats />
          {org && (
            <>
              <div className="ink-card">
                <h3 style={{ marginTop: 0 }}>About</h3>
                <p style={{ margin: 0 }}>{org.reason}</p>
                <p className="data-stat" style={{ marginTop: 10 }}>{org.location}</p>
                <p className="data-stat">{org.phone}</p>
              </div>
              <OrgTags org={org} onSaved={(tags) => setOrg((prev) => ({ ...prev, ...tags }))} />
            </>
          )}
        </aside>
        <main className="dash-main">
          <OrgQuests />
        </main>
      </div>
    </PageMotion>
  );
}
