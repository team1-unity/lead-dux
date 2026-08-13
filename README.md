# Lead-Dux

**A gamified way into real leadership.**

Lead-Dux turns community involvement into a game a member levels up in. Local organizations (nonprofits, schools, libraries, and similar) post "quests" — real one-off or recurring volunteer and leadership opportunities — and members take them on, check in with a QR code when they show up, and earn points that grow their Leadership Rank (Iron → Bronze → Silver → Gold → Diamond). Reach the top rank and you receive an official Leader Certificate. Along the way there are badges to earn, a private journal of reflections on what you did (with organizations able to respond with encouraging, AI-summarized feedback), and quests recommended for you based on what you've actually gone and done, not just what you clicked on.

The goal, in the app's own words: get people off their phones and into their communities, then have them pay it forward by bringing the next wave of leaders in behind them.

## Who it's for

- **Leaders** (regular members) — people looking for real, structured ways to get involved locally and build a track record of leadership they can point to (points, rank, badges, an actual certificate).
- **Organizations** — nonprofits, schools, and community groups that need volunteers, want a lightweight way to post opportunities and verify who actually showed up, and want reviews/ratings that build a public reputation (a Trust Score) over time.
- **Admins** — oversee the whole system: approve new organizations, moderate side-quest submissions, manage roles, and post admin-run "neighborhood" quests for anyone not yet matched with a specific organization.

## Live App

[https://lead-dux.web.app](https://lead-dux.web.app)

---

## Core Features

### For Leaders

- Browse and filter **quests** (organization-run) and **side quests** (admin-run "neighborhood" quests, tiered Iron–Diamond and gated by your own current rank), search by `#tag`, sort by Recommended/Newest/Soonest, RSVP, and add an event straight to your calendar.
- **Explore geographically** on a map (MapLibre), sorted by distance, with a bottom-sheet quest list on mobile.
- **QR check-in** — scan the event's QR (with the in-app scanner or your phone's own camera) to check in and earn points; a durable link works either way.
- **Leadership Rank & points** — Iron/Bronze/Silver/Gold/Diamond, 100 points per rank. Points come from completing a quest, an optional bonus/proof photo, and answering a request for feedback that scores well.
- **Badges** — 17 in total: completion-count milestones, a side-quest badge, an "explorer" badge for spreading across organizations, a "rising fast" badge for climbing quickly, and one badge per activity tag (community, education, environment, outdoors, technology, youth, fitness, food security, arts).
- **Journal** — a private reflection per completed organization quest; request feedback from the organization and get back an AI-generated encouraging summary (never the raw numbers) plus an optional growth area.
- **AI-recommended quests** — recommendations refresh periodically based on your real attendance history (not just onboarding answers), falling back to simple tag-overlap relevance for anything new.
- **Proof/bonus photos** — upload a photo (and, for side quests, a written reflection) as part of completing a quest; organizations review and approve/reject it.
- **Reviews** — rate and review a quest once you've attended it.
- **Duck avatar** — pick from a handful of illustrated duck skins (Straw Hat, Bow, Chef, Frog) as your profile picture if you haven't uploaded one.
- **Certificate** — a downloadable certificate once an admin issues one for reaching Diamond rank.
- Public **share links** for any organization quest, and a public **organization profile** page (About, Trust tag, active quests, a community photo gallery), reachable without an account.

### For Organizations

- **Quest management** — create one-off or recurring quests (with a recurrence pattern and end date), required accessibility accommodations, optional capacity, tags, and cover photos; edit, share, or delete a single date or an entire series.
- **QR check-in** — generate, view, or regenerate an event's check-in QR code; regenerating invalidates the old one.
- **Attendee list** and **inline reviews** for each quest.
- **Photo submission review** — approve or reject members' proof/bonus photos, with a reason on rejection; approved organization-quest photos can be promoted into the org's public Community Photos gallery.
- **Feedback requests** — answer a fixed 5-question rubric when a member requests feedback on a completed quest; an AI-generated summary of your answers is what actually reaches the member (the raw scores never are).
- **Organization profile** — logo (with a crop tool), mission statement, category, contact info, social links, location/activity tags, and a public photo gallery. No logo yet? Every organization is assigned a unique, illustrated duck-mascot color instead of a plain initials tile.
- **Trust Score** — a public tag (New / Trustworthy / Under Review) computed from review ratings once an organization has enough reviews; the raw numeric score is never shown publicly.
- **Private host journal** — an organization's own reflections on quests it's hosted, separate from what members see.
- Dashboard stats: pending photo submissions, pending feedback requests, and quest counts at a glance.

