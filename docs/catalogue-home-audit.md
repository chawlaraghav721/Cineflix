# Catalogue and Home integration audit

Audit date: 2026-11-02. Integration baseline: `d4c9525` (`origin/main` at fetch).

## Repository findings

- The initial working tree was clean on `feat/catalogue-home` at `dd1941e`.
- Fetch discovered eight newer commits on its remote branch, ending at
  `c5d0d6a`, plus later integration work on main.
- All original commits (`a801fa4`, `d2fdc2b`, `dd1941e`) exist in main's ancestry.
  Main contains the feature merge `27a7767` and the later feature tip `c5d0d6a`.
- Continued on new branch `fix/catalogue-metadata-audit` from `origin/main`,
  preserving the old local feature branch and all existing history. No push,
  merge into main, reset, amendment or destructive operation was performed.
- Neither requested planning document was present in tracked files or the
  Desktop search. Requirements below therefore come from the supplied task and
  current public interfaces; compliance with unavailable documents is NOT TESTED.

## Catalogue findings

The original JSON had 20 movies and 10 shows, one nonempty description, one cast
array, one director and zero trailers. The populated credits belonged to an
unverified identity (`movie-004`), rather than to one of the recognized films.
The integration report was substantially accurate: missing data, rather than a
missing Details binding, explained the unavailable metadata and trailer button.

| Metric | Updated catalogue |
| --- | ---: |
| Movies | 20 |
| Shows | 10 |
| Globally unique, preserved IDs | 30 |
| Nonempty descriptions | 19 |
| Nonempty principal cast arrays | 19 |
| Nonempty director information | 19 |
| Trailer identities and oEmbed markup verified | 19 |
| Unresolved production identities | 11 |

See [metadata provenance](catalogue-metadata.md) for every researched production,
trailer publisher, unresolved field and reason. Explicit empty values are
intentional. The legacy `movie-004` rating and duration are unchanged but remain
unverified; the report does not certify those values as real production facts.

## Requirement-by-requirement review

PASS means the bounded behavior described was implemented and actually checked.
It does not imply exhaustive device, assistive-technology or external-service
coverage.

