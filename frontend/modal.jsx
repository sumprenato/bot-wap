import React, { useContext, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UI } from './template';

const openDialogs = new Set();

export function Modal({ children, onClose, label, labelledBy, className = '', size = 'standard', busy = false }) {
  const ref = useRef(null), callbacks = useRef(null), backdropPress = useRef(false), titleId = useId();
  const ctx = useContext(UI);
  const suspended = Boolean(ctx?.contactsBlocked);
  callbacks.current = { onClose, busy };
  const requestClose = () => {
    if (callbacks.current.busy || ref.current?.querySelector('[aria-busy="true"]')) return;
    callbacks.current.onClose?.();
  };
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || suspended) return;
    const previous = document.activeElement;
    if (!label && !labelledBy) {
      const heading = dialog.querySelector('h2,h3');
      if (heading) { heading.id ||= titleId; dialog.setAttribute('aria-labelledby', heading.id); }
    }
    document.querySelectorAll('[popover]:popover-open').forEach(element => element.hidePopover());
    dialog.showModal();
    openDialogs.add(dialog);
    document.documentElement.classList.add('has-modal');
    const first = dialog.querySelector('input:not([type=hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled),.confirm-cancel:not(:disabled)');
    first?.focus({ preventScroll: true });
    const preventBackdropScroll = event => { if (event.target === dialog) event.preventDefault(); };
    dialog.addEventListener('wheel', preventBackdropScroll, { passive: false });
    dialog.addEventListener('touchmove', preventBackdropScroll, { passive: false });
    return () => {
      dialog.removeEventListener('wheel', preventBackdropScroll);
      dialog.removeEventListener('touchmove', preventBackdropScroll);
      openDialogs.delete(dialog);
      dialog.close();
      if (!openDialogs.size) document.documentElement.classList.remove('has-modal');
      requestAnimationFrame(() => {
        const top = [...openDialogs].at(-1);
        if (previous?.isConnected && (!top || top.contains(previous))) previous.focus({ preventScroll: true });
      });
    };
  }, [suspended, titleId, label, labelledBy]);
  if (suspended) return null;
  return createPortal(<dialog ref={ref} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy}
    className={`app-modal app-modal--${size} ${className}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type=hidden]),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    }} onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      backdropPress.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    }} onClick={event => {
      if (event.target !== event.currentTarget || !backdropPress.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
    }}>
    <button type="button" className="app-modal-close" aria-label="Fechar janela" disabled={busy} onClick={requestClose}>×</button>
    <div className="app-modal-content">{children}</div>
  </dialog>, document.body);
}
