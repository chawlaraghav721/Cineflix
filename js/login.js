
const loginForm = document.getElementById("login-form");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const loginFeedback = document.getElementById("login-feedback");

const togglePassword = document.getElementById("toggle-password");

// Show or hide password when button is clicked
togglePassword.addEventListener("click", function() {

    if (passwordInput.type === "password") {

        passwordInput.type = "text";
        togglePassword.textContent = "Hide";
        togglePassword.setAttribute("aria-label", "Hide password");
        togglePassword.setAttribute("aria-pressed", "true");

    } else {

        passwordInput.type = "password";
        togglePassword.textContent = "Show";
        togglePassword.setAttribute("aria-label", "Show password");
        togglePassword.setAttribute("aria-pressed", "false");

    }

});

// Validate login form
loginForm.addEventListener("submit", function(event) {

    event.preventDefault();

    emailError.textContent = "";
    passwordError.textContent = "";
    loginFeedback.textContent = "";

    let isValid = true;

    const email = emailInput.value.trim();

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Check if email is empty
    if (email === "") {
        emailError.textContent = "Please enter your email.";
        isValid = false;
    }

    // Check if email format is incorrect
    else if (!emailPattern.test(email)) {
        emailError.textContent = "Please enter a valid email address.";
        isValid = false;
    }

    // Check if password is empty
    if (passwordInput.value.trim() === "") {
        passwordError.textContent = "Please enter your password.";
        isValid = false;
    }

    // Display final feedback
    if (isValid) {

        const rememberMe = document.getElementById("remember").checked;

        const demoUser = {
            email: email,
            signedInAt: new Date().toISOString()
        };

        try {
            const storage = rememberMe ? localStorage : sessionStorage;

            // Save demo session without storing password
            storage.setItem("cineflixDemoUser", JSON.stringify(demoUser));

            // Remove any previous session from the other storage
            if (rememberMe) {
                sessionStorage.removeItem("cineflixDemoUser");
            } else {
                localStorage.removeItem("cineflixDemoUser");
            }

            loginFeedback.textContent =
                "Demo sign-in successful! Welcome to CineFlix.";

            loginFeedback.style.color = "#4ade80";

            // Clear password after successful sign-in
            passwordInput.value = "";

        } catch (error) {

            loginFeedback.textContent =
                "Unable to save your demo session. Please check browser settings.";

            loginFeedback.style.color = "#ff6b6b";
        }

    } else {

        loginFeedback.textContent = "Please correct the errors above.";
        loginFeedback.style.color = "#ff6b6b";

    }

});
