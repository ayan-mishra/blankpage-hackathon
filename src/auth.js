// Email/password actions shared by the app gate (account.js) and the landing hero (landing.js).

// Where the visitor was headed (e.g. app.html?demo). Email confirmation links land on
// plain app.html, so the intent is remembered in this browser across that round trip.
export const NEXT_KEY = 'somnium.next';
export const rememberNext = path => { try { localStorage.setItem(NEXT_KEY, path); } catch { /* storage blocked: lands on plain app.html */ } };

// Runs one action ('login' | 'signup' | 'reset') and resolves to what happened:
// 'signedIn', 'confirm' (check your email) or 'reset'. Throws the service's error.
// `next` is the page signup should come back to after the confirmation link.
export async function submitAuth(client, action, email, password, next) {
  const redirectTo = new URL('app.html', location.href).href;
  let result;
  if (action === 'reset') {
    result = await client.auth.resetPasswordForEmail(email, { redirectTo });
  } else if (action === 'signup') {
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    rememberNext(next);
    result = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  } else {
    result = await client.auth.signInWithPassword({ email, password });
  }
  if (result.error) throw result.error;
  if (action === 'reset') return 'reset';
  return action === 'signup' && !result.data.session ? 'confirm' : 'signedIn';
}
