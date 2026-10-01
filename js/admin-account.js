import { mountSelfProfile } from "./self-profile.js";

function note(message, kind) {
  const slot = document.getElementById("admin-account-note");
  if (!slot) return;
  slot.hidden = !message;
  slot.textContent = message || "";
  slot.className = kind === "success" ? "admin-clients-note" : "admin-clients-note";
}

export function mountAdminAccount() {
  const root = document.getElementById("admin-account");
  const nav = document.getElementById("nav-account");
  const dashboard = document.getElementById("admin-dashboard");
  if (!root || !nav) return;

  function hideOthers() {
    ["admin-clients", "admin-projects", "admin-employees"].forEach((id) => {
      const section = document.getElementById(id);
      if (section) section.hidden = true;
    });
    ["nav-clients", "nav-projects", "nav-employees", "nav-dashboard"].forEach((id) => {
      const button = document.getElementById(id);
      button?.classList.remove("is-current");
      button?.removeAttribute("aria-current");
    });
    if (dashboard) dashboard.hidden = true;
  }

  function hideSelf() {
    root.hidden = true;
    nav.classList.remove("is-current");
    nav.removeAttribute("aria-current");
  }

  function showAccount() {
    hideOthers();
    root.hidden = false;
    nav.classList.add("is-current");
    nav.setAttribute("aria-current", "page");
    root.innerHTML = `<div class="admin-clients-head"><h1 id="admin-account-title">Account</h1></div>
      <p id="admin-account-note" class="admin-clients-note" role="status" hidden></p>
      <div id="admin-account-body"></div>`;
    mountSelfProfile(document.getElementById("admin-account-body"), note).catch(() => note("Your profile could not be loaded."));
    root.focus();
  }

  nav.addEventListener("click", showAccount);
  ["nav-dashboard", "nav-clients", "nav-projects", "nav-employees"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", hideSelf);
  });
}
