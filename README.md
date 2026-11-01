# 🎬 CineFlix

**CineFlix** is a frontend movie and TV show discovery website developed as a collaborative college project using HTML, CSS, JavaScript, and JSON.

The project lets users browse a catalogue, view title details, save movies and shows to a personal list, give star ratings, and organize a Movie Night vote. It is an **educational demo**, not a real streaming service.

## ✨ Features

- **Home page:** Featured movies, Previous/Next navigation, a *Surprise Me* option, and dynamically generated movie cards.
- **Movies and TV Shows:** Catalogue-driven listings with live search, genre filtering, title/year sorting, and reset controls.
- **Details page:** Information for a selected title using its unique catalogue ID, with poster, genre, year, and additional metadata when available. A trailer modal is supported when a valid trailer URL is provided.
- **My List:** Add or remove movies and shows, search saved titles, clear the list, and see the saved-item count in the navigation bar.
- **Personal ratings:** Rate individual movies or shows from 1 to 5 stars, update a rating, or clear it.
- **Movie Night:** Select exactly three movies, choose 2–10 participants, vote one turn at a time, and view vote totals, winners, or ties. Selections and voting progress are saved in the browser.
- **Demo sign-in:** Client-side form validation, show/hide password, remember-me option, and sign-out.
- **Contact form:** Validates name, email, and message and displays feedback (demo only; no message is sent).
- **Responsive design:** Layouts for desktop and mobile, with loading messages, error handling, and poster fallbacks.

## 🛠️ Technologies Used

| Technology | Purpose |
| --- | --- |
| HTML5 | Page structure, navigation, and forms |
| CSS3 | Styling, layouts, responsiveness, and animations |
| Vanilla JavaScript | DOM updates, events, and application logic |
| JSON | Shared movie and TV show catalogue |
| Fetch API | Loading catalogue data into the website |
| Browser localStorage / sessionStorage | Saving demo sessions, lists, ratings, and votes |
| Node.js built-in test runner | Running automated JavaScript tests |
| Git and GitHub | Version control and team collaboration |

No frontend framework, backend server, database, or external movie-data API is required.

## 📁 Project Structure

```text
Cineflix/
├── index.html                  # Home page
├── movies.html                 # Movie catalogue
├── shows.html                  # TV show catalogue
├── details.html                # Selected title details and ratings
├── mylist.html                 # Saved titles
├── movie-night.html            # Movie Night voting
├── login.html                  # Demo login
├── data/
│   └── catalogue.json          # Shared movies and shows data
├── css/
│   ├── style.css               # Main website styles
│   ├── movie-night.css         # Movie Night styles
│   └── ratings.css             # Rating controls
├── js/                         # Catalogue and feature scripts
├── images/                     # CineFlix branding assets
├── tests/                      # Automated JavaScript tests
└── README.md
```

## 🚀 Getting Started

1. Clone the repository and open the project folder:

   ```bash
   git clone https://github.com/chawlaraghav721/Cineflix.git
   cd Cineflix
   ```

2. Open the folder in **VS Code**.
3. Use the **Live Server** extension to open `index.html` in your browser.

   Alternatively, if Python is installed, run:

   ```bash
   python -m http.server 5500
   ```

   Then visit `http://localhost:5500/`.

**Important:** Use a local HTTP server rather than opening the HTML files directly with a `file://` URL. The Fetch API needs to load `data/catalogue.json` correctly.

No `npm install` or build step is required to run the website.

## ⚙️ How It Works

1. `data/catalogue.json` contains the shared catalogue of **20 movies and 10 TV shows**, each with a unique ID.
2. `js/catalogue.js` loads and validates the data using `fetch()`.
3. JavaScript creates and updates the movie/show cards through DOM manipulation.
4. Clicking a card opens a Details page using a URL such as `details.html?id=movie-011`.
5. My List, personal ratings, and Movie Night save records against stable catalogue IDs, so users can return to them after refreshing the page.

The saved information belongs to the **current browser**, not an online account, and is not synchronized between devices.

## 🧪 Running Tests

Install Node.js if it is not already available, then run this command from the project root:

```bash
node --test
```

The `tests/` folder contains tests for browsing utilities, Movie Night, personal ratings, and integration/regression scenarios. Tests use Node.js's built-in test runner; no extra testing package is required.

## ℹ️ Project Scope and Limitations

- CineFlix is a **frontend demonstration**. It does not stream or host full movies or TV episodes.
- Login is a **demo session**, not secure server-side authentication.
- The contact form validates entries but does not deliver emails or messages.
- Saved lists, ratings, and votes are stored locally in the browser.
- Catalogue entries may have optional metadata; unavailable fields show fallback text. Trailer playback depends on a compatible embed URL being provided.
- Some poster images come from external URLs and may be unavailable if their source changes.

## 👥 Collaboration

CineFlix was built as a team college project. Development work was organized using Git feature branches, focused commits, and GitHub pull requests before integration into `main`.

---

**Project type:** B.Tech CSE college frontend project  
**Status:** Frontend functionality implemented; demo content can be expanded further.
