import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { computeBadges } from './badges.js';

// Shared by Profile.jsx (the full badges preview) and BottomNav.jsx (the
// last-3-earned icons next to the name in the avatar dropdown) — one fetch
// shape instead of each duplicating the quests/attendance/user-doc reads.
// null while loading.
export function useEarnedBadges(user) {
  const [earned, setEarned] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid))),
      getDoc(doc(db, 'users', user.uid)),
    ]).then(([questsSnap, attendanceSnap, userSnap]) => {
      if (cancelled) return;
      const questsById = new Map(questsSnap.docs.map((d) => [d.id, d.data()]));
      const attendance = attendanceSnap.docs.map((d) => d.data());
      const userData = userSnap.exists() ? userSnap.data() : {};
      const computed = computeBadges({
        attendance,
        questsById,
        rank: userData.rank,
        createdAt: userData.createdAt,
      });
      setEarned(computed.filter((b) => b.earned));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return earned;
}
