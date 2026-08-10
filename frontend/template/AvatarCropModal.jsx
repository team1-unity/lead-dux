import { useCallback, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { StampButton } from './StampButton.jsx';

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

// No rotation/flip support (unlike some crop-library examples) — an
// avatar crop never needs either, so this is just a straight rectangular
// extract via drawImage's own source-rect args, not the rotate-aware
// translate/getImageData/putImageData dance a general-purpose cropper
// needs.
async function cropToBlob(imageUrl, area) {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to crop that image.'));
    }, 'image/jpeg', 0.92);
  });
}

// Pick -> crop (always a circle, always square) -> save, all in one
// modal. `onSave(file)` does the actual upload+persist and is awaited
// directly here — a rejection shows inline as `error` rather than closing,
// so a failed upload leaves the crop still in place to retry rather than
// losing it. Shared by EditProfileModal (a member's own profile picture)
// and OrganizationProfile (an org's logo) — both are round avatars
// cropped from an arbitrary source photo the same way; nothing here is
// specific to either.
export function AvatarCropModal({ label = 'Upload photo', accept, maxSizeBytes = DEFAULT_MAX_SIZE_BYTES, onClose, onSave }) {
  const [pickedFile, setPickedFile] = useState(null);
  const [pickedUrl, setPickedUrl] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (accept && !accept.split(',').includes(file.type)) {
      setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
      return;
    }
    if (file.size > maxSizeBytes) {
      setError('Photo must be smaller than 10MB.');
      return;
    }
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    setPickedFile(file);
    setPickedUrl(URL.createObjectURL(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  const handleCropComplete = useCallback((_area, areaPixels) => {
    setCroppedArea(areaPixels);
  }, []);

  function handleClose() {
    if (saving) return;
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    onClose();
  }

  async function handleSave() {
    if (!pickedFile || !croppedArea) return;
    setSaving(true);
    setError('');
    try {
      const blob = await cropToBlob(pickedUrl, croppedArea);
      const file = new File([blob], pickedFile.name, { type: pickedFile.type });
      await onSave(file);
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <LightboxBackdrop onClose={handleClose} label={label}>
      <div className="ink-card avatar-crop-modal" data-frame="cozy" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>{label}</h3>

        {pickedUrl ? (
          <>
            <div className="avatar-crop-area">
              <Cropper
                image={pickedUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="avatar-crop-zoom"
              aria-label="Zoom"
            />
          </>
        ) : (
          <StampButton type="button" variant="primary" onClick={() => fileInputRef.current?.click()}>
            Choose a photo
          </StampButton>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {error && <p className="box-danger">{error}</p>}

        <div className="flex gap-sm">
          {pickedUrl && (
            <StampButton type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </StampButton>
          )}
          <StampButton type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </StampButton>
        </div>
      </div>
    </LightboxBackdrop>
  );
}
