/**
 * Pulse Analytics — central Supabase Auth + client context for the static site.
 * Uses the publishable anon key only. RLS remains the authorization authority.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

/** @typedef {'admin' | 'employee' | 'client'} AppRole */

/** @typedef {{
 *   user: import('@supabase/supabase-js').User | null,
 *   session: import('@supabase/supabase-js').Session | null,
 *   profile: object | null,
 *   membership: object | null,
 *   client: object | null,
 *   loading: boolean,
 *   authenticated: boolean,
 *   authEvent: string | null,
 *   error: string | null
 * }} AuthState */

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabase = null;

/** @type {AuthState} */
let state = {
  user: null,
  session: null,
  profile: null,
  membership: null,
  client: null,
  loading: true,
  authenticated: false,
  authEvent: null,
  error: null
};

/** @type {Set<(s: AuthState) => void>} */
const listeners = new Set();

let initPromise = null;
let handlingAuthChange = false;

function getConfig() {
  const cfg = window.PULSE_SUPABASE;
  if (!cfg?.url || !cfg?.anonKey || cfg.anonKey.includes('REPLACE_WITH')) {
    throw new Error(
      'Supabase is not configured. Copy js/supabase-env.example.js to js/supabase-env.js and set your publishable anon key.'
    );
  }
  return cfg;
}

export function getSiteRootPrefix() {
  const link = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
  if (!link) return '';
  return link.getAttribute('href').replace(/styles\.css.*$/i, '');
}

export function getSiteOriginBase() {
  const cfg = window.PULSE_SUPABASE || {};
  if (cfg.siteUrl && String(cfg.siteUrl).trim()) {
    return String(cfg.siteUrl).replace(/\/$/, '');
  }
  return window.location.origin;
}

export function authPageUrl(filename) {
  return `${getSiteOriginBase()}/${filename.replace(/^\//, '')}`;
}

function notify() {
  const snapshot = getAuthState();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (_) {
      /* ignore subscriber errors */
    }
  });
}

export function getAuthState() {
  return {
    user: state.user,
    session: state.session,
    profile: state.profile,
    membership: state.membership,
    client: state.client,
    loading: state.loading,
    authenticated: state.authenticated,
    authEvent: state.authEvent,
    error: state.error
  };
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  listener(getAuthState());
  return () => listeners.delete(listener);
}

export function getSupabase() {
  if (!supabase) {
    throw new Error('Auth not initialized. Call initAuth() first.');
  }
  return supabase;
}

async function clearClientContext() {
  state.profile = null;
  state.membership = null;
  state.client = null;
}

/**
 * Load profile + client membership from PostgREST under RLS.
 * Does not create profiles.
 */
export async function loadClientContext() {
  if (!state.user) {
    await clearClientContext();
    return { profile: null, membership: null, client: null };
  }

  const client = getSupabase();
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, email, full_name, role, phone, avatar_url, is_active')
    .eq('id', state.user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message || 'Unable to load profile.');
  }
  if (!profile) {
    throw new Error('Your account profile was not found. Contact Pulse Analytics support.');
  }

  state.profile = profile;

  if (profile.role !== 'client') {
    state.membership = null;
    state.client = null;
    return { profile, membership: null, client: null };
  }

  const { data: membershipRows, error: memberError } = await client
    .from('client_members')
    .select('id, client_id, member_role, created_at')
    .eq('profile_id', state.user.id)
    .order('created_at', { ascending: true })
    .limit(1);

  if (memberError) {
    throw new Error(memberError.message || 'Unable to load client membership.');
  }

  const membership = membershipRows?.[0] ?? null;
  state.membership = membership;

  if (!membership) {
    state.client = null;
    return { profile, membership: null, client: null };
  }

  const { data: clientRow, error: clientError } = await client
    .from('clients')
    .select('id, name, website, industry, status')
    .eq('id', membership.client_id)
    .maybeSingle();

  if (clientError) {
    throw new Error(clientError.message || 'Unable to load client organization.');
  }

  state.client = clientRow;
  return { profile, membership, client: clientRow };
}

