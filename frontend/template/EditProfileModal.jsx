import { useState } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebaseapp.jsx';
import { callUpdateUserProfile } from './fetch.jsx';
import { StampButton } from './StampButton.jsx';
import { UserAvatar } from './UserAvatar.jsx';
import { AvatarCropModal } from './AvatarCropModal.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconEdit } from './icons.jsx';
import { DUCK_SKINS, DEFAULT_DUCK_SKIN } from './duckSkins.js';

const PROFILE_PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const PROFILE_PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Visual identity only — name, profile picture, and the duck-avatar
// fallback (all three live on users/{uid}, written through
// update_user_profile like everything else in this app). Email/password
// are account-security concerns, not identity, and live on Settings'
// Account section instead (see Settings.jsx's AccountSection) — the two
// used to share this one modal, but "who am I" and "how do I sign in"
// aren't really the same decision, and splitting them means Settings can
// also gate a fresh reauthentication around just the security-sensitive
// half instead of every save here needing to ask for a password.
//
// Shared, not Profile.jsx-only — the nav's avatar dropdown (see
// BottomNav.jsx) also opens this directly, from wherever in the app the
// caller happens to be, rather than routing to /profile first.
//
// The photo itself saves immediately (see handleAvatarSave), independent
// of this form's own Save button — cropping and clicking Save inside
// AvatarCropModal already is the confirmation for that specific change,
// the same way OrganizationProfile's logo upload always saved the instant
// a file was picked. Only name/duckSkin wait for the form's own Save.
export function EditProfileModal({ user, currentName, currentPhotoURL, currentDuckSkin, onClose, onSaved }) {
  const [name, setName] = useState(currentName || '');
  const [photoURL, setPhotoURL] = useState(currentPhotoURL || null);
  const [duckSkin, setDuckSkin] = useState(currentDuckSkin || DEFAULT_DUCK_SKIN);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleAvatarSave(file) {
    const ext = PROFILE_PHOTO_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
    const path = `avatars/${user.uid}/${Date.now()}.${ext}`;
    await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
    const url = await getDownloadURL(storageRef(storage, path));
    await callUpdateUserProfile({ name: name.trim() || currentName, photoURL: url });
    setPhotoURL(url);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give yourself a name.');
      return;
    }
    setSaving(true);
    try {
      const trimmedName = name.trim();
      const duckSkinChanged = duckSkin !== (currentDuckSkin || DEFAULT_DUCK_SKIN);
      if (trimmedName !== currentName || duckSkinChanged) {
        await callUpdateUserProfile({
          name: trimmedName,
          ...(duckSkinChanged ? { duckSkin } : {}),
        });
      }
      onSaved({ name: trimmedName, photoURL, duckSkin });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label='Edit profile'>
      <div className='detail-modal-content' data-frame='cozy' onClick={(e) => e.stopPropagation()}>
        <div className='detail-modal-content-scroll'>
        <form onSubmit={handleSave} className='ink-card flex flex-col gap-md'>
          <h3 style={{ margin: 0 }}>Edit Profile</h3>

          <button
            type='button'
            className='avatar-edit-trigger'
            onClick={() => setCropModalOpen(true)}
            aria-label='Change profile picture'
          >
            <UserAvatar photoURL={photoURL} duckSkin={duckSkin} />
            <span className='avatar-edit-trigger-badge' aria-hidden='true'>
              <IconEdit width={14} height={14} />
            </span>
          </button>

          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete='name' />
          </label>
          <div>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Duck avatar</p>
            <p className='field-optional' style={{ margin: '0 0 8px' }}>
              Shown whenever you don&rsquo;t have a profile picture set.
            </p>
            <div className='duck-skin-picker' role='radiogroup' aria-label='Duck avatar'>
              {DUCK_SKINS.map((duck) => (
                <button
                  key={duck.id}
                  type='button'
                  role='radio'
                  aria-checked={duckSkin === duck.id}
                  aria-label={duck.label}
                  className='duck-skin-option'
                  data-selected={duckSkin === duck.id ? 'true' : undefined}
                  onClick={() => setDuckSkin(duck.id)}
                >
                  <img src={duck.src} alt='' />
                </button>
              ))}
            </div>
          </div>
          {error && <p className='box-danger'>{error}</p>}
          <div className='flex gap-sm'>
            <StampButton type='submit' variant='primary' disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </StampButton>
            <StampButton type='button' onClick={onClose} disabled={saving}>
              Cancel
            </StampButton>
          </div>
        </form>
        </div>
      </div>
      {cropModalOpen && (
        <AvatarCropModal
          label='Profile picture'
          accept={PROFILE_PHOTO_CONTENT_TYPES.join(',')}
          maxSizeBytes={PROFILE_PHOTO_MAX_SIZE_BYTES}
          onClose={() => setCropModalOpen(false)}
          onSave={handleAvatarSave}
        />
      )}
    </LightboxBackdrop>
  );
}
