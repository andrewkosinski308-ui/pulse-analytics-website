let lastScroll = 0;

const header = document.querySelector("header");

if (header) {
    window.addEventListener("scroll", () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll <= 0) {
            header.classList.remove("header-hidden");
            lastScroll = 0;
            return;
        }

        if (currentScroll > lastScroll) {
            header.classList.add("header-hidden");
        } else {
            header.classList.remove("header-hidden");
        }

        lastScroll = currentScroll;
    });
}

const backToTop = document.getElementById("backToTop");

if (backToTop) {
    backToTop.addEventListener("click", function () {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });
}

/**
 * Inject Client Portal entry next to the cart icon using existing header structure.
 */
(function injectClientPortalEntry() {
    if (document.getElementById("client-portal-entry")) return;

    const cart = document.querySelector(".header-cart");
    if (!cart || !cart.parentElement) return;

    const stylesLink = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
    const rootPrefix = stylesLink
        ? stylesLink.getAttribute("href").replace(/styles\.css.*$/i, "")
        : "";

    if (!document.querySelector('link[href*="client-portal.css"]')) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = rootPrefix + "client-portal.css";
        document.head.appendChild(css);
    }

    let actions = document.querySelector(".header-actions");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "header-actions";
        cart.parentElement.insertBefore(actions, cart);
        actions.appendChild(cart);
    }

    const portal = document.createElement("div");
    portal.className = "header-portal";
    portal.id = "client-portal-entry";

    const link = document.createElement("a");
    link.id = "client-portal-link";
    link.href = rootPrefix + "client-login.html";
    link.setAttribute("aria-label", "Client Portal sign in");
    link.title = "Client Portal";
    link.innerHTML =
        '<i class="fa-solid fa-user-lock" aria-hidden="true"></i>' +
        '<span class="portal-label">Client Portal</span>';

    portal.appendChild(link);
    actions.insertBefore(portal, cart);

    // Upgrade href to portal when an eligible client session exists.
    const envScript = document.createElement("script");
    envScript.src = rootPrefix + "js/supabase-env.js";
    envScript.onload = function () {
        import(rootPrefix + "js/pulse-auth.js")
            .then(function (mod) {
                return mod.initAuth().then(function () {
                    mod.subscribeAuth(function (authState) {
                        if (mod.isClientPortalEligible(authState)) {
                            link.href = rootPrefix + "client-portal.html";
                            link.setAttribute("aria-label", "Open Client Portal");
                        } else {
                            link.href = rootPrefix + "client-login.html";
                            link.setAttribute("aria-label", "Client Portal sign in");
                        }
                    });
                });
            })
            .catch(function () {
                /* Auth optional on marketing pages if env missing */
            });
    };
    envScript.onerror = function () {
        /* Missing local env — keep login link */
    };
    document.head.appendChild(envScript);
})();
