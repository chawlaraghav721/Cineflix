
document.addEventListener("DOMContentLoaded", function () {

    // Get the current page name from the URL
    const currentPage =
        window.location.pathname.split("/").pop() || "index.html";

    // Select all navbar links
    const navLinks = document.querySelectorAll(".nav-links a");

    // Check each link against the current page
    navLinks.forEach(function (link) {

        const linkPage = link.getAttribute("href");

        if (linkPage === currentPage) {

            link.classList.add("active");

            link.setAttribute("aria-current", "page");

        }

    });

});
