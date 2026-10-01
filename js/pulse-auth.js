/**
 * Pulse Analytics — shared Supabase Auth for the static site.
 * The Client Portal and the Admin Portal both use this module:
 * one Supabase client, one persisted session, and profiles.role for authorization.
 * Uses the publishable anon key only. RLS remains the authorization authority.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { ONBOARDING_PAGES } from './onboarding-catalog.js';
import {
  isAdminPortalEligible as adminEligible,
  isAdminStaffPortalEligible as staffPortalEligible,
  loginRedirectDestination,
  portalGuardDestination
} from './portal-guard.js';

export { loginRedirectDestination, portalGuardDestination };

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

/** Preference only — never a password or token. '0' means end an admin or employee portal session with the browser tab. */
const ADMIN_PERSIST_KEY = 'pulse-admin-persist';
const ADMIN_TAB_KEY = 'pulse-admin-tab';
const ACCESS_COOKIE = 'pulse-access';

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
    .select('id, name, website, industry, status, onboarding_step')
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
  writeAccessCookie(session);
}

function writeAccessCookie(session) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (!session?.access_token) {
    document.cookie = `${ACCESS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    return;
  }
  const maxAge = Math.max(120, Number(session.expires_at || 0) - Math.floor(Date.now() / 1000));
  document.cookie = `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
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
      authState.profile?.is_active !== false &&
      Number(authState.client?.onboarding_step) === 5
  );
}

export function onboardingResumePath(authState = getAuthState()) {
  const step = Number(authState.client?.onboarding_step);
  return ONBOARDING_PAGES[step] || ONBOARDING_PAGES[1];
}

/** Portal for a finished client, the current onboarding step for an unfinished client, or null. */
export function clientEntryPath(authState = getAuthState()) {
  if (isClientPortalEligible(authState)) return '/client-portal.html';
  if (
    authState.authenticated &&
    authState.profile?.role === 'client' &&
    authState.profile?.is_active !== false &&
    authState.client?.id &&
    Number(authState.client?.onboarding_step) < 5
  ) {
    return onboardingResumePath(authState);
  }
  return null;
}

function signupFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('already') || error?.code === 'user_already_exists') {
    return 'An account with this email already exists. Sign in to continue.';
  }
  if (message.includes('password')) return 'Choose a stronger password.';
  if (message.includes('email') || message.includes('invalid')) return 'Enter a valid email address.';
  return 'We could not create the account. Try again.';
}

/**
 * Create the Supabase auth user. The database trigger creates the client record.
 * Returns needsEmailConfirmation when Auth withholds a session until the mailbox is confirmed.
 */
