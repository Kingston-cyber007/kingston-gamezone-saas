import { useEffect, useState, useCallback } from 'react';

interface ToastItem {
  id: number;
  msg: string;
  icon: string;
  color?: string;
}

let addToast: ((msg: string, icon?: string, color?: string) => void) | null = null;

export function showToast(msg: string, icon = '✅', color?: string) {
  addToast?.(msg, icon, color);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((msg: string, icon = '✅', color?: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, icon, color }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    addToast = add;
    return () => { addToast = null; };
  }, [add]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="toast-item flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl"
          style={{ background: '#1A1E27', border: '1px solid #2A2F3B', borderLeft: `3px solid ${t.color || '#3DDC84'}`, color: '#EDEFF3' }}
        >
          <span className="toast-icon text-base">{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
