import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';

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
    </div>
  );
}
