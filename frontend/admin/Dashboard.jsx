import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import {
  callAdminListUsers,
  callAdminListOrganizations,
  callApproveOrganization,
  callSetUserRole,
  callDeleteOrganization,
  callCreateDefaultQuest,
  callDeleteQuest,
} from '@shared/fetch.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';

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

function QuestsAdmin() {
  const [quests, setQuests] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const snap = await getDocs(collection(db, 'quests'));
    setQuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    load();
  }, []);

  async function createDefault(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await callCreateDefaultQuest({
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setTitle('');
      setDescription('');
      setTags('');
      await load();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id) {
    setBusyId(id);
    try {
      await callDeleteQuest(id);
      await load();
    } finally {
      setBusyId(null);
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
          {error && <p className="box-danger">{error}</p>}
          <StampButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add quest'}
          </StampButton>
        </form>
      </div>

      <div className="section-heading" style={{ marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>All quests</h2>
        <span className="data-stat">{quests.length} total</span>
      </div>
      <div className="ink-card data-list">
        {quests.map((q) => (
          <div key={q.id} className="data-row">
            <div className="data-row-head">
              <p className="data-row-title">{q.title}</p>
              <span className="data-stat">{(q.rsvpd || []).length} RSVP'd</span>
            </div>
            <p className="data-row-sub">{q.isDefault ? 'Default neighborhood quest' : q.orgName || ''}</p>
            <p className="data-row-sub">{q.description}</p>
            <div className="data-row-actions">
              <StampButton type="button" variant="danger" onClick={() => remove(q.id)} disabled={busyId === q.id}>
                {busyId === q.id ? 'Deleting...' : 'Delete'}
              </StampButton>
            </div>
          </div>
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
      <AllUsers />
      <Organizations />
      <QuestsAdmin />
    </PageMotion>
  );
}