export async function signUpClient({ fullName, email, password }) {
  const client = getSupabase();
  const { data, error } = await client.auth.signUp({
    email: String(email).trim(),
    password,
    options: {
      data: {
        full_name: String(fullName).trim(),
        signup_intent: 'portal_client'
      },
      emailRedirectTo: `${getSiteOriginBase()}/account/business`
    }
  });
  if (error) throw new Error(signupFailure(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('An account with this email already exists. Sign in to continue.');
  }
  if (!data.session) {
    return { needsEmailConfirmation: true, email: String(email).trim() };
  }
  await applySession(data.session, 'SIGNED_IN');
  state.loading = false;
  notify();
  return { needsEmailConfirmation: false, auth: getAuthState() };
}

/** Active administrator on the existing profiles.role column. Employees and clients are not administrators. */
export function isAdminPortalEligible(authState = getAuthState()) {
  return adminEligible(authState);
}

/** Active administrator or employee for the shared Admin / Staff Portal. */
export function isAdminStaffPortalEligible(authState = getAuthState()) {
  return staffPortalEligible(authState);
}

export function getAdminPersistPreference() {
  try {
    return localStorage.getItem(ADMIN_PERSIST_KEY) !== '0';
  } catch (_) {
    return true;
  }
}

/**
 * Remember-me uses the existing Supabase localStorage session.
 * Unchecked: the same session ends when this browser tab session ends.
 */
export function setAdminPersistPreference(remember) {
  try {
    localStorage.setItem(ADMIN_PERSIST_KEY, remember ? '1' : '0');
    if (remember) sessionStorage.removeItem(ADMIN_TAB_KEY);
    else sessionStorage.setItem(ADMIN_TAB_KEY, '1');
  } catch (_) {
    /* Storage unavailable; the shared Supabase session still applies. */
  }
}

/**
 * Signs out an administrator or employee who chose not to keep the portal session, once the tab session is gone.
 * Does not sign out client accounts.
 * @returns {Promise<boolean>} true when an admin session was ended
 */
export async function enforceAdminPersistPreference() {
  let remember = true;
  let tabAlive = false;
  try {
    remember = localStorage.getItem(ADMIN_PERSIST_KEY) !== '0';
    tabAlive = sessionStorage.getItem(ADMIN_TAB_KEY) === '1';
  } catch (_) {
    return false;
  }
  if (remember || tabAlive) return false;
  const role = getAuthState().profile?.role;
  if (role !== 'admin' && role !== 'employee') return false;
  await signOut();
  return true;
}

async function establishSession(email, password) {
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
  return getAuthState();
}

async function assertClientPortalAccess(current) {
  if (!current.profile) {
    const message = current.error || 'Your account profile was not found.';
    await signOut();
    throw new Error(message);
  }

  if (current.profile.role !== 'client') {
    await signOut();
    const role = current.profile.role;
    if (role === 'admin') {
      throw new Error(
        'This account is an administrator account. Sign in through the Admin Portal.'
      );
    }
    if (role === 'employee') {
      throw new Error(
        'This account is a staff account. Open the staff file workspace instead of the Client Portal.'
      );
    }
    throw new Error('This account is not authorized for the Client Portal.');
  }

  if (current.profile.is_active === false) {
    await signOut();
    throw new Error('This client account is inactive. Contact Pulse Analytics support.');
  }

  if (!current.client) {
    await signOut();
    throw new Error(
      'Your login succeeded, but no client organization is linked to this account. Contact Pulse Analytics support.'
    );
  }

  return current;
}

/** Same people who may open Staff Workspace: active administrators and employees. */
export function isStaffWorkspaceEligible(authState = getAuthState()) {
  return isAdminStaffPortalEligible(authState);
}

async function assertAdminStaffPortalAccess(current) {
  if (!current.profile) {
    const message = current.error || 'Your account profile was not found.';
    await signOut();
    throw new Error(message);
  }
  if ((current.profile.role === 'admin' || current.profile.role === 'employee') && current.profile.is_active === false) {
    await signOut();
    throw new Error('This staff account is inactive.');
  }
  if (current.profile.role === 'client') {
    throw new Error('This account is a client account. The Admin / Staff Portal is for Pulse Analytics staff.');
  }
  if (!isAdminStaffPortalEligible(current)) {
    await signOut();
    throw new Error('This account is not authorized for the Admin / Staff Portal.');
  }
  return current;
}

async function assertAdminPortalAccess(current) {
  if (!current.profile) {
    const message = current.error || 'Your account profile was not found.';
    await signOut();
    throw new Error(message);
  }

  if (current.profile.role === 'admin' && current.profile.is_active === false) {
    await signOut();
    throw new Error('This administrator account is inactive. Contact Pulse Analytics support.');
  }

  if (!isAdminPortalEligible(current)) {
    if (current.profile.role === 'client') {
      throw new Error(
        'This account is a client account. The Admin Portal is for administrators only.'
      );
    }
    throw new Error('This account is not authorized for the Admin Portal.');
  }

  return current;
}

/**
 * Sign in with the shared Supabase Auth client.
 * @param {'client' | 'admin' | 'portal'} [portal='client'] Client Portal rules stay the default.
 * `portal` admits an active administrator or employee. `admin` remains administrator-only.
 */
export async function signIn(email, password, portal = 'client') {
  const current = await establishSession(email, password);
  if (portal === 'admin') return assertAdminPortalAccess(current);
  if (portal === 'portal') return assertAdminStaffPortalAccess(current);
  return assertClientPortalAccess(current);
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

export async function resetPassword(email, redirectPage = 'client-update-password.html') {
  const client = getSupabase();
  const redirectTo = authPageUrl(redirectPage);
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
  const loginHref = '/client-login.html';

  return initAuth().then((authState) => {
    if (authState.loading) return authState;
    const destination = clientEntryPath(authState);
    if (destination && destination !== '/client-portal.html') {
      window.location.replace(destination);
      return null;
    }
    if (!isClientPortalEligible(authState)) {
      window.location.replace(loginHref);
      return null;
    }
    return authState;
  });
}

export function redirectAuthenticatedClientAwayFromLogin() {
  return initAuth().then((authState) => {
    const destination = clientEntryPath(authState);
    if (destination) {
      window.location.replace(destination);
      return null;
    }
    return authState;
  });
}

function adminPage(filename) {
  return `${getSiteRootPrefix()}${filename}`;
}

function leaveFor(destination) {
  if (!destination) return false;
  window.location.replace(adminPage(destination));
  return true;
}

/** No session → shared login. Employee → Staff Workspace. Other non-admins → access denied. Active admin → allow. */
export async function requireAdminPortal() {
  await initAuth();
  const ended = await enforceAdminPersistPreference();
  const current = getAuthState();
  const destination = ended ? 'admin-login.html' : portalGuardDestination(current, 'admin');
  if (leaveFor(destination)) return null;
  return current;
}

/** Shared Admin / Staff Portal gate. Administrators and employees may continue. */
export async function requireAdminStaffPortal() {
  await initAuth();
  const ended = await enforceAdminPersistPreference();
  const current = getAuthState();
  const destination = ended ? 'admin-login.html' : portalGuardDestination(current, 'staff');
  if (leaveFor(destination)) return null;
  return current;
}

/** Active admin or employee leaves the login page for their portal. A client session is denied, without ending it. */
export async function redirectAuthenticatedAdminFromLogin() {
  await initAuth();
  const ended = await enforceAdminPersistPreference();
  if (ended) return getAuthState();
  const destination = loginRedirectDestination(getAuthState());
  if (leaveFor(destination)) return null;
  return getAuthState();
}
