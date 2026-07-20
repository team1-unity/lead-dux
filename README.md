# Lead-dux

A full-stack civic-engagement app that connects community organizations with volunteers. Organizations post "quests", one-off volunteer events and activities, and members browse, filter, and RSVP to the ones that match their interests. Demonstrates Firebase Authentication (email/password + Google OAuth), Firestore as a client-read database with all writes routed through Cloud Functions, a custom-claims role/approval state machine, and a shared-component monorepo serving three distinct interfaces (public, organization, admin) from one React app.

## Live App

[https://lead-dux.web.app](https://lead-dux.web.app)

---

## Tech Stack

| Layer        | Technology                                                                        |
| ------------ | --------------------------------------------------------------------------------- |
| Frontend     | React 19, React Router DOM 7, Framer Motion                                       |
| Visual style | Rough.js (hand-drawn/sketch rendering for cards, frames, textures)                |
| Build Tool   | Vite                                                                              |
| Mobile       | Capacitor (iOS/Android shells configured, not yet built)                          |
| Backend      | Firebase Cloud Functions (Python 3.13)                                            |
| Database     | Cloud Firestore                                                                   |
| Auth         | Firebase Authentication, email/password and Google OAuth, custom claims for roles |
| Hosting      | Firebase Hosting                                                                  |

---

## Role & Status Model

There's no separate "sign up as an organization" flow, every account starts identically and a role stored in the user's Firebase Auth custom claims (`role`) tracks where it is in the pipeline:

```
(no claim) -> onboarding_user -> user -> onboarding_org -> pending_org -> organization
```

- **onboarding_user**, signed up, hasn't finished the interests/profile form yet.
- **user**, a regular member; can browse and RSVP to quests, and can opt in to registering an organization later from Settings.
- **onboarding_org**, a "user" (or brand-new signup) who started the organization-registration form but hasn't submitted it.
- **pending_org**, submitted an organization request; sees the normal member view plus a "pending review" banner until an admin acts.
- **organization**, approved; gets the organization dashboard instead of the member view.
- **admin**, granted out-of-band (a `config/admins` email allowlist checked at signup, or manually via `bootstrap_admin.py`/the admin dashboard), manages users, organizations, and neighborhood-wide quests.

Every transition between roles is a Cloud Function, not a direct Firestore write, the client can never set its own custom claims (see `functions/main.py`).

---

## User Stories

**Auth**

- A user can register with name, email, and password
- A user can sign up or log in with Google
- A user can log in to an existing account
- A user can reset a forgotten password via email
- A user can log out
- A returning user with an active session is automatically routed to the interface matching their role
- A suspended user is signed back out immediately after authenticating

**Onboarding**

- A newly-registered user completes a one-time form (name, age, interests) before seeing the quest list
- Completing onboarding graduates the account from `onboarding_user` to `user`

**Quests (members)**

- A logged-in member sees all open quests, sorted by how many tags overlap with their own interests
- A logged-in member can filter the quest list by a single tag
- A logged-in member can expand a quest to read its full description and tags
- A logged-in member can RSVP to a quest
- A logged-in member can cancel an existing RSVP
- A member can update their interests at any time from Profile

**Organization registration**

- A member can start registering an organization from Profile/Settings
- A member submits organization details (name, phone, location, reason) for admin review
- A pending applicant sees the normal member view plus a "pending review" banner
- An approved organization is redirected to the organization dashboard instead of the member view

**Organization dashboard**

- An organization can create a quest with a title, description, and tags
- An organization can search their own quests by title
- An organization can view the list of members RSVP'd to one of their quests
- An organization can delete one of their own quests
- An organization can set the location areas and activity types it operates in
- An organization sees at-a-glance stats: quests posted and total RSVPs received

**Admin**

- An admin can view and approve pending organization requests
- An admin can view every account and its current role
- An admin can manually assign any role to any account
- An admin can view all approved organizations and delete one (cascades its quests)
- An admin can create a "default neighborhood" quest with no owning organization, visible to everyone
- An admin can delete any quest, default or organization-owned

**Account**

- A user can switch the app's theme between Light, Dark, and System
- A user can permanently delete their own account, cascading their organization's profile and quests, or removing them from every quest they RSVP'd to

---

## Roadmap / Not Yet Built

- Native iOS/Android builds, Capacitor is configured (`frontend/app/capacitor.config.json`) but the platform projects haven't been generated yet.
- Browsing/filtering organizations by the location and activity-type tags (`ltag`/`etag`) they set on their profile, captured today, not yet surfaced anywhere in the member-facing UI.
- Quest-authoring by anyone other than an approved organization or admin, there's still no way for a plain member to propose a quest.

---

## Data Model (Firestore)

All writes go through Cloud Functions using the Admin SDK, which bypasses Firestore Security Rules entirely, the rules below only gate direct client **reads**.

```
users/{uid}
─────────────────────────────────────────
email          string
name           string
age            number | null
interests      string[]
isSuspended    boolean
createdAt      timestamp
updatedAt      timestamp


ORGREQ/{uid}                          (pending organization application)
─────────────────────────────────────────
name           string
email          string
phone          string
location       string
reason         string
status         "pending" | "approved"
createdAt      timestamp


organizations/{uid}                   (uid matches the owning account, same as ORGREQ)
─────────────────────────────────────────
name           string
email          string
phone          string
location       string
reason         string
ltag           string[]   // location areas the org operates in
etag           string[]   // activity/event types the org runs
createdAt      timestamp
updatedAt      timestamp


quests/{questId}
─────────────────────────────────────────
title          string
description    string
tags           string[]
orgId          string | null   // null for admin-created "default" quests
orgName        string
isDefault      boolean
rsvpd          string[]        // array of member uids
createdAt      timestamp


config/admins                          (never client-readable)
─────────────────────────────────────────
emails         string[]        // allowlist checked once, at signup
```

### Security rules summary (`firestore.rules`)

| Collection            | Read                                   | Write                       |
| --------------------- | -------------------------------------- | --------------------------- |
| `users/{uid}`         | owner or admin                         | none (Cloud Functions only) |
| `ORGREQ/{uid}`        | owner or admin                         | none                        |
| `organizations/{uid}` | owner or admin                         | none                        |
| `quests/{questId}`    | any signed-in user                     | none                        |
| `config/**`           | none, internal to Cloud Functions only | none                        |

---

## Cloud Functions (callable API)

All functions are `https_fn.on_call()` endpoints invoked from the client via `httpsCallable(functions, name)`, which automatically attaches the caller's ID token. Role checks happen server-side in `functions/main.py`; the client can't bypass them by editing a request payload.

| Function                        | Required role(s)                 | Request                             | Response                                       |
| ------------------------------- | -------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `complete_signup`               | signed in                        | `{ name }`                          | `{ success, role }`                            |
| `submit_onboarding`             | `onboarding_user`                | `{ name, age, interests }`          | `{ success, role: "user" }`                    |
| `start_organization_onboarding` | `user`                           | ,                                   | `{ success, role: "onboarding_org" }`          |
| `submit_organization_request`   | `onboarding_org`                 | `{ name, phone, location, reason }` | `{ success, role: "pending_org" }`             |
| `update_interests`              | `user`                           | `{ interests }`                     | `{ success }`                                  |
| `create_quest`                  | `organization`                   | `{ title, description, tags }`      | `{ success, questId }`                         |
| `update_organization_tags`      | `organization`                   | `{ ltag, etag }`                    | `{ success }`                                  |
| `rsvp_to_quest`                 | `user`                           | `{ questId }`                       | `{ success }`                                  |
| `cancel_rsvp`                   | `user`                           | `{ questId }`                       | `{ success }`                                  |
| `delete_quest`                  | owning `organization` or `admin` | `{ questId }`                       | `{ success }`                                  |
| `list_quest_attendees`          | owning `organization` or `admin` | `{ questId }`                       | `{ attendees: [{ uid, name, email }] }`        |
| `delete_account`                | signed in                        | ,                                   | `{ success }`                                  |
| `set_user_role`                 | `admin`                          | `{ targetUid, role }`               | `{ success, targetUid, role }`                 |
| `approve_organization`          | `admin`                          | `{ targetUid }`                     | `{ success, targetUid, role: "organization" }` |
| `delete_organization`           | `admin`                          | `{ targetUid }`                     | `{ success, targetUid }`                       |
| `admin_list_users`              | `admin`                          | ,                                   | `{ users: [{ uid, email, role }] }`            |
| `admin_list_organizations`      | `admin`                          | ,                                   | `{ organizations: [{ uid, ...orgFields }] }`   |
| `create_default_quest`          | `admin`                          | `{ title, description, tags }`      | `{ success, questId }`                         |

---

## Setup

### 1. Firebase project

Create a Firebase project (or use an existing one) with **Authentication** (Email/Password + Google providers enabled), **Firestore**, and **Cloud Functions** turned on. Install the Firebase CLI and log in:

```sh
npm install -g firebase-tools
firebase login
```

Point this repo at your project by editing `.firebaserc`, and update `firebaseConfig` in `frontend/template/firebaseapp.jsx` with your web app's config values from the Firebase Console.

### 2. Cloud Functions

```sh
cd functions
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Grant yourself the first admin account (sign up in the app once first, then find your uid in Firebase Console > Authentication > Users):

```sh
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
python bootstrap_admin.py <uid>
```

Optionally seed a handful of sample "default neighborhood" quests:

```sh
python seed_quests.py
```

Or seed a full presentation-ready demo dataset instead — verified organizations
with complete profiles, a realistic spread of organization quests, demo users
at every rank, reviews/Trust Scores, and the 6 default Iron neighborhood
quests (prints every seeded login at the end):

```sh
python seed_demo_data.py
```

### 3. Frontend

From the repo root (an npm workspace):

```sh
npm install
cd frontend/app
npm run dev
```

The dev server runs on Vite's default port. To point the frontend at the Firebase emulator suite instead of production, add to `frontend/app/.env.local`:

```
VITE_USE_FIREBASE_EMULATORS=true
```

and start the emulators from the repo root:

```sh
firebase emulators:start
```

Location fields (organization registration, organization quest creation, and the neighborhood/city field in user onboarding) use Google Places Autocomplete — add a Maps API key to `frontend/app/.env.local` too:

```
VITE_GOOGLE_MAPS_API_KEY=your-key-here
```

Get one from the [Google Cloud Console](https://console.cloud.google.com/) under the same project backing this app's Firebase project (`lead-dux`) — enable the **Places API**, create an API key under Credentials, and restrict it to your dev/prod domains (HTTP referrers). Without this key set, those location fields won't render (side/default quests created by an admin are unaffected — they keep a plain free-text location on purpose, since they don't have one specific physical place).

Auth, Firestore, and Functions must be either **all** emulated or **all** real together, the local Auth emulator issues unsigned tokens that only the local Firestore/Functions emulators trust.

### 4. Deploy

Hosting, Functions, and Firestore rules/indexes are all declared as one config in `firebase.json` — deploy them together, in one command, every time:

```sh
cd frontend/app && npm run build && cd ../..
firebase deploy
```

There's no CI/CD for this project — deploying is always this manual two-step, run from whoever's machine has the latest `main` pulled. **Don't deploy `--only functions,firestore` (or `--only hosting`) as a habit** — `frontend/app/dist` is gitignored and only exists because you just built it, so a partial deploy is how the live site quietly falls behind the repo. If you only need to iterate on one piece while testing, scope it with `--only` for that one run, but do a full `firebase deploy` before considering a change actually shipped.

---

## Application Structure

```
lead-dux/
├── firebase.json               # Hosting, Firestore, Functions, and emulator config
├── firestore.rules             # Client read rules (all writes go through Cloud Functions)
├── firestore.indexes.json
├── .firebaserc                 # Firebase project alias ("lead-dux")
├── package.json                # Root npm workspace, points at frontend/app
│
├── functions/                   # Firebase Cloud Functions (Python)
│   ├── main.py                  # Every callable function + the role state machine
│   ├── bootstrap_admin.py       # One-time: grant the first admin account (local only)
│   ├── seed_quests.py           # One-time: seed sample default quests (local only)
│   ├── seed_demo_data.py        # One-time: seed a full presentation-ready demo dataset (local only)
│   └── requirements.txt
│
└── frontend/
    ├── app/                     # The Vite app that's actually built/deployed
    │   ├── src/
    │   │   ├── App.jsx          # Routing + role-based redirect logic (Home)
    │   │   ├── main.jsx
    │   │   ├── Login.jsx
    │   │   ├── ForgotPassword.jsx
    │   │   ├── ResetPassword.jsx
    │   │   ├── Profile.jsx      # Identity, interests, org-registration status
    │   │   └── Settings.jsx     # Theme + account deletion
    │   ├── vite.config.js       # @shared/@admin/@org/@mobile aliases (see below)
    │   └── capacitor.config.json
    │
    ├── template/                 # Shared components/logic, @shared/*
    │   ├── firebaseapp.jsx       # Firebase app/Auth/Firestore/Functions init
    │   ├── auth.jsx              # signInWithEmail/Google, register, reset, sign out
    │   ├── AuthContext.jsx       # useAuth(), current user, role, refreshRole()
    │   ├── fetch.jsx             # Typed wrappers around every callable Cloud Function
    │   ├── ProtectedRoute.jsx
    │   └── ...                  # UI: TopBar, BottomNav, TagStamp, StampButton, etc.
    │
    ├── mobile/                   # Public/member-facing screens, @mobile/*
    │   ├── Register.jsx          # Email/Google signup -> complete_signup
    │   ├── Onboarding.jsx        # Name/age/interests -> submit_onboarding
    │   └── Quests.jsx            # Browse/filter/RSVP quest list
    │
    ├── org/                      # Organization-facing screens, @org/*
    │   ├── Register.jsx          # Org-details form -> submit_organization_request
    │   ├── Dashboard.jsx         # Create/search/delete quests, view attendees, org tags
    │   └── PendingBanner.jsx     # Shown to pending_org while under review
    │
    └── admin/                    # Admin-facing screens, @admin/*
        └── Dashboard.jsx         # Approve orgs, manage roles/users, manage all quests
```
