const KEY = 'somnium.guest';
export const GUEST_OWNER = 'browser-guest';
export const isGuest = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export function setGuest(enabled) {
  if (enabled) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
}
