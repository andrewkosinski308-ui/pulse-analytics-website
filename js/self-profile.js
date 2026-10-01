import { getAuthState, getSupabase, updateEmail } from "./pulse-auth.js";
import {
  emailChangeRequest,
  esc,
  personalFieldsHtml,
  personalPayload,
  readPersonalForm
} from "./account-profile.js";

export async function mountSelfProfile(container, showAlert, { employment = false } = {}) {
  const user = getAuthState().user;
  if (!container || !user) return;
  const loaded = await getSupabase()
    .from("profiles")
    .select("first_name,last_name,full_name,phone,timezone,notification_preferences,role,job_title,department,started_on,ended_on")
    .eq("id", user.id)
    .maybeSingle();
  if (loaded.error || !loaded.data) {
    container.innerHTML = `<p class="portal-empty">Your profile could not be loaded.</p>`;
    return;
  }
  const profile = loaded.data;
  const employmentHtml = employment && profile.role === "employee"
    ? `<article class="portal-card portal-card-static"><h3>Employment</h3><dl>
        <div><dt>Job title</dt><dd>${esc(profile.job_title || "—")}</dd></div>
        <div><dt>Department</dt><dd>${esc(profile.department || "—")}</dd></div>
        <div><dt>Started on</dt><dd>${esc(profile.started_on || "—")}</dd></div>
        <div><dt>Ended on</dt><dd>${esc(profile.ended_on || "—")}</dd></div>
      </dl><p>An administrator manages these fields.</p></article>`
    : "";
  container.innerHTML = `<form id="self-email" class="portal-form portal-card portal-card-static">
      <h3>Email</h3>
      <p>Supabase sends a confirmation before your sign-in email changes.</p>
      <label>Email<input name="email" type="email" required value="${esc(user.email || "")}"></label>
      <button class="secondary-button" type="submit">Update email</button>
    </form>
    <form id="self-profile" class="portal-form portal-card portal-card-static">
      <h3>Personal information</h3>
      ${personalFieldsHtml(profile)}
      <button class="primary-button" type="submit">Save personal information</button>
    </form>
    ${employmentHtml}`;
  container.querySelector("#self-email")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const requested = emailChangeRequest(event.currentTarget.email.value);
    if (requested.error) return showAlert(requested.error);
    try {
      await updateEmail(requested.email);
      showAlert("Check your inbox to confirm the new email.", "success");
    } catch (error) {
      showAlert(error.message || "The email change could not be started.");
    }
  });
  container.querySelector("#self-profile")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = personalPayload(readPersonalForm(event.currentTarget));
    if (!payload.full_name) return showAlert("Enter your name.");
    const updated = await getSupabase().from("profiles").update(payload).eq("id", user.id);
    if (updated.error) return showAlert("Personal information could not be saved.");
    showAlert("Personal information saved.", "success");
  });
}
