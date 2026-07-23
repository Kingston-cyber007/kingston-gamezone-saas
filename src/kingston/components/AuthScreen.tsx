import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { unlockAudio } from '../lib/audio';

interface Props {
  onAuth: () => void;
}

export function AuthScreen({ onAuth }: Props) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const settings = useStore(s => s.settings);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  function handleLogin() {
    if (pw === settings.staffPassword) {
      unlockAudio();
      onAuth();
    } else {
      setError('Mot de passe incorrect');
      setPw('');
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className="auth-overlay fixed inset-0 z-[300] flex items-center justify-center p-5"
      style={{ background: 'rgba(8,9,12,0.97)', backdropFilter: 'blur(12px)' }}>

      <div className="auth-particles" aria-hidden>
        {Array.from({ length: 20 }).map((_, i) => (
          <span key={i} className="particle" style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 4}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
            fontSize: `${10 + Math.random() * 16}px`,
            opacity: 0.15 + Math.random() * 0.25,
          }}>
            {['🎮', '🕹️', '👾', '⚡', '🏆', '🎯', '💥', '⭐'][Math.floor(Math.random() * 8)]}
          </span>
        ))}
      </div>

      <div className={`auth-modal relative bg-[#161A22] border border-[#2A2F3B] rounded-2xl p-8 w-full max-w-xs text-center shadow-2xl ${shake ? 'shake' : ''}`}>
        <div className="auth-logo mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
          style={{ background: 'linear-gradient(135deg, #E8A33D, #C97E1F)', color: '#11141A', fontFamily: 'Oswald, sans-serif' }}>
          KG
        </div>
        <div className="auth-glow absolute inset-0 rounded-2xl pointer-events-none" />

        <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'Oswald, sans-serif', color: '#EDEFF3' }}>
          Kingston Gaming
        </h2>
        <p className="text-xs mb-6" style={{ color: '#5C6373' }}>Connexion staff requise</p>

        <input
          ref={inputRef}
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="Mot de passe"
          className="w-full px-4 py-3 rounded-xl text-center text-sm mb-3 outline-none"
          style={{ background: '#11141A', border: '1px solid #2A2F3B', color: '#EDEFF3', fontFamily: 'Inter, sans-serif' }}
        />
        {error && <p className="text-xs mb-3" style={{ color: '#FF5C5C' }}>{error}</p>}
        {!error && <div className="mb-3 h-4" />}

        <button
          onClick={handleLogin}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #E8A33D, #C97E1F)', color: '#11141A', fontFamily: 'Oswald, sans-serif', letterSpacing: '0.5px' }}
        >
          🔓 Se connecter
        </button>

        <p className="mt-4 text-xs" style={{ color: '#5C6373' }}>Pointe-Noire · Données locales uniquement</p>
      </div>
    </div>
  );
}
