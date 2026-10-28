
const loginForm = document.getElementById("login-form");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const loginFeedback = document.getElementById("login-feedback");

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
