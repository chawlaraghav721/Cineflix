"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");
const { integrationFixture } = require("../test-support/movieNightIntegration.cjs");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");
const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();

test("Movie Night guest and account frontend with real cookies, MongoDB and server restart", {
    skip: !existsSync(executable) && "Install Chromium or set CINEFLIX_CHROME_PATH", timeout: 90000
}, async t => {
    const f = await integrationFixture(t);
    let server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret });
    t.after(async () => { await server.close(); });
    const browser = await chromium.launch({ headless: true, executablePath: executable }); t.after(() => browser.close());
    const a = await browser.newContext(), b = await browser.newContext(), guest = await browser.newContext();
    t.after(async () => { await Promise.all([a.close(), b.close(), guest.close()]); });
    const errors = [];
    for (const context of [a, b, guest]) {
        await context.route("https://**/*", route => route.abort());
        context.on("page", page => page.on("pageerror", e => errors.push(e.message)));
    }
    const page = await a.newPage();
    async function signup(page, email) {
        await page.goto(server.origin + "/login.html?mode=register");
        await page.locator("#registration-name:not([hidden])").waitFor();
        await page.locator("#name").fill("Night Viewer"); await page.locator("#email").fill(email);
        await page.locator("#password").fill("a private browser movie night password"); await page.locator("#auth-submit").click();
        await page.locator("#account-panel:not([hidden])").waitFor();
    }
    await signup(page, "night-browser-a@example.test");
    const guestState = { selected: [], voters: 4, votes: [], started: false };
    await page.evaluate(value => localStorage.setItem("cineflixMovieNightV1", JSON.stringify(value)), guestState);
    await page.goto(server.origin + "/movie-night.html?new=1");
    await page.waitForFunction(() => document.getElementById("night-mode-message").textContent.includes("Saved to your account"));
    await page.locator("#night-choose").click();
    await page.locator('.movie-card[data-id="movie-011"]').focus(); await page.keyboard.press("Space");
    await page.locator('.movie-card[data-id="movie-012"]').click(); await page.locator('.movie-card[data-id="movie-013"]').click();
    assert.equal(await page.locator('.movie-card[aria-checked="true"]').count(), 3);
    await page.getByRole("link", { name: "Continue to Movie Night" }).click();
    await page.locator("#night-start:not(:disabled)").waitFor(); await page.locator("#night-voters").fill("2");
    await page.locator("#night-start").click(); await page.locator("#night-voting:not([hidden])").waitFor();
    await page.getByRole("button", { name: "Vote for Inception", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("night-progress").textContent.startsWith("Vote 2"), undefined, { timeout: 5000 }).catch(async error => {
        t.diagnostic(JSON.stringify(await page.evaluate(() => ({ progress: document.getElementById("night-progress").textContent,
            feedback: document.getElementById("night-feedback").textContent, voters: document.getElementById("night-voters").value })))); throw error;
    });
    assert.equal(await page.locator("#night-progress").textContent(), "Vote 2 of 2");
    const activeUrl = page.url();
    const port = server.port; await server.close(); server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret, port });
    await page.reload(); await page.waitForFunction(() => document.getElementById("night-progress").textContent === "Vote 2 of 2");
    await page.getByRole("button", { name: "Vote for Interstellar", exact: true }).click();
    await page.locator("#night-results:not([hidden])").waitFor();
    assert.match(await page.locator("#night-winner").textContent(), /tie/);
    await page.reload(); await page.locator("#night-results:not([hidden])").waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixMovieNightV1"))), guestState);
    const second = await b.newPage(); await signup(second, "night-browser-b@example.test");
    await second.goto(activeUrl); await second.waitForFunction(() => document.getElementById("night-feedback").textContent.includes("not found"));
    assert.equal(await second.locator("#night-results").isVisible(), false);
    await page.route("**/api/movie-night/sessions", route => route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Test API unavailable" } }) }));
    await page.locator("#night-retry").click(); await page.waitForFunction(() => document.getElementById("night-feedback").textContent.includes("Test API unavailable"));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixMovieNightV1"))), guestState);
    await page.unroute("**/api/movie-night/sessions");
    const demo = await guest.newPage(); await demo.goto(server.origin + "/movie-night.html");
    await demo.waitForFunction(() => document.getElementById("night-mode-message").textContent.includes("Guest demo"));
    await demo.locator("#night-choose").click();
    for (const id of ["movie-011", "movie-012", "movie-013"]) await demo.locator(`.movie-card[data-id="${id}"]`).click();
    await demo.getByRole("button", { name: "Continue to Movie Night" }).click();
    await demo.locator("#night-start:not(:disabled)").waitFor(); await demo.locator("#night-voters").fill("2"); await demo.locator("#night-start").click();
    await demo.getByRole("button", { name: "Vote for Inception", exact: true }).click(); await demo.reload();
    await demo.waitForFunction(() => document.getElementById("night-progress").textContent === "Vote 2 of 2");
    for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    assert.deepEqual(errors, []);
});
