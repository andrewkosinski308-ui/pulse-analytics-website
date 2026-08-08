let lastScroll = 0;

const header = document.querySelector("header");

window.addEventListener("scroll", () => {

    const currentScroll = window.pageYOffset;

    if(currentScroll <= 0){

        header.classList.remove("header-hidden");
        lastScroll = 0;
        return;

    }

    if(currentScroll > lastScroll){

        // Scrolling down
        header.classList.add("header-hidden");

    } else {

        // Scrolling up
        header.classList.remove("header-hidden");

    }

    lastScroll = currentScroll;

});

const backToTop = document.getElementById("backToTop");

backToTop.addEventListener("click", function () {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
});