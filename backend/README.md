# CineFlix backend

The Express app serves the existing frontend and `/api` routes from the same origin. MongoDB access is centralized in `src/config/db.js`; the backend connects once before it starts listening.

## Local setup

1. From the repository root, install backend dependencies:

   ```sh
   cd backend
   npm install
   ```

2. Set your private Atlas connection string in `backend/.env` as `MONGODB_URI`. The file is ignored by Git. `backend/.env.example` contains variable names and a placeholder only.
3. Seed the shared development database with the 30 checked-in catalogue items:

   ```sh
   npm run seed
   ```

   Seeding upserts by the stable catalogue `id`; rerunning it does not create duplicate titles or remove other records.
4. Start the integrated website and API:

   ```sh
   npm start
   ```

   Open <http://localhost:3000>. `npm run dev` restarts the server when backend source files change.

The server exits before listening if `MONGODB_URI` is missing or MongoDB cannot be reached. `GET /api/health` reports the database connection state. Do not put database credentials in frontend files or commit `.env`.

## Catalogue endpoints

| Method and path | Result |
|---|---|
| `GET /api/health` | `{ "status": "ok", "database": "connected" }` when ready |
| `GET /api/catalogue` | `{ "movies": [...], "shows": [...] }`, compatible with the current frontend |
| `GET /api/titles/:itemId` | One title selected by its stable catalogue ID |
| `GET /api/titles?type=&q=&genre=&sort=&page=&limit=` | `{ "items": [...], "total": n, "page": n, "limit": n }` |

Sort values are `title_asc`, `title_desc`, `year_asc`, and `year_desc`. Page defaults to 1, limit defaults to 12 and is capped at 50. Query errors and API failures use `{ "error": { "code", "message" } }`.

Admin title creation, update, and deletion are intentionally not mounted yet. They require Member 2's real `requireAuth` and `requireAdmin` middleware; the current demo login is not server authentication and must not authorize catalogue changes. Once that middleware is integrated, add the protected `POST /api/titles`, `PATCH /api/titles/:itemId`, and `DELETE /api/titles/:itemId` routes.

## Tests

Run the existing frontend/regression suite from the repository root:

```sh
node --test
```

Run the backend integration suite:

```sh
cd backend
npm test
```

Backend tests use `mongodb-memory-server` and an isolated temporary MongoDB instance; they do not connect to or clear Atlas data. The first test run may download a MongoDB test binary.
