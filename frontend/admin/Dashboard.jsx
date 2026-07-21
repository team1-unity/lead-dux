import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import {
  callAdminListUsers,
  callAdminListOrganizations,
  callApproveOrganization,
  callSetUserRole,
  callDeleteOrganization,
  callCreateDefaultQuest,
  callCreateRecurringQuest,
  callListDiamondUsers,
  callIssueCertificate,
} from '@shared/fetch.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { EventDateFields, detectTimezone } from '@shared/EventDateFields.jsx';
import { groupBySeries, attachSeriesRatings } from '@shared/questSeries.js';
import { QuestSeriesRow } from '@shared/QuestSeriesRow.jsx';
import { PendingPhotoSubmissions } from '@shared/PendingPhotoSubmissions.jsx';

const ROLES = ['onboarding_user', 'user', 'onboarding_org', 'pending_org', 'organization', 'admin'];

// What each role means for the "is this account in good standing" glance —
// separate from the ink rack's tag semantics, chosen here because this is
// the one screen where role meaning lives.
const ROLE_TONE = {
  user: 'environment',
  pending_org: 'outdoors',
  organization: 'education',
  admin: 'community',
};

function RoleStamp({ role }) {
  const tone = ROLE_TONE[role];
  return (
    <StatusStamp tone={tone} muted={!tone}>
      {role}
    </StatusStamp>
  );
}

// Every default/neighborhood quest must pick one of these — see
// TIER_BASE_POINTS in functions/main.py, the source of truth these point
// values mirror.
const TIER_OPTIONS = [
  { value: 'iron', label: 'Iron — 10 pts' },
  { value: 'bronze', label: 'Bronze — 12 pts' },
  { value: 'silver', label: 'Silver — 15 pts' },
  { value: 'gold', label: 'Gold — 18 pts' },
  { value: 'diamond', label: 'Diamond — 20 pts' },
];

