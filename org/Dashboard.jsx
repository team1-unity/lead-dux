import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callCreateQuest, callDeleteQuest, callListQuestAttendees } from '@shared/fetch.jsx';

function OrgQuests() {
  const { user } = useAuth();
  const [quests, setQuests] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [attendeesFor, setAttendeesFor] = useState(null);
  const [attendees, setAttendees] = useState(null);

  async function load() {
    const snap = await getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid)));
    setQuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    load();
  }, [user]);

  async function createQuest(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await callCreateQuest({
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

  async function removeQuest(id) {
    setBusyId(id);
    try {
      await callDeleteQuest(id);
      if (attendeesFor === id) setAttendeesFor(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleAttendees(id) {
    if (attendeesFor === id) {
      setAttendeesFor(null);
      return;
    }
    setBusyId(id);
    try {
      setAttendees(await callListQuestAttendees(id));
      setAttendeesFor(id);
    } finally {
      setBusyId(null);
    }
  }

  if (!quests) return <p>Loading your quests...</p>;

  return (
    <section className="box">
      <h2>Your quests</h2>
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
        {error && <p className="box-danger">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create quest'}
        </button>
      </form>

      {quests.length === 0 && <p>You haven't created any quests yet.</p>}
      <ul>
        {quests.map((quest) => (
          <li key={quest.id} className="box-secondary">
            <strong>{quest.title}</strong>
            <p>{quest.description}</p>
            <p>{(quest.rsvpd || []).length} RSVP'd</p>
            <div className="flex gap-sm">
              <button onClick={() => toggleAttendees(quest.id)} disabled={busyId === quest.id}>
                {attendeesFor === quest.id ? 'Hide attendees' : 'View attendees'}
              </button>
              <button onClick={() => removeQuest(quest.id)} disabled={busyId === quest.id}>
                {busyId === quest.id ? 'Working...' : 'Delete'}
              </button>
            </div>
            {attendeesFor === quest.id && attendees && (
              <ul>
                {attendees.length === 0 && <li>No RSVPs yet.</li>}
                {attendees.map((a) => (
                  <li key={a.uid}>
                    {a.name || 'Unnamed'} — {a.email}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (snap.exists()) setOrg(snap.data());
    });
  }, [user]);

  return (
    <div className="box">
      <h1>{org ? org.name : 'Organization Dashboard'}</h1>
      <p>Signed in as {user?.email}</p>
      {org && (
        <div>
          <p>{org.reason}</p>
          <p>{org.location}</p>
          <p>{org.phone}</p>
        </div>
      )}
      <button onClick={logout}>Log out</button>
      <OrgQuests />
    </div>
  );
}
