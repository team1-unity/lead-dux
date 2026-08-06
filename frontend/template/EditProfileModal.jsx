import { useEffect, useState } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from 'firebase/auth';
import { storage } from './firebaseapp.jsx';
import { callUpdateUserProfile } from './fetch.jsx';
import { StampButton } from './StampButton.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconX } from './icons.jsx';

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

// Name + profile picture live in Firestore (users/{uid}), so those two go
// through update_user_profile like everything else in this app ("every
// write goes through a Cloud Function"). Email and password are Firebase
// Auth's own concern instead — updateEmail/updatePassword talk to Auth
// directly, no Cloud Function involved — and only appear at all for an
// account that actually signed in with a password; a Google-only account
// has no password to change and Google, not this app, owns its email.
// Both require a fresh reauthentication first (Firebase's own
// "requires-recent-login" rule for anything security-sensitive), so
// "Current password" is asked for once and reused for whichever of the
// two actually changed.
//
// Shared, not Profile.jsx-only — the nav's avatar dropdown (see
// BottomNav.jsx) also opens this directly, from wherever in the app the
// caller happens to be, rather than routing to /profile first.
export function EditProfileModal({ user, currentName, currentPhotoURL, onClose, onSaved }) {
  const isPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  const [name, setName] = useState(currentName || '');
  const [file, setFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  const [newEmail, setNewEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) {
      setLocalPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give yourself a name.');
      return;
    }
    if (file) {
      if (!PROFILE_PHOTO_CONTENT_TYPES.includes(file.type)) {
        setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
        return;
      }
      if (file.size > PROFILE_PHOTO_MAX_SIZE_BYTES) {
        setError('Photo must be smaller than 10MB.');
        return;
      }
    }
    const emailChanged = isPasswordProvider && newEmail.trim() !== user.email;
    const passwordChanged = isPasswordProvider && newPassword.trim().length > 0;
    if ((emailChanged || passwordChanged) && !currentPassword) {
      setError('Enter your current password to change your email or password.');
      return;
    }

    setSaving(true);
    try {
      if (emailChanged || passwordChanged) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        if (emailChanged) await updateEmail(user, newEmail.trim());
        if (passwordChanged) await updatePassword(user, newPassword.trim());
      }

      let photoURL;
      if (file) {
        const ext = PROFILE_PHOTO_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
        const path = `avatars/${user.uid}/${Date.now()}.${ext}`;
        await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
        photoURL = await getDownloadURL(storageRef(storage, path));
      }

      const trimmedName = name.trim();
      if (trimmedName !== currentName || photoURL) {
        await callUpdateUserProfile({ name: trimmedName, ...(photoURL ? { photoURL } : {}) });
      }
      onSaved({ name: trimmedName, photoURL: photoURL || currentPhotoURL });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label='Edit profile'>
      <div className='detail-modal-content' onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSave} className='ink-card flex flex-col gap-md'>
          <h3 style={{ margin: 0 }}>Edit Profile</h3>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Profile picture
            <input
              type='file'
              accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {(localPreviewUrl || currentPhotoURL) && (
            <img
              src={localPreviewUrl || currentPhotoURL}
              alt='Profile preview'
              style={{
                width: 72,
                height: 72,
                borderRadius: 'var(--radius-full)',
                objectFit: 'cover',
              }}
            />
          )}
          {isPasswordProvider && (
            <>
              <label>
                Email
                <input
                  type='email'
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </label>
              <label>
                New password <span className='field-optional'>(optional)</span>
                <input
                  type='password'
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder='Leave blank to keep your current password'
                />
              </label>
              <label>
                Current password
                <input
                  type='password'
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder='Only needed to change email or password'
                />
              </label>
            </>
          )}
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
        <button type='button' className='photo-lightbox-close' onClick={onClose} aria-label='Close'>
          <IconX width={18} height={18} />
        </button>
      </div>
    </LightboxBackdrop>
  );
}
