"use strict";
const service = require("../services/authService");
const { setAuthCookie, clearAuthCookie } = require("../services/authCookies");

const handle = (action, status = 200) => async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try { return res.status(status).json(await action(req, res)); }
    catch (error) {
        if (error instanceof service.AuthError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return next(error);
    }
};

function signIn(method) {
    return async (req, res) => {
        if (!req.is("application/json")) throw new service.AuthError("INVALID_INPUT", "Send account fields as a JSON object.");
        const user = await service[method](req.body);
        setAuthCookie(res, user, req.app.locals.authConfig);
        return { user };
    };
}

module.exports = {
    register: handle(signIn("register"), 201),
    login: handle(signIn("login")),
    logout: handle((req, res) => {
        clearAuthCookie(res, req.app.locals.authConfig);
        return { message: "Signed out" };
    }),
    me: handle(req => ({ user: req.authenticatedUser }))
};
