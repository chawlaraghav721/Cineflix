"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const signedUser = { id: "000000000000000000000001", name: "Test Viewer", email: "viewer@example.test", role: "user" };
const flush = () => new Promise(resolve => setImmediate(resolve));
class Element {
    constructor(className = "") {
        Object.assign(this, { className, children: [], listeners: {}, attributes: {}, dataset: {}, style: {},
            textContent: "", value: "", hidden: false, disabled: false, type: "password" });
        this.classList = { add: name => { this.className += " " + name; },
            remove: name => { this.className = this.className.split(/\s+/).filter(c => c !== name).join(" "); } };
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); }
    remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.className.split(/\s+/).includes(selector.slice(1))) return child;
            const found = child.querySelector(selector); if (found) return found;
        }
        return null;
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async dispatch(type, event = {}) { await Promise.all((this.listeners[type] || []).map(fn => fn({ preventDefault() {}, ...event }))); }
    async click() { if (!this.disabled) await this.dispatch("click"); }
    focus() { this.focused = true; }
}
function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, blocked: false,
        getItem(key) { if (this.blocked) throw new Error("Storage blocked"); return values.get(key) ?? null; },
        setItem(key, value) { if (this.blocked) throw new Error("Storage blocked"); values.set(key, value); },
        removeItem(key) { if (this.blocked) throw new Error("Storage blocked"); values.delete(key); } };
}

async function loadPage(options = {}) {
    const nav = new Element();
    const login = new Element("login-link"); login.setAttribute("href", "login.html");
    const mylist = new Element(); mylist.setAttribute("href", "mylist.html");
    nav.appendChild(login); nav.appendChild(mylist);
    const ids = Object.fromEntries(["login-form", "email", "password", "name", "name-error", "email-error", "password-error",
        "login-feedback", "toggle-password", "registration-name", "auth-submit", "auth-toggle", "auth-title",
        "account-panel", "account-message", "account-signout"].map(id => [id, new Element()]));
    const ready = [], events = {}, alerts = [], requests = [];
    const local = options.local || storage(), session = options.session || storage();
    const api = { user: options.user || null, failLogout: false, override: null };
    const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
    const window = {
        localStorage: local, sessionStorage: session,
        location: { pathname: "/login.html", search: options.registration ? "?mode=register" : "", href: "" },
        CineFlixMyList: { getMyListIds: () => ["movie-001"], isStorageAvailable: () => true },
        addEventListener(type, cb) { (events[type] ||= []).push(cb); },
        dispatchEvent(event) { for (const cb of events[event.type] || []) cb(event); },
        alert(message) { alerts.push(message); },
        async fetch(url, config) {
            requests.push({ url, ...config });
            if (api.override) { const result = api.override(url, config); if (result !== undefined) return result; }
            if (url.endsWith("/me")) return response(api.user ? { user: api.user } : { error: { code: "AUTH_REQUIRED" } }, api.user ? 200 : 401);
            if (url.endsWith("/logout")) { if (api.failLogout) throw new Error("offline"); api.user = null; return response({ message: "Signed out" }); }
            api.user = { ...signedUser };
            return response({ user: api.user }, url.endsWith("/register") ? 201 : 200);
        }
    };
    const document = {
        getElementById: id => ids[id],
        querySelector: selector => selector === ".login-link" ? login : selector === ".nav-links" ? nav : selector.includes("mylist.html") ? mylist : null,
        querySelectorAll: () => [login, mylist], createElement: () => new Element(),
        addEventListener(type, cb) { if (type === "DOMContentLoaded") ready.push(cb); }
    };
    const context = vm.createContext({ document, window, console, URLSearchParams, Event: class { constructor(type) { this.type = type; } } });
    for (const file of ["login.js", "navigation.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", file), "utf8"), context);
    ready.forEach(cb => cb());
    await flush();
    return { window, api, response, requests, local, session, nav, login, mylist, ids, alerts };
}

