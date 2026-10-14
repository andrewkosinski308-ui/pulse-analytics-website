/**
 * Role routing for the shared Admin / Staff Portal.
 * These checks read an already loaded auth state. They do not grant access.
 * Supabase RLS remains the data boundary.
 */

function roleOf(authState) {
  return authState?.profile?.role || "";
}

function isActive(authState) {
  return authState?.profile?.is_active !== false;
}

/** Active administrator. Employees and clients are not administrators. */
export function isAdminPortalEligible(authState) {
  return Boolean(
    authState?.authenticated &&
      roleOf(authState) === "admin" &&
      isActive(authState)
  );
}

/** Active administrator or employee. Clients are not portal staff. */
export function isAdminStaffPortalEligible(authState) {
  const role = roleOf(authState);
  return Boolean(
    authState?.authenticated &&
      isActive(authState) &&
      (role === "admin" || role === "employee")
  );
}

/**
 * Where a signed-in user leaves the shared login.
 * Null means the visitor is signed out and the login form stays.
 */
export function loginRedirectDestination(authState) {
  if (!authState?.authenticated) return null;
  if (isAdminStaffPortalEligible(authState)) return "admin-portal.html";
  return "admin-unauthorized.html";
}

/**
 * Active staff who reach client sign-in keep the session and go to their staff portal.
 * Inactive staff and other non-clients are not given that destination.
 */
export function clientLoginStaffDestination(authState) {
  if (!authState?.authenticated) return null;
  const role = roleOf(authState);
  if (role !== "admin" && role !== "employee") return null;
  if (!isActive(authState)) return null;
  return loginRedirectDestination(authState);
}

/**
 * Where a protected portal page must send this session.
 * Null means the page may render.
 * @param {'admin' | 'staff'} page
 */
export function portalGuardDestination(authState, page) {
  if (!authState?.authenticated) return "admin-login.html";
  if (page === "admin") {
    if (isAdminStaffPortalEligible(authState)) return null;
    return "admin-unauthorized.html";
  }
  if (isAdminStaffPortalEligible(authState)) return null;
  return "admin-unauthorized.html";
}
