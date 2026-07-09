import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
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
import { useAuth } from '@shared/AuthContext.jsx';

const ROLES = ['onboarding_user', 'user', 'onboarding_org', 'pending_org', 'organization', 'admin'];

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

  if (!requests) return <p>Loading requests...</p>;

  return (
    <section className="box">
      <h2>Pending organization requests</h2>
      {requests.length === 0 && <p>No pending requests.</p>}
      <ul>
        {requests.map((r) => (
          <li key={r.uid} className="box-secondary">
            <strong>{r.name}</strong> ({r.email})
            <p>{r.location} · {r.phone}</p>
            <p>{r.reason}</p>
            <button onClick={() => approve(r.uid)} disabled={busyUid === r.uid}>
              {busyUid === r.uid ? 'Approving...' : 'Approve'}
            </button>
          </li>
        ))}
      </ul>
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

  if (!users) return <p>Loading users...</p>;

  return (
    <section className="box">
      <h2>All users</h2>
      <ul>
        {users.map((u) => (
          <li key={u.uid}>
            <button onClick={() => selectUser(u)}>{u.email} — {u.role}</button>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="box-secondary">
          <h3>{selected.email}</h3>
          <p>uid: {selected.uid}</p>
          <p>Current role: {selected.role}</p>
          {selectedProfile && <pre>{JSON.stringify(selectedProfile, null, 2)}</pre>}
          <label>
            Assign role
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button onClick={assignRole} disabled={busy}>
            {busy ? 'Saving...' : 'Save role'}
          </button>
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

  if (!orgs) return <p>Loading organizations...</p>;

  return (
    <section className="box">
      <h2>Organizations</h2>
      {orgs.length === 0 && <p>No organizations yet.</p>}
      <ul>
        {orgs.map((o) => (
          <li key={o.uid} className="box-secondary">
            <strong>{o.name}</strong> ({o.email})
            <p>{o.location} · {o.phone}</p>
            <button onClick={() => remove(o.uid)} disabled={busyUid === o.uid}>
              {busyUid === o.uid ? 'Deleting...' : 'Delete organization'}
            </button>
          </li>
        ))}
      </ul>
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

  if (!quests) return <p>Loading quests...</p>;

  return (
    <section className="box">
      <h2>All quests</h2>
      <form onSubmit={createDefault} className="flex flex-col gap-md">
        <h3>Add default neighborhood quest</h3>
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
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add quest'}
        </button>
      </form>

      <ul>
        {quests.map((q) => (
          <li key={q.id} className="box-secondary">
            <strong>{q.title}</strong>{' '}
            {q.isDefault ? '(default neighborhood quest)' : q.orgName ? `— ${q.orgName}` : ''}
            <p>{q.description}</p>
            <p>{(q.rsvpd || []).length} RSVP'd</p>
            <button onClick={() => remove(q.id)} disabled={busyId === q.id}>
              {busyId === q.id ? 'Deleting...' : 'Delete'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dashboard() {
  const { logout } = useAuth();

  return (
    <div>
      <h1>Admin Dashboard</h1>
      <nav className="flex justify-between">
        <Link to="/">View quests</Link>
        <button onClick={logout}>Log out</button>
      </nav>
      <PendingRequests />
      <AllUsers />
      <Organizations />
      <QuestsAdmin />
    </div>
  );
}