async function applySession(session, eventName) {
  state.session = session;
  state.user = session?.user ?? null;
  state.authenticated = Boolean(session?.user);
  state.authEvent = eventName || null;
  state.error = null;

  if (session?.user) {
    try {
      await loadClientContext();
    } catch (err) {
      state.error = err?.message || 'Failed to load account context.';
      await clearClientContext();
    }
  } else {
    await clearClientContext();
  }
}

export function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cfg = getConfig();
    supabase = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });

    // IMPORTANT: never await other Supabase calls directly inside onAuthStateChange.
    // That deadlocks the auth lock (session stays loading forever).
    supabase.auth.onAuthStateChange((event, session) => {
      state.authEvent = event;
      state.session = session;
      state.user = session?.user ?? null;
      state.authenticated = Boolean(session?.user);

      window.setTimeout(async () => {
        if (handlingAuthChange) return;
        handlingAuthChange = true;
        state.loading = true;
        notify();
        try {
          await applySession(session, event);
        } finally {
          state.loading = false;
          handlingAuthChange = false;
          notify();
        }
      }, 0);
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      state.error = error.message;
    }
    state.loading = true;
    notify();
    await applySession(data.session, 'INITIAL_SESSION');
    state.loading = false;
    notify();
    return getAuthState();
  })();

  return initPromise;
}

export function isClientPortalEligible(authState = getAuthState()) {
  return Boolean(
    authState.authenticated &&
      authState.profile?.role === 'client' &&
      authState.client?.id &&
      authState.profile?.is_active !== false
  );
}

export async function signIn(email, password) {
  const client = getSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email).trim(),
    password
  });
  if (error) {
    throw new Error(error.message || 'Sign-in failed.');
  }

  await applySession(data.session, 'SIGNED_IN');
  state.loading = false;
  notify();

  const current = getAuthState();
  if (!current.profile) {
    await client.auth.signOut();
    await applySession(null, 'SIGNED_OUT');
    notify();
    throw new Error(current.error || 'Your account profile was not found.');
  }

  if (current.profile.role !== 'client') {
    await client.auth.signOut();
    await applySession(null, 'SIGNED_OUT');
    notify();
    const role = current.profile.role;
    if (role === 'admin' || role === 'employee') {
      throw new Error(
        'This account is a staff account. The Client Portal is for client users only. Staff dashboards will be available in a future release.'
      );
    }
    throw new Error('This account is not authorized for the Client Portal.');
  }

  if (!current.client) {
    await client.auth.signOut();
    await applySession(null, 'SIGNED_OUT');
    notify();
    throw new Error(
      'Your login succeeded, but no client organization is linked to this account. Contact Pulse Analytics support.'
    );
  }

  return current;
}

export async function signOut() {
  const client = getSupabase();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message || 'Sign-out failed.');
  }
  await applySession(null, 'SIGNED_OUT');
  state.loading = false;
  notify();
}

export async function resetPassword(email) {
  const client = getSupabase();
  const redirectTo = authPageUrl('client-update-password.html');
  const { error } = await client.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo
  });
  if (error) {
    throw new Error(error.message || 'Unable to send reset email.');
  }
  // Always present the same UX message to the caller (no account enumeration).
  return { ok: true, redirectTo };
}

export async function updatePassword(newPassword) {
  const client = getSupabase();
  const { data, error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    throw new Error(error.message || 'Unable to update password.');
  }
  state.authEvent = 'USER_UPDATED';
  state.user = data.user;
  notify();
  return data.user;
}

export function requireClientPortalOrRedirect() {
  const prefix = getSiteRootPrefix();
  const loginHref = `${prefix}client-login.html`;
  const portalHref = `${prefix}client-portal.html`;

  return initAuth().then((authState) => {
    if (authState.loading) return authState;
    if (!isClientPortalEligible(authState)) {
      window.location.replace(loginHref);
      return null;
    }
    return authState;
  });
}

export function redirectAuthenticatedClientAwayFromLogin() {
  const prefix = getSiteRootPrefix();
  const portalHref = `${prefix}client-portal.html`;

  return initAuth().then((authState) => {
    if (isClientPortalEligible(authState)) {
      window.location.replace(portalHref);
      return null;
    }
    return authState;
  });
}
