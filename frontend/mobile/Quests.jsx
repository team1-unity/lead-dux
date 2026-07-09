import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callRsvpToQuest, callCancelRsvp } from '@shared/fetch.jsx';

// Client-side relevance sort: count how many of a quest's tags overlap with
// the user's own interests, sort descending. Fine at this data scale (a
// handful of seeded quests) — a real recommendation engine or a
// server-side scored query would replace this if the quest list grows.
function relevanceScore(quest, interests) {
  return (quest.tags || []).filter((tag) => interests.includes(tag)).length;
}

export function Quests({ interests }) {
  const { user, role } = useAuth();
  const [quests, setQuests] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    getDocs(collection(db, 'quests')).then((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => relevanceScore(b, interests) - relevanceScore(a, interests));
      setQuests(all);
    });
  }

  useEffect(load, [interests]);

  async function toggleRsvp(quest) {
    setBusyId(quest.id);
    try {
      if ((quest.rsvpd || []).includes(user.uid)) {
        await callCancelRsvp(quest.id);
      } else {
        await callRsvpToQuest(quest.id);
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (!quests) return <p>Loading quests...</p>;

  return (
    <div className="box">
      <h1>Quests for you</h1>
      {quests.length === 0 && <p>No quests yet — check back soon.</p>}
      <ul>
        {quests.map((quest) => {
          const isRsvpd = (quest.rsvpd || []).includes(user?.uid);
          return (
            <li key={quest.id} className="box-secondary">
              <strong>{quest.title}</strong>
              {quest.orgName && <span className="quest-org"> — {quest.orgName}</span>}
              <p>{quest.description}</p>
              <p>{(quest.tags || []).join(', ')}</p>
              {role === 'user' && (
                <button onClick={() => toggleRsvp(quest)} disabled={busyId === quest.id}>
                  {busyId === quest.id ? 'Saving...' : isRsvpd ? 'Cancel RSVP' : 'RSVP'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