### For Admins

- Review and approve (or leave pending) organization signup requests.
- Manage every account and reassign any role directly.
- View all approved organizations (with computed Trust Score/flagged status) and delete one, cascading its quests.
- Create and manage admin-run "side quests" (one-off or recurring, with a required difficulty tier) visible to everyone.
- Review pending side-quest photo submissions.
- Manually issue Leader Certificates to members who've reached Diamond rank (never automatic).
- A one-time/re-runnable tool to backfill map coordinates for quests created before the map existed.

### Cross-cutting

- **AI** — Google Gemini powers both the quest-recommendation ranking and the natural-language feedback summaries described above; both fail safe (silently skipped, or a generic fallback) if the model call doesn't succeed, so neither feature can break the app.
- **Mobile app** — an Android build is already generated (Capacitor), sharing the exact same web build Firebase Hosting serves. iOS hasn't been set up yet.
- **Demo mode** — a set of unauthenticated `/demo-*` routes that seed and drive a self-contained, presentation-ready demo (fixed demo organization/leader/quest) without needing a service account or CLI access.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router 7, Framer Motion, Vite, Vitest, oxlint |
| Map | MapLibre GL JS with a MapTiler-hosted vector style |
| QR codes | `html5-qrcode` (in-app scanning), `qrcode`+Pillow (server-side generation) |
| Location autocomplete | Geoapify |
| Image cropping | react-easy-crop (avatar/logo uploads) |
| Backend | Firebase Cloud Functions, Python 3.13, `firebase_admin` |
| AI | Google Gemini (`google-genai`) — quest recommendations, feedback summaries |
| Database | Cloud Firestore |
| File storage | Firebase Storage (photo submissions, org/quest galleries, avatars, journal backgrounds) |
| Auth | Firebase Authentication — email/password and Google OAuth, custom claims for roles |
| Hosting | Firebase Hosting |
| Mobile | Capacitor (Android shell generated and working; no iOS project yet) |
| Styling | Hand-authored CSS (`frontend/template/style.css`) — no CSS framework |

There is no separate CSS/animation library beyond Framer Motion, and no "hand-drawn/sketch" rendering library (an earlier design pass considered one; the current visual style is plain CSS).

---

## How it's built

Every Firestore collection denies client writes outright — every mutation goes through a Cloud Function using the Admin SDK, which the client can't bypass by editing a request. Firestore security rules only gate what a signed-in client can *read* directly. The one deliberate exception is `quests/{questId}`, which allows a public single-document read (not a list/query) so a quest's share link and a scanned check-in QR both work for someone who isn't signed in yet.

Firebase Storage is the other place clients write directly: uploads are gated by size/content-type rules in `storage.rules`, and a Cloud Function re-verifies the resulting file server-side (and, for photo submissions, patches its metadata) before it's "activated" — a Firestore doc created, points awarded, etc.

---

## Role & Status Model

There's no separate "sign up as an organization" flow — every account starts identically, and a role stored in the user's Firebase Auth custom claims (`role`) tracks where it is in the pipeline:

```
(no claim) -> onboarding_user -> user -> onboarding_org -> pending_org -> organization
```

- **onboarding_user** — signed up, hasn't finished the onboarding form yet.
- **user** — a regular member ("Leader"); can browse/RSVP/complete quests, and can opt in to registering an organization later from Settings.
- **onboarding_org** — started the organization-registration form but hasn't submitted it.
- **pending_org** — submitted an organization request; sees the normal member view plus a "pending review" banner until an admin acts.
- **organization** — approved; gets the organization dashboard instead of the member view.
- **admin** — granted out-of-band (a `config/admins` email allowlist checked at signup, or manually via `bootstrap_admin.py`); manages users, organizations, and admin-run quests.

