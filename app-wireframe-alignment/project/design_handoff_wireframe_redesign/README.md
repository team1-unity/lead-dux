# Handoff: LEAD·DUX Wireframe-Aligned Redesign (Org View)

## Overview
This package realigns the LEAD·DUX app's layout to its original wireframe while **keeping the existing visual styling** (colors, type, card treatments). It covers the org (organization/admin) view across four screens — Quests list, Badges, Profile, Settings — at both desktop and mobile widths.

Key layout changes from the current app:
- **Profile moves to a top-right circular avatar** in the header (was elsewhere).
- **Desktop keeps the horizontal top nav** — do NOT introduce a vertical sidebar.
- Wireframe controls are pulled in: **search bar**, **filter icon**, **floating "+" add-quest button**, **edit pencil + "Manage Attendees"** on cards, **image thumbnail** on each quest card, **Accept** button (mobile cards), and a **Badges/trophy tab**.

## About the Design Files
The file in this bundle (`Wireframe Layouts.dc.html`) is a **design reference created in HTML** — a prototype showing intended look and layout, not production code to copy directly. It is a single-file mockup rendered as a pan/zoom canvas of labeled options (1a–1g); it uses a lightweight custom runtime (`support.js`) purely for previewing and is **not** the target architecture.

The task is to **recreate these layouts in the app's existing codebase**, using its established framework, component library, routing, and state patterns. If no frontend environment exists yet, choose the most appropriate framework for the project and implement there.