test("successful cookie login updates navigation and never stores identity/password/token", async () => {
    const page = await loadPage();
    page.ids.email.value = signedUser.email;
    page.ids.password.value = "a safe password phrase";
    await page.ids["login-form"].dispatch("submit"); await flush();
    const call = page.requests.find(call => call.url.endsWith("/login"));
    assert.equal(call.method, "POST");
    assert.equal(call.credentials, "same-origin");
    assert.deepEqual(JSON.parse(call.body), { email: signedUser.email, password: "a safe password phrase" });
    assert.equal(page.login.textContent, "My Account");
    assert(page.nav.querySelector(".signout-btn"));
    assert.equal(page.ids.password.value, "");
    assert.equal(page.ids["account-panel"].hidden, false);
    assert.equal(page.mylist.querySelector(".mylist-count").textContent, "1");
    const stored = [...page.local.values.values(), ...page.session.values.values()].join("");
    assert(!stored.includes(signedUser.email)); assert(!stored.includes("password"));
});

test("legacy demo sessions cannot impersonate a cookie-authenticated account", async () => {
    const local = storage({ cineflixDemoUser: JSON.stringify(signedUser) });
    const signedOut = await loadPage({ local });
    assert.equal(signedOut.login.textContent, "Login");
    for (const raw of ["not-json", "[]", '{"email":"fake@example.test"}']) {
        const page = await loadPage({ local: storage({ cineflixDemoUser: raw }), user: signedUser });
        assert.equal(page.login.textContent, "My Account"); assert.equal(page.login.title, signedUser.email);
    }
});

test("blocked browser storage does not prevent cookie login or logout", async () => {
    const local = storage(), session = storage(); local.blocked = session.blocked = true;
    const page = await loadPage({ local, session, user: signedUser });
    assert.equal(page.login.textContent, "My Account");
    await page.nav.querySelector(".signout-btn").click(); await flush();
    assert.equal(page.window.location.href, "login.html");
    assert.equal(page.login.textContent, "Login");
    assert.equal(page.alerts.length, 0);
});

test("session events, cross-tab notices and page restoration fetch current server identity", async () => {
    const page = await loadPage({ user: signedUser });
    for (const event of [{ type: "cineflix:session-updated" }, { type: "pageshow", persisted: true },
        { type: "storage", key: "cineflixSessionChange" }, { type: "focus" }]) {
        page.window.dispatchEvent(event); await flush();
    }
    assert.equal(page.nav.children.length, 3);
    page.api.user = null;
    page.window.dispatchEvent({ type: "storage", key: "cineflixSessionChange" });
    assert.equal(page.ids["account-panel"].hidden, true);
    await flush();
    assert.equal(page.login.textContent, "Login");
    assert.equal(page.nav.querySelector(".signout-btn"), null);
});

test("sign-out calls the API, clears legacy demo stores and preserves guest lists", async () => {
    const local = storage({ cineflixDemoUser: "old", cineflixMyList: '["movie-001"]' });
    const session = storage({ cineflixDemoUser: "old" });
    const page = await loadPage({ local, session, user: signedUser });
    await page.nav.querySelector(".signout-btn").click(); await flush();
    assert(page.requests.some(call => call.url.endsWith("/logout") && call.method === "POST"));
    assert.equal(local.getItem("cineflixDemoUser"), null); assert.equal(session.getItem("cineflixDemoUser"), null);
    assert.equal(local.getItem("cineflixMyList"), '["movie-001"]');
    assert.equal(page.window.location.href, "login.html");
});

test("failed sign-out preserves the account and reports the error without navigating", async () => {
    const page = await loadPage({ user: signedUser }); page.api.failLogout = true;
    await page.nav.querySelector(".signout-btn").click();
    assert.equal(page.window.location.href, "");
    assert.equal(page.login.textContent, "My Account");
    assert.equal(page.nav.querySelector(".signout-btn").disabled, false);
    assert.match(page.alerts[0], /Unable to sign out/);
});

test("registration validates name/password and sends only agreed account fields", async () => {
    const page = await loadPage({ registration: true });
    assert.equal(page.ids["registration-name"].hidden, false);
    await page.ids["login-form"].dispatch("submit");
    assert.match(page.ids["name-error"].textContent, /name/);
    assert.equal(page.requests.filter(call => call.method === "POST").length, 0);
    page.ids.name.value = "Test Viewer"; page.ids.email.value = signedUser.email; page.ids.password.value = "long password phrase";
    await page.ids["login-form"].dispatch("submit"); await flush();
    assert.deepEqual(JSON.parse(page.requests.find(call => call.url.endsWith("/register")).body),
        { name: "Test Viewer", email: signedUser.email, password: "long password phrase" });
    assert.equal(page.ids["auth-title"].textContent, "Your Account");
});

