import { Capacitor } from '@capacitor/core';

// Whether this is running inside the installed Capacitor app (iOS/Android)
// rather than a plain mobile web browser — computed once at module load,
// since it can't change during a session. Safe to import/call even in a
// plain web build, where it always resolves false (see auth.jsx's own note
// on this same Capacitor.isNativePlatform() call).
export const IS_NATIVE_APP = Capacitor.isNativePlatform();
