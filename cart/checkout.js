/* ==========================================
   PULSE ANALYTICS GROUP LLC
   CHECKOUT FUNCTIONALITY
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    const CART_STORAGE_KEY = "pulseAnalyticsCart";


    /* ==========================================
       CART STORAGE
    ========================================== */

    function getCart() {

        try {

            const storedCart =
                localStorage.getItem(CART_STORAGE_KEY);

            return storedCart
                ? JSON.parse(storedCart)
                : [];

        } catch (error) {

            console.error(
                "Unable to read cart:",
                error
            );

            return [];

        }

    }


    /* ==========================================
       FORMAT CURRENCY
    ========================================== */

    function formatCurrency(amount) {

        return new Intl.NumberFormat(
            "en-US",
            {
                style: "currency",
                currency: "USD"
            }
        ).format(amount);

    }


    /* ==========================================
       CALCULATE TOTALS
    ========================================== */

    function calculateTotals(cart) {

        let oneTimeTotal = 0;
        let monthlyTotal = 0;


        cart.forEach((item) => {

            const quantity =
                item.quantity || 1;

            const itemTotal =
                item.price * quantity;


            if (item.billing === "monthly") {

                monthlyTotal += itemTotal;

            } else {

                oneTimeTotal += itemTotal;

            }

        });


        return {

            oneTimeTotal,
            monthlyTotal,
            totalDueToday:
                oneTimeTotal + monthlyTotal

        };

    }


    /* ==========================================
       RENDER ORDER ITEMS
    ========================================== */

    function renderCheckoutItems(cart) {

        const checkoutItems =
            document.getElementById(
                "checkoutItems"
            );


        if (!checkoutItems) {

            return;

        }


        checkoutItems.innerHTML = "";


        cart.forEach((item) => {

            const quantity =
                item.quantity || 1;

            const itemTotal =
                item.price * quantity;

            const billingText =
                item.billing === "monthly"
                    ? "/ month"
                    : "one-time";


            const itemElement =
                document.createElement("div");


            itemElement.className =
                "checkout-item";


            itemElement.innerHTML = `

                <div class="checkout-item-details">

                    <h3>
                        ${item.name}
                    </h3>

                    <p>
                        ${formatCurrency(item.price)}
                        ${billingText}
                    </p>

                    ${
                        quantity > 1
                            ? `
                                <span>
                                    Quantity: ${quantity}
                                </span>
                            `
                            : ""
                    }

                </div>

                <strong class="checkout-item-total">

                    ${formatCurrency(itemTotal)}

                </strong>

            `;


            checkoutItems.appendChild(
                itemElement
            );

        });

    }


    /* ==========================================
       UPDATE ORDER TOTALS
    ========================================== */

    function updateCheckoutTotals(cart) {

        const totals =
            calculateTotals(cart);


        const oneTimeElement =
            document.getElementById(
                "checkoutOneTimeTotal"
            );


        const monthlyElement =
            document.getElementById(
                "checkoutMonthlyTotal"
            );


        const totalElement =
            document.getElementById(
                "checkoutTotal"
            );


        const recurringElement =
            document.getElementById(
                "checkoutRecurringTotal"
            );


        if (oneTimeElement) {

            oneTimeElement.textContent =
                formatCurrency(
                    totals.oneTimeTotal
                );

        }


        if (monthlyElement) {

            monthlyElement.textContent =
                formatCurrency(
                    totals.monthlyTotal
                );

        }


        if (totalElement) {

            totalElement.textContent =
                formatCurrency(
                    totals.totalDueToday
                );

        }


        if (recurringElement) {

            recurringElement.textContent =
                formatCurrency(
                    totals.monthlyTotal
                );

        }

    }


    /* ==========================================
       EMPTY CART HANDLING
    ========================================== */

    function handleEmptyCart(cart) {

        if (cart.length > 0) {

            return false;

        }


        window.location.href = "cart.html";

        return true;

    }


    function showAlert(message) {

        const alertElement =
            document.getElementById("checkoutAlert");


        if (!alertElement) {

            return;

        }


        alertElement.hidden = false;

        alertElement.textContent = message;

    }


    function showSuccess() {

        const successElement =
            document.getElementById("checkoutSuccess");

        const checkoutForm =
            document.getElementById("checkoutForm");


        if (successElement) {

            successElement.hidden = false;

        }


        if (checkoutForm) {

            checkoutForm.hidden = true;

        }

    }


    function checkoutPayload(cart) {

        return {
            items: cart.map((item) => ({
                id: item.id,
                quantity: item.quantity || 1
            }))
        };

    }


    async function loadStripeJs() {

        if (window.Stripe) {

            return window.Stripe;

        }


        await new Promise((resolve, reject) => {

            const script = document.createElement("script");

            script.src = "https://js.stripe.com/v3/";

            script.async = true;

            script.onload = resolve;

            script.onerror = reject;

            document.head.appendChild(script);

        });


        return window.Stripe;

    }


    async function confirmReturnedCheckout(sessionId) {

        const response = await fetch(
            `/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`
        );

        const payload = await response.json().catch(() => null);


        if (!response.ok || !payload) {

            showAlert(
                "We couldn't confirm this payment. Please contact Pulse Analytics if you were charged."
            );

            return false;

        }


        if (payload.complete) {

            showSuccess();

            localStorage.removeItem(CART_STORAGE_KEY);

            return true;

        }


        showAlert(
            "Your payment was not completed. Your cart is still available."
        );

        return false;

    }


    async function mountEmbeddedCheckout(cart) {

        const statusElement =
            document.getElementById("checkoutStatus");

        const mountElement =
            document.getElementById("embedded-checkout");


        const response = await fetch("/api/checkout/session", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(checkoutPayload(cart))
        });

        const payload = await response.json().catch(() => null);


        if (
            !response.ok ||
            !payload?.clientSecret ||
            !payload?.publishableKey
        ) {

            showAlert(
                payload?.error ||
                "We couldn't start checkout. Please try again or contact Pulse Analytics."
            );


            if (statusElement) {

                statusElement.hidden = true;

            }

            return;

        }


        const Stripe = await loadStripeJs();

        const stripe = Stripe(payload.publishableKey);

        const checkout = await stripe.initEmbeddedCheckout({
            clientSecret: payload.clientSecret
        });


        if (statusElement) {

            statusElement.hidden = true;

        }


        checkout.mount(mountElement || "#embedded-checkout");

    }


    /* ==========================================
       INITIALIZE CHECKOUT
    ========================================== */

    const checkoutForm =
        document.getElementById("checkoutForm");


    if (checkoutForm) {

        checkoutForm.addEventListener(
            "submit",
            (event) => {

                event.preventDefault();

            }
        );

    }


    const params = new URLSearchParams(window.location.search);

    const sessionId = params.get("session_id");

    const cart = getCart();


    if (sessionId) {

        if (cart.length) {

            renderCheckoutItems(cart);

            updateCheckoutTotals(cart);

        }


        confirmReturnedCheckout(sessionId)
            .then((completed) => {

                if (completed) {

                    return;

                }


                if (handleEmptyCart(cart)) {

                    return;

                }


                renderCheckoutItems(cart);

                updateCheckoutTotals(cart);

                return mountEmbeddedCheckout(cart);

            })
            .catch(() => {

                showAlert(
                    "We couldn't confirm this payment. Please contact Pulse Analytics if you were charged."
                );

            });

        return;

    }


    if (handleEmptyCart(cart)) {

        return;

    }


    renderCheckoutItems(cart);

    updateCheckoutTotals(cart);


    mountEmbeddedCheckout(cart).catch(() => {

        showAlert(
            "We couldn't start checkout. Please try again or contact Pulse Analytics."
        );

    });

});