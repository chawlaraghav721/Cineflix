
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
                if (typeof myList.isStorageAvailable === "function" && !myList.isStorageAvailable()) {
                    throw new Error("Browser storage is unavailable.");
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
            window.addEventListener("storage", function (event) {
                if (event.key === null || event.key === "cineflixMyList") updateMyListCount();
            });
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

    // Read the stores independently: a blocked or corrupt persistent store must
    // not hide a valid tab session. Demo sessions never contain passwords.
    function readDemoUser() {
        for (const storageName of ["localStorage", "sessionStorage"]) {
            try {
                const user = JSON.parse(window[storageName].getItem("cineflixDemoUser"));
                if (user && typeof user === "object" && !Array.isArray(user) &&
                    typeof user.email === "string" && user.email.trim()) return user;
            } catch (error) {
                // Missing, corrupt and unavailable demo sessions are signed out.
            }
        }
        return null;
    }

    function updateDemoSession() {
        const loginLink = document.querySelector(".login-link");
        const navList = document.querySelector(".nav-links");
        if (!loginLink || !navList) return;
        const demoUser = readDemoUser();
        const existingSignOut = navList.querySelector(".signout-btn");

        if (!demoUser) {
            loginLink.textContent = "Login";
            loginLink.removeAttribute("title");
            loginLink.classList.remove("account-link");
            if (existingSignOut) existingSignOut.parentNode.remove();
            return;
        }

        loginLink.textContent = "My Account";
        loginLink.title = demoUser.email;
        loginLink.classList.add("account-link");
        if (existingSignOut) return;

        const signOutItem = document.createElement("li");
        const signOutButton = document.createElement("button");
        signOutButton.type = "button";
        signOutButton.textContent = "Sign Out";
        signOutButton.className = "signout-btn";
        signOutButton.addEventListener("click", function () {
            let failed = false;
            for (const storageName of ["localStorage", "sessionStorage"]) {
                try {
                    window[storageName].removeItem("cineflixDemoUser");
                } catch (error) {
                    failed = true;
                }
            }
            if (failed) {
                window.alert("Unable to clear your demo session. Check browser storage settings and try again.");
                return;
            }
            window.location.href = "login.html";
        });
        signOutItem.appendChild(signOutButton);
        navList.appendChild(signOutItem);
    }

    window.addEventListener("cineflix:session-updated", updateDemoSession);
    window.addEventListener("pageshow", updateDemoSession);
    window.addEventListener("storage", function (event) {
        if (event.key === null || event.key === "cineflixDemoUser") updateDemoSession();
    });
    updateDemoSession();
});
