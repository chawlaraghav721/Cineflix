# Ratings demonstration

Start the existing integrated server using `backend/README.md` and open it at the
configured `APP_ORIGIN` (normally `http://localhost:3000`). Use assigned demo
accounts; do not reset or clear shared collections. Automated database checks
already use disposable local MongoDB, independent of Atlas.

## Browser walkthrough

1. Signed out, open `details.html?id=movie-004` and select two stars. The mode note
   identifies a browser-only guest score.
2. Register/sign in and return to that title. There is no account rating yet;
   the guest score is not imported. Choose five stars, enter a review and press
   **Save rating & review**. Reload to see the saved score and text.
3. Open My Account. Its rating count, Rated by you titles and rating badges now
   reflect the account collection. My List still displays its saved titles and
   statuses independently.
4. In a separate browser profile, sign in as another account and save one star
   for the same title. Refresh the first Details page: average 3, count 2. Each
   editor still shows its own score and text.
5. Edit the first review, then clear the textarea and save to remove only the
   written text. Clear Rating removes both fields; the other account's record
   remains and the summary updates.
6. Sign out or change accounts in another tab. Private editor/count state clears
   while identity is checked; another account never inherits the previous draft.
7. Use Tab/Enter to select a score and save. Inspect narrow mobile sizes; controls,
   text and reviews wrap without horizontal overflow.

The automated Chrome suite performs these flows, failure/retry scenarios and an
actual backend restart against an isolated database. Desktop/mobile screenshots
are temporary local QA artifacts and can be visually inspected after the browser
test; they are not committed. The steps here are a repeatable demonstration,
not a claim that Postman or a physical phone was manually exercised.

## Postman requests

Set `baseUrl` to the exact configured origin. Use Postman's cookie jar, keep the
same hostname throughout and set `Origin: {{baseUrl}}` on mutations. Do not copy
cookies, passwords or local environment values into version control.

1. `POST {{baseUrl}}/api/auth/login` with your account's `{email,password}`. The
   response sets the existing HttpOnly session cookie.
2. `GET {{baseUrl}}/api/ratings/movie-004` works without authentication and returns
   average/count/recent reviews.
3. `PUT {{baseUrl}}/api/ratings/movie-004/me` with JSON
   `{"score":5,"reviewText":"A compelling story."}` returns that saved object.
4. `GET {{baseUrl}}/api/ratings/movie-004/me` returns
   `{"rating":{"score":5,"reviewText":"A compelling story."}}`.
5. PUT `{"score":4}` preserves the text. PUT `{"score":4,"reviewText":""}` clears
   it. `GET {{baseUrl}}/api/ratings` returns the account's rated titles for the
   dashboard.
6. `DELETE {{baseUrl}}/api/ratings/movie-004/me` returns 204 and no body. Repeat it
   to demonstrate idempotence; the public summary reflects the remaining users.
7. Try a string score, score 6, an extra `userId`, an unknown title, or an invalid
   Origin: expect 400, 404 or 403 as appropriate. Remove the cookie and try a
   private endpoint: expect 401. Supplying a different optional
   `X-Ratings-Account` value gives 409 and never changes ownership.

To explain the implementation, follow one save from router middleware through
controller, validation/service, explicit owner/title repository filter, Mongoose
schema and MongoDB unique index. Then follow the public aggregation separately:
all scores contribute to totals, while only recent nonempty reviews are shown.