Every transition between roles is a Cloud Function, not a direct Firestore write — the client can never set its own custom claims.

---

## Data Model (Firestore)

All writes go through Cloud Functions using the Admin SDK; the rules below only gate direct client **reads**.

| Collection | Purpose |
| --- | --- |
| `users/{uid}` | Profile: identity, interests/accessibility needs, points/rank, chosen duck avatar, seen-badges, notification/onboarding flags. |
| `users/{uid}/journal/{questId}` | One entry per attended organization quest — reflection text, feedback-request status, the org's eventual response. |
| `users/{uid}/notifications/{id}` | Transient notices (a quest you RSVP'd to was rescheduled/cancelled, feedback received, etc.). |
| `ORGREQ/{uid}` | A pending organization signup application. |
| `organizations/{uid}` | Approved organization profile: contact info, tags, review aggregate, Trust Score inputs, logo/duck-color. |
| `organizations/{uid}/hostReflections/{questId}` | An organization's own private reflections on a quest it hosted. |
| `quests/{questId}` | One quest occurrence: details, location/coordinates, recurrence/series linkage, `isDefault`/tier for side quests, RSVPs, QR token. |
| `questSeries/{seriesId}` | Aggregate rating data and shared cover photos for a recurring quest series. |
| `questSeries/{seriesId}/reviews/{uid}` | One member's rating + written review of a series. |
| `attendance/{questId}_{uid}` | A check-in record. |
| `photoSubmissions/{questId}_{uid}` | A proof/bonus photo submission and its review status. |
| `feedbackRequests/{questId}_{uid}` | A member's feedback request and the organization's eventual response. |
| `config/admins` | The email allowlist checked once, at signup — never client-readable. |

---

## Project Structure

```
leadership-quest/
├── firebase.json / .firebaserc / firestore.rules / firestore.indexes.json / storage.rules
├── package.json                  # npm workspaces root: frontend/app, capacitor
│
├── frontend/
│   ├── app/                      # the actual Vite/React app that gets built and deployed
│   │   ├── src/                  # App.jsx (routing), main.jsx, top-level pages (Login, Landing,
│   │   │                         # Profile, Settings, QuestDetails, MapQuestPage, Certificate,
│   │   │                         # CheckIn*, SharedQuest, Demo*, ...) + a vitest suite
│   │   ├── public/, dist/        # dist/ is the build output — what Firebase Hosting serves and
│   │   │                         # what capacitor.config.json points at as its webDir
│   │   ├── vite.config.js        # defines the @shared/@admin/@org/@mobile aliases below
│   │   └── .env.example          # VITE_MAPTILER_KEY, VITE_GEOAPIFY_KEY
│   │
│   ├── template/                 # @shared — cross-role components/hooks/utilities
│   │                             # (AuthContext, firebaseapp.jsx, BottomNav, badges.js, rank.js,
│   │                             #  EventsMap, mapStyle.js, style.css, ...)
│   ├── mobile/                   # @mobile — leader/member-facing pages (Home, Quests, Journal,
│   │                             #  Badges, Onboarding, Register)
│   ├── org/                      # @org — organization dashboard pages (Home, Quests,
│   │                             #  CreateQuestForm, PhotoSubmissions, FeedbackRequests, ...)
│   └── admin/                    # @admin — the single admin console page
│
├── capacitor/                    # Capacitor Android shell (its own npm workspace)
│   ├── android/                  # generated native Android (Gradle) project
│   ├── capacitor.config.json     # webDir: "../frontend/app/dist" — ships the same web build,
│   │                             #  not a separate app
│   └── package.json              # `npm run sync` / `npm run open:android`
│
├── functions/                    # Cloud Functions for Firebase, Python 3.13 runtime
│   ├── main.py                   # every callable function + the role state machine
│   ├── requirements.txt / requirements-dev.txt
│   ├── bootstrap_admin.py        # one-time local script: grant the first admin account
│   ├── seed_quests.py            # one-time local script: seed sample default quests
│   ├── seed_demo_data.py         # one-time local script: seed a full presentation-ready dataset
│   └── tests/                    # pytest suite
│
└── app-wireframe-alignment/      # design/wireframe handoff notes — not application code
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.13
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with **Authentication** (Email/Password + Google providers), **Firestore**, **Cloud Functions**, and **Storage** enabled

### 1. Firebase project

```sh
firebase login
```

Point this repo at your project by editing `.firebaserc`, and update `firebaseConfig` in `frontend/template/firebaseapp.jsx` with your web app's config from the Firebase Console.

### 2. Cloud Functions

```sh
cd functions
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

The AI features need a Gemini API key. `genai.Client()` reads `GEMINI_API_KEY` straight from the environment (not a declared Firebase secret param) — for local emulator use, put it in a `functions/.env` file; for a real deploy, set it with `firebase functions:secrets:set GEMINI_API_KEY`. Without it, quest recommendations and feedback summaries just fall back silently (a plain relevance sort, and a generic summary string) — nothing breaks.

Grant yourself the first admin account (sign up in the app once first, then find your uid in Firebase Console → Authentication → Users):

```sh
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
python bootstrap_admin.py <uid>
```

Optionally seed sample data — a handful of default quests:

```sh
python seed_quests.py
```

or a full presentation-ready demo dataset (verified organizations, a spread of quests, demo users at every rank, reviews/Trust Scores; prints every seeded login at the end):

```sh
python seed_demo_data.py
```

### 3. Frontend

From the repo root (an npm workspace):

```sh
npm install
cd frontend/app
cp .env.example .env   # fill in the keys below
npm run dev
```

Two keys are required for full functionality:

- **`VITE_MAPTILER_KEY`** — the map (`/map`) won't render without one. Free account, no card: [MapTiler Cloud](https://cloud.maptiler.com/account/keys/).
- **`VITE_GEOAPIFY_KEY`** — location autocomplete (organization registration, quest creation, onboarding). Free account, no card: [Geoapify MyProjects](https://myprojects.geoapify.com/). Without it, those fields still render but suggestions fail silently.

To point the frontend at the Firebase emulator suite instead of production, add to `.env`:

```
VITE_USE_FIREBASE_EMULATORS=true
```

and start the emulators from the repo root:

```sh
firebase emulators:start
```

Auth, Firestore, Functions, and Storage must be either **all** emulated or **all** real together — the local Auth emulator issues unsigned tokens that only the local Firestore/Functions/Storage emulators trust. If you're testing photo uploads against the emulator suite, also export `STORAGE_EMULATOR_HOST=http://127.0.0.1:9199` before starting the emulators, so the server-side upload verification in `main.py` talks to the local Storage emulator instead of real Cloud Storage.

### 4. Tests

```sh
cd functions && source venv/bin/activate && pytest
```

```sh
cd frontend/app && npm test
```

### 5. Mobile (Android)

```sh
cd frontend/app && npm run build
cd ../../capacitor && npm install && npx cap sync android
```

Then open `capacitor/android` in Android Studio and run it, or build/install from the command line:

```sh
cd capacitor/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

If you only changed web code (not native code), do a `./gradlew clean` before rebuilding — Gradle's incremental build occasionally doesn't notice that `cap sync` refreshed the bundled web assets.

### 6. Deploy

Hosting, Functions, and Firestore/Storage rules are all declared in one `firebase.json` — deploy them together:

```sh
cd frontend/app && npm run build && cd ../..
firebase deploy
```

There's no CI/CD — deploying is a manual step from whoever's machine has the latest `main` pulled. Scoping a deploy with `--only` (e.g. `--only hosting`) is fine while iterating on one piece, but do a full `firebase deploy` before considering a change actually shipped, so the live site doesn't quietly fall behind the repo.
