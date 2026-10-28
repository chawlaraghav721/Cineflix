
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

    // Check for an existing demo sign-in session
    let demoUser = null;

    try {
        const savedUser =
            localStorage.getItem("cineflixDemoUser") ||
            sessionStorage.getItem("cineflixDemoUser");

        if (savedUser) {
            demoUser = JSON.parse(savedUser);
        }

    } catch (error) {
        console.error("Unable to read demo session:", error);
    }

    // Update navigation when a demo user is signed in
    if (demoUser) {

        const loginLink = document.querySelector(".login-link");
        const navList = document.querySelector(".nav-links");

        if (loginLink && navList) {

            loginLink.textContent = "My Account";
            loginLink.title = demoUser.email;
            loginLink.classList.add("account-link");

            // Create sign-out button
            const signOutItem = document.createElement("li");
            const signOutButton = document.createElement("button");

            signOutButton.type = "button";
            signOutButton.textContent = "Sign Out";
            signOutButton.className = "signout-btn";

            // Clear demo session on sign-out
            signOutButton.addEventListener("click", function () {

                localStorage.removeItem("cineflixDemoUser");
                sessionStorage.removeItem("cineflixDemoUser");

                window.location.href = "login.html";

            });

            signOutItem.appendChild(signOutButton);
            navList.appendChild(signOutItem);

        }

    }

});
