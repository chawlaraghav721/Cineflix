# Member 4: Postman demonstration and viva

## Postman

Import [CineFlix-MyList.postman_collection.json](postman/CineFlix-MyList.postman_collection.json). Set `baseUrl` to the exact backend `APP_ORIGIN`, normally `http://localhost:3000`, without a trailing slash. Use a dedicated demonstration account. The collection creates one using a timestamp email unless `email` is supplied. `password` is a public demonstration placeholder; use a private local value for a real account. Do not export real passwords or cookie jars.

Run the collection in order. Postman's cookie jar retains the HttpOnly login cookie. Every request includes `Origin: {{baseUrl}}`. It contains 14 requests and 19 assertions covering registration, empty read, movie save, duplicate `409`, status update, persisted read, show save, unknown title `404`, invalid status `400`, individual deletion, clear, empty read, logout and unauthenticated `401`.

To run the local file through the installed CLI without reporting run events to Postman cloud:

```sh
postman collection run docs/postman/CineFlix-MyList.postman_collection.json --no-report-events --env-var baseUrl=http://localhost:3000
```

Start the integrated backend first. Automated verification of this collection used only a disposable local database. Running it against your ordinary development server creates a dedicated account and changes only that account's list. It does not delete the account itself or clear other accounts' lists.

A short manual demonstration:

1. Register or log in using `/api/auth/register` or `/api/auth/login` and the Origin header.
2. POST `/api/my-list` with `{"itemId":"movie-004"}`. Expect `201` and default `want-to-watch`.
3. Repeat the POST. Expect `409`.
4. PATCH `/api/my-list/movie-004` with `{"status":"watched"}`. Expect `200`.
5. GET `/api/my-list`, then refresh My List in the browser. The same status remains saved.
6. Use a second account with a separate cookie jar. GET returns its own list; PATCH/DELETE of A's unsaved item returns `404`.
7. DELETE `/api/my-list/movie-004` to remove one item, or DELETE `/api/my-list` to clear only the current account. Expect `204` with no body.
8. Sign out and GET the list. Expect `401`.

## Professor demonstration

Sign in as A, save two movies and one show through Details, then open My List. Mark one title Watched and another Watching. Switch among All, Want to Watch, Watching and Watched, then search by title. Show the navbar count and account preview. Refresh and show that statuses remain. Sign out: the separate guest list appears. Sign in as B: A's titles are absent. Return to A: its list is intact. Clear A's list and verify B's list remains. In Postman, show one duplicate `409`, one invalid status `400`, and one logged-out `401`.

If MongoDB inspection is available, filter `watchlists` by the demonstration account's User ObjectId. Explain `user`, catalogue `itemId`, `status`, timestamps and the compound unique index. Do not display connection credentials or tokens in screenshots.

## Ten easy viva questions

1. **What does your module do?** It saves each account's movies and shows and tracks whether the user wants to watch, is watching, or has watched them.
2. **Why use MongoDB instead of only localStorage?** Account lists persist on the server across visits and devices; localStorage is used only for a separate guest list.
3. **What identifies a saved title?** The catalogue's stable string ID, such as `movie-004`, rather than the title document's MongoDB `_id`.
4. **How do you identify the owner?** The shared verified-cookie middleware attaches `req.user.id`; every database query uses it.
5. **Can a client supply another userId?** No. Ownership fields in POST/PATCH are rejected, and the server never uses a browser-supplied owner.
6. **Why use a compound unique index?** It prevents the same user saving a title twice, including concurrent requests, while allowing other users to save it.
7. **What do POST, PATCH and DELETE do?** POST creates an entry, PATCH changes its status, and DELETE removes one entry or clears the current user's list.
8. **Why use async/await?** Network and database operations finish later; awaiting them prevents treating an unresolved Promise as a saved/not-saved result.
9. **What happens when the API fails?** The UI shows a friendly error with retry where appropriate, avoids pretending a change succeeded, and does not expose guest or another account's data as fallback.
10. **How did you test safely?** Node, HTTP and real-browser tests used disposable local MongoDB, verified cookies, separate accounts, failed requests, concurrent adds, refreshes and a server restart. The shared Atlas database was untouched.
