# 🎬 CineFlix

**CineFlix** is a movie and TV show discovery website built with vanilla HTML/CSS/JavaScript and a shared Express/MongoDB backend for catalogue data and account authentication.

The project lets users browse a catalogue, view title details, save movies and shows to a personal list, give star ratings, and organize a Movie Night vote. It is an **educational demo**, not a real streaming service.

## ✨ Features

- **Home page:** Featured movies, Previous/Next navigation, a *Surprise Me* option, and dynamically generated movie cards.
- **Movies and TV Shows:** Catalogue-driven listings with live search, genre filtering, title/year sorting, and reset controls.
- **Details page:** Information for a selected title using its unique catalogue ID, with poster, genre, year, and additional metadata when available. A trailer modal is supported when a valid trailer URL is provided.
- **My List:** Add or remove movies and shows, search saved titles, clear the list, and see the saved-item count in the navigation bar.
- **Personal ratings:** Rate individual movies or shows from 1 to 5 stars, update a rating, or clear it.
- **Movie Night:** Select exactly three movies, choose 2–10 participants, vote one turn at a time, and view vote totals, winners, or ties. Selections and voting progress are saved in the browser.
- **Accounts:** Register, sign in, view account details and sign out using secure server-managed cookies, with password hashing and server-side validation.
- **Contact form:** Validates name, email, and message and displays feedback (demo only; no message is sent).
- **Responsive design:** Layouts for desktop and mobile, with loading messages, error handling, and poster fallbacks.

## 🛠️ Technologies Used

| Technology | Purpose |
| --- | --- |
| HTML5 | Page structure, navigation, and forms |
| CSS3 | Styling, layouts, responsiveness, and animations |
| Vanilla JavaScript | DOM updates, events, and application logic |
| JSON | Shared movie and TV show catalogue |
| Fetch API | Same-origin catalogue and account requests |
| Node.js / Express | Shared API and frontend hosting |
| MongoDB / Mongoose | Catalogue and account persistence |
| scrypt / signed JWT cookies | Password hashing and short-lived authentication |
| Browser localStorage | Guest lists, personal ratings, votes and credential-free change notifications |
| Node.js built-in test runner | Running automated JavaScript tests |
| Git and GitHub | Version control and team collaboration |

Node.js 20 or later and a configured MongoDB database are required to run the integrated website. No frontend framework or external movie-data API is used.

## 📁 Project Structure

```text
Cineflix/
├── index.html                  # Home page
├── movies.html                 # Movie catalogue
├── shows.html                  # TV show catalogue
├── details.html                # Selected title details and ratings
├── mylist.html                 # Saved titles
├── movie-night.html            # Movie Night voting
├── login.html                  # Registration, sign-in and account display
├── data/
│   └── catalogue.json          # Shared movies and shows data
├── css/
│   ├── style.css               # Main website styles
│   ├── movie-night.css         # Movie Night styles
│   └── ratings.css             # Rating controls
├── js/                         # Catalogue and feature scripts
├── images/                     # CineFlix branding assets
├── backend/                    # Shared Express app, models, APIs and isolated database tests
├── docs/authentication.md      # Authentication integration and verification
├── tests/                      # Frontend regression tests
└── README.md
```

## 🚀 Getting Started

1. Clone the repository and open the project folder:

   ```bash
   git clone https://github.com/chawlaraghav721/Cineflix.git
   cd Cineflix
   ```

2. Open the folder in **VS Code** and install backend dependencies:

   ```bash
   cd backend
   npm ci
   ```

3. Copy `backend/.env.example` to `backend/.env`. Privately configure the shared `MONGODB_URI`, a random `JWT_SECRET` of at least 32 bytes, and `APP_ORIGIN=http://localhost:3000`. See [backend setup](backend/README.md) for the secret-generation command and production settings. Never commit `.env`.
4. After database access is available, seed the catalogue and start the server:

   ```bash
   npm run seed
   npm start
   ```

5. Open `http://localhost:3000/`. Catalogue and authentication APIs must run on the same origin as the pages; Live Server or `file://` alone does not provide these APIs.

Live shared Atlas verification is pending until team database access is configured. Automated integration tests use an isolated temporary database and do not require Atlas.

## ⚙️ How It Works

1. `data/catalogue.json` contains the shared catalogue of **20 movies and 10 TV shows**, each with a unique ID.
2. The seed command upserts catalogue entries by stable ID; `js/catalogue.js` loads `/api/catalogue` and validates the response.
3. JavaScript creates and updates the movie/show cards through DOM manipulation.
4. Clicking a card opens a Details page using a URL such as `details.html?id=movie-011`.
5. My List, personal ratings, and Movie Night save records against stable catalogue IDs, so users can return to them after refreshing the page.

User accounts are stored in MongoDB and sessions use HttpOnly cookies. My List, personal ratings and Movie Night still belong to the current browser until their backend integrations are completed; they are not automatically merged into accounts.

## 🧪 Running Tests

After installing backend dependencies, run this command from the project root:

```bash
node --test
```

The frontend suite uses Node's built-in test runner. Backend integration tests use `mongodb-memory-server` and real HTTP handlers against temporary test databases. Browser tests start the actual server, exercise cookie accounts, and restart it to check persistence. See [test commands](backend/README.md#tests) and the [authentication verification notes](docs/authentication.md#verification). A browser check is explicitly skipped if Playwright Chromium or a configured Chrome executable is unavailable.

## ℹ️ Project Scope and Limitations

- CineFlix does not stream or host full movies or TV episodes.
- Authentication cookies expire after one hour. Logout clears the browser cookie; copied stateless JWTs remain usable until expiry. Password reset, email verification and OAuth are outside the current scope.
- The contact form validates entries but does not deliver emails or messages.
- Saved lists, ratings, and votes are stored locally in the browser.
- Catalogue entries may have optional metadata; unavailable fields show fallback text. Trailer playback depends on a compatible embed URL being provided.
- Some poster images come from external URLs and may be unavailable if their source changes.

## 👥 Collaboration

CineFlix was built as a team college project. Development work was organized using Git feature branches, focused commits, and GitHub pull requests before integration into `main`.

---

**Project type:** B.Tech CSE college project<br>
**Status:** Catalogue backend and account authentication implemented; live shared Atlas verification and remaining account-backed feature integrations are pending.
