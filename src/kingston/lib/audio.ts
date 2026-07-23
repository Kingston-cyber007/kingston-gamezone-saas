let audioCtx: AudioContext | null = null;

export function getAudioCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { audioCtx = null; }
  }
  return audioCtx;
}

export function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

/* ── Beep synthétisé (fallback) ────────────────────────────── */
export function playAlertSound(kind: 'warning' | 'expired', volume = 0.5) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  function tone(freq: number, start: number, duration: number, vol: number) {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(vol * 0.5, now + start + 0.012);
    gain.gain.linearRampToValueAtTime(0, now + start + duration);
    osc.connect(gain);
    gain.connect(ctx!.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.03);
  }

  if (kind === 'expired') {
    tone(880, 0, 0.15, volume);
    tone(660, 0.18, 0.18, volume);
    tone(880, 0.38, 0.15, volume);
    tone(440, 0.56, 0.25, volume);
  } else {
    tone(740, 0, 0.14, volume);
  }
}

export function playSessionStart(volume = 0.5) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  function tone(freq: number, start: number, duration: number) {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume * 0.4, now + start);
    gain.gain.linearRampToValueAtTime(0, now + start + duration);
    osc.connect(gain);
    gain.connect(ctx!.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.02);
  }
  tone(523, 0, 0.1);
  tone(659, 0.1, 0.1);
  tone(784, 0.2, 0.15);
}

export function playTicketScan(volume = 0.5) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.1);
  gain.gain.setValueAtTime(volume * 0.3, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/* ── Voix synthétique (Web Speech API) ──────────────────────── */
let lastSpokenPostes = new Map<string, string>();

export function speakAlert(text: string, volume = 0.5) {
  if (!('speechSynthesis' in window)) return;
  // avoid interrupting if already speaking the same message
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 0.9;
  utterance.pitch = 1.05;
  utterance.volume = Math.min(1, Math.max(0, volume * 2));
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function speakWarning(posteName: string, minutesLeft: number, volume = 0.5) {
  const mins = minutesLeft <= 1 ? '1 minute' : `${minutesLeft} minutes`;
  speakAlert(`${posteName}… il reste ${mins}`, volume);
}

export function speakExpired(posteName: string, volume = 0.5) {
  speakAlert(`${posteName}… session terminée`, volume);
}

export function isSpeechSupported() {
  return 'speechSynthesis' in window;
}

/* ── Son personnalisé (fichier audio uploadé) ────────────────── */
const customAudioCache = new Map<string, HTMLAudioElement>();

export function playCustomSound(dataUrl: string, volume = 0.5) {
  try {
    let audio = customAudioCache.get(dataUrl);
    if (!audio) {
      audio = new Audio(dataUrl);
      customAudioCache.set(dataUrl, audio);
    }
    audio.currentTime = 0;
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(() => {});
  } catch { /* silent fail */ }
}
