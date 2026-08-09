import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getCachedCollection } from '@shared/collectionCache.js';
import {
  callUpdateOrganizationTags,
  callUpdateOrganizationProfile,
  callAddOrganizationPhoto,
  callRemoveOrganizationPhoto,
} from '@shared/fetch.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { ImageUploadCard } from '@shared/ImageUploadCard.jsx';
import { AvatarCropModal } from '@shared/AvatarCropModal.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { AddPropertyMenu } from '@shared/AddPropertyMenu.jsx';
import { PlaceCombobox } from '@shared/PlaceCombobox.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { PhotoGallery } from '@shared/PhotoGallery.jsx';
import { groupBySeries, attachSeriesRatings, isUpcoming, getTrustStatus } from '@shared/questSeries.js';
import { TrustTag } from '@shared/TrustTag.jsx';
import { hashTone } from '@shared/tagTones.js';
import {
  IconGlobe,
  IconMail,
  IconPhone,
  IconPin,
  IconChevron,
  IconEdit,
  IconInstagram,
  IconFacebook,
  IconX,
  IconLinkedIn,
  IconTikTok,
  IconYouTube,
} from '@shared/icons.jsx';

const SOCIAL_ICONS = {
  instagram: IconInstagram,
  facebook: IconFacebook,
  twitter: IconX,
  linkedin: IconLinkedIn,
  tiktok: IconTikTok,
  youtube: IconYouTube,
};

const SOCIAL_LINK_FIELDS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
];

// Same avatars/{uid}/ Storage path a leader's own profile picture upload
// uses (see Profile.jsx's EditProfileModal) — storage.rules gates it on
// request.auth.uid == uid alone, no role check, so an organization's own
// uid works exactly the same way. logoUrl itself stays a plain string
// field (update_organization_profile validates it as nothing more than
// `isinstance(value, str)`), so this just fills that same field with a
// real download URL instead of requiring someone to paste one in by hand.
const LOGO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const LOGO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const LOGO_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Website/Contact/Phone/Areas and every social link are optional and, for
// most orgs, blank — rather than a wall of empty rows, they only show once
// added via "+ Add a property" (same pattern as CreateQuestForm's
// Capacity/Tags), with a remove control on any row that's already there. A
// field that already has a value (from before this change, or a previous
// save) starts out shown, not hidden behind the menu.
const CORE_OPTIONAL_FIELD_ITEMS = [
  { key: 'website', label: 'Website', placeholder: 'https://...' },
  { key: 'contactEmail', label: 'Contact', placeholder: 'Empty' },
  { key: 'phone', label: 'Phone', placeholder: 'Empty' },
];
const OPTIONAL_FIELD_ITEMS = [
  ...CORE_OPTIONAL_FIELD_ITEMS,
  { key: 'ltag', label: 'Areas' },
  ...SOCIAL_LINK_FIELDS,
];

