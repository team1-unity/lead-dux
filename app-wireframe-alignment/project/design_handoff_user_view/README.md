# Handoff: LEAD·DUX Wireframe-Aligned Redesign (USER View)

## Overview
This package covers the **user (volunteer) view** of the LEAD·DUX app, realigned to its original wireframe while keeping the existing visual styling. Screens: mobile Quests (1c), Badges mobile (1d) and desktop (1e). Profile lives in a **top-right circular avatar** on every screen.

> Companion package `design_handoff_wireframe_redesign/` covers the **org/admin view** (quests list+detail, profile, settings). This one is the counterpart for end users. **Ignore org-only options 1a, 1b, 1f, 1g** here.

## About the Design Files
`Wireframe Layouts.dc.html` is a **design reference created in HTML** — a prototype of intended look/layout, not production code. It renders as a pan/zoom canvas of labeled options (open in a browser; each frame is tagged 1a–1g top-left). It uses a small preview runtime (`support.js`) for display only — **not** the target architecture.

The task: **recreate these layouts in the app's existing codebase**, using its framework, component library, routing, and state patterns. Wire to real data/APIs, not the mock's sample content.

## Fidelity
**High-fidelity for layout and styling** — colors, typography, spacing, and card treatments are final; match closely. Placeholders to replace: quest photos (hatch boxes), inline SVG icons (use the app's icon set), and sample copy.

## Scope — USER VIEW. Build 1c + 1d + 1e.
- **1c — Quests, mobile.** Includes the **org / side-quests segmented toggle** (users DO have side-quests) and an **Accept** button per card.
- **1d — Badges, mobile.**
- **1e — Badges, desktop.**
- Every screen: **profile as a top-right circular avatar** (36px mobile / 40px desktop; bg `#d4e7d0`, initials `#2f7d45` Bricolage 800, border `2px solid #f2c94c`). Clicking it goes to the user's profile/account.

## Screens / Views

### 1. Quests — mobile (option 1c)
- **Purpose**: user browses quests and side-quests, searches, and accepts a quest.
- **Frame**: 360×720, bg `#efe9df`, `position:relative`.
- **Header**: white, padding `14px 18px`, bottom border `1px solid rgba(0,0,0,.07)`. Left: 24px yellow (`#f2c94c`) circle + "LEAD·DUX" (Bricolage Grotesque 800, 16px, `#223018`). Right: 36px avatar (bg `#d4e7d0`, "AR" `#2f7d45` Bricolage 800 13px, `2px solid #f2c94c`).
- **Body** (padding `16px 16px 90px`):
  - **Segmented toggle**: container bg `#e0d9c9`, radius 999px, padding 4px; two equal segments; active "org" = white bg, Mulish 700 13px `#223018`; inactive "side-quests" = `#6b6b63`. Switches the quest source.
  - **Search**: white, `1px solid rgba(0,0,0,.12)`, radius 999px, padding `10px 14px`, magnifier SVG + "Search" (`#9a9a90` 13px).
  - **Quest cards** (flex column, gap 12px): white, `1px solid rgba(0,0,0,.08)`, radius 14px, padding 12px, flex gap 12px, `position:relative`. 64×64 thumbnail (radius 10px, hatch placeholder → real image). Content: title (Bricolage 700 16px, `#223018`), meta row (green `#2f7d45` dot + location, Mulish 12px `#6b6b63`), then a row (margin-top 10px, space-between): **Accept** button (bg `#2f7d45`, white, Bricolage 700 13px, padding `6px 16px`, radius 9px) + chevron `#8a8a80`. Edit-pencil SVG shown top-right in the org mock is **org-only — omit for users** unless the user owns the item.
- **Bottom nav** (absolute, full width, bottom 0): white, top border, flex space-around, padding `10px 0 14px`. Left tab "Quests" (list SVG) active `#2f7d45`; center **floating "+" FAB** (54×54 circle, `#2f7d45`, white "+" 30px/300, `box-shadow:0 4px 12px rgba(47,125,69,.4)`, `margin-top:-24px` to overhang); right tab "Badges" (trophy SVG) `#8a8a80`. Labels Mulish 600 11px. (Confirm whether users get the "+" create action or if it's org-only.)

### 2. Badges — mobile (option 1d)
- **Purpose**: user views earned / in-progress / undiscovered achievement badges.
- **Frame**: 360×720, bg `#efe9df`.
- **Header**: white, padding `14px 18px`. Left: "Badges" (Bricolage 800 22px `#223018`). Right: 36px avatar (as above).
- **Body** (padding `18px 18px 90px`):
  - Row of **3 earned badges** (74px circles), space-around. Each earned badge = colored ring + tinted fill + small red heart (`♥ #e0574f`) top-right: green `#2f7d45` on `#e8f2e4`, blue `#3457c4` on `#e6edf9`, gold `#d0b02e` on `#fdf3d4`.
  - **"IN PROGRESS"** label pill: white, `1px solid rgba(0,0,0,.08)`, Bricolage 700 13px letter-spacing .06em `#223018`, radius 9px, padding `8px 14px`. Below it a **3-col grid** (gap 14px) of 70px in-progress badges (white fill, `2px solid rgba(0,0,0,.12)`).
  - **"UNDISCOVERED"** label pill: bg `#e7e0d2`, `#6b6b63`. Below it a 3-col grid of 70px locked badges (bg `#ddd6c8` + small grey `#9a9384` lock glyph).
- **Bottom nav**: same as 1c, but **Badges tab active** (`#2f7d45`), Quests tab `#8a8a80`.

### 3. Badges — desktop (option 1e)
- **Purpose**: same, desktop width.
- **Container**: 760px. **Header** (shared desktop pattern): white, padding `13px 28px`, bottom border. Left cluster (gap 34px): 30px yellow circle + "LEAD·DUX" (Bricolage 800 20px), then horizontal nav pills (gap 6px) — **Badges active** (bg `#d4e7d0`, `#2f7d45`), others (Quests, Settings) `#5f6b57`; pill text Bricolage 700 16px, padding `8px 16px`, radius 999px. Right: 40px avatar (top-right).
- **Body** (padding `26px 28px 30px`): title "Badges" (Bricolage 800 32px `#223018`). Three stacked **section cards** (white, `1px solid rgba(0,0,0,.08)`, radius 16px, padding 22px; the UNDISCOVERED card bg `#f3eee3`), each with an uppercase section label (Bricolage 700 14px letter-spacing .05em `#6b6b63`, margin-bottom 16px) and a flex row (gap 22px, wrap) of 78px badges:
  - **EARNED**: 3 badges, same green/blue/gold treatment + heart as 1d.
  - **IN PROGRESS**: ~5 badges, `#f3eee3` fill, `2px solid rgba(0,0,0,.12)`.
  - **UNDISCOVERED**: 3 locked badges (`#ddd6c8` + grey lock glyph).

## Interactions & Behavior
- **Segmented toggle (1c)**: switches quest list between org quests and side-quests.
- **Search**: filters the visible quest list by title/org/location as the user types.
- **Accept (1c)**: user commits to/joins the quest; reflect state change (e.g. → "Accepted"/RSVP'd).
- **Card chevron**: expands the card or opens quest detail.
- **Bottom nav / desktop nav**: routes between Quests and Badges (+ whatever else the user role has). Active = green icon+label (mobile) / green pill (desktop).
- **Avatar (top-right)**: opens the user's profile/account.
- **Badges**: earned badges show a heart/favorite affordance; locked badges are non-interactive (or show a "how to unlock" hint) — match current app.
- **Responsive**: mobile uses compact header + bottom nav with center FAB; desktop uses the horizontal-nav header. No vertical sidebar at any breakpoint.

## State Management
- `activeSegment` (org | side-quests) for 1c.
- `searchQuery` string.
- `acceptedQuestIds` / per-quest RSVP state.
- `activeTab` (quests | badges | …).
- Quest list, and badge sets (earned / in-progress / undiscovered), come from existing APIs — don't hardcode the mock's sample data.

## Design Tokens
**Colors**
- Page/body bg: `#e9e3d7` / `#efe9df`; card `#fff`; muted `#f3eee3`; warm chips `#e0d9c9` / `#e7e0d2` / `#ddd6c8`.
- Brand green (primary/active): `#2f7d45`; active-pill bg `#d4e7d0`.
- Brand yellow (logo/avatar accent): `#f2c94c`.
- Badge accents: blue `#3457c4` / `#e6edf9`; gold `#d0b02e` / `#fdf3d4`; green ring `#2f7d45` / `#e8f2e4`.
- Text: primary `#223018`; body `#4a4a42`; muted `#6b6b63` / `#5f6b57`; placeholder `#9a9a90`.
- Heart `#e0574f`; star `#c9a227`; lock glyph `#9a9384`.
- Hairlines `rgba(0,0,0,.07)`–`rgba(0,0,0,.12)`.

**Typography**: headings/buttons/nav **Bricolage Grotesque** (600/700/800); body/labels **Mulish** (400–700). Sizes: screen titles 22–32px/800; card titles 16px/700; nav pills 16px/700; body/meta 11–14px; uppercase section labels 13–14px, letter-spacing .05–.06em.

**Radius**: pills 999px; cards 14–16px; thumbnails/icon buttons 9–10px; badges are circles.
**Shadows**: card `0 1px 3px rgba(0,0,0,.05)`; mobile FAB `0 4px 12px rgba(47,125,69,.4)`.
**Spacing**: header `14px 18px` mobile / `13px 28px` desktop; body `16px 16px 90px` mobile / `26px 28px 30px` desktop; grid/row gaps 12–22px.
**Sizes**: avatar 36px mobile / 40px desktop; FAB 54px; quest thumb 64px; badges 70–78px.

## Assets
- **Fonts**: Bricolage Grotesque + Mulish (Google Fonts) — use the codebase's font-loading approach.
- **Icons**: magnifier (search), pencil (edit, org-only), trophy (badges), quest-list glyph, "+", chevron, lock — swap the mock's inline SVGs for the app's icon library.
- **Quest thumbnails**: hatch placeholders → real quest images.
- **No proprietary/brand assets** beyond the LEAD·DUX lockup (yellow circle + wordmark).

## Files
- `Wireframe Layouts.dc.html` — design reference (pan/zoom canvas; user-view options are 1c, 1d, 1e).
- `support.js` — preview runtime for the .dc.html only; not part of the design to implement.
