import { useEffect, useState } from 'react';

export default function Toast({ toast }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [toast]);

  if (!toast) return null;

  return (
    <div className={`toast ${toast.type || 'success'} ${visible ? 'show' : ''}`}>
      {toast.message}
    </div>
  );
}
