import { useEffect, useRef, useState } from 'react';

const defaults = { notifications: false, signature: true };

export function useAttendancePreferences(username) {
  const key = username ? `bwap-attendance:${username}` : '';
  const [stored, setStored] = useState({ key: '', value: defaults });
  const audio = useRef(null);
  const preferences = stored.key === key ? stored.value : defaults;
  useEffect(() => {
    if (!key) return;
    let value = defaults;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      value = { notifications: saved.notifications === true, signature: saved.signature !== false };
    } catch {}
    setStored({ key, value });
  }, [key]);
  const unlock = async () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!audio.current || audio.current.state === 'closed') audio.current = new Audio();
    if (audio.current.state === 'suspended') await audio.current.resume();
    return audio.current;
  };
  useEffect(() => {
    if (!preferences.notifications) return;
    const resume = () => { unlock().catch(() => {}); };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => { window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); };
  }, [preferences.notifications]);
  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);
  const playNotification = async () => {
    if (!preferences.notifications) return;
    const context = await unlock();
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = start + index * 0.15;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + 0.14);
    });
  };
  const togglePreference = (name) => {
    if (!key) return;
    const value = { ...preferences, [name]: !preferences[name] };
    setStored({ key, value });
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    if (name === 'notifications' && value.notifications) unlock().catch(() => {});
  };
  return { preferences, togglePreference, playNotification };
}
