
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

    if (emailInput.value.trim() === "") {
        emailError.textContent = "Please enter your email.";
        isValid = false;
    }

    if (passwordInput.value.trim() === "") {
        passwordError.textContent = "Please enter your password.";
        isValid = false;
    }

    if (isValid) {
        loginFeedback.textContent = "Both fields are filled!";
    } else {
        loginFeedback.textContent = "Please correct the errors above.";
    }

});
