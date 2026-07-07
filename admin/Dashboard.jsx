import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { callAdminListUsers, callApproveOrganization, callSetUserRole } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';

const ROLES = ['public', 'pendingorg', 'organization', 'admin'];

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
  const [newRole, setNewRole] = useState('public');
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

export function Dashboard() {
  const { logout } = useAuth();

  return (
    <div>
      <h1>Admin Dashboard</h1>
      <button onClick={logout}>Log out</button>
      <PendingRequests />
      <AllUsers />
    </div>
  );
}
