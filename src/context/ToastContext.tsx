import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastItem['type'], message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastItem['type'], message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      setTimeout(() => removeToast(id), 4500);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-xl border backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-[#111827]/95 border-emerald-500/35 text-emerald-100'
                : toast.type === 'error'
                  ? 'bg-[#111827]/95 border-red-400/40 text-red-100'
                  : 'bg-[#1E293B]/95 border-indigo-400/35 text-slate-100'
            }`}
          >
            {toast.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'info' && (
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            )}
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
