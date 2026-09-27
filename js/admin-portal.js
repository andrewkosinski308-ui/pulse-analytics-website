/**
 * Admin Portal shell only.
 * Sign-in, session, role checks, and sign-out stay in pulse-auth.js.
 */

export function renderAdminIdentity(authState) {
  const email = authState?.profile?.email || authState?.user?.email || '';
  const fullName = authState?.profile?.full_name?.trim() || '';
  const nameEl = document.getElementById('admin-user-name');
  const emailEl = document.getElementById('admin-user-email');
  if (!nameEl || !emailEl) return;

  const label = fullName || email || 'Administrator';
  nameEl.textContent = label;
  emailEl.textContent = email;
  emailEl.hidden = !email || email === label;
}

export { bindPasswordToggle } from './auth-scene.js';

export function bindAdminChrome() {
  const sidebar = document.getElementById('admin-sidebar');
  const toggle = document.getElementById('admin-menu-toggle');
  const backdrop = document.getElementById('admin-backdrop');

  function setSidebar(open) {
    if (!sidebar || !toggle) return;
    sidebar.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (backdrop) backdrop.hidden = !open;
    document.body.classList.toggle('admin-nav-open', open);
  }

  toggle?.addEventListener('click', () => {
    setSidebar(!sidebar.classList.contains('is-open'));
  });

  backdrop?.addEventListener('click', () => setSidebar(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSidebar(false);
  });

  document.querySelectorAll('.admin-nav-link.is-soon').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
    });
  });

  document.getElementById('nav-dashboard')?.addEventListener('click', () => {
    const dashboard = document.getElementById('admin-dashboard');
    if (dashboard) dashboard.focus();
    setSidebar(false);
  });
}
