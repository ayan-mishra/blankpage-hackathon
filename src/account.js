import { normalizeRules, checklistName } from './checklists.js';

// Where the visitor was headed (e.g. app.html?demo). Email confirmation links land on
// plain app.html, so the intent is remembered in this browser across that round trip.
const NEXT_KEY = 'somnium.next';
const here = () => location.pathname + location.search;
function takeIntent() {
  let next = null;
  try { next = localStorage.getItem(NEXT_KEY); localStorage.removeItem(NEXT_KEY); } catch { /* storage blocked */ }
  if (location.search || !next) return new URLSearchParams(location.search);
  const url = new URL(next, location.href);
  if (url.origin !== location.origin) return new URLSearchParams();
  if (url.pathname !== location.pathname) { location.replace(url.href); return null; }
  history.replaceState(null, '', url.pathname + url.search + location.hash);
  return url.searchParams;
}

// The app pages are gated: #gate (sign in / create account / reset) shows until there is
// a session, then #appShell. onSignedIn gets the page's query intent on the first sign-in.
export function mountAccount(client, { getRules, setRules, onSignedIn, onSignedOut } = {}) {
  const $ = id => document.getElementById(id);
  const status = (message, error = false) => document.querySelectorAll('.account-status').forEach(el => {
    el.textContent = message;
    el.classList.toggle('error', error);
  });
  if (!client) {
    status('Accounts are not configured on this copy of Somnium, so the app can’t open. Whoever runs this site needs to add its Supabase URL and publishable key.', true);
    return;
  }
  const cloud = $('cloud'); // saved checklists live only on app.html
  let session = null, recovery = false, busy = false, ready = false, generation = 0, intent = undefined;
  let saved = [];
  const redirectTo = new URL('app.html', location.href).href;
  function render() {
    const inside = !!session && !recovery;
    $('gate').hidden = inside;
    $('appShell').hidden = !inside;
    $('authForm').hidden = !ready || !!session;
    $('recoveryForm').hidden = !recovery || !session;
    $('accountEmail').textContent = session?.user.email ?? '';
    document.querySelectorAll('#gate button, #signOut').forEach(button => { button.disabled = busy; });
    if (!cloud) return;
    cloud.hidden = !session || recovery;
    $('savedChecklists').replaceChildren(...saved.map(item => Object.assign(document.createElement('option'), { value: item.id, textContent: item.name })));
    for (const id of ['savedChecklists', 'loadChecklist', 'deleteChecklist']) $(id).disabled = !saved.length || busy;
    $('saveChecklist').disabled = busy;
    $('refreshChecklists').disabled = busy;
  }
  async function refreshSaved(version) {
    const { data, error } = await client.from('checklists').select('id,name,created_at').order('created_at', { ascending: false });
    if (version !== generation) return;
    if (error) throw error;
    saved = data;
    render();
  }
  async function run(action) {
    if (busy) return;
    busy = true; render(); status('Working…');
    const version = generation;
    try { await action(version); }
    catch (error) { if (version === generation) status(error.message || 'Request failed. Please try again.', true); }
    finally { busy = false; render(); }
  }
  client.auth.onAuthStateChange((event, next) => {
    const changed = session?.user.id !== next?.user.id;
    session = next;
    ready = true;
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (!session) recovery = false;
    if (changed || event === 'INITIAL_SESSION') {
      generation++;
      saved = [];
      status(session ? (recovery ? 'Choose a new password.' : 'Loading your checklists…') : 'Sign in or create an account to open Somnium.');
      const version = generation;
      // Run database requests and page work outside the auth callback so token refresh can finish.
      setTimeout(() => {
        if (version !== generation) return;
        if (!session) { onSignedOut?.(); return; }
        if (intent === undefined) intent = takeIntent();
        if (intent === null) return; // redirecting to the page the visitor started from
        onSignedIn?.(intent);
        intent = new URLSearchParams(); // the ?demo intent runs once per page load
        if (!cloud) { status(''); return; }
        refreshSaved(version).then(() => {
          if (version === generation) status(recovery ? 'Choose a new password.' : 'Your checklists are private to your account.');
        }).catch(() => { if (version === generation) status('Could not load checklists. Use Refresh to retry.', true); });
      }, 0);
    }
    render();
  });
  $('authForm').onsubmit = event => {
    event.preventDefault();
    const action = event.submitter?.value ?? 'login';
    run(async () => {
      const email = $('email').value.trim(), password = $('password').value;
      let result;
      if (action === 'reset') {
        result = await client.auth.resetPasswordForEmail(email, { redirectTo });
      } else if (action === 'signup') {
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
        try { localStorage.setItem(NEXT_KEY, here()); } catch { /* storage blocked: lands on plain app.html */ }
        result = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      } else {
        result = await client.auth.signInWithPassword({ email, password });
      }
      if (result.error) throw result.error;
      $('password').value = '';
      if (action === 'reset') status('If that address has an account, a password reset email is on its way.');
      else if (action === 'signup' && !result.data.session) status('Check your email and click the link to confirm your account. It brings you back here, signed in.');
    });
  };
  $('forgotPassword').onclick = () => { $('password').required = false; };
  for (const id of ['login', 'signup']) $(id).onclick = () => { $('password').required = true; };
  $('signOut').onclick = () => run(async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    status('Signed out.');
  });
  $('recoveryForm').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const { error } = await client.auth.updateUser({ password: $('newPassword').value });
      if (error) throw error;
      $('newPassword').value = ''; recovery = false;
      status('Password updated.');
    });
  };
  render();
  if (!cloud) return;
  $('refreshChecklists').onclick = () => run(async version => { await refreshSaved(version); if (version === generation) status('Checklists refreshed.'); });
  $('saveForm').onsubmit = event => {
    event.preventDefault();
    const user = session?.user;
    if (!user) return;
    run(async version => {
      const name = checklistName($('checklistName').value);
      const rules = normalizeRules(getRules());
      const { error } = await client.from('checklists').insert({ user_id: user.id, name, rules });
      if (version !== generation) return;
      if (error) throw error;
      await refreshSaved(version);
      if (version === generation) status('Checklist saved.');
    });
  };
  $('loadChecklist').onclick = () => {
    const id = $('savedChecklists').value;
    run(async version => {
      const { data, error } = await client.from('checklists').select('rules').eq('id', id).single();
      if (version !== generation) return;
      if (error) throw error;
      // Loading is explicit; never replace work silently during login or refresh.
      if (!confirm('Replace the current checklist with this saved checklist?')) { status('Current checklist kept.'); return; }
      setRules(normalizeRules(data.rules)); status('Checklist loaded.');
    });
  };
  $('deleteChecklist').onclick = () => {
    const id = $('savedChecklists').value;
    if (!confirm('Delete this saved checklist? The current checklist will stay in this tab.')) return;
    run(async version => {
      const { data, error } = await client.from('checklists').delete().eq('id', id).select('id');
      if (version !== generation) return;
      if (error) throw error;
      if (!data.length) throw new Error('This checklist no longer exists. Refresh the list.');
      await refreshSaved(version);
      if (version === generation) status('Saved checklist deleted.');
    });
  };
}
