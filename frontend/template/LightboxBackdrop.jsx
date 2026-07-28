import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// A full-viewport modal backdrop (photo lightbox, QR code, Attendees,
// Proof Photo, ...) — rendered via a portal straight onto document.body
// rather than nested wherever its component happens to sit in the tree.
//
// This matters because every page is wrapped in PageMotion, a framer-motion
// `motion.div` animating `y`. Framer-motion keeps a real (non-`none`)
// `transform` on that div even once the animation finishes at rest — and
// per the CSS spec, any ancestor with a `transform` other than `none`
// becomes the containing block for `position: fixed` descendants. A
// backdrop with `inset: 0` nested inside that div is then sized/stacked
// relative to *that div's* box, not the true viewport — so anything on the
// page with its own independent positioning (e.g. a quest detail's
// absolutely-positioned Share icon) can end up rendering on top of it,
// undimmed, instead of being covered like everything else. Portalling to
// document.body sidesteps the whole ancestor chain.
export function LightboxBackdrop({ onClose, label, children }) {
  // Without this, a scroll gesture over the dimmed backdrop (rather than
  // directly over the card) scrolls the page behind it instead of the
  // card's own content — the backdrop itself has no overflow, so the
  // nearest scrollable ancestor a wheel/touch event finds is the document.
  // Locking scroll while any modal is open means the card's own
  // `overflow-y: auto` (see .detail-modal-content) is the only scrollable
  // thing left, so a scroll gesture anywhere on the backdrop lands there
  // instead. Both <html> and <body> get locked, not just body — #root has
  // no fixed height/overflow of its own (see style.css), so the page's
  // real scrolling element is the documentElement, not the body; body's
  // overflow alone doesn't stop it. Each restores whatever was there
  // before on close/unmount, in case something else had already set it.
  useEffect(() => {
    const html = document.documentElement;
    const previousHtml = html.style.overflow;
    const previousBody = document.body.style.overflow;
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previousHtml;
      document.body.style.overflow = previousBody;
    };
  }, []);

  // Escape closes the same way clicking the backdrop does — every caller
  // gets this for free rather than each wiring up its own keydown listener.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="photo-lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  );
}
