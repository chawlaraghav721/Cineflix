"use strict";
const User = require("../models/User");
const { hashPassword, verifyPassword, getDummyHash } = require("./passwords");

class AuthError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function validateCredentials(body, registration = false) {
    const fields = registration ? ["name", "email", "password"] : ["email", "password"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
        throw new AuthError("INVALID_INPUT", "Provide only the required account fields.");
    }
    if (typeof body.email !== "string" || body.email.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        throw new AuthError("INVALID_EMAIL", "Enter a valid email address.");
    }
    if (typeof body.password !== "string" || body.password.length < (registration ? 12 : 1) || body.password.length > 128) {
        throw new AuthError("INVALID_PASSWORD", registration
            ? "Use a password between 12 and 128 characters." : "Enter your password (up to 128 characters).");
    }
    if (registration && (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80)) {
        throw new AuthError("INVALID_NAME", "Enter a name between 2 and 80 characters.");
    }
    return { email: body.email.trim().toLowerCase(), password: body.password,
        ...(registration ? { name: body.name.trim() } : {}) };
}

function userDto(user) {
    return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}

async function register(body) {
    const values = validateCredentials(body, true);
    // The unique database index also enforces this check under concurrent requests.
    if (await User.exists({ email: values.email })) throw new AuthError("EMAIL_EXISTS", "An account with this email already exists.", 409);
    const passwordHash = await hashPassword(values.password);
    try {
        return userDto(await User.create({ name: values.name, email: values.email, passwordHash, role: "user" }));
    } catch (error) {
        if (error.code === 11000 && error.keyPattern?.email) throw new AuthError("EMAIL_EXISTS", "An account with this email already exists.", 409);
        throw error;
    }
}

async function login(body) {
    const values = validateCredentials(body);
    const user = await User.findOne({ email: values.email }).select("+passwordHash");
    const valid = await verifyPassword(values.password, user ? user.passwordHash : await getDummyHash());
    if (!user || !valid) throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    return userDto(user);
}

module.exports = { register, login, userDto, validateCredentials, AuthError };
