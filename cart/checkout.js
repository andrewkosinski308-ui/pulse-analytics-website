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


        /*
         * There is nothing to purchase.
         * Return the customer to the cart page.
         */

        window.location.href = "cart.html";

        return true;

    }


    /* ==========================================
       PAYMENT BUTTON
    ========================================== */

    function setupPaymentButton() {

        const paymentButton =
            document.getElementById(
                "completePaymentButton"
            );


        if (!paymentButton) {

            return;

        }


        /*
         * Payment remains disabled until
         * a payment processor is connected.
         */

        paymentButton.disabled = true;


        paymentButton.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                console.warn(
                    "Payment processing has not been connected yet."
                );

            }
        );

    }


    /* ==========================================
       CHECKOUT FORM
    ========================================== */

    function setupCheckoutForm() {

        const checkoutForm =
            document.getElementById(
                "checkoutForm"
            );


        if (!checkoutForm) {

            return;

        }


        checkoutForm.addEventListener(
            "submit",
            (event) => {

                event.preventDefault();

                console.log(
                    "Checkout form submitted."
                );

            }
        );

    }


    /* ==========================================
       INITIALIZE CHECKOUT
    ========================================== */

    const cart = getCart();


    if (handleEmptyCart(cart)) {

        return;

    }


    renderCheckoutItems(cart);

    updateCheckoutTotals(cart);

    setupPaymentButton();

    setupCheckoutForm();

});