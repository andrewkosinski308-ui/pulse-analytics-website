/* ==========================================
   PULSE ANALYTICS GROUP LLC
   CART FUNCTIONALITY
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    const CART_STORAGE_KEY = "pulseAnalyticsCart";


    /* ==========================================
       CART STORAGE
    ========================================== */

    function getCart() {

        try {

            const storedCart = localStorage.getItem(CART_STORAGE_KEY);

            return storedCart ? JSON.parse(storedCart) : [];

        } catch (error) {

            console.error("Unable to read cart:", error);

            return [];

        }

    }


    function saveCart(cart) {

        localStorage.setItem(
            CART_STORAGE_KEY,
            JSON.stringify(cart)
        );

    }


    /* ==========================================
       CART COUNTER
    ========================================== */

    function updateCartCounter() {

        const cart = getCart();

        const cartCountElements = document.querySelectorAll(
            "#cartCount"
        );

        const totalItems = cart.reduce(
            (total, item) => total + (item.quantity || 1),
            0
        );

        cartCountElements.forEach((element) => {

            element.textContent = totalItems;

        });

    }


    /* ==========================================
       ADD ITEM TO CART
    ========================================== */

    function addToCart(button) {

        const productId = button.dataset.productId;
        const productName = button.dataset.productName;
        const price = parseFloat(button.dataset.price);
        const billing = button.dataset.billing || "one_time";


        if (!productId || !productName || Number.isNaN(price)) {

            console.error(
                "Unable to add product. Missing product information.",
                button
            );

            return;

        }


        const cart = getCart();

        const existingItem = cart.find(
            (item) => item.id === productId
        );


        /* ==========================================
           PREVENT DUPLICATE STANDARD SERVICES
        ========================================== */

        if (existingItem) {

            if (existingItem.quantity !== undefined) {

                existingItem.quantity += 1;

            } else {

                existingItem.quantity = 2;

            }

        } else {

            cart.push({

                id: productId,
                name: productName,
                price: price,
                billing: billing,
                quantity: 1

            });

        }


        saveCart(cart);

        updateCartCounter();


        /*
         * Allow the browser to continue to the cart
         * after the item has been saved.
         */

        window.location.href = "cart/cart.html";

    }


    /* ==========================================
       ADD-ON CART ITEMS
    ========================================== */

    function addAddonToCart(button) {

        const productId = button.dataset.productId;
        const productName = button.dataset.productName;
        const price = parseFloat(button.dataset.price);
        const priceType = button.dataset.priceType || "fixed";


        if (!productId || !productName || Number.isNaN(price)) {

            console.error(
                "Unable to add add-on. Missing product information.",
                button
            );

            return;

        }


        const cart = getCart();

        const existingItem = cart.find(
            (item) => item.id === productId
        );


        if (existingItem) {

            existingItem.quantity =
                (existingItem.quantity || 1) + 1;

        } else {

            cart.push({

                id: productId,
                name: productName,
                price: price,
                billing: priceType.includes("monthly")
                    ? "monthly"
                    : "one_time",
                priceType: priceType,
                quantity: 1

            });

        }


        saveCart(cart);

        updateCartCounter();

        window.location.href = "cart/cart.html";

    }


    /* ==========================================
       REMOVE ITEM FROM CART
    ========================================== */

    function removeFromCart(productId) {

        const cart = getCart();

        const updatedCart = cart.filter(
            (item) => item.id !== productId
        );

        saveCart(updatedCart);

        renderCart();

        updateCartCounter();

    }


    /* ==========================================
       UPDATE QUANTITY
    ========================================== */

    function updateQuantity(productId, quantity) {

        const cart = getCart();

        const item = cart.find(
            (cartItem) => cartItem.id === productId
        );


        if (!item) {

            return;

        }


        const newQuantity = parseInt(quantity, 10);


        if (Number.isNaN(newQuantity) || newQuantity <= 0) {

            removeFromCart(productId);

            return;

        }


        item.quantity = newQuantity;

        saveCart(cart);

        renderCart();

        updateCartCounter();

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
       RENDER CART ITEMS
    ========================================== */

    function renderCart() {

        const cartContainer =
            document.getElementById("cartItems");


        if (!cartContainer) {

            return;

        }


        const cart = getCart();

        const emptyCart =
            document.getElementById("emptyCart");

        const itemCount =
            document.getElementById("cartItemCount");

        const checkoutButton =
            document.getElementById("checkoutButton");


        /* ==========================================
           EMPTY CART
        ========================================== */

        if (cart.length === 0) {

            cartContainer.innerHTML = `
                <div class="cart-empty-state" id="emptyCart">

                    <div class="cart-empty-icon">

                        <i class="fa-solid fa-cart-shopping"></i>

                    </div>

                    <h3>
                        Your Cart Is Empty
                    </h3>

                    <p>
                        You haven't selected any services yet.
                        Explore our pricing options to find the right
                        solution for your business.
                    </p>

                    <a href="../pricing.html"
                        class="btn-primary">

                        View Pricing

                    </a>

                </div>
            `;


            if (itemCount) {

                itemCount.textContent = "0 items";

            }


            updateTotals();


            if (checkoutButton) {

                checkoutButton.setAttribute(
                    "aria-disabled",
                    "true"
                );

                checkoutButton.classList.add(
                    "disabled"
                );

            }


            return;

        }


        /* ==========================================
           CART HAS ITEMS
        ========================================== */

        cartContainer.innerHTML = "";


        cart.forEach((item) => {

            const itemElement =
                document.createElement("div");

            itemElement.className =
                "cart-item";


            const billingText =
                item.billing === "monthly"
                    ? "/ month"
                    : "one-time";


            itemElement.innerHTML = `

                <div class="cart-item-details">

                    <h3>
                        ${item.name}
                    </h3>

                    <p>
                        ${formatCurrency(item.price)}
                        ${billingText}
                    </p>

                </div>

                <div class="cart-item-controls">

                    ${
                        item.priceType === "per_page"
                            ? `
                                <label>
                                    Quantity
                                </label>

                                <input
                                    type="number"
                                    min="1"
                                    value="${item.quantity}"
                                    data-quantity-id="${item.id}">
                            `
                            : `
                                <span>
                                    Quantity: ${item.quantity}
                                </span>
                            `
                    }

                    <strong>
                        ${formatCurrency(
                            item.price * item.quantity
                        )}
                    </strong>

                    <button
                        type="button"
                        class="cart-remove"
                        data-remove-id="${item.id}">

                        Remove

                    </button>

                </div>

            `;


            cartContainer.appendChild(
                itemElement
            );

        });


        /* ==========================================
           ITEM COUNT
        ========================================== */

        if (itemCount) {

            const totalItems = cart.reduce(
                (total, item) =>
                    total + (item.quantity || 1),
                0
            );


            itemCount.textContent =
                `${totalItems} ${
                    totalItems === 1
                        ? "item"
                        : "items"
                }`;

        }


        /* ==========================================
           ENABLE CHECKOUT
        ========================================== */

        if (checkoutButton) {

            checkoutButton.removeAttribute(
                "aria-disabled"
            );

            checkoutButton.classList.remove(
                "disabled"
            );

        }


        updateTotals();

    }


    /* ==========================================
       CALCULATE TOTALS
    ========================================== */

    function calculateTotals() {

        const cart = getCart();

        let oneTimeTotal = 0;
        let monthlyTotal = 0;


        cart.forEach((item) => {

            const itemTotal =
                item.price *
                (item.quantity || 1);


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
       UPDATE CART TOTALS
    ========================================== */

    function updateTotals() {

        const totals =
            calculateTotals();


        const oneTimeElement =
            document.getElementById(
                "oneTimeTotal"
            );


        const monthlyElement =
            document.getElementById(
                "monthlyTotal"
            );


        const totalElement =
            document.getElementById(
                "cartTotal"
            );


        const recurringElement =
            document.getElementById(
                "recurringTotal"
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
       BUTTON EVENT HANDLING
    ========================================== */

    document.addEventListener(
        "click",
        (event) => {

            const addButton =
                event.target.closest(
                    "[data-add-to-cart='true']"
                );


            if (!addButton) {

                return;

            }


            event.preventDefault();


            /*
             * Add-on products have data-price-type.
             */

            if (addButton.dataset.priceType) {

                addAddonToCart(
                    addButton
                );

            } else {

                addToCart(
                    addButton
                );

            }

        }
    );


    /* ==========================================
       REMOVE BUTTON HANDLING
    ========================================== */

    document.addEventListener(
        "click",
        (event) => {

            const removeButton =
                event.target.closest(
                    "[data-remove-id]"
                );


            if (!removeButton) {

                return;

            }


            const productId =
                removeButton.dataset.removeId;


            removeFromCart(
                productId
            );

        }
    );


    /* ==========================================
       QUANTITY HANDLING
    ========================================== */

    document.addEventListener(
        "change",
        (event) => {

            const quantityInput =
                event.target.closest(
                    "[data-quantity-id]"
                );


            if (!quantityInput) {

                return;

            }


            updateQuantity(
                quantityInput.dataset.quantityId,
                quantityInput.value
            );

        }
    );


    /* ==========================================
       CHECKOUT VALIDATION
    ========================================== */

    const checkoutButton =
        document.getElementById(
            "checkoutButton"
        );


    if (checkoutButton) {

        checkoutButton.addEventListener(
            "click",
            (event) => {

                const cart = getCart();


                if (cart.length === 0) {

                    event.preventDefault();


                    checkoutButton.setAttribute(
                        "aria-disabled",
                        "true"
                    );


                    checkoutButton.classList.add(
                        "disabled"
                    );


                    return;

                }


                /*
                 * Cart contains items.
                 * The existing href="checkout.html"
                 * is allowed to perform the navigation.
                 */

                checkoutButton.removeAttribute(
                    "aria-disabled"
                );


                checkoutButton.classList.remove(
                    "disabled"
                );

            }
        );

    }


    /* ==========================================
       INITIALIZE CART
    ========================================== */

    updateCartCounter();

    renderCart();

});