| Requirement | Status | Evidence |
| --- | --- | --- |
| JSON root and expected 20/10 entries | PASS | `data/catalogue.json`; automated parse, counts and root-key assertions |
| IDs unchanged; no removal, reordering or duplicate IDs/titles | PASS | `tests/catalogue-home.test.cjs` compares against original commit `a801fa4`; global ID/title sets |
| Titles, classifications, years, genres and poster paths preserved | PASS | Automated comparison of all six fields for every entry against original commit |
| Required and optional field types | PASS | Loader acceptance plus table-driven rejection tests; all requested metadata keys exist with compatible types |
| Accurate complete metadata for the entire catalogue | PARTIAL | 19 identified productions populated; 11 unresolved identities with explicit empties; legacy rating/runtime noted above |
| Poster references | PARTIAL | 29 HTTP 200 image responses; `show-006` DNS failure; successful delivery does not certify artwork identity; generic Unsplash images retained |
| Trailer references and syntactic validity | PASS | All 19 URLs match HTTPS YouTube embed + 11-character ID syntax; independent oEmbed title/publisher/iframe checks |
| Live playback of every trailer | NOT TESTED | All identities/oEmbed responses checked; actual media playback exercised for Endgame only |
| Exact shared public interface | PASS | `js/catalogue.js:45`, `:66`, `:70`, `:75`; Promise, fresh array and object-or-null return assertions |
| Fetch API and HTTP error handling | PASS | `js/catalogue.js:48`; HTTP 503 tests in Node and a served Chromium page |
| Promise caching and duplicate concurrent requests | PASS | Same Promise before/after completion; one deferred fetch call; successful cache also checked in browser |
| Invalid JSON/data and retry after failure | PASS | Network rejection, synchronous fetch exception, HTTP failure, JSON parse failure, invalid arrays, duplicate IDs and invalid item fields tested; subsequent success verified |
| DOM manipulation and safe text rendering | PASS | `js/home.js:33`, `:65`, `:81`; actual browser fixture with HTML-like title/description creates text, no injected elements |
| Dynamic Trending Now and Popular Movies | PASS | Five cards per grid from JSON; `index.html` contains no permanent movie-card markup; curated IDs remain in `js/home.js` |
| JSON-backed featured content | PASS | Starts with `movie-004`; title, metadata, description and links come from the selected object; missing description fallback verified |
| Previous/Next and wraparound | PASS | Real clicks verify forward/backward and first/last wraparound (`js/home.js:95`) |
| Surprise Me | PASS | 20 consecutive real clicks change selection; single-movie fixture remains stable; empty fixture disables action |
| Encoded Details URL generation | PASS | All ten rendered links checked; special-character ID fixture verifies `encodeURIComponent`; Movies/Shows card clicks resolve correct items |
| Loading, empty, failure and retry UI | PASS | Held HTTP request shows busy state/hidden links/disabled controls; 503 exposes retry; real retry renders cards; empty catalogue feedback verified |
| Missing or failed posters | PASS | Failed external requests produce ten accessible Home fallbacks; absent/unsafe Details posters and metadata fallbacks exercised |
| Responsive layout | PASS | Chromium widths 320/390/768/1440 across seven pages, 28 checks with no horizontal overflow; Home desktop/mobile screenshots inspected after intro animation |
| Basic accessibility | PASS | Native controls, disabled/hidden states, live status and fallback labels reviewed; trailer Escape/focus restoration and Tab wrapping exercised |
| Full assistive-technology and cross-browser accessibility | NOT TESTED | No screen-reader, Firefox, Safari or physical-device certification performed |
| Details URL lookup and metadata bindings | PASS | `js/details-integration.js:17`; all 30 URL-selected entries render correct title/summary/cast/director and fallback states |
| Watch Trailer integration | PASS | All 19 stored URLs activate button/modal/iframe; Escape clears source and restores focus; actual Endgame playback reached readyState 4 with increasing currentTime and no media error |
| Strict rejection of malformed trailer identifiers | PARTIAL | Details allows any non-slash embed path segment; reproduced with `not-a-video-id`. Current catalogue has no such URLs. Existing Details-owner defect; see below |
| Missing trailer/disallowed provider fallback | PASS | Empty URLs, unsafe protocols, credentials, non-approved host and watch-page URLs hide/disable trailer button |
| Navigation | PASS | Current-page state reviewed; Home/Movies/Shows/Details/My List links and account/sign-out interactions exercised |
| Contact form | PASS | Empty submission marks invalid input; valid submission reports demo-only success and sends no message |
| Login and Remember Me | PASS | Real submissions store demo identity in sessionStorage or localStorage as selected, clear password, omit password from saved identity |
| Sign-out | PASS | Account link appears on navigation; sign-out clears both stores and returns to login |
| Movies and Shows regression | PASS | 20/10 cards; title search; actual Details navigation; existing filter/sort/reset/retry tests pass |
| My List regression | PASS | Actual add, badge count, persisted list render and removal; existing ratings/My List integration tests pass |
| Personal ratings regression | PASS | Existing suite covers all 30 entries, persistence, migration, invalid data and storage errors |
| Movie Night regression | PASS | Actual three-ID selection, two votes, winner, reload persistence; existing migration/retry/storage/keyboard tests pass |
| JavaScript syntax and whitespace | PASS | All production/test JS files checked with Node `--check`; `git diff --check` clean |
| Original planning-document compliance | NOT TESTED | Requested documents unavailable; no instruction documents added to commits |

## Executed verification

1. Ran the original test suite before changes: **51 passed, 0 failed**.
2. Added 22 durable tests in `tests/catalogue-home.test.cjs`. Full suite after
   metadata changes: **73 passed, 0 failed**. Tests do not make external requests.
   Run with Node 18+:

   ```powershell
   node --test tests/*.test.cjs tests/*.test.js
   ```

   Node was not on this machine's PATH. Execution used the Node binary bundled
   with the locally installed Python Playwright driver, without adding project
   runtime dependencies or package manifests.
