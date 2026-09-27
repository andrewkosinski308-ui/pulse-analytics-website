/**
 * Shared account-creation background.
 * Sign-in pages and onboarding use this same field. It does not touch sessions.
 */

export function startAuthScene() {
  const canvas = document.getElementById("onboard-field");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = window.matchMedia("(max-width: 860px)").matches;
  if (!canvas || reduce || narrow) return;
  const context = canvas.getContext("2d");
  const orbs = [...document.querySelectorAll(".onboard-orb")];
  const nodes = Array.from({ length: 36 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00035,
    vy: (Math.random() - 0.5) * 0.00035
  }));
  let frame = 0;
  const draw = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    nodes.forEach((node) => {
      node.x = (node.x + node.vx + 1) % 1;
      node.y = (node.y + node.vy + 1) % 1;
    });
    context.strokeStyle = "rgba(174, 182, 191, 0.28)";
    context.fillStyle = "rgba(255, 255, 255, 0.8)";
    nodes.forEach((node, index) => {
      const x = node.x * width;
      const y = node.y * height;
      context.beginPath();
      context.arc(x, y, 1.6, 0, Math.PI * 2);
      context.fill();
      for (let next = index + 1; next < nodes.length; next += 1) {
        const other = nodes[next];
        const dx = (node.x - other.x) * width;
        const dy = (node.y - other.y) * height;
        if (dx * dx + dy * dy < 140 * 140) {
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(other.x * width, other.y * height);
          context.stroke();
        }
      }
    });
    frame = window.requestAnimationFrame(draw);
  };
  const move = (event) => {
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    orbs.forEach((orb, index) => {
      orb.style.transform = `translate3d(${x * (8 + index * 4)}px, ${y * (6 + index * 3)}px, 0)`;
    });
  };
  window.addEventListener("pointermove", move, { passive: true });
  frame = window.requestAnimationFrame(draw);
  window.addEventListener("pagehide", () => window.cancelAnimationFrame(frame), { once: true });
}

export function bindPasswordToggle(input, button, label = "password") {
  if (!input || !button) return;

  button.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    const nowShowing = input.type === "text";
    button.setAttribute("aria-pressed", nowShowing ? "true" : "false");
    button.textContent = nowShowing ? "Hide" : "Show";
    button.setAttribute("aria-label", nowShowing ? `Hide ${label}` : `Show ${label}`);
    input.focus();
  });
}