test("login errors remain visible and password visibility/mode switching work", async () => {
    const page = await loadPage();
    await page.ids["toggle-password"].click(); assert.equal(page.ids.password.type, "text");
    await page.ids["toggle-password"].click(); assert.equal(page.ids.password.type, "password");
    await page.ids["auth-toggle"].click(); assert.equal(page.ids["registration-name"].hidden, false);
    await page.ids["auth-toggle"].click(); assert.equal(page.ids["registration-name"].hidden, true);
    page.api.override = (url, options) => options.method === "POST" ? page.response({ error: { message: "Email or password is incorrect." } }, 401) : undefined;
    page.ids.email.value = signedUser.email; page.ids.password.value = "wrong password";
    await page.ids["login-form"].dispatch("submit");
    assert.match(page.ids["login-feedback"].textContent, /incorrect/);
    assert.equal(page.ids["auth-submit"].disabled, false);
    assert.equal(page.login.textContent, "Login");
});

test("late account reads cannot restore a previous identity after a newer logout", async () => {
    const page = await loadPage({ user: signedUser });
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    let heldRead = false;
    page.api.override = url => {
        if (url.endsWith("/me") && !heldRead) { heldRead = true; return pending; }
    };
    const oldRead = page.window.CineFlixAuth.refresh();
    await page.window.CineFlixAuth.logout();
    page.api.override = null;
    await page.window.CineFlixAuth.refresh();
    resolve(page.response({ user: signedUser })); await oldRead; await flush();
    assert.equal(page.window.CineFlixAuth.getState().user, null);
    assert.equal(page.login.textContent, "Login");
});

test("background refreshes during login or registration cannot discard successful sign-in", async () => {
    for (const method of ["login", "register"]) {
        const page = await loadPage();
        let complete;
        const pending = new Promise(resolve => { complete = resolve; });
        page.api.override = url => url.endsWith("/" + method) ? pending : undefined;
        const signIn = page.window.CineFlixAuth[method]({ email: signedUser.email, password: "a safe password phrase", ...(method === "register" ? { name: signedUser.name } : {}) });
        page.window.dispatchEvent({ type: "focus" });
        page.window.dispatchEvent({ type: "storage", key: "cineflixSessionChange" });
        await page.window.CineFlixAuth.refresh();
        page.api.user = signedUser;
        complete(page.response({ user: signedUser }, method === "register" ? 201 : 200));
        await signIn; await flush();
        assert.equal(page.window.CineFlixAuth.getState().user?.id, signedUser.id);
        assert.equal(page.login.textContent, "My Account");
        assert.equal(page.ids["account-panel"].hidden, false);
        assert(page.local.values.has("cineflixSessionChange"));
    }
});

test("background refreshes during logout cannot restore the previous signed-in view", async () => {
    const page = await loadPage({ user: signedUser });
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    page.api.override = url => url.endsWith("/logout") ? pending : undefined;
    const signOut = page.window.CineFlixAuth.logout();
    page.window.dispatchEvent({ type: "focus" });
    page.window.dispatchEvent({ type: "storage", key: "cineflixSessionChange" });
    await page.window.CineFlixAuth.refresh();
    page.api.user = null;
    complete(page.response({ message: "Signed out" }));
    await signOut; await flush();
    assert.equal(page.window.CineFlixAuth.getState().user, null);
    assert.equal(page.login.textContent, "Login");
    assert.equal(page.ids["account-panel"].hidden, true);
    assert(page.local.values.has("cineflixSessionChange"));
});

test("account service failure never falls back to a stored demo identity", async () => {
    const page = await loadPage({ local: storage({ cineflixDemoUser: JSON.stringify(signedUser) }) });
    page.api.override = () => { throw new Error("offline"); };
    await page.window.CineFlixAuth.refresh();
    assert.equal(page.window.CineFlixAuth.getState().status, "error");
    assert.equal(page.login.textContent, "Login");
    assert.match(page.ids["login-feedback"].textContent, /could not be loaded/);
});
