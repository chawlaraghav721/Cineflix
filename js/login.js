(function () {
    "use strict";
    const form = document.getElementById("login-form");
    if (!form) return;
    const email = document.getElementById("email");
    const password = document.getElementById("password");
    const name = document.getElementById("name");
    const nameGroup = document.getElementById("registration-name");
    const feedback = document.getElementById("login-feedback");
    const submit = document.getElementById("auth-submit");
    const toggle = document.getElementById("auth-toggle");
    const title = document.getElementById("auth-title");
    const account = document.getElementById("account-panel");
    const accountMessage = document.getElementById("account-message");
    const signOut = document.getElementById("account-signout");
    const showPassword = document.getElementById("toggle-password");
    const shell = document.getElementById("auth-shell");
    const hint = document.getElementById("session-hint");
    let registration = new URLSearchParams(window.location.search).get("mode") === "register";
    let busy = false;
    let hadAccount = false;

    function render() {
        const state = window.CineFlixAuth?.getState();
        const user = state?.user;
        if (user) hadAccount = true;
        else if (hadAccount && state?.status === "signed-out") { registration = false; hadAccount = false; }
        account.hidden = !user;
        form.hidden = Boolean(user);
        toggle.hidden = Boolean(user);
        if (shell) shell.classList[user ? "add" : "remove"]("account-view");
        if (hint) hint.hidden = Boolean(user);
        title.textContent = user ? "Your Account" : registration ? "Create Account" : "Sign In";
        accountMessage.textContent = user ? "Signed in as " + user.name + " (" + user.email + ")." : "";
        nameGroup.hidden = !registration;
        name.required = registration;
        password.autocomplete = registration ? "new-password" : "current-password";
        submit.textContent = busy ? "Please wait…" : registration ? "Create Account" : "Sign In";
        submit.disabled = busy;
        toggle.textContent = registration ? "Already have an account? Sign in" : "New to CineFlix? Create an account";
        form.setAttribute("aria-busy", String(busy));
        if (state?.status === "error" && !busy && !feedback.textContent) {
            feedback.textContent = "Account details could not be loaded. Check your connection and try signing in.";
            feedback.dataset.state = "error";
        }
    }
    function fieldError(id, message) {
        document.getElementById(id + "-error").textContent = message;
        document.getElementById(id).setAttribute("aria-invalid", "true");
    }
    function clearErrors() {
        for (const id of ["name", "email", "password"]) {
            document.getElementById(id + "-error").textContent = "";
            document.getElementById(id).removeAttribute("aria-invalid");
        }
        feedback.textContent = "";
        feedback.dataset.state = "";
    }
    toggle.addEventListener("click", event => {
        event.preventDefault();
        if (busy) return;
        registration = !registration;
        password.value = "";
        clearErrors();
        render();
        (registration ? name : email).focus();
    });
    showPassword.addEventListener("click", () => {
        const visible = password.type === "password";
        password.type = visible ? "text" : "password";
        showPassword.textContent = visible ? "Hide" : "Show";
        showPassword.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        showPassword.setAttribute("aria-pressed", String(visible));
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        clearErrors();
        let valid = true;
        if (registration && (name.value.trim().length < 2 || name.value.trim().length > 80)) {
            fieldError("name", "Enter a name between 2 and 80 characters."); valid = false;
        }
        if (email.value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
            fieldError("email", "Enter a valid email address."); valid = false;
        }
        if (password.value.length < (registration ? 12 : 1) || password.value.length > 128) {
            fieldError("password", registration ? "Use a password between 12 and 128 characters." : "Enter your password (up to 128 characters)."); valid = false;
        }
        if (!valid) { feedback.textContent = "Please correct the highlighted fields."; return; }
        busy = true;
        render();
        try {
            const values = { email: email.value.trim(), password: password.value };
            if (registration) values.name = name.value.trim();
            await window.CineFlixAuth[registration ? "register" : "login"](values);
            password.value = "";
            feedback.textContent = "";
        } catch (error) {
            feedback.textContent = error.message || "Unable to sign in. Please try again.";
            feedback.dataset.state = "error";
            if (error.code === "USER_NOT_FOUND") fieldError("email", error.message);
            if (error.code === "INVALID_CREDENTIALS") fieldError("password", error.message);
            feedback.focus();
        }
        finally { busy = false; render(); }
    });
    signOut.addEventListener("click", async () => {
        signOut.disabled = true;
        try { await window.CineFlixAuth.logout(); clearErrors(); feedback.textContent = "Signed out."; }
        catch (error) { feedback.textContent = "Unable to sign out. " + error.message; feedback.dataset.state = "error"; }
        finally { signOut.disabled = false; render(); }
    });
    window.addEventListener("cineflix:auth-state", render);
    document.addEventListener("DOMContentLoaded", render);
}());
