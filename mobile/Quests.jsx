import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';

// Client-side relevance sort: count how many of a quest's tags overlap with
// the user's own interests, sort descending. Fine at this data scale (a
// handful of seeded quests) — a real recommendation engine or a
// server-side scored query would replace this if the quest list grows.
function relevanceScore(quest, interests) {
  return (quest.tags || []).filter((tag) => interests.includes(tag)).length;
}

export function Quests({ interests }) {
  const [quests, setQuests] = useState(null);

  useEffect(() => {
    getDocs(collection(db, 'quests')).then((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => relevanceScore(b, interests) - relevanceScore(a, interests));
      setQuests(all);
    });
  }, [interests]);

  if (!quests) return <p>Loading quests...</p>;

  return (
    <div className="box">
      <h1>Quests for you</h1>
      {quests.length === 0 && <p>No quests yet — check back soon.</p>}
      <ul>
        {quests.map((quest) => (
          <li key={quest.id} className="box-secondary">
            <strong>{quest.title}</strong>
            <p>{quest.description}</p>
            <p>{(quest.tags || []).join(', ')}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