// One combined edit form for everything in the About section that has a
// writer — phone, mission statement, category, location, website, contact
// email, social links (callUpdateOrganizationProfile), and activity tags
// (callUpdateOrganizationTags, a separate call since it's a separate
// backend function, but presented as one save here to match the
// wireframe's single pencil icon on one About box).
//
// The logo is NOT one of these fields — it's edited directly from the
// header's own avatar (see OrganizationProfile's handleLogoAvatarSave),
// the same "click your own picture to change it" affordance
// EditProfileModal already uses for a member's photo, rather than a
// separate "Logo URL" row buried in this form.
//
// org.reason is deliberately NOT one of these fields — it's the org's
// answer to "what do you hope to get out of this?" from their original
// registration request (see Register.jsx), copied over at approval time
// purely so an admin can see it when reviewing that request. It was
// briefly reused as a public-facing "Description" here, but that mixed up
// an internal approval detail with the org's own public bio — reverted to
// admin-only; see functions/main.py's _SIMPLE_PROFILE_FIELDS.
function AboutEditForm({ org, onSaved, onCancel }) {
  const reduce = useReducedMotion();
  const [fields, setFields] = useState({
    category: org.category || '',
    missionStatement: org.missionStatement || '',
    phone: org.phone || '',
    website: org.website || '',
    contactEmail: org.contactEmail || '',
  });
  const [location, setLocation] = useState({
    location: org.location || '',
    placeId: org.placeId || null,
    lat: org.lat ?? null,
    lng: org.lng ?? null,
  });
  // Starts already showing the current address (there's almost always one,
  // set at signup — see Register.jsx) rather than a blank search box;
  // focusing that readonly display (see the render below) swaps in the
  // live search to replace it. Same "readonly display <-> live search"
  // pattern as CreateQuestForm's own location field.
  const [editingLocation, setEditingLocation] = useState(!org.placeId);
  const [placeKey, setPlaceKey] = useState(0);
  const [social, setSocial] = useState({ ...org.socialLinks });
  const [ltagInput, setLtagInput] = useState((org.ltag || []).join(', '));
  const [etagInput, setEtagInput] = useState((org.etag || []).join(', '));
  const [addedFields, setAddedFields] = useState(() => ({
    website: Boolean(org.website),
    contactEmail: Boolean(org.contactEmail),
    phone: Boolean(org.phone),
    ltag: (org.ltag || []).length > 0,
    instagram: Boolean(org.socialLinks?.instagram),
    facebook: Boolean(org.socialLinks?.facebook),
    twitter: Boolean(org.socialLinks?.twitter),
    linkedin: Boolean(org.socialLinks?.linkedin),
    tiktok: Boolean(org.socialLinks?.tiktok),
    youtube: Boolean(org.socialLinks?.youtube),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function addOptionalField(key) {
    setAddedFields((f) => ({ ...f, [key]: true }));
  }

  // Un-adding a field clears its value too, not just the addedFields flag —
  // so if it's added again later it starts fresh rather than silently
  // reappearing with whatever was typed before removal.
  function removeOptionalField(key) {
    setAddedFields((f) => ({ ...f, [key]: false }));
    if (key === 'ltag') setLtagInput('');
    else if (key in fields) setFields((f) => ({ ...f, [key]: '' }));
    else setSocial((s) => ({ ...s, [key]: '' }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const profilePayload = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v.trim() || null]),
      );
      const locationPayload = location.placeId
        ? { location: location.location, placeId: location.placeId, lat: location.lat, lng: location.lng }
        : {};
      const ltag = ltagInput.split(',').map((t) => t.trim()).filter(Boolean);
      const etag = etagInput.split(',').map((t) => t.trim()).filter(Boolean);
      await Promise.all([
        callUpdateOrganizationProfile({ ...profilePayload, ...locationPayload, socialLinks: social }),
        callUpdateOrganizationTags({ ltag, etag }),
      ]);
      onSaved({ ...profilePayload, ...locationPayload, socialLinks: social, ltag, etag });
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={save} className="about-edit-doc">
      {/* Same fixed-height/internal-scroll shape as CreateQuestForm's own
          .quest-form-scroll — everything that can grow (the mission
          statement, an ever-longer list of added properties) scrolls
          inside this wrapper instead of pushing Save/Cancel down and
          growing the whole About card past a reasonable height. */}
      <div className="about-edit-scroll">
      {/* Same borderless auto-grow trick as the create-quest description
          field (see CreateQuestForm.jsx/style.css) — a textarea and an
          invisible ::after sharing one grid cell, kept in sync via
          data-replicated-value, rather than JS scrollHeight measuring. */}
      <label className="visually-hidden" htmlFor="org-mission">Mission statement</label>
      <div className="quest-form-description-wrap" data-replicated-value={fields.missionStatement}>
        <textarea
          id="org-mission"
          className="quest-form-description-input"
          placeholder="What's your mission?"
          value={fields.missionStatement}
          onChange={(e) => setFields((f) => ({ ...f, missionStatement: e.target.value }))}
        />
      </div>

      <div className="quest-form-properties">
        <div className="quest-form-row">
          <label className="quest-form-row-label" htmlFor="org-category">Category</label>
          <div className="quest-form-row-value">
            <input
              id="org-category"
              type="text"
              placeholder="Youth center, sports league, etc."
              value={fields.category}
              onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
        </div>

        <div className="quest-form-row">
          <label className="quest-form-row-label" htmlFor="org-location">Location</label>
          <div className="quest-form-row-value">
            {editingLocation ? (
              <PlaceCombobox
                key={placeKey}
                id="org-location"
                ariaLabel="Organization location"
                placeholder="Search for an address or venue…"
                onSelect={(selection) => {
                  setLocation(selection);
                  setEditingLocation(false);
                  setPlaceKey((k) => k + 1);
                }}
              />
            ) : (
              <input
                id="org-location"
                type="text"
                readOnly
                value={location.location}
                onFocus={() => setEditingLocation(true)}
                placeholder="Empty"
              />
            )}
          </div>
        </div>

        <div className="quest-form-row">
          <label className="quest-form-row-label" htmlFor="org-etag">Activities</label>
          <div className="quest-form-row-value">
            <input
              id="org-etag"
              type="text"
              placeholder="Cleanup, Workshop"
              value={etagInput}
              onChange={(e) => setEtagInput(e.target.value)}
            />
          </div>
        </div>

        {CORE_OPTIONAL_FIELD_ITEMS.map(({ key, label, placeholder }) => addedFields[key] && (
          <motion.div
            className="quest-form-row"
            key={key}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          >
            <div className="quest-form-row-label">
              <button
                type="button"
                className="quest-form-label-remove"
                aria-label={`Remove ${label} property`}
                onClick={() => removeOptionalField(key)}
              >
                {label}
              </button>
            </div>
            <div className="quest-form-row-value">
              <label className="visually-hidden" htmlFor={`org-${key}`}>{label}</label>
              <input
                id={`org-${key}`}
                type="text"
                placeholder={placeholder}
                value={fields[key]}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          </motion.div>
        ))}

        {addedFields.ltag && (
          <motion.div
            className="quest-form-row"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          >
            <div className="quest-form-row-label">
              <button
                type="button"
                className="quest-form-label-remove"
                aria-label="Remove Areas property"
                onClick={() => removeOptionalField('ltag')}
              >
                Areas
              </button>
            </div>
            <div className="quest-form-row-value">
              <label className="visually-hidden" htmlFor="org-ltag">Areas</label>
              <input
                id="org-ltag"
                type="text"
                placeholder="Downtown, Riverside"
                value={ltagInput}
                onChange={(e) => setLtagInput(e.target.value)}
              />
            </div>
          </motion.div>
        )}

        {SOCIAL_LINK_FIELDS.map(({ key, label }) => addedFields[key] && (
          <motion.div
            className="quest-form-row"
            key={key}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          >
            <div className="quest-form-row-label">
              <button
                type="button"
                className="quest-form-label-remove"
                aria-label={`Remove ${label} property`}
                onClick={() => removeOptionalField(key)}
              >
                {label}
              </button>
            </div>
            <div className="quest-form-row-value">
              <label className="visually-hidden" htmlFor={`org-social-${key}`}>{label}</label>
              <input
                id={`org-social-${key}`}
                type="text"
                placeholder="Empty"
                value={social[key] || ''}
                onChange={(e) => setSocial((s) => ({ ...s, [key]: e.target.value }))}
              />
            </div>
          </motion.div>
        ))}

        <AddPropertyMenu
          items={OPTIONAL_FIELD_ITEMS.filter((it) => !addedFields[it.key])}
          onSelect={addOptionalField}
        />
      </div>
      </div>

      {error && <p className="quest-form-error">{error}</p>}

      <div className="quest-form-footer">
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </StampButton>
        <button type="button" className="quest-form-ghost-btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const ORG_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ORG_PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ORG_PHOTO_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Wraps the generic, read-only PhotoGallery with the org-owner-only upload/
// delete affordances — kept separate from PhotoGallery itself so that
// component stays a plain "array of URLs in, grid+lightbox out" building
// block (see its own module note) rather than knowing about storage paths,
// Storage uploads, or who's allowed to manage a given gallery.
//
// `paths` are storage paths (organizations/{orgId}.photos), not resolved
// URLs — same pattern quest proof photos already use (see
// QuestPhotoSubmission.jsx) — resolved to download URLs here via
// getDownloadURL rather than the Cloud Function returning them, so there's
// nothing to keep in sync if the bucket's URL-signing scheme ever changes.
function OrgPhotoGallery({ orgId, paths, canEdit, onPathsChange }) {
  const [urls, setUrls] = useState([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  // ImageUploadCard's own onUpload only means "picked and locally
  // previewed" here, not "actually uploaded" — the real Storage write
  // waits for the modal's own explicit Upload button (see handleUpload),
  // matching QuestPhotoSubmission's identical pick-then-confirm shape
  // rather than uploading the instant a file is dropped.
  const [pickedFile, setPickedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  // Bumping this remounts ImageUploadCard fresh (empty, no lingering
  // preview) after each successful upload, since the component itself has
  // no reset API of its own to call instead — the modal itself stays open
  // across uploads, so this is what lets someone add several photos in
  // one sitting rather than reopening it each time.
  const [uploadKey, setUploadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      paths.map((p) => {
        // Already a real URL — some seeded demo orgs have external
        // (picsum.photos) placeholder URLs in this field from before this
        // feature had a real writer at all (see seed_demo_data.py's
        // photo_url). Only genuine Storage paths (new uploads via
        // handleUpload below) need resolving; storageRef() would throw on
        // a URL that isn't actually one of this bucket's own objects.
        if (/^https?:\/\//.test(p)) return Promise.resolve(p);
        return getDownloadURL(storageRef(storage, p)).catch(() => null);
      }),
    ).then((resolved) => {
      if (!cancelled) setUrls(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  async function handleUpload() {
    if (!pickedFile) return;
    setError('');
    if (!ORG_PHOTO_CONTENT_TYPES.includes(pickedFile.type)) {
      setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
      return;
    }
    if (pickedFile.size > ORG_PHOTO_MAX_SIZE_BYTES) {
      setError('Photo must be smaller than 10MB.');
      return;
    }
    setUploading(true);
    try {
      const ext = ORG_PHOTO_EXT_BY_CONTENT_TYPE[pickedFile.type] || 'jpg';
      const path = `orgPhotos/${orgId}/${Date.now()}.${ext}`;
      await uploadBytes(storageRef(storage, path), pickedFile, { contentType: pickedFile.type });
      await callAddOrganizationPhoto(path);
      onPathsChange([...paths, path]);
      setPickedFile(null);
      setUploadKey((k) => k + 1);
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setUploading(false);
    }
  }

  function closeModal() {
    setModalOpen(false);
    setPickedFile(null);
    setError('');
  }

  async function handleDelete(index) {
    const path = paths[index];
    try {
      await callRemoveOrganizationPhoto(path);
      onPathsChange(paths.filter((p) => p !== path));
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    }
  }

  return (
    <>
      {canEdit && (
        <StampButton
          type="button"
          className="quest-form-ghost-btn"
          style={{ marginBottom: 12 }}
          onClick={() => setModalOpen(true)}
        >
          + Add photo
        </StampButton>
      )}
      {!modalOpen && error && <p className="box-danger">{error}</p>}
      <PhotoGallery
        photos={urls}
        onDelete={canEdit ? handleDelete : undefined}
        className="photo-gallery-grid-fixed-4"
      />
      {modalOpen && (
        <LightboxBackdrop onClose={closeModal} label="Upload image">
          <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
            <ImageUploadCard
              key={uploadKey}
              title="Upload image"
              accept={ORG_PHOTO_CONTENT_TYPES.join(',')}
              onUpload={(url, file) => setPickedFile(file)}
              onRemove={() => setPickedFile(null)}
            />
            {error && <p className="box-danger">{error}</p>}
            <div className="flex gap-sm" style={{ marginTop: 12 }}>
              <StampButton type="button" variant="primary" onClick={handleUpload} disabled={!pickedFile || uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </StampButton>
              <StampButton type="button" onClick={closeModal} disabled={uploading}>
                Cancel
              </StampButton>
            </div>
          </div>
        </LightboxBackdrop>
      )}
    </>
  );
}

function OrgQuestCard({ series }) {
  const { primary } = series;
  const rsvpCount = (primary.rsvpd || []).length;
  return (
    <Link to={`/quests/${series.seriesId}`} className="ink-card org-quest-card">
      <p className="quest-title">{primary.title}</p>
      {primary.description && <p className="quest-card-description">{primary.description}</p>}
      <p className="data-stat">{rsvpCount} RSVP'd</p>
    </Link>
  );
}

// The organization's public "home" within the app — reachable by any
// signed-in role (not gated to a specific one, same as browsing quests
// itself). Organization docs are readable by any signed-in user (see
// firestore.rules) since every field on them is meant to be public once
// approved; quests are read the same direct-client-query way the main
// Quests page already reads them.
//
// View and Edit are the same page and the same content — "View profile"
// and "Edit profile" (BottomNav.jsx's nav avatar menu) both land here,
// differing only in whether editMode (see below) is on. In View, an
// organization sees the exact same thing a visitor does; edit mode adds
// nothing but a handful of small controls on top of that same content —
// a pencil on About toggling AboutEditForm (editing happens on this same
// page, not a separate one; both backend calls it needs —
// callUpdateOrganizationProfile and callUpdateOrganizationTags — are
// submitted together as one save), a "manage quests" link next to Active
// Quests, and the photo gallery's add/delete controls. This used to be
// gated on isOwner alone, which meant "View profile" showed every one of
// those owner-only controls too, indistinguishable from Edit.
export function OrganizationProfile() {
  const { orgId } = useParams();
  const { role, user } = useAuth();
  const location = useLocation();
  // isOwner is pure identity ("is this your org") — it still decides the
  // BackLink destination below, but no longer gates any owner-only
  // control by itself. editMode is the actual view/edit distinction: only
  // reachable via the nav avatar menu's "Edit profile" link (see
  // BottomNav.jsx), which is the one thing that sets this state flag —
  // "View profile," a stale back-navigation, or landing here any other
  // way (e.g. clicking the org's own name from a quest card) all leave it
  // unset, so the page renders identically to what any other visitor
  // sees. There's no page-level toggle back into edit mode by design —
  // the nav menu is the only door in.
  const isOwner = role === 'organization' && user?.uid === orgId;
  const editMode = isOwner && Boolean(location.state?.editMode);
  const [org, setOrg] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [seriesList, setSeriesList] = useState(null);
  const [editingAbout, setEditingAbout] = useState(false);
  const [logoCropOpen, setLogoCropOpen] = useState(false);

  // Saves immediately, same as EditProfileModal's identical pattern for a
  // member's own profile picture — cropping and clicking Save inside
  // AvatarCropModal already is the confirmation for this specific change,
  // not something that waits for the About form's own Save.
  async function handleLogoAvatarSave(file) {
    const ext = LOGO_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
    const path = `avatars/${user.uid}/${Date.now()}.${ext}`;
    await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
    const url = await getDownloadURL(storageRef(storage, path));
    await callUpdateOrganizationProfile({ logoUrl: url });
    setOrg((prev) => ({ ...prev, logoUrl: url }));
  }

  useEffect(() => {
    getDoc(doc(db, 'organizations', orgId)).then((snap) => {
      if (!snap.exists()) {
        setNotFound(true);
        return;
      }
      setOrg(snap.data());
    });
  }, [orgId]);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'quests'), where('orgId', '==', orgId))),
      getCachedCollection(db, 'questSeries'),
    ]).then(([questsSnap, seriesSnap]) => {
      const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
      const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
      setSeriesList(attachSeriesRatings(groupBySeries(quests), seriesDocsById));
    });
  }, [orgId]);

  if (notFound) return <Navigate to="/" replace />;
  if (!org) return <LoadingSpinner label="Loading organization…" />;

  const socialEntries = Object.entries(org.socialLinks || {}).filter(([, url]) => url);

  return (
    <PageMotion>
      {isOwner ? <BackLink to="/org" label="Home" /> : <BackLink to="/quests" label="Quests" />}
      <div className="ink-card org-profile-header">
        {editMode ? (
          <button
            type="button"
            className="avatar-edit-trigger"
            onClick={() => setLogoCropOpen(true)}
            aria-label="Change logo"
          >
            {org.logoUrl ? (
              <img src={org.logoUrl} alt="" className="org-profile-logo" />
            ) : (
              <OrgAvatar name={org.name} seed={orgId} />
            )}
            <span className="avatar-edit-trigger-badge" aria-hidden="true">
              <IconEdit width={14} height={14} />
            </span>
          </button>
        ) : org.logoUrl ? (
          <img src={org.logoUrl} alt="" className="org-profile-logo" />
        ) : (
          <OrgAvatar name={org.name} seed={orgId} />
        )}
        <div className="org-profile-header-info">
          <div className="flex items-center gap-sm">
            <h1 style={{ margin: 0 }}>{org.name}</h1>
          </div>
          <div className="flex items-center gap-sm" style={{ marginTop: 6 }}>
            <TrustTag status={getTrustStatus(org.reviewCount || 0, org.avgRating || 0)} />
            {org.category && <TagStamp tone={hashTone(org.category)}>{org.category}</TagStamp>}
          </div>
        </div>
        {/* No Settings shortcut here anymore — it's already one click away
            from the same nav avatar menu "Edit profile" is reached from
            (see BottomNav.jsx), so this was a redundant second door to the
            same place. */}
      </div>
      {getTrustStatus(org.reviewCount || 0, org.avgRating || 0) === 'under_review' && (
        <p className="box-danger">
          This organization is under review for consistently low ratings — its Trust Score has not yet been
          confirmed.
        </p>
      )}

      <div className="profile-grid org-profile-grid">
        <section className="ink-card org-profile-about">
          <div className="flex justify-between items-center">
            <h2 style={{ margin: 0 }}>About</h2>
            {editMode && !editingAbout && (
              <button
                type="button"
                className="quest-icon-btn"
                onClick={() => setEditingAbout(true)}
                aria-label="Edit About"
                title="Edit"
              >
                <IconEdit />
              </button>
            )}
          </div>
          {editingAbout ? (
            <AboutEditForm
              org={org}
              onSaved={(patch) => {
                setOrg((prev) => ({ ...prev, ...patch }));
                setEditingAbout(false);
              }}
              onCancel={() => setEditingAbout(false)}
            />
          ) : (
            <>
              {org.missionStatement && <p style={{ margin: '10px 0 0' }}>{org.missionStatement}</p>}
              {org.location && (
                <p className="data-stat" style={{ marginTop: 10 }}>
                  <IconPin /> {org.location}
                </p>
              )}
              {org.website && (
                <p className="data-stat">
                  <IconGlobe />{' '}
                  <a href={org.website} target="_blank" rel="noreferrer">{org.website}</a>
                </p>
              )}
              {org.contactEmail && (
                <p className="data-stat">
                  <IconMail /> <a href={`mailto:${org.contactEmail}`}>{org.contactEmail}</a>
                </p>
              )}
              {org.phone && (
                <p className="data-stat">
                  <IconPhone /> {org.phone}
                </p>
              )}
              {socialEntries.length > 0 && (
                <div className="org-social-links">
                  {socialEntries.map(([key, url]) => {
                    const Icon = SOCIAL_ICONS[key];
                    if (!Icon) return null;
                    return (
                      <a key={key} href={url} target="_blank" rel="noreferrer" aria-label={key}>
                        <Icon />
                      </a>
                    );
                  })}
                </div>
              )}
              {((org.ltag || []).length > 0 || (org.etag || []).length > 0) && (
                <div className="quest-tags" style={{ marginTop: 10 }}>
                  {(org.ltag || []).map((t) => <TagStamp key={`l-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
                  {(org.etag || []).map((t) => <TagStamp key={`e-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
                </div>
              )}
            </>
          )}
        </section>

        <section className="ink-card org-profile-quests">
          <div className="flex justify-between items-center">
            <h2 style={{ margin: 0 }}>Active Quests</h2>
            {/* Same content either way now (see module note) — this link
                to the real management dashboard is the one addition edit
                mode gets here, not a different summary in place of the
                grid below. */}
            {editMode && (
              <Link to="/org/quests" aria-label="Manage your quests">
                <IconChevron style={{ transform: 'rotate(-90deg)' }} />
              </Link>
            )}
          </div>
          {seriesList === null ? (
            <LoadingSpinner label="Loading quests…" />
          ) : seriesList.length === 0 ? (
            <p className="data-stat">No active quests right now.</p>
          ) : (
            <div className="org-quest-grid">
              {seriesList.map((series) => (
                <OrgQuestCard key={series.seriesId} series={series} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="ink-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: '0 0 12px' }}>Community Photos</h2>
        <OrgPhotoGallery
          orgId={orgId}
          paths={org.photos || []}
          canEdit={editMode}
          onPathsChange={(photos) => setOrg((prev) => ({ ...prev, photos }))}
        />
      </section>

      {logoCropOpen && (
        <AvatarCropModal
          label="Logo"
          accept={LOGO_CONTENT_TYPES.join(',')}
          maxSizeBytes={LOGO_MAX_SIZE_BYTES}
          onClose={() => setLogoCropOpen(false)}
          onSave={handleLogoAvatarSave}
        />
      )}
    </PageMotion>
  );
}