// The "admin can see once a user reaches the last rank" requirement —
// certificates are never issued automatically (see issue_certificate,
// functions/main.py), only by an admin choosing to here.
function DiamondCertifications() {
  const [users, setUsers] = useState(null);
  const [busyUid, setBusyUid] = useState(null);

  async function load() {
    setUsers(await callListDiamondUsers());
  }

  useEffect(() => {
    load();
  }, []);

  async function issue(uid) {
    setBusyUid(uid);
    try {
      await callIssueCertificate(uid);
      await load();
    } finally {
      setBusyUid(null);
    }
  }

  if (!users) return <LoadingSpinner label="Loading Diamond members..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>Diamond certifications</h2>
      {users.length === 0 ? (
        <p>No one has reached Diamond rank yet.</p>
      ) : (
        <div className="ink-card data-list">
          {users.map((u) => (
            <div key={u.uid} className="data-row">
              <div className="data-row-head">
                <p className="data-row-title">{u.name || u.email}</p>
                <span className="data-stat">{u.points} points</span>
              </div>
              <p className="data-row-sub">{u.email}</p>
              <div className="data-row-actions" style={{ alignItems: 'center', gap: 12 }}>
                {u.certificateIssued ? (
                  <StatusStamp tone="community">CERTIFICATE ISSUED</StatusStamp>
                ) : (
                  <StampButton type="button" variant="primary" onClick={() => issue(u.uid)} disabled={busyUid === u.uid}>
                    {busyUid === u.uid ? 'Issuing...' : 'Issue certificate'}
                  </StampButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PendingRequests() {
  const [requests, setRequests] = useState(null);
  const [busyUid, setBusyUid] = useState(null);

  async function load() {
    const snap = await getDocs(query(collection(db, 'ORGREQ'), where('status', '==', 'pending')));
    setRequests(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(uid) {
    setBusyUid(uid);
    try {
      await callApproveOrganization(uid);
      await load();
    } finally {
      setBusyUid(null);
    }
  }

  if (!requests) return <LoadingSpinner label="Loading requests..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>Pending organization requests</h2>
      {requests.length === 0 ? (
        <p>No pending requests.</p>
      ) : (
        <div className="ink-card data-list">
          {requests.map((r) => (
            <div key={r.uid} className="data-row">
              <div className="data-row-head">
                <p className="data-row-title">{r.name}</p>
                <span className="data-stat">{r.email}</span>
              </div>
              <p className="data-row-sub">{r.location} · {r.phone}</p>
              <p className="data-row-sub">{r.reason}</p>
              <div className="data-row-actions">
                <StampButton type="button" variant="primary" onClick={() => approve(r.uid)} disabled={busyUid === r.uid}>
                  {busyUid === r.uid ? 'Approving...' : 'Approve'}
                </StampButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AllUsers() {
  const [users, setUsers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [newRole, setNewRole] = useState('user');
  const [busy, setBusy] = useState(false);

  async function load() {
    setUsers(await callAdminListUsers());
  }

  useEffect(() => {
    load();
  }, []);

  async function selectUser(user) {
    setSelected(user);
    setNewRole(user.role);
    const collectionName = user.role === 'organization' ? 'organizations' : 'users';
    const snap = await getDoc(doc(db, collectionName, user.uid));
    setSelectedProfile(snap.exists() ? snap.data() : null);
  }

  async function assignRole() {
    setBusy(true);
    try {
      await callSetUserRole(selected.uid, newRole);
      await load();
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  if (!users) return <LoadingSpinner label="Loading users..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-heading">
        <h2 style={{ marginBottom: 0 }}>All users</h2>
        <span className="data-stat">{users.length} total</span>
      </div>
      <div className="ink-card data-list" style={{ marginTop: 12 }}>
        {users.map((u) => (
          <button
            key={u.uid}
            type="button"
            className="data-row"
            onClick={() => selectUser(u)}
          >
            <div className="data-row-head">
              <p className="data-row-title">{u.email}</p>
              <RoleStamp role={u.role} />
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="ink-card" style={{ marginTop: 16 }}>
          <h3>{selected.email}</h3>
          <p className="data-stat">uid: {selected.uid}</p>
          <p style={{ marginTop: 8 }}>
            Current role: <RoleStamp role={selected.role} />
          </p>
          {selectedProfile && <pre>{JSON.stringify(selectedProfile, null, 2)}</pre>}
          <label>
            Assign role
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <StampButton type="button" variant="primary" onClick={assignRole} disabled={busy} style={{ marginTop: 12 }}>
            {busy ? 'Saving...' : 'Save role'}
          </StampButton>
        </div>
      )}
    </section>
  );
}

function Organizations() {
  const [orgs, setOrgs] = useState(null);
  const [busyUid, setBusyUid] = useState(null);

  async function load() {
    setOrgs(await callAdminListOrganizations());
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(uid) {
    setBusyUid(uid);
    try {
      await callDeleteOrganization(uid);
      await load();
    } finally {
      setBusyUid(null);
    }
  }

  if (!orgs) return <LoadingSpinner label="Loading organizations..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>Organizations</h2>
      {orgs.length === 0 ? (
        <p>No organizations yet.</p>
      ) : (
        <div className="ink-card data-list">
          {orgs.map((o) => (
            <div key={o.uid} className="data-row">
              <div className="data-row-head">
                <p className="data-row-title">{o.name}</p>
                <span className="data-stat">{o.email}</span>
              </div>
              <p className="data-row-sub">{o.location} · {o.phone}</p>
              <div className="data-row-actions">
                <StampButton type="button" variant="danger" onClick={() => remove(o.uid)} disabled={busyUid === o.uid}>
                  {busyUid === o.uid ? 'Deleting...' : 'Delete organization'}
                </StampButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// One row per series here too (see @shared/QuestSeriesRow.jsx) — a
// recurring default quest, or a recurring quest an organization created,
// both show as a single row with a date picker and the same
// attendees/reviews/scanner/delete-series features the org dashboard has,
// rather than one flat un-grouped row per date the way this used to work.
function QuestsAdmin() {
  const [quests, setQuests] = useState(null);
  const [seriesAggregates, setSeriesAggregates] = useState(new Map());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [timezone, setTimezone] = useState(detectTimezone());
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [tier, setTier] = useState('iron');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [questsSnap, seriesSnap] = await Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(collection(db, 'questSeries')),
    ]);
    setQuests(questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setSeriesAggregates(new Map(seriesSnap.docs.map((d) => [d.id, d.data()])));
  }

  useEffect(() => {
    load();
  }, []);

  const seriesList = useMemo(
    () => (quests ? attachSeriesRatings(groupBySeries(quests), seriesAggregates) : []),
    [quests, seriesAggregates],
  );

  async function createDefault(e) {
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
        tier,
      };
      if (isRecurring) {
        await callCreateRecurringQuest({ ...base, frequency, until });
      } else {
        await callCreateDefaultQuest(base);
      }
      setTitle('');
      setDescription('');
      setTags('');
      setEventDate('');
      setEventEndTime('');
      setLocation('');
      setCapacity('');
      setTier('iron');
      setIsRecurring(false);
      setUntil('');
      await load();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!quests) return <LoadingSpinner label="Loading quests..." />;

  return (
    <section>
      <div className="ink-card" style={{ marginBottom: 16 }}>
        <h3>Add default neighborhood quest</h3>
        <form onSubmit={createDefault} className="flex flex-col gap-md">
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
            <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" />
          </label>
          <label>
            Difficulty tier
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
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
          <StampButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Adding...' : isRecurring ? 'Add recurring quest' : 'Add quest'}
          </StampButton>
        </form>
      </div>

      <div className="section-heading" style={{ marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>All quests</h2>
        <span className="data-stat">{seriesList.length} total</span>
      </div>
      <div className="ink-card data-list">
        {seriesList.map((series) => (
          <QuestSeriesRow key={series.seriesId} series={series} onChanged={load} showOwner />
        ))}
      </div>
    </section>
  );
}

export function Dashboard() {
  return (
    <PageMotion>
      <TopBar title="Admin Data" />
      <PendingRequests />
      <PendingPhotoSubmissions scopeField="isDefault" scopeValue={true} title="Pending side quest photo submissions" />
      <AllUsers />
      <Organizations />
      <DiamondCertifications />
      <QuestsAdmin />
    </PageMotion>
  );
}
