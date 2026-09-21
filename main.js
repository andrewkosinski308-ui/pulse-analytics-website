let lastScroll = 0;

const header = document.querySelector("header");

if (header) {
    window.addEventListener("scroll", () => {
        if (header.classList.contains("nav-open")) {
            header.classList.remove("header-hidden");
            return;
        }

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

/**
 * Mobile navigation toggle and accordion dropdowns (<=992px).
 * Injected so production HTML files do not each need a hamburger button.
 */
(function initMobileNavigation() {
    const headerEl = document.querySelector("header");
    const nav = document.getElementById("primary-navigation");
    if (!headerEl || !nav) return;

    const mobileQuery = window.matchMedia("(max-width: 992px)");

    let actions = document.querySelector(".header-actions");
    const cart = document.querySelector(".header-cart");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "header-actions";
        if (cart && cart.parentElement) {
            cart.parentElement.insertBefore(actions, cart);
            actions.appendChild(cart);
        } else {
            const container = headerEl.querySelector(".container");
            if (!container) return;
            container.appendChild(actions);
        }
    }

    if (document.querySelector(".mobile-menu")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mobile-menu";
    toggle.setAttribute("aria-controls", "primary-navigation");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    toggle.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
    actions.appendChild(toggle);

    const dropdowns = Array.prototype.slice.call(nav.querySelectorAll(".dropdown"));

    dropdowns.forEach(function (dropdown, index) {
        const trigger = dropdown.querySelector(":scope > a");
        const menu = dropdown.querySelector(":scope > .dropdown-menu");
        if (!trigger || !menu) return;

        if (!menu.id) {
            menu.id = "dropdown-menu-" + (index + 1);
        }

        trigger.setAttribute("aria-haspopup", "true");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-controls", menu.id);
    });

    function isMobileNav() {
        return mobileQuery.matches;
    }

    function closeDropdowns() {
        dropdowns.forEach(function (dropdown) {
            dropdown.classList.remove("is-open");
            const trigger = dropdown.querySelector(":scope > a");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        });
    }

    function setMenuOpen(open) {
        headerEl.classList.toggle("nav-open", open);
        document.body.classList.toggle("nav-open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        const icon = toggle.querySelector("i");
        if (icon) {
            icon.className = open ? "fa-solid fa-xmark" : "fa-solid fa-bars";
        }
        if (open) {
            headerEl.classList.remove("header-hidden");
        } else {
            closeDropdowns();
        }
    }

    toggle.addEventListener("click", function () {
        setMenuOpen(!headerEl.classList.contains("nav-open"));
    });

    dropdowns.forEach(function (dropdown) {
        const trigger = dropdown.querySelector(":scope > a");
        if (!trigger) return;

        trigger.addEventListener("click", function (event) {
            if (!isMobileNav()) return;

            const alreadyOpen = dropdown.classList.contains("is-open");
            if (!alreadyOpen) {
                event.preventDefault();
                closeDropdowns();
                dropdown.classList.add("is-open");
                trigger.setAttribute("aria-expanded", "true");
            }
        });

        trigger.addEventListener("keydown", function (event) {
            if (!isMobileNav()) return;

            if (event.key === "ArrowDown" || event.key === " ") {
                event.preventDefault();
                closeDropdowns();
                dropdown.classList.add("is-open");
                trigger.setAttribute("aria-expanded", "true");
            }
        });
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;

        const openDropdown = headerEl.querySelector(".dropdown.is-open");
        if (openDropdown) {
            closeDropdowns();
            const trigger = openDropdown.querySelector(":scope > a");
            if (trigger) trigger.focus();
            return;
        }

        if (headerEl.classList.contains("nav-open")) {
            setMenuOpen(false);
            toggle.focus();
        }
    });

    function onBreakpointChange() {
        if (!isMobileNav()) {
            setMenuOpen(false);
            closeDropdowns();
        }
    }

    if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", onBreakpointChange);
    } else if (typeof mobileQuery.addListener === "function") {
        mobileQuery.addListener(onBreakpointChange);
    }
})();
