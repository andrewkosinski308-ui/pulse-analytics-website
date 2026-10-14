/**
 * Password recovery for an existing employee.
 * Uses the public Auth recovery API. No service-role call.
 */

import { getSupabase } from "./pulse-auth.js";
import { EMPLOYEE_SETUP_REDIRECT } from "./employee-setup-rules.js";

export async function requestEmployeePasswordRecovery(email, redirectTo = EMPLOYEE_SETUP_REDIRECT) {
  if (redirectTo !== EMPLOYEE_SETUP_REDIRECT) {
    throw new Error("Unable to send reset email.");
  }
  const client = getSupabase();
  const { error } = await client.auth.resetPasswordForEmail(String(email || "").trim(), { redirectTo });
  if (error) throw new Error("Unable to send reset email.");
  return { ok: true, redirectTo };
}
