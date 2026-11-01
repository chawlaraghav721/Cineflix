const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const key = 'cineflixDemoUser';
const user = JSON.stringify({ email: 'student@example.com', signedInAt: '2026-11-02T00:00:00Z' });
class Element {
    constructor(className = '') {
        this.className = className;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.dataset = {};
        this.style = {};
        this.textContent = '';
        this.value = '';
        this.classList = {
            add: name => { this.className += ' ' + name; },
            remove: name => { this.className = this.className.split(/\s+/).filter(c => c !== name).join(' '); }
        };
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); }
    remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.className.split(/\s+/).includes(selector.slice(1))) return child;
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners[type] || []) listener({ preventDefault() {}, ...event }); }
    click() { this.dispatch('click'); }
}
function storage(raw = null) {
    return {
        raw, readsBlocked: false, removalsBlocked: false,
        getItem() { if (this.readsBlocked) throw new Error('Read blocked'); return this.raw; },
        setItem(name, value) { assert.equal(name, key); this.raw = value; },
        removeItem() { if (this.removalsBlocked) throw new Error('Removal blocked'); this.raw = null; }
    };
}
function loadPage(local = storage(), session = storage()) {
    const nav = new Element();
    const login = new Element('login-link');
    login.textContent = 'Login';
    login.setAttribute('href', 'login.html');
    const mylist = new Element();
    mylist.setAttribute('href', 'mylist.html');
    nav.appendChild(login);
    nav.appendChild(mylist);
    const ids = Object.fromEntries(['login-form', 'email', 'password', 'email-error', 'password-error', 'login-feedback', 'toggle-password', 'remember'].map(id => [id, new Element()]));
    const ready = [];
    const events = {};
    const alerts = [];
    const window = {
        localStorage: local, sessionStorage: session,
        location: { pathname: '/login.html', href: '' },
        CineFlixMyList: { getMyListIds: () => [], isStorageAvailable: () => true },
        addEventListener(type, cb) { (events[type] ||= []).push(cb); },
        dispatchEvent(event) { for (const cb of events[event.type] || []) cb(event); },
        alert(message) { alerts.push(message); }
    };
    const document = {
        getElementById: id => ids[id],
        querySelector: selector => selector === '.login-link' ? login : selector === '.nav-links' ? nav : selector.includes('mylist.html') ? mylist : null,
        querySelectorAll: () => [login, mylist],
        createElement: () => new Element(),
        addEventListener(type, cb) { if (type === 'DOMContentLoaded') ready.push(cb); }
    };
    const context = vm.createContext({ document, window, localStorage: local, sessionStorage: session, console, Event: class { constructor(type) { this.type = type; } } });
    for (const file of ['login.js', 'navigation.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
    ready.forEach(cb => cb());
    return { window, local, session, nav, login, ids, alerts };
}

test('successful demo login updates navigation immediately without storing the password', () => {
    const page = loadPage();
    page.ids.email.value = 'student@example.com';
    page.ids.password.value = 'demo-password';
    page.ids['login-form'].dispatch('submit');
    assert.match(page.ids['login-feedback'].textContent, /successful/);
    assert.equal(page.login.textContent, 'My Account');
    assert(page.nav.querySelector('.signout-btn'));
    assert.equal(page.local.raw, null);
    assert.equal(JSON.parse(page.session.raw).email, 'student@example.com');
    assert(!page.session.raw.includes('demo-password'));
    assert.equal(page.ids.password.value, '');
});

test('invalid stored sessions cannot hide a valid session or impersonate a signed-in user', () => {
    for (const raw of ['not-json', '[]', '{}', '"user"', '{"email":17}', '{"email":""}']) {
        assert.equal(loadPage(storage(raw)).login.textContent, 'Login');
        const page = loadPage(storage(raw), storage(user));
        assert.equal(page.login.textContent, 'My Account');
        assert.equal(page.login.title, 'student@example.com');
    }
});

test('a blocked persistent store does not prevent reading a valid session login', () => {
    const local = storage();
    local.readsBlocked = true;
    assert.equal(loadPage(local, storage(user)).login.textContent, 'My Account');
});

test('session events and page restoration refresh navigation without duplicate sign-out buttons', () => {
    const page = loadPage(storage(user));
    for (const type of ['cineflix:session-updated', 'pageshow', 'storage']) {
        page.window.dispatchEvent({ type, key });
    }
    assert.equal(page.nav.children.length, 3);
    page.local.raw = null;
    page.window.dispatchEvent({ type: 'storage', key });
    assert.equal(page.login.textContent, 'Login');
    assert.equal(page.nav.querySelector('.signout-btn'), null);
    page.session.raw = user;
    page.window.dispatchEvent({ type: 'pageshow' });
    assert.equal(page.login.textContent, 'My Account');
});

test('sign-out clears both demo stores and navigates to login', () => {
    const page = loadPage(storage(user), storage(user));
    page.nav.querySelector('.signout-btn').click();
    assert.equal(page.local.raw, null);
    assert.equal(page.session.raw, null);
    assert.equal(page.window.location.href, 'login.html');
});

test('failed sign-out reports the failure instead of throwing or navigating away', () => {
    const page = loadPage(storage(user), storage(user));
    page.local.removalsBlocked = true;
    assert.doesNotThrow(() => page.nav.querySelector('.signout-btn').click());
    assert.equal(page.local.raw, user);
    assert.equal(page.session.raw, null);
    assert.equal(page.window.location.href, '');
    assert.match(page.alerts[0], /Unable to.*session/);
});
