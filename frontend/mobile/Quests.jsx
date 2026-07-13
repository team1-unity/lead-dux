import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callRsvpToQuest, callCancelRsvp, callGetQuestQr } from '@shared/fetch.jsx';
import { RoughTexture } from '@shared/RoughTexture.jsx';
import { RoughFrame } from '@shared/RoughFrame.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { IconChevron } from '@shared/icons.jsx';

function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// The member's own check-in QR code for a quest they've RSVP'd to. Fetched
// lazily (only once the card is expanded and this is rendered) rather than
// alongside the quest list itself, since most quests in the list aren't
// ones this member RSVP'd to.
function QuestQrCode({ questId }) {
  const [state, setState] = useState({ loading: true, qr: null, expired: false, error: null });

  useEffect(() => {
    let cancelled = false;
    callGetQuestQr(questId)
      .then((data) => {
        if (!cancelled) setState({ loading: false, qr: data.qr, expired: data.expired, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, qr: null, expired: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  if (state.loading) return <LoadingSpinner label="Loading your check-in code..." />;
  if (state.error) return <p className="box-danger">{state.error}</p>;

  return (
    <div className="quest-qr" style={{ textAlign: 'center', marginTop: 12 }}>
      <img src={state.qr} alt="Your check-in QR code" style={{ maxWidth: 220, width: '100%' }} />
      {state.expired && <p className="box-warning">This code has expired.</p>}
    </div>
  );
}

// One entrance per row, staggered from the parent's transition — cheap
// enough at feed scale (a few dozen quests) and gives the list a sense of
// arriving rather than just appearing.
const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

// Client-side relevance sort: count how many of a quest's tags overlap with
// the user's own interests, sort descending. Fine at this data scale (a
// handful of seeded quests) — a real recommendation engine or a
// server-side scored query would replace this if the quest list grows.
function relevanceScore(quest, interests) {
  return (quest.tags || []).filter((tag) => interests.includes(tag)).length;
}

// One-off decorative illustration for the empty state — a hand-drawn target,
// resolved to real theme colors at draw time since <canvas> can't read CSS
// custom properties the way SVG's currentColor can.
function drawEmptyIllustration(rc, w, h) {
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--line').trim();
  const fill = styles.getPropertyValue('--tag-outdoors').trim();
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) - 24;
  const base = { roughness: 0.85, bowing: 0.7, stroke: ink, strokeWidth: 2.4 };
  rc.circle(cx, cy, outer, { ...base, fill, fillStyle: 'solid', seed: 11 });
  rc.circle(cx, cy, outer * 0.55, { ...base, strokeWidth: 1.8, fill: 'none', seed: 12 });
}

// Each quest is a node (thumbnail) on a connecting thread, with its card
// attached beside it — the "chain of quests" thread runs down the node
// column independently of whether any given card is expanded.
function QuestCard({ quest, isRsvpd, canRsvp, busy, onToggleRsvp, isLast }) {
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);

  return (
    <motion.li className="quest-row" variants={itemVariants}>
      <div className="quest-node-col">
        <div className="quest-thumb">
          <OrgAvatar name={quest.orgName} seed={quest.orgId || quest.id} />
        </div>
        {!isLast && (
          <div className="quest-thread">
            <RoughTexture variant="thread" seed={quest.id} />
          </div>
        )}
      </div>

      <div className="ink-card quest-content-col">
        <button type="button" className="quest-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <div className="quest-card-titles">
            <p className="quest-title">{quest.title}</p>
            {quest.orgName && <p className="quest-org-line">{quest.orgName}</p>}
          </div>
          <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
        </button>

        {open && (
          <div className="quest-card-body">
            {formatEventDate(quest.eventDate) && (
              <p className="quest-org-line">{formatEventDate(quest.eventDate)}</p>
            )}
            <p>{quest.description}</p>
            <div className="quest-tags">
              {(quest.tags || []).map((tag) => (
                <TagStamp key={tag} tone={tag}>
                  {tag}
                </TagStamp>
              ))}
            </div>
            {canRsvp && (
              <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                <StampButton
                  type="button"
                  variant={isRsvpd ? 'danger' : 'primary'}
                  onClick={() => {
                    setShowQr(false);
                    onToggleRsvp(quest);
                  }}
                  disabled={busy}
                >
                  {busy ? 'Saving...' : isRsvpd ? 'Cancel RSVP' : 'RSVP'}
                </StampButton>
                {isRsvpd && (
                  <StampButton type="button" onClick={() => setShowQr((v) => !v)}>
                    {showQr ? 'Hide my check-in code' : 'Show my check-in code'}
                  </StampButton>
                )}
              </div>
            )}
            {isRsvpd && showQr && <QuestQrCode questId={quest.id} />}
          </div>
        )}
      </div>
    </motion.li>
  );
}

export function Quests({ interests }) {
  const { user, role } = useAuth();
  const [quests, setQuests] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const reduce = useReducedMotion();

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

  const availableTags = useMemo(() => {
    if (!quests) return [];
    const seen = new Set();
    quests.forEach((q) => (q.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [quests]);

  const orgCount = useMemo(() => {
    if (!quests) return 0;
    return new Set(quests.filter((q) => q.orgId).map((q) => q.orgId)).size;
  }, [quests]);

  const visibleQuests = useMemo(() => {
    if (!quests) return [];
    if (!activeTag) return quests;
    return quests.filter((q) => (q.tags || []).includes(activeTag));
  }, [quests, activeTag]);

  if (!quests) return <LoadingSpinner label="Loading quests..." />;

  if (quests.length === 0) {
    return (
      <div className="quest-empty">
        <RoughFrame width={120} height={120} draw={drawEmptyIllustration} />
        <h2>No Quests Yet</h2>
        <p>Check back soon — organizations are just getting started.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="stat-hero-row">
        <div className="stat-hero-tile" style={{ background: 'var(--tag-community)' }}>
          <span className="stat-hero-number">{quests.length}</span>
          <span className="stat-hero-label">Quests Open</span>
        </div>
        <div className="stat-hero-tile" style={{ background: 'var(--tag-education)' }}>
          <span className="stat-hero-number">{orgCount}</span>
          <span className="stat-hero-label">Organizations</span>
        </div>
      </div>

      {availableTags.length > 0 && (
        <div className="tag-filter-row">
          <TagStamp selectable selected={activeTag === null} onClick={() => setActiveTag(null)}>
            All
          </TagStamp>
          {availableTags.map((tag) => (
            <TagStamp key={tag} tone={tag} selectable selected={activeTag === tag} onClick={() => setActiveTag(tag)}>
              {tag}
            </TagStamp>
          ))}
        </div>
      )}

      {visibleQuests.length === 0 ? (
        <p>No quests match that filter.</p>
      ) : (
        <motion.ul
          className="quest-list"
          variants={listVariants}
          initial={reduce ? false : 'hidden'}
          animate="show"
        >
          {visibleQuests.map((quest, i) => (
            <QuestCard
              key={quest.id}
              quest={quest}
              isRsvpd={(quest.rsvpd || []).includes(user?.uid)}
              canRsvp={role === 'user'}
              busy={busyId === quest.id}
              onToggleRsvp={toggleRsvp}
              isLast={i === visibleQuests.length - 1}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}