3. Served the repository using `python -m http.server 8765 --bind 127.0.0.1`.
   All browser tests used HTTP, never `file://`.
4. Installed Python Playwright and its Chromium browser outside the repository.
   Executed ten browser scenario groups plus uncaught-error monitoring: all
   passed, no uncaught page errors. Tests covered 30 Details entries, 19 trailer
   modal flows, dynamic Home controls/states, browsing, storage/account/contact,
   Movie Night, and 28 responsive page/width combinations. External resources
   were deliberately aborted in deterministic scenarios to exercise fallbacks.
   Supplemental served-browser checks passed for empty, unsafe and missing-file
   Home poster URLs and actual featured-to-Details link navigation.
5. Independently requested all 30 poster URLs and all 19 stored video oEmbed
   endpoints over the network. Results are described above and in provenance.
6. Ran a separate browser with external resources enabled. Endgame's real
   embedded player loaded from YouTube, played after an actual click, and
   reported `paused: false`, `currentTime: 1.645306`, `readyState: 4`, no error.
   Also verified dialog Tab/Shift+Tab wrapping. This is a representative playback
   check, not a claim that every external video was played.
7. Ran JS syntax checks and Git whitespace checks. Temporary browser script,
   screenshots and network-result files were kept outside the repository under
   the Windows temporary directory (`cineflix-browser-audit.py`, `cineflix-audit/`).

An initial live-browser attempt timed out waiting for the trailer button; a
subsequent independent attempt loaded correctly and the final playback check
succeeded. No production fix was inferred from that isolated timeout.

## Integration notes and separate ownership

- **Catalogue identity decisions:** confirm what `movie-001` through `movie-010`
  and `show-004` represent. Do not rename, renumber, reclassify or replace them
  automatically. Clarify the legacy rating/runtime for `movie-004` too.
- **Poster curation:** Run Away's existing host failed DNS. Some working images
  are generic illustrations rather than production posters. Existing fallback
  behavior works; no poster paths were silently replaced.
- **Details validator:** `js/details.js:126` uses `/embed/[^/]+` and
  `/video/[^/]+`, so an approved host with `not-a-video-id` still shows Watch
  Trailer. Reproduced through `CineFlixDetails.render`. The owner should validate
  YouTube IDs with `[A-Za-z0-9_-]{11}` and Vimeo IDs as numeric, and replace the
  existing `test-video` fixture in `tests/personal-ratings.test.cjs`. This is an
  existing validation limitation, not introduced by the catalogue changes. No
  Details-owned implementation was changed.
- The three `window.CineFlixCatalogue` methods and their return contracts are
  unchanged. Optional metadata remains backward compatible. Current browsing,
  Details, My List, ratings and Movie Night all use the same preserved IDs.
- Home's curated sections intentionally still reference the first ten movies.
  Until those identities are resolved, their descriptions remain unavailable;
  featured navigation can also reach the ten fully researched movies.

## Final verdict

**NO: the entire Catalogue + Home assignment cannot yet be certified fully
complete.** The loader, dynamic Home implementation and tested integrations work.
The metadata update is compatible and locally verified, but eleven production
identities, the unverified legacy runtime/rating and poster curation remain open.
The Details validator correction belongs to its owner. Missing planning documents
and unexercised external playback across all videos are explicit verification
limits, not silently passed requirements.

## Pull request summary

Complete verified summaries, principal casts, scoped directing credits and
official trailer references for 19 catalogue entries. Preserve all 30 IDs and
existing identity fields and poster paths. Clear unsupported legacy credits for
The Last Run and document the eleven unresolved identities rather than assigning
unrelated production metadata.

Add regression coverage for catalogue identity preservation, schema validation,
the public loader contract, concurrent Promise caching and failure/retry behavior.
Validation: 73 automated tests passed, served Chromium interaction checks passed,
28 responsive checks passed, 19 trailer oEmbed identities confirmed, representative
embedded playback succeeded, JavaScript syntax and whitespace checks passed.

Remaining integration decisions: identify the unresolved productions, curate
poster assets and have the Details owner tighten malformed video-ID validation.
