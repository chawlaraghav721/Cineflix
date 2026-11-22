"use strict";
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");
const { ratingsHttp } = require("./ratingsHttp.cjs");
const { startBackendProcess } = require("./movieNightServerProcess.cjs");
const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();
const browserSkip = !existsSync(executable) && "Install Playwright Chromium or set CINEFLIX_CHROME_PATH.";
const password = "private account ratings browser password";

async function ratingsBrowser(t) {
    const database = await ratingsHttp(t);
    let server = await startBackendProcess({ mongoUri: database.mongo.getUri(), secret: database.config.secret });
    t.after(async () => { await server.close(); });
    const browser = await chromium.launch({ headless: true, executablePath: executable });
    t.after(() => browser.close());
    const errors = [];
    async function page() {
        const context = await browser.newContext();
        t.after(() => context.close());
        await context.route("https://**/*", route => route.abort());
        context.on("page", p => p.on("pageerror", error => errors.push(error.message)));
        return context.newPage();
    }
    async function register(p, email) {
        await p.goto(server.origin + "/login.html?mode=register");
        await p.locator("#registration-name:not([hidden])").waitFor();
        await p.locator("#name").fill("Ratings Viewer"); await p.locator("#email").fill(email);
        await p.locator("#password").fill(password); await p.locator("#auth-submit").click();
        await p.locator("#account-panel:not([hidden])").waitFor();
    }
    const ready = p => p.locator('.rating-stars button[data-rating="1"]:not(:disabled)').waitFor();
    const saved = (p, score) => p.waitForFunction(value => document.querySelector(`.rating-stars button[data-rating="${value}"]`)?.getAttribute("aria-pressed") === "true"
        && document.getElementById("rating-message").textContent.includes("saved") && document.querySelector(".personal-rating").getAttribute("aria-busy") === "false", score);
    async function save(p, score, reviewText) {
        await ready(p); await p.locator(`[data-rating="${score}"]`).click();
        if (reviewText !== undefined) await p.locator("#rating-review").fill(reviewText);
        await p.locator("#save-rating").click(); await saved(p, score);
    }
    return { ...database, page, register, ready, saved, save, errors, password,
        get origin() { return server.origin; },
        async restart() { const port = server.port; await server.close(); server = await startBackendProcess({ mongoUri: database.mongo.getUri(), secret: database.config.secret, port }); }
    };
}
module.exports = { ratingsBrowser, browserSkip };
