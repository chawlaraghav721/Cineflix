
document.addEventListener("DOMContentLoaded", function () {

    const myListLink = document.querySelector('.nav-links a[href="mylist.html"]');

    if (myListLink) {
        let badge = myListLink.querySelector(".mylist-count");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "mylist-count";
            myListLink.appendChild(badge);
        }
        badge.setAttribute("role", "status");
        badge.setAttribute("aria-live", "polite");
        badge.setAttribute("aria-atomic", "true");

        function updateMyListCount() {
            let count;
            try {
                const myList = window.CineFlixMyList;
                if (!myList || typeof myList.getMyListIds !== "function") {
                    throw new Error("My List storage API is unavailable.");
                }
                count = myList.getMyListIds().length;
            } catch (error) {
                badge.textContent = "\u2014";
                badge.setAttribute("aria-label", "Saved title count unavailable");
                badge.title = "My List count is unavailable. Check that the shared storage script is loaded.";
                return;
            }

            const label = count + (count === 1 ? " saved title" : " saved titles");
            if (badge.textContent !== String(count)) badge.textContent = String(count);
            badge.setAttribute("aria-label", label);
            badge.title = label;
        }

        if (badge.dataset.countInitialized !== "true") {
            window.addEventListener("cineflix:list-updated", updateMyListCount);
            window.addEventListener("storage", updateMyListCount);
            window.addEventListener("pageshow", updateMyListCount);
            badge.dataset.countInitialized = "true";
        }
        updateMyListCount();
    }

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

            if (navList.querySelector(".signout-btn")) return;

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
