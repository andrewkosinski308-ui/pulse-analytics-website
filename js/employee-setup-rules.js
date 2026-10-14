/**
 * Employee invitation and password-recovery checks.
 * These read an already loaded auth state. They do not grant a role.
 */

export const EMPLOYEE_SETUP_PAGE = "employee-setup.html";
export const EMPLOYEE_WORKSPACE_PAGE = "staff-workspace.html";
export const EMPLOYEE_SETUP_REDIRECT = "https://pulseanalyticsgroupllc.com/employee-setup.html";

const INVALID_LINK = "This invitation link is invalid or has expired. Ask an administrator to send a new invitation.";
const NOT_EMPLOYEE = "This page is only for an active employee account. Ask an administrator for help.";
const PROFILE_UNAVAILABLE = "This employee account could not be verified. Ask an administrator for help.";

export const EMPLOYEE_RECOVERY_MESSAGE = "If an employee account exists for that email, a password setup link has been sent. Check your inbox and spam folder.";

export function passwordSetupError(password, confirm) {
  const next = String(password ?? "");
  if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
    return "Use at least 8 characters with a letter and a number.";
  }
  if (next !== String(confirm ?? "")) return "Passwords do not match.";
  return "";
}

export function passwordSaveAllowed({ ready, saving } = {}) {
  return ready === true && saving !== true;
}

export function recoveryRequestAllowed({ sending } = {}) {
  return sending !== true;
}

/**
 * Password setup is allowed only for an authenticated, active employee.
 * A missing session or any other role stays on this page.
 */
export function employeeInvitationGate(authState) {
  if (authState?.authenticated && (authState.error || !authState.profile)) {
    return { ok: false, message: PROFILE_UNAVAILABLE };
  }
  if (!authState?.authenticated || !authState.profile) {
    return { ok: false, message: INVALID_LINK };
  }
  if (authState.profile.role !== "employee" || authState.profile.is_active === false) {
    return { ok: false, message: NOT_EMPLOYEE };
  }
  return { ok: true, message: "" };
}

/** A failed Auth redirect must not be treated as a usable session. */
export function recoveryCallbackFailure(href) {
  let url;
  try {
    url = new URL(String(href || ""));
  } catch {
    return true;
  }
  const sources = [url.searchParams];
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash) sources.push(new URLSearchParams(hash));
  return sources.some((params) => params.get("error") || params.get("error_code") || params.get("error_description"));
}

/**
 * Decide whether this page may show the password form.
 * URL role, email, and user id parameters are ignored.
 * A callback error blocks password setup even when another session is present.
 */
export function employeeSetupAccess(authState, href) {
  if (recoveryCallbackFailure(href)) {
    return { ok: false, message: INVALID_LINK, allowRecoveryRequest: true };
  }
  const gate = employeeInvitationGate(authState);
  return {
    ok: gate.ok,
    message: gate.message,
    allowRecoveryRequest: !gate.ok && !authState?.authenticated
  };
}

/** Where an employee goes after the password is saved. Never the admin login. */
export function employeeSetupDestination(authState) {
  const gate = employeeInvitationGate(authState);
  if (!gate.ok) return "";
  return EMPLOYEE_WORKSPACE_PAGE;
}

/** Plan a recovery email. The message is the same whether or not the address exists. */
export function employeeRecoveryRequest(email) {
  const trimmed = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { error: "Enter a valid email address." };
  }
  return {
    email: trimmed,
    redirectTo: EMPLOYEE_SETUP_REDIRECT,
    message: EMPLOYEE_RECOVERY_MESSAGE
  };
}