## Fidelity
**High-fidelity for layout and styling.** Colors, typography, spacing, and card treatments are final and should be matched closely. Placeholder content: quest photos are hatch-pattern boxes (use real thumbnails), icons are simple inline SVGs (swap for the app's icon set), and copy is representative sample data from the current app.

## Scope — ORG VIEW ONLY. Build 1b + 1f/1g.
This handoff is **exclusively the organization (org/admin) view**. Do NOT build user-facing screens from this bundle.

**Build these options:**
- **1b — Quests, desktop (list + detail split).** The chosen quests layout for orgs. See the scroll behavior note — it's important.
- **1f — Profile** and **1g — Settings**, combined behind the top-right avatar (see "Avatar menu").

**Ignore these — they are the USER view, out of scope here:**
- **1a** — alternate (unchosen) quests layout.
- **1c** — mobile quests with the org/side-quests toggle. Orgs have no side-quests → skip.
- **1d / 1e** — Badges (mobile / desktop). Badges are a user-view feature → skip.

### 1b scroll behavior (important)
The two columns scroll independently and the detail pane must never leave blank space:
- **Left list column** (quests — "One-Time Beach Day", "Sample test", "River Trail Cleanup", …) is the **only scrollable region**; it can grow arbitrarily long.
- **Right detail pane is static/sticky** — pinned and **spanning the full height of the content area at all times** (e.g. `position: sticky; top: <header-offset>` with height filling the viewport below the header, or an equivalent full-height sticky column). The user should **never** see empty background below the pane, no matter how far the left list scrolls or how short the detail content is. The floating "+" stays anchored bottom-right within/over the pane.

### Avatar menu (combining 1f + 1g)
Profile stays a **top-right circular avatar**. **Clicking the avatar opens a dropdown** to choose **Profile** (1f) or **Settings** (1g) — rather than reaching them as separate top-nav destinations. (Proposed interaction — the user was unsure; flag it and confirm before finalizing. Both screens' content is specified below regardless of how they're reached.)

## Screens / Views

### 1. Quests list — desktop (BUILD 1b)
- **Purpose**: Org admin browses/manages the org's quests; searches, filters by tag, adds new quests, manages attendees.
- **Header (shared across all desktop screens)**: white bar, `13px 28px` padding, `1px solid rgba(0,0,0,.07)` bottom border. Left cluster (gap 34px): brand lockup = 30px yellow (`#f2c94c`) circle + "LEAD·DUX" (Bricolage Grotesque 800, 20px, `#223018`), then horizontal nav pills (gap 6px). Active pill: bg `#d4e7d0`, text `#2f7d45`; inactive: text `#5f6b57`; pill text Bricolage Grotesque 700, 16px, padding `8px 16px`, radius 999px. Right cluster: org name ("Riverside Volunteers", Mulish 600, 13px, `#5f6b57`) + **40px circular avatar** (bg `#d4e7d0`, initials "AR" in `#2f7d45` Bricolage 800 15px, `2px solid #f2c94c` border).
- **1a layout** — OUT OF SCOPE (unchosen; documented for reference only):
  - Title row: "Quests near you" (Bricolage 800, 38px, `#223018`) + subtitle (Mulish 15px, `#6b6b63`) on the left; on the right a search field + filter button.
  - **Search field**: white, `1px solid rgba(0,0,0,.13)`, radius 999px, padding `11px 16px`, width 280px, magnifier SVG + placeholder "Search quests" (`#9a9a90`, 14px).
  - **Filter button**: 44×44, white, `1px solid rgba(0,0,0,.13)`, radius 12px, 3-line SVG icon (`#5f6b57`).
  - **Stat cards** (flex, gap 16px): card 1 bg `#2f8a4e`, card 2 bg `#3457c4`; white text; big number Bricolage 800 34px, label Mulish 700 12px letter-spacing .08em; radius 16px, padding `18px 20px`.
  - **Tag filter chips** (flex, gap 9px): "All" active = bg `#e0d9c9`, text `#223018`, weight 700. Others = 1px colored border + matching text (environment `#7cb47f`/`#3f7a49`, outdoors `#d98a3a`/`#b06d26`, community `#cbb636`/`#8f7f1e`, neutral `rgba(0,0,0,.18)`/`#7a7a70`); Mulish 600 13px, padding `7px 15px`, radius 999px.
  - **Quest rows** (flex column, gap 14px). Each row: white card, `1px solid rgba(0,0,0,.08)`, radius 16px, padding 16px, `box-shadow:0 1px 3px rgba(0,0,0,.05)`, `position:relative`, flex gap 18px. Left **thumbnail** 110×110, radius 12px (hatch placeholder). Content (flex 1, `padding-right:40px`): title (Bricolage 700, 20px), org name (Mulish 14px `#6b6b63`), meta row with green dot + location/dates (Mulish 13px), then a row (margin-top 14px, gap 12px) of "Manage Attendees →" (Mulish 700 13px `#2f7d45`) + "N RSVP'd" (Mulish 600 13px `#6b6b63`). **Edit pencil**: absolute top 14px right 14px, 34×34, radius 9px, `1px solid rgba(0,0,0,.12)`, pencil SVG `#5f6b57`.
  - **Floating add button**: absolute bottom 26px right 28px, 58×58 circle, bg `#2f7d45`, `box-shadow:0 6px 16px rgba(47,125,69,.4)`, white "+" 32px weight 300.
- **1b layout** (container 1120px): same header + title/search/filter row, then a two-column flex (gap 24px):
  - **Left list column** (width 340px): tag chips (smaller — padding `6px 13px`, 12px), then a timeline-style stack: a 38px avatar node (`#d9c9f0` bg, `#5b3a8c` "R") with a dashed connector, beside a column (gap 12px) of quest cards. Selected card: bg `#e8f2e4`, `1.5px solid #7cb47f`. Others: white, `1px solid rgba(0,0,0,.08)`. Radius 14px, padding 15px; title Bricolage 700 17px, meta Mulish 13px `#6b6b63`.
  - **Right detail pane** (flex 1, white, `1px solid rgba(0,0,0,.08)`, radius 18px, padding `28px 30px`, relative): edit pencil absolute top 22px right 22px (36×36, radius 10px). Quest title Bricolage 800 28px; org name; recurrence line; "Date" label (Mulish 700 14px) + a date select box (`1px solid rgba(0,0,0,.15)`, radius 12px, padding `13px 16px`, max-width 360px, chevron); a meta list (location w/ green dot, RSVP count w/ grey square); description; a tag chip (bg `#d4e7d0`, `#2f7d45`); action buttons row (gap 12px): primary "Manage Attendees" (bg `#2f7d45`, white) + secondary "View reviews" (`1px solid rgba(0,0,0,.15)`, `#223018`), both radius 12px, padding `12px 22px`, Bricolage 700 15px. Floating + absolute bottom-right 56×56.

### 2. Quests list — mobile (option 1c) — OUT OF SCOPE (user view; orgs have no side-quests)
- **Frame**: 360×720, bg `#efe9df`, `position:relative`.
- **Header**: white, padding `14px 18px`, bottom border. Left: 24px yellow circle + "LEAD·DUX" (Bricolage 800 16px). Right: 36px avatar (bg `#d4e7d0`, "AR" `#2f7d45` Bricolage 800 13px, `2px solid #f2c94c`).
- **Body** (padding `16px 16px 90px`):
  - **Segmented toggle**: pill container bg `#e0d9c9`, radius 999px, padding 4px; two equal segments; active "org" = white bg, Mulish 700 13px `#223018`; inactive "side-quests" = `#6b6b63`.
  - **Search**: white, `1px solid rgba(0,0,0,.12)`, radius 999px, padding `10px 14px`, magnifier + "Search" (`#9a9a90` 13px).
  - **Quest cards** (flex column, gap 12px): white, `1px solid rgba(0,0,0,.08)`, radius 14px, padding 12px, flex gap 12px, relative. 64×64 thumbnail (radius 10px, hatch). Content: title (Bricolage 700 16px), meta row (green dot + location, Mulish 12px `#6b6b63`), then a row (margin-top 10px, space-between): **Accept** button (bg `#2f7d45`, white, Bricolage 700 13px, padding `6px 16px`, radius 9px) + chevron. Edit pencil SVG absolute top 10px right 10px (`#8a8a80`).
- **Bottom nav** (absolute, full width, bottom 0): white, top border, flex space-around, padding `10px 0 14px`. Left tab "Quests" (list SVG) active `#2f7d45`; center **floating + FAB** (54×54 circle, `#2f7d45`, white "+", `margin-top:-24px` to overhang); right tab "Badges" (trophy SVG) `#8a8a80`. Tab labels Mulish 600 11px.

### 3. Badges — mobile (1d) and desktop (1e) — OUT OF SCOPE (user view feature)
- **Purpose**: view earned / in-progress / undiscovered achievement badges.
- **Badge chip**: circle. Earned styles carry a small red heart (`♥ #e0574f`) top-right and a colored ring: green `#2f7d45` on `#e8f2e4`, blue `#3457c4` on `#e6edf9`, gold `#d0b02e` on `#fdf3d4`. In-progress: white/`#f3eee3` fill, `2px solid rgba(0,0,0,.12)`. Undiscovered: bg `#ddd6c8` with a small grey "locked" glyph.
- **Mobile (1d)**: header "Badges" (Bricolage 800 22px) + top-right avatar. Body padding `18px 18px 90px`. Row of 3 earned badges (74px). Section label pills — "IN PROGRESS" (white, `1px` border) and "UNDISCOVERED" (bg `#e7e0d2`, `#6b6b63`), Bricolage 700 13px letter-spacing .06em, radius 9px, padding `8px 14px`. Badges laid out in a 3-col grid (gap 14px), 70px circles. Same bottom nav as 1c but with **Badges** tab active.
- **Desktop (1e)**: container 760px, standard header (Badges nav active). Title "Badges" (Bricolage 800 32px). Three stacked section cards (white, `1px solid rgba(0,0,0,.08)`, radius 16px, padding 22px; UNDISCOVERED card bg `#f3eee3`) each with an uppercase section label (Bricolage 700 14px letter-spacing .05em `#6b6b63`) and a flex row of 78px badges (gap 22px).

### 4. Profile (option 1f)
- **Purpose**: view own profile + org status; log out.
- Shown as a wide (1120px) comparison holding a desktop and a narrow variant side by side; **build the desktop version**, reached via the top-right **avatar menu → Profile** (see Scope). The essential change: the **header avatar moves to top-right** (here bordered `2px solid #2f7d45` to indicate the active profile page).
- Body bg `#efe9df`, padding 24px. **Profile card**: white, radius 16px, padding 22px, flex space-between. Left: 56px avatar (white, `3px solid #f2c94c`, inner 26px yellow dot) + "Your profile" (Bricolage 800 26px) & "Signed in as amy14rubio@gmail.com" (Mulish 14px `#6b6b63`). Right: "Log out" button (`1px solid rgba(0,0,0,.15)`, radius 12px, padding `11px 20px`, Bricolage 700 14px). **Organization card**: white, radius 16px, padding 22px; "Organization" (Bricolage 800 22px); status pill "UNDER REVIEW" (bg `#f6d9b8`, `#a35d16`, Mulish 700 12px, radius 999px); helper text (Mulish 15px `#4a4a42`).

### 5. Settings (option 1g)
- **Purpose**: display/theme preference; account deletion.
- Container 760px, standard header (Settings nav active, avatar top-right). Title "Settings" (Bricolage 800 32px).
- **Display card**: white, radius 16px, padding 22px. "Display" (Bricolage 800 22px) + description (Mulish 15px `#4a4a42`). Theme buttons row (gap 12px): "Light" active (bg `#2f7d45`, white), "Dark" & "System" (`1px solid rgba(0,0,0,.15)`, `#223018`); all radius 12px, padding `12px 26px`, Bricolage 700 15px.
- **Danger zone card**: white, `1.5px solid #c0402f`, radius 16px, padding 22px. "Danger zone" (Bricolage 800 22px). "Delete account" button: `1.5px solid #c0402f`, text `#c0402f`, radius 12px, padding `12px 22px`, Bricolage 700 15px.

## Interactions & Behavior
- **Nav pills / bottom-nav tabs**: route between Quests / Badges / Settings (+ Profile via avatar). Active state uses the green pill (desktop) or green icon+label (mobile).
- **Avatar (top-right)**: navigates to Profile (and/or opens an account menu — match current app behavior).
- **Search field**: filters the quest list by title/org as the user types.
- **Filter button**: opens tag/category filter controls; tag chips below toggle the active filter (single-select in the mock; "All" clears).
- **Floating "+"**: opens the create-quest flow.
- **Edit pencil**: opens edit mode for that quest (org/admin only).
- **Manage Attendees**: navigates to the attendee-management view for that quest/date.
- **Accept (mobile)**: org accepts/publishes the quest.
- **1b date select**: chooses among a quest's upcoming dates, updating the detail pane.
- **Responsive**: desktop uses the horizontal-nav header + multi-column layouts; mobile uses the compact header + bottom nav with center FAB. No vertical sidebar at any breakpoint.

## State Management
- `activeTab` (quests | badges | settings | profile) for nav.
- `searchQuery` string for the quest search filter.
- `activeTagFilter` (all | environment | outdoors | community | …).
- `selectedQuestId` + `selectedDate` (1b detail pane).
- `viewRole` — this handoff is the **org view**; a role/segment toggle (org vs side-quests, seen in 1c) may gate admin controls (edit pencil, Manage Attendees, Accept, +).
- Quest list, badge list (earned/in-progress/undiscovered), and profile/org status come from existing data sources — wire to current APIs rather than the mock's sample data.

## Design Tokens
**Colors**
- Page bg: `#e9e3d7`; panel/body bg: `#efe9df`; card bg: `#fff`; muted fill: `#f3eee3`; warm chip fill: `#e0d9c9` / `#e7e0d2` / `#ddd6c8`.
- Brand green (primary/active): `#2f7d45`; stat green: `#2f8a4e`; active-pill bg: `#d4e7d0`; selected-card tint: `#e8f2e4`, border `#7cb47f`.
- Brand yellow (logo/avatar accent): `#f2c94c`.
- Accent blue (stat/badge): `#3457c4` / `#e6edf9`; badge gold: `#d0b02e` / `#fdf3d4`; badge purple node: `#d9c9f0` / `#5b3a8c`.
- Text: primary `#223018`; body `#4a4a42`; muted `#6b6b63` / `#5f6b57`; placeholder `#9a9a90`.
- Status: under-review `#f6d9b8` bg / `#a35d16` text; danger `#c0402f`; heart `#e0574f`; star `#c9a227`.
- Tag borders/text: environment `#7cb47f`/`#3f7a49`, outdoors `#d98a3a`/`#b06d26`, community `#cbb636`/`#8f7f1e`.
- Hairline borders: `rgba(0,0,0,.07)`–`rgba(0,0,0,.13)`.

**Typography**
- Display/headings/buttons/nav: **Bricolage Grotesque** (600/700/800).
- Body/labels/meta: **Mulish** (400/500/600/700).
- Scale seen: page titles 32–38px/800; card titles 20–28px/700–800; nav pills 15–16px/700; body 14–15px; meta/labels 11–14px; uppercase section labels ~13–14px with .05–.08em letter-spacing.

**Radius**: pills 999px; cards 14–18px; icon buttons 9–12px; thumbnails 10–12px.
**Shadows**: card `0 1px 3px rgba(0,0,0,.05)`; FAB `0 6px 16px rgba(47,125,69,.4)` (mobile `0 4px 12px`); canvas card `0 4px 18px rgba(0,0,0,.08)`.
**Spacing**: header padding `13px 28px` (desktop) / `14px 18px` (mobile); body `26px 28px 30px` (desktop) / `16px 16px 90px` (mobile); common gaps 9–24px.
**Sizes**: desktop avatar 40px, mobile avatar 36px; desktop FAB 58px, mobile FAB 54px; desktop quest thumb 110px, mobile 64px; badges 70–78px.

## Assets
- **Fonts**: Bricolage Grotesque + Mulish (Google Fonts). Use the codebase's existing font-loading approach.
- **Icons**: search (magnifier), filter (3 lines), edit (pencil), trophy (badges), quest-list glyph, "+". These are simple inline SVGs in the mock — replace with the app's existing icon library.
- **Quest thumbnails**: hatch-pattern placeholders in the mock — wire to real quest images.
- **No proprietary/brand assets** beyond the app's own LEAD·DUX lockup (yellow circle + wordmark).

## Files
- `Wireframe Layouts.dc.html` — the design reference (open in a browser; pan/zoom the canvas, options labeled 1a–1g in the top-left of each frame).
- `support.js` — preview runtime for the .dc.html file only; **not** part of the design to implement.
