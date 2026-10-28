
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
        loginFeedback.textContent = "Looks good! This is a demo sign-in.";
    } else {
        loginFeedback.textContent = "Please correct the errors above.";
    }

});
