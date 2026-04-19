import React, { useEffect, useRef } from 'react';

// Professional Modal with Tailwind animations, focus trap and accessible controls
export default function Modal({
  show,
  title,
  size = 'md',
  onClose,
  children,
  closeOnBackdrop = true,
  footer = null,
}) {
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const onCloseRef = useRef(onClose);
  // keep latest onClose in a ref so effect doesn't need it as dep
  onCloseRef.current = onClose;

  // map size to max width
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    xxl: 'max-w-[96vw]',
  };

  useEffect(() => {
    if (!show) return;
    previouslyFocusedRef.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // when opened, move focus to first focusable element inside dialog
    const setInitialFocus = () => {
      const el = dialogRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable && focusable.length) {
        try { focusable[0].focus(); } catch (e) {}
      } else {
        // fallback: focus dialog container
        try { el.focus(); } catch (e) {}
      }
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current && onCloseRef.current();
      } else if (e.key === 'Tab') {
        const el = dialogRef.current;
        if (!el) return;
        const focusable = el.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    // small timeout to allow DOM to render
    const t = setTimeout(setInitialFocus, 40);
    document.addEventListener('keydown', handleKey);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prev;
      try { previouslyFocusedRef.current && previouslyFocusedRef.current.focus(); } catch (e) {}
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop (click to close) */}
      <div
        onClick={(e) => { if (!closeOnBackdrop) return; if (onClose) onClose(); }}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 z-40"
      />

      {/* Modal Panel */}
      <div
        className={`${sizeClasses[size] || sizeClasses.md} w-full relative transform transition-all duration-300 ease-out will-change-transform z-50`}
        style={{ zIndex: 60 }}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="mx-auto overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-100 transform transition-all duration-350 ease-out"
          style={{ boxShadow: '0 10px 40px rgba(2,6,23,0.14)' }}
        >

          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 bg-gradient-to-b from-white to-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-50 text-green-700 font-bold">{(title || '').charAt(0) || ''}</div>
              <div>
                <h2 id="modal-title" className="text-lg font-semibold text-gray-900">{title}</h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                aria-label="Close"
                className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 max-h-[72vh] overflow-auto custom-scrollbar">
            <div className="motion-safe:animate-fade-slide-up">
              {children}
            </div>
          </div>

          {/* Footer */}
          {footer ? (
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t">
              {footer}
            </div>
          ) : null}

        </div>
      </div>
    </div>
  );
}
