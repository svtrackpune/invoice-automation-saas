'use client';

import { useEffect } from 'react';

/**
 * Global modal/form UX contract:
 * - clicking the transparent backdrop must never dismiss a modal
 * - Escape must never dismiss a modal
 * - only the modal's explicit Save / Cancel / Close actions may change its state
 *
 * Existing modal components remain responsible for their own explicit close buttons.
 */
export default function ModalPersistenceGuard() {
  useEffect(() => {
    const isModalOverlay = (value: EventTarget | null): value is HTMLElement => {
      if (!(value instanceof HTMLElement)) return false;
      return value.classList.contains('fixed') && value.classList.contains('inset-0');
    };

    const handleClickCapture = (event: MouseEvent) => {
      // A click whose target is the overlay itself is a backdrop click.
      // Stop it before React's bubbling handler can interpret it as "close".
      if (isModalOverlay(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.fixed.inset-0')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('click', handleClickCapture, true);
    document.addEventListener('keydown', handleKeyDownCapture, true);
    return () => {
      document.removeEventListener('click', handleClickCapture, true);
      document.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, []);

  return null;
}
