(function () {
    "use strict";
    let state = { user: null, status: "loading" };
    let revision = 0;
    let pendingMutations = 0;
    const notificationKey = "cineflixSessionChange";

    function getState() { return { status: state.status, user: state.user ? { ...state.user } : null }; }
    function update(user, status) {
        state = { user, status };
        window.dispatchEvent(new Event("cineflix:auth-state"));
    }
    function publicUser(data) {
        const user = data?.user;
        if (!user || typeof user.id !== "string" || typeof user.name !== "string" ||
            typeof user.email !== "string" || !["user", "admin"].includes(user.role)) {
            throw new Error("The account response could not be read. Please try again.");
        }
        return { id: user.id, name: user.name, email: user.email, role: user.role };
    }
    async function request(path, method = "GET", body) {
        let response;
        try {
            response = await window.fetch("/api/auth/" + path, { method, credentials: "same-origin", cache: "no-store",
                headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        } catch { throw new Error("Unable to reach CineFlix. Check your connection and try again."); }
        let data;
        try { data = await response.json(); } catch { data = null; }
        if (!response.ok) {
            const error = new Error(response.status >= 500 ? "The account service is unavailable. Please try again."
                : data?.error?.message || "The account request failed. Please try again.");
            error.status = response.status;
            error.code = data?.error?.code;
            throw error;
        }
        if (!data || typeof data !== "object") throw new Error("The account response could not be read. Please try again.");
        return data;
    }
    function announceChange() {
        // This notification contains no identity or credentials; cookies remain HttpOnly.
        for (const name of ["localStorage", "sessionStorage"]) {
            try { window[name].removeItem("cineflixDemoUser"); } catch { /* Optional legacy cleanup. */ }
        }
        try { window.localStorage.setItem(notificationKey, Date.now() + ":" + Math.random()); } catch { /* Cookie login still works without storage. */ }
        window.dispatchEvent(new Event("cineflix:session-updated"));
    }
    async function refresh() {
        // A mutation may still be changing the cookie; reconcile once it settles.
        if (pendingMutations) return getState();
        const current = ++revision;
        update(null, "loading");
        try {
            const user = publicUser(await request("me"));
            if (current === revision) update(user, "signed-in");
        } catch (error) {
            if (current === revision) update(null, error.status === 401 ? "signed-out" : "error");
        }
        return getState();
    }
    async function finishMutation() {
        pendingMutations--;
        if (!pendingMutations) await refresh();
    }
    async function signIn(path, body) {
        const current = ++revision;
        pendingMutations++;
        try {
            update(null, "loading");
            const user = publicUser(await request(path, "POST", body));
            if (current === revision) { update(user, "signed-in"); announceChange(); }
            return user;
        } catch (error) { if (current === revision) update(null, "signed-out"); throw error; }
        finally { await finishMutation(); }
    }
    async function signOut() {
        const current = ++revision;
        pendingMutations++;
        try {
            await request("logout", "POST");
            if (current === revision) { update(null, "signed-out"); announceChange(); }
        } finally { await finishMutation(); }
    }
    window.CineFlixAuth = { getState, refresh, login: values => signIn("login", values),
        register: values => signIn("register", values), logout: signOut };
    window.addEventListener("cineflix:session-updated", refresh);
    window.addEventListener("storage", event => { if (event.key === null || event.key === notificationKey) refresh(); });
    window.addEventListener("pageshow", event => { if (event.persisted) refresh(); });
    window.addEventListener("focus", refresh);
}());

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

        let countRevision = 0;
        async function updateMyListCount() {
            const current = ++countRevision;
            badge.textContent = "\u2014";
            badge.setAttribute("aria-label", "Loading saved title count");
            let count;
            try {
                const myList = window.CineFlixMyList;
                if (!myList || typeof myList.getMyListIds !== "function") {
                    throw new Error("My List storage API is unavailable.");
                }
                count = (await myList.getMyListIds()).length;
                if (current !== countRevision) return;
            } catch (error) {
                if (current !== countRevision) return;
                badge.textContent = "\u2014";
                badge.setAttribute("aria-label", "Saved title count unavailable");
                badge.title = "My List count is unavailable. Open My List to try again.";
                return;
            }

            const label = count + (count === 1 ? " saved title" : " saved titles");
            if (badge.textContent !== String(count)) badge.textContent = String(count);
            badge.setAttribute("aria-label", label);
            badge.title = label;
        }

        if (badge.dataset.countInitialized !== "true") {
            window.addEventListener("cineflix:list-updated", updateMyListCount);
            window.addEventListener("cineflix:list-refreshed", updateMyListCount);
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

    function updateAccount() {
        const loginLink = document.querySelector(".login-link");
        const navList = document.querySelector(".nav-links");
        if (!loginLink || !navList) return;
        const state = window.CineFlixAuth.getState();
        const existingSignOut = navList.querySelector(".signout-btn");
        let adminItem = navList.querySelector("[data-admin-nav]");

        loginLink.setAttribute("aria-busy", String(state.status === "loading"));
        if (!state.user) {
            loginLink.textContent = state.status === "loading" ? "Account…" : "Login";
            loginLink.removeAttribute("title");
            loginLink.classList.remove("account-link");
            if (existingSignOut) existingSignOut.parentNode.remove();
            if (adminItem) adminItem.remove();
            return;
        }

        loginLink.textContent = "My Account";
        loginLink.title = state.user.email;
        loginLink.classList.add("account-link");
        if (state.user.role === "admin") {
            if (!adminItem) {
                adminItem = document.createElement("li");
                adminItem.dataset.adminNav = "true";
                const adminLink = document.createElement("a");
                adminLink.href = "admin.html";
                adminLink.className = "admin-link";
                adminLink.textContent = "Admin";
                if ((window.location.pathname.split("/").pop() || "index.html") === "admin.html") {
                    adminLink.classList.add("active");
                    adminLink.setAttribute("aria-current", "page");
                }
                adminItem.appendChild(adminLink);
                navList.appendChild(adminItem);
            }
        } else if (adminItem) {
            adminItem.remove();
        }
        if (existingSignOut) return;

        const signOutItem = document.createElement("li");
        const signOutButton = document.createElement("button");
        signOutButton.type = "button";
        signOutButton.textContent = "Sign Out";
        signOutButton.className = "signout-btn";
        signOutButton.addEventListener("click", async function () {
            signOutButton.disabled = true;
            try {
                await window.CineFlixAuth.logout();
                window.location.href = "login.html";
            } catch {
                signOutButton.disabled = false;
                window.alert("Unable to sign out. Check your connection and try again.");
            }
        });
        signOutItem.appendChild(signOutButton);
        navList.appendChild(signOutItem);
    }

    window.addEventListener("cineflix:auth-state", updateAccount);
    updateAccount();
    window.CineFlixAuth.refresh();
});
