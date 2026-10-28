
const contactForm = document.getElementById("contact-form");

const contactName = document.getElementById("contact-name");
const contactEmail = document.getElementById("contact-email");
const contactMessage = document.getElementById("contact-message");

const nameError = document.getElementById("contact-name-error");
const emailError = document.getElementById("contact-email-error");
const messageError = document.getElementById("contact-message-error");
const contactFeedback = document.getElementById("contact-feedback");

contactForm.addEventListener("submit", function(event) {

    // Prevent the page from reloading
    event.preventDefault();

    // Clear previous errors
    nameError.textContent = "";
    emailError.textContent = "";
    messageError.textContent = "";
    contactFeedback.textContent = "";

    contactName.removeAttribute("aria-invalid");
    contactEmail.removeAttribute("aria-invalid");
    contactMessage.removeAttribute("aria-invalid");

    let isValid = true;

    const name = contactName.value.trim();
    const email = contactEmail.value.trim();
    const message = contactMessage.value.trim();

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Validate name
    if (name === "") {
        nameError.textContent = "Please enter your name.";
        contactName.setAttribute("aria-invalid", "true");
        isValid = false;
    }

    // Validate email
    if (email === "") {
        emailError.textContent = "Please enter your email.";
        contactEmail.setAttribute("aria-invalid", "true");
        isValid = false;
    } else if (!emailPattern.test(email)) {
        emailError.textContent = "Please enter a valid email address.";
        contactEmail.setAttribute("aria-invalid", "true");
        isValid = false;
    }

    // Validate message
    if (message === "") {
        messageError.textContent = "Please enter your message.";
        contactMessage.setAttribute("aria-invalid", "true");
        isValid = false;
    } else if (message.length < 10) {
        messageError.textContent =
            "Your message must contain at least 10 characters.";
        contactMessage.setAttribute("aria-invalid", "true");
        isValid = false;
    }

    // Show feedback
    if (isValid) {
        contactFeedback.textContent =
            "Thanks for your feedback! This is a demo form, so no message was sent.";

        contactFeedback.className = "contact-success";

        contactForm.reset();

    } else {
        contactFeedback.textContent =
            "Please correct the errors above.";

        contactFeedback.className = "contact-failure";
    }

});
