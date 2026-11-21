"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { integrationFixture } = require("../test-support/movieNightIntegration.cjs");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");
const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();

test("room UI lifecycle in two real authenticated browser contexts", {
    skip: !existsSync(executable) && "Install Chromium or set CINEFLIX_CHROME_PATH", timeout: 120000
}, async t => {
    const f = await integrationFixture(t);
    let server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret });
    t.after(async () => { await server.close(); });
    const browser = await chromium.launch({ headless: true, executablePath: executable }); t.after(() => browser.close());
    const host = await browser.newContext(), participant = await browser.newContext();
    t.after(async () => { await host.close(); await participant.close(); });
    const errors = [];
    for (const context of [host, participant]) {
        await context.route("https://**/*", route => route.abort());
        context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    }
    const a = await host.newPage(), b = await participant.newPage();
    async function signup(page, email) {
        await page.goto(server.origin + "/login.html?mode=register"); await page.locator("#registration-name:not([hidden])").waitFor();
        await page.locator("#name").fill("Room Viewer"); await page.locator("#email").fill(email);
        await page.locator("#password").fill("a safe independent room browser password");
        await page.locator("#auth-submit").click(); await page.locator("#account-panel:not([hidden])").waitFor();
    }
    await signup(a, "room-browser-host@example.test");
    await a.goto(server.origin + "/movie-night.html?mode=room&new=1");
    await a.locator("#night-room-panel:not([hidden])").waitFor();
    await a.getByRole("link", { name: "Choose movies for room" }).click();
    for (const id of ["movie-011", "movie-012", "movie-013"]) await a.locator(`.movie-card[data-id="${id}"]`).click();
    await a.getByRole("link", { name: "Continue to Movie Night" }).click();
    await a.locator("#night-room-create:not(:disabled)").waitFor(); await a.locator("#night-room-voters").fill("2");
    await a.locator("#night-room-create").click(); await a.locator("#night-room-state:not([hidden])").waitFor();
    const code = (await a.locator("#night-room-code").textContent()).replace("Room code: ", ""); assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    await a.locator("#night-room-enroll").click();
    await signup(b, "room-browser-participant@example.test"); await b.goto(server.origin + "/movie-night.html?mode=room");
    await b.locator("#night-room-panel:not([hidden])").waitFor(); await b.locator("#night-room-code-input").fill(code.toLowerCase());
    await b.getByRole("button", { name: "Join room", exact: true }).click(); await b.locator("#night-room-state:not([hidden])").waitFor();
    assert(!(await b.locator("#night-room-code").textContent()).includes(code));
    await a.bringToFront(); await a.locator("#night-room-start:not(:disabled)").waitFor();
    await a.locator("#night-room-start").click();
    await a.locator("#night-room-options button").first().waitFor();
    await b.bringToFront(); await b.locator("#night-room-options button").first().waitFor();
    const pendingRoomId = new URL(b.url()).searchParams.get("room");
    await b.route("**/api/movie-night/rooms/" + pendingRoomId, route => route.fulfill({ status: 503,
        contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Room temporarily offline" } }) }));
    await b.locator("#night-room-refresh").click();
    await b.waitForFunction(() => document.getElementById("night-feedback").textContent.includes("Room temporarily offline"));
    assert.equal(await b.locator("#night-room-panel").isVisible(), true);
    await b.unroute("**/api/movie-night/rooms/" + pendingRoomId);
    await b.locator("#night-room-refresh").click();
    await Promise.all([a.getByRole("button", { name: "Vote for Inception", exact: true }).click(),
        b.getByRole("button", { name: "Vote for Interstellar", exact: true }).click()]);
    await a.bringToFront(); await a.waitForFunction(() => document.getElementById("night-room-winner").textContent.includes("tie"));
    await b.bringToFront(); await b.locator("#night-room-refresh").click();
    await b.waitForFunction(() => document.getElementById("night-room-winner").textContent.includes("tie"));
    const roomId = new URL(a.url()).searchParams.get("room");
    const previousRound = (await f.Session.findById(roomId).lean()).roundId;
    const duplicate = await b.evaluate(async ({ roomId, roundId }) => {
        const response = await fetch(`/api/movie-night/rooms/${roomId}/votes/me`, { method: "PUT", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-Movie-Night-Round": roundId }, body: JSON.stringify({ itemId: "movie-012" }) });
        return response.status;
    }, { roomId, roundId: previousRound }); assert.equal(duplicate, 409);
    const port = server.port; await server.close(); server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret, port });
    await a.reload(); await a.waitForFunction(() => document.getElementById("night-room-winner").textContent.includes("tie"));
    await a.bringToFront(); a.once("dialog", dialog => dialog.accept()); await a.locator("#night-room-reset").click();
    await a.waitForFunction(() => document.getElementById("night-room-help").textContent.includes("Everyone is here"));
    await b.bringToFront(); await b.locator("#night-room-refresh").click();
    await b.waitForFunction(() => document.getElementById("night-room-help").textContent.includes("Waiting for the host"));
    const stale = await b.evaluate(async ({ roomId, roundId }) => (await fetch(`/api/movie-night/rooms/${roomId}/votes/me`, {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Movie-Night-Round": roundId },
        body: JSON.stringify({ itemId: "movie-012" }) })).status, { roomId, roundId: previousRound }); assert.equal(stale, 409);
    const roomUrl = b.url();
    const otherTab = await participant.newPage(); await otherTab.goto(roomUrl);
    await otherTab.locator("#night-room-state:not([hidden])").waitFor();
    await b.bringToFront(); await b.locator(".signout-btn").click(); await b.waitForURL("**/login.html");
    await otherTab.waitForFunction(() => document.getElementById("night-mode-message").textContent.includes("Signed out"));
    assert.equal(await otherTab.locator("#night-room-code").textContent(), "");
    assert.equal(await otherTab.locator("#night-room-tally").textContent(), "");
    await b.goto(roomUrl); await b.waitForFunction(() => document.getElementById("night-mode-message").textContent.includes("Sign in to open"));
    assert.equal(await b.locator("#night-room-state").isVisible(), false);
    for (const width of [320, 390, 1440]) {
        await a.setViewportSize({ width, height: 1000 }); assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.CINEFLIX_MOVIE_NIGHT_ARTIFACTS) {
            mkdirSync(process.env.CINEFLIX_MOVIE_NIGHT_ARTIFACTS, { recursive: true });
            await a.screenshot({ path: path.join(process.env.CINEFLIX_MOVIE_NIGHT_ARTIFACTS, `movie-night-room-${width}.png`), fullPage: true });
        }
    }
    assert.deepEqual(errors, []);
});
