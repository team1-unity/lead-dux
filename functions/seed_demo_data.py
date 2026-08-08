# Demo Seeder v2 — regenerates the full presentation/testing dataset for
# every feature currently shipped: verified organizations with complete
# profiles (mission, contact info, socials, community photo galleries),
# a realistic spread of organization quests (upcoming/near-full/full/
# completed/brand-new-org/recurring-series), demo users at every rank with
# believable quest history and accessibility needs, reviews/Trust Scores,
# Iron-through-Diamond side quests with mixed completion states, QR
# attendance data ready to scan immediately, photo-submission moderation
# queues (both org and admin), leader-requested feedback in both pending
# and completed states, journal reflections, notification-banner demos,
# and pending organization applications for the admin dashboard.
#
# Reuses main.py's already-initialized Firebase app plus its own
# rank/points/attendance/review/QR helpers (_rank_for_points,
# _attendance_ref, _review_ref, _photo_submission_ref, _feedback_request_ref,
# _journal_ref, _notify_user, ORG_QUEST_BASE_POINTS, TIER_BASE_POINTS)
# rather than reimplementing that logic, so seeded data is always
# shape-correct with whatever the deployed app actually reads.
#
# Safe to re-run — organizations/users are looked up by email first, so a
# second run updates existing accounts instead of duplicating them. Quest/
# series/attendance/photoSubmissions/feedbackRequests docs all use
# deterministic ids for the same reason (see wipe_old_seed_data).
#
# Usage (against production — a real service account key, or Application
# Default Credentials from `gcloud auth application-default login`):
#   cd functions && source venv/bin/activate && python3 seed_demo_data.py
#
# Usage (against the local emulator suite instead, for a dry run):
#   firebase emulators:start --only auth,firestore,functions   # separate terminal
#   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
#   export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
#   cd functions && source venv/bin/activate && python3 seed_demo_data.py

import secrets
from datetime import datetime, timedelta, timezone

import main

firestore = main.firestore
auth = main.auth
db = firestore.client()

DEMO_PASSWORD = "password123"
NOW = datetime.now(timezone.utc)

EMAIL_DOMAIN = "lead-dux.app"
ADMIN_EMAIL = f"admin@{EMAIL_DOMAIN}"
ADMIN_NAME = "Leadership Quest Admin"

# The previous generation of this seeder (see git history) used these
# addresses — wiped in wipe_old_demo_accounts() below so the app never ends
# up with both an old- and new-domain copy of the same demo account. Frozen
# here rather than derived, since NEW_* below has since diverged from it
# (different domain, and org emails were never slug-derived to begin with).
OLD_ADMIN_EMAIL = "admin@leadershipquest.com"
OLD_USER_EMAIL_DOMAIN = "demo.leadershipquest.app"
OLD_ORG_EMAILS = [
    "volunteer@jccommunitykitchen.org", "info@hudsonyouthleadership.org",
    "admin@green-tomorrow.org", "events@hobokenrescue.org", "hello@nextgenmentors.org",
    "team@gardenstatevolunteers.org", "director@communitygarden.org", "contact@libertysports.org",
    "hello@downtownalliance.org", "studio@creativefutures.org",
]


# --- Organizations -----------------------------------------------------
#
# 6 "normal" orgs (2 completed quests + 1 upcoming + 1 full-or-near-full),
# 2 "recurring" orgs (same 3 one-off quests, plus a 3-occurrence recurring
# series each — see RECURRING_SERIES below), 2 "brand new" orgs (no
# completed quests/reviews at all yet — just upcoming/near-full, so the
# Trust Score "new" tag and an empty-but-not-broken quest history both have
# a real example to show).

ORGS = [
    {
        "slug": "manhattan-community-kitchen", "name": "Manhattan Community Kitchen",
        "email": f"jc.kitchen@{EMAIL_DOMAIN}", "category": "Food Pantry", "group": "recurring",
        "city": "Manhattan", "state": "NY", "phone": "(212) 555-0142",
        "website": "https://manhattancommunitykitchen.org",
        "missionStatement": "Ensuring every neighbor in East Harlem has access to a warm meal and a welcoming table.",
        "reason": "We started in a church basement in 2014 packing lunches for day laborers, and now we run a full community kitchen five days a week. Today we serve roughly 300 meals a week across weeknight dinners, weekend service, and holiday meal drives, almost entirely powered by volunteers from the neighborhood we feed.",
        "social": {"instagram": "https://instagram.com/manhattancommunitykitchen", "facebook": "https://facebook.com/manhattancommunitykitchen"},
        "photos": 9,
    },
    {
        "slug": "bronx-youth-leadership", "name": "Bronx Youth Leadership Center",
        "email": f"hudson.youth@{EMAIL_DOMAIN}", "category": "Youth Leadership", "group": "normal",
        "city": "Bronx", "state": "NY", "phone": "(718) 555-0198",
        "website": "https://bronxyouthleadership.org",
        "missionStatement": "Building tomorrow's community leaders through mentorship, public speaking, and hands-on civic projects.",
        "reason": "Fordham teens told us they wanted more say in their own neighborhoods — this Center is our answer. We run after-school public speaking workshops, a civic leadership roundtable series, and student council training for every middle and high school in the borough.",
        "social": {"instagram": "https://instagram.com/bronxyouthleadership", "facebook": "https://facebook.com/bronxyouthleadership", "youtube": "https://youtube.com/@bronxyouthleadership"},
        "photos": 10,
    },
    {
        "slug": "green-tomorrow-nyc", "name": "Green Tomorrow NYC",
        "email": f"green.tomorrow@{EMAIL_DOMAIN}", "category": "Environmental", "group": "recurring",
        "city": "Queens", "state": "NY", "phone": "(718) 555-0176",
        "website": "https://green-tomorrow.org",
        "missionStatement": "A cleaner, greener New York City, one park cleanup and native planting at a time.",
        "reason": "Founded by a handful of Astoria neighbors after a particularly bad litter season along Astoria Park, we've since restored six acres of parkland and planted over two thousand native seedlings across Queens.",
        "social": {"instagram": "https://instagram.com/greentomorrownyc", "twitter": "https://x.com/greentomorrownyc"},
        "photos": 12,
    },
    {
        "slug": "brooklyn-animal-rescue", "name": "Brooklyn Animal Rescue",
        "email": f"hoboken.rescue@{EMAIL_DOMAIN}", "category": "Animal Rescue", "group": "normal",
        "city": "Brooklyn", "state": "NY", "phone": "(718) 555-0133",
        "website": "https://brooklynanimalrescue.org",
        "missionStatement": "No adoptable animal in Brooklyn should wait more than 60 days for a home.",
        "reason": "What began as one foster home in a Bushwick brownstone is now a full rescue network across Brooklyn, running weekly adoption fairs, a foster-volunteer pipeline, and a shelter that never turns an animal away.",
        "social": {"instagram": "https://instagram.com/brooklynanimalrescue", "facebook": "https://facebook.com/brooklynanimalrescue", "tiktok": "https://tiktok.com/@brooklynanimalrescue"},
        "photos": 8,
    },
    {
        "slug": "nextgen-mentors", "name": "NextGen Mentors",
        "email": f"nextgen.mentors@{EMAIL_DOMAIN}", "category": "Education", "group": "normal",
        "city": "Bronx", "state": "NY", "phone": "(718) 555-0154",
        "website": "https://nextgenmentors.org",
        "missionStatement": "Pairing Mott Haven students with working professionals who looked like them growing up.",
        "reason": "Every mentor in our program was once a mentee — the whole model is built on paying it forward. We run resume workshops, mock interviews, and a year-round 1:1 mentor match program for Bronx high schoolers.",
        "social": {"instagram": "https://instagram.com/nextgenmentors", "linkedin": "https://linkedin.com/company/nextgenmentors"},
        "photos": 7,
    },
    {
        "slug": "empire-state-volunteers", "name": "Empire State Volunteers",
        "email": f"garden.state@{EMAIL_DOMAIN}", "category": "Senior Services", "group": "normal",
        "city": "Staten Island", "state": "NY", "phone": "(718) 555-0187",
        "website": "https://empirestatevolunteers.org",
        "missionStatement": "Keeping St. George's senior residents connected, independent, and never alone on a Tuesday afternoon.",
        "reason": "We run grocery runs, friendly visits, and tech-help sessions for seniors across Staten Island — most of our volunteers see the same handful of neighbors week after week.",
        "social": {"facebook": "https://facebook.com/empirestatevolunteers"},
        "photos": 6,
    },
    {
        "slug": "riverfront-community-garden", "name": "Riverfront Community Garden",
        "email": f"community.garden@{EMAIL_DOMAIN}", "category": "Community Garden", "group": "normal",
        "city": "Queens", "state": "NY", "phone": "(718) 555-0165",
        "website": "https://communitygarden.org",
        "missionStatement": "Turning an unused lot along the Long Island City waterfront into fresh vegetables for the families who need them most.",
        "reason": "The garden started with six raised beds behind the rec center — we're up to forty now, donating over a ton of produce a year to local food pantries.",
        "social": {"instagram": "https://instagram.com/riverfrontgarden", "facebook": "https://facebook.com/riverfrontgarden"},
        "photos": 11,
    },
    {
        "slug": "liberty-youth-sports", "name": "Liberty Youth Sports",
        "email": f"liberty.sports@{EMAIL_DOMAIN}", "category": "Community Sports", "group": "normal",
        "city": "Brooklyn", "state": "NY", "phone": "(718) 555-0121",
        "website": "https://libertysports.org",
        "missionStatement": "Every kid in Sunset Park deserves a team, a coach, and a place to belong.",
        "reason": "We field rec-league soccer, flag football, and track teams for kids who'd otherwise sit the season out, and we're always short on volunteer coaches and gameday help.",
        "social": {"instagram": "https://instagram.com/libertyyouthsports", "facebook": "https://facebook.com/libertyyouthsports", "youtube": "https://youtube.com/@libertyyouthsports"},
        "photos": 9,
    },
    {
        "slug": "downtown-neighborhood-alliance", "name": "Downtown Neighborhood Alliance",
        "email": f"downtown.alliance@{EMAIL_DOMAIN}", "category": "Neighborhood Association", "group": "brand_new",
        "city": "Manhattan", "state": "NY", "phone": "(212) 555-0110",
        "website": "https://downtownalliance.org",
        "missionStatement": "A stronger downtown starts with neighbors who actually know each other.",
        "reason": "We just got our nonprofit paperwork finalized this spring — block parties, safety walks, and a monthly potluck are our first real events as an organization.",
        "social": {"instagram": "https://instagram.com/downtownallianceNYC", "facebook": "https://facebook.com/downtownallianceNYC"},
        "photos": 5,
    },
    {
        "slug": "creative-futures-collective", "name": "Creative Futures Collective",
        "email": f"creative.futures@{EMAIL_DOMAIN}", "category": "Arts & Culture", "group": "brand_new",
        "city": "Staten Island", "state": "NY", "phone": "(718) 555-0143",
        "website": "https://creativefutures.org",
        "missionStatement": "Free studio space and real audiences for Staten Island's next generation of working artists.",
        "reason": "We signed the lease on a vacant storefront in Stapleton last month and are just now opening it up as a gallery, workshop, and performance space for local artists.",
        "social": {"instagram": "https://instagram.com/creativefuturesnyc", "tiktok": "https://tiktok.com/@creativefuturesnyc", "youtube": "https://youtube.com/@creativefuturesnyc"},
        "photos": 5,
    },
    {
        "slug": "queens-volleyball-club", "name": "Queens Volleyball Club",
        "email": f"jc.volleyball@{EMAIL_DOMAIN}", "category": "Community Sports", "group": "normal",
        "city": "Queens", "state": "NY", "phone": "(718) 555-0176",
        "website": "https://queensvolleyballclub.org",
        "missionStatement": "Free volleyball leagues and clinics for every age and skill level in Queens.",
        "reason": "We started with one Sunday pickup game at Rockaway Beach and grew into a full rec league running beach and indoor volleyball year-round — coaches, referees, and gameday setup are all volunteer-run.",
        "social": {"instagram": "https://instagram.com/queensvolleyballclub", "facebook": "https://facebook.com/queensvolleyballclub"},
        "photos": 8,
    },
]

# Every accessibility accommodation combo a seeded org quest can offer,
# cycled across all org quests below (see ACCOMMODATION_OPTIONS in
# main.py) — organization quests require at least one non-empty
# accommodationTags entry as of the accessibility-accommodations feature,
# so every quest here needs one, not just a token few.
ACCOMMODATION_CYCLE = [
    ["wheelchair-accessible"],
    ["wheelchair-accessible", "accessible-parking"],
    ["asl-interpretation"],
    ["sensory-friendly"],
    ["elevator-access"],
    ["wheelchair-accessible", "elevator-access"],
]
ACCOMMODATION_DETAILS_SAMPLE = "Ring the side door bell for step-free entry, or ask any volunteer in a green vest for help."

_accommodation_cursor = 0


def _next_accommodation():
    global _accommodation_cursor
    tags = ACCOMMODATION_CYCLE[_accommodation_cursor % len(ACCOMMODATION_CYCLE)]
    details = ACCOMMODATION_DETAILS_SAMPLE if _accommodation_cursor % 5 == 4 else None
    _accommodation_cursor += 1
    return tags, details


# One-off quests per org — "small"/"big" completed quests (so review counts
# and attendee-history spread land naturally per org), one upcoming (not
# full), one full-or-near-full. "brand_new" orgs skip the two completed
# slots entirely — no quest history yet, no reviews yet, Trust Score
# correctly reads "new". Tags intentionally use the app's 9 canonical
# tones (community/education/environment/outdoors/technology/youth/
# fitness/food-security/arts — see tagTones.js) wherever a tag should
# actually drive interest-matching (Quests.jsx's relevanceScore) or a
# tag-badge (badges.js), same as user interests below; extra descriptive
# tags beyond those 9 are fine too (TagStamp just renders them neutral).
QUEST_TEMPLATES = {
    "manhattan-community-kitchen": [
        {"key": "completed_small", "title": "Thanksgiving Food Drive Sorting", "days": -60, "capacity": 10, "count": 4, "tags": ["community", "food-security"], "location": "Manhattan Community Kitchen, East Harlem"},
        {"key": "completed_big", "title": "Weekend Meal Prep & Serve", "days": -35, "capacity": 15, "count": 13, "tags": ["community", "food-security"], "location": "Manhattan Community Kitchen, East Harlem"},
        {"key": "near_full", "title": "Holiday Meal Packing Day", "days": 5, "capacity": 15, "count": 14, "tags": ["community", "food-security"], "location": "Manhattan Community Kitchen, East Harlem", "qr_precheck": 2},
    ],
    "bronx-youth-leadership": [
        {"key": "completed_small", "title": "Civic Leadership Roundtable", "days": -50, "capacity": 12, "count": 3, "tags": ["youth", "community"], "location": "Fordham Library Center, Bronx"},
        {"key": "completed_big", "title": "Public Speaking Workshop for Teens", "days": -28, "capacity": 20, "count": 16, "tags": ["youth", "education"], "location": "Bronx Youth Leadership Center, Bronx"},
        {"key": "upcoming", "title": "Youth Leadership Training: Goal Setting", "days": 14, "capacity": 20, "count": 5, "tags": ["youth", "education"], "location": "Bronx Youth Leadership Center, Bronx"},
        {"key": "full", "title": "Student Council Bootcamp", "days": 7, "capacity": 12, "count": 12, "tags": ["youth", "education"], "location": "Bronx Youth Leadership Center, Bronx"},
    ],
    "green-tomorrow-nyc": [
        {"key": "completed_small", "title": "Native Plant Restoration Day", "days": -45, "capacity": 12, "count": 5, "tags": ["environment", "outdoors"], "location": "Astoria Park, Queens"},
        {"key": "completed_big", "title": "Astoria Park Cleanup", "days": -21, "capacity": 20, "count": 18, "tags": ["environment", "outdoors"], "location": "Astoria Park, Queens"},
        {"key": "near_full", "title": "Socrates Sculpture Park Cleanup", "days": 4, "capacity": 25, "count": 23, "tags": ["environment", "outdoors"], "location": "Socrates Sculpture Park, Queens", "qr_precheck": 2},
    ],
    "brooklyn-animal-rescue": [
        {"key": "completed_small", "title": "Shelter Deep-Clean & Enrichment Day", "days": -55, "capacity": 8, "count": 3, "tags": ["community"], "location": "Brooklyn Animal Rescue Shelter"},
        {"key": "completed_big", "title": "Adoption Fair Volunteer Day", "days": -30, "capacity": 12, "count": 11, "tags": ["community", "outdoors"], "location": "Bushwick Inlet Park, Brooklyn"},
        {"key": "upcoming", "title": "Foster Orientation Night", "days": 9, "capacity": 10, "count": 3, "tags": ["community", "education"], "location": "Brooklyn Animal Rescue Shelter"},
        {"key": "full", "title": "Winter Coat & Supply Drive", "days": 6, "capacity": 8, "count": 8, "tags": ["community"], "location": "Brooklyn Animal Rescue Shelter"},
    ],
    "nextgen-mentors": [
        {"key": "completed_small", "title": "Resume & Interview Workshop", "days": -48, "capacity": 10, "count": 4, "tags": ["education"], "location": "NextGen Mentors HQ, Bronx"},
        {"key": "completed_big", "title": "Mentor Match Night", "days": -24, "capacity": 20, "count": 17, "tags": ["education", "youth"], "location": "Mott Haven Branch Library, Bronx"},
        {"key": "upcoming", "title": "New Mentor Orientation", "days": 16, "capacity": 12, "count": 4, "tags": ["education", "community"], "location": "NextGen Mentors HQ, Bronx"},
        {"key": "near_full", "title": "Career Panel: Careers in Tech", "days": 5, "capacity": 20, "count": 19, "tags": ["education", "technology"], "location": "Mott Haven Branch Library, Bronx"},
    ],
    "empire-state-volunteers": [
        {"key": "completed_small", "title": "Tech Help Desk for Seniors", "days": -62, "capacity": 6, "count": 3, "tags": ["community", "technology"], "location": "St. George Senior Center, Staten Island"},
        {"key": "completed_big", "title": "Grocery Run for Seniors", "days": -33, "capacity": 10, "count": 9, "tags": ["community"], "location": "St. George Senior Center, Staten Island"},
        {"key": "upcoming", "title": "Friendly Visits Volunteer Training", "days": 11, "capacity": 10, "count": 2, "tags": ["community"], "location": "St. George Senior Center, Staten Island"},
        {"key": "full", "title": "Senior Center Holiday Party Setup", "days": 8, "capacity": 10, "count": 10, "tags": ["community"], "location": "St. George Senior Center, Staten Island"},
    ],
    "riverfront-community-garden": [
        {"key": "completed_small", "title": "Compost Bin Build Day", "days": -52, "capacity": 10, "count": 4, "tags": ["environment", "outdoors"], "location": "Riverfront Community Garden, Long Island City"},
        {"key": "completed_big", "title": "Fall Harvest Volunteer Day", "days": -26, "capacity": 20, "count": 17, "tags": ["community", "outdoors", "food-security"], "location": "Riverfront Community Garden, Long Island City"},
        {"key": "upcoming", "title": "Spring Bed Prep Workshop", "days": 18, "capacity": 20, "count": 5, "tags": ["community", "outdoors"], "location": "Riverfront Community Garden, Long Island City"},
        {"key": "near_full", "title": "Community Planting Day", "days": 3, "capacity": 20, "count": 19, "tags": ["community", "outdoors"], "location": "Riverfront Community Garden, Long Island City"},
    ],
    "liberty-youth-sports": [
        {"key": "completed_small", "title": "Flag Football Jamboree Volunteer Day", "days": -44, "capacity": 10, "count": 3, "tags": ["youth", "fitness"], "location": "Sunset Park, Brooklyn"},
        {"key": "completed_big", "title": "Fall Soccer Coaching Clinic", "days": -20, "capacity": 15, "count": 12, "tags": ["youth", "fitness"], "location": "Sunset Park, Brooklyn"},
        {"key": "upcoming", "title": "Winter Track Coaching Signup Night", "days": 13, "capacity": 15, "count": 3, "tags": ["youth", "fitness"], "location": "Liberty Youth Sports HQ, Brooklyn"},
        {"key": "full", "title": "Youth Soccer Tournament Volunteer Day", "days": 6, "capacity": 15, "count": 15, "tags": ["youth", "fitness"], "location": "Sunset Park, Brooklyn"},
    ],
    "downtown-neighborhood-alliance": [
        {"key": "upcoming", "title": "Monthly Neighbor Potluck", "days": 10, "capacity": 30, "count": 6, "tags": ["community"], "location": "Battery Park, Manhattan"},
        {"key": "near_full", "title": "Downtown Mural Cleanup Day", "days": 4, "capacity": 20, "count": 18, "tags": ["community", "arts"], "location": "Downtown Manhattan"},
    ],
    "creative-futures-collective": [
        {"key": "upcoming", "title": "Youth Art Workshop: Community Murals", "days": 15, "capacity": 16, "count": 4, "tags": ["arts", "youth"], "location": "Bay Street Studio, Staten Island"},
        {"key": "near_full", "title": "Bay Street Pop-Up Gallery Fundraiser", "days": 5, "capacity": 10, "count": 9, "tags": ["arts", "community"], "location": "Bay Street Studio, Staten Island"},
    ],
    "queens-volleyball-club": [
        {"key": "completed_small", "title": "Beach Volleyball Clinic for Kids", "days": -40, "capacity": 12, "count": 5, "tags": ["youth", "fitness"], "location": "Rockaway Beach, Queens"},
        {"key": "completed_big", "title": "Fall Rec League Kickoff Tournament", "days": -18, "capacity": 24, "count": 20, "tags": ["community", "fitness"], "location": "Rockaway Beach, Queens"},
        {"key": "upcoming", "title": "Referee & Scorekeeper Training Night", "days": 12, "capacity": 15, "count": 4, "tags": ["community", "fitness"], "location": "Queens Volleyball Club HQ, Queens"},
        {"key": "near_full", "title": "Winter Indoor League Volunteer Day", "days": 5, "capacity": 20, "count": 18, "tags": ["community", "fitness"], "location": "Rockaway Beach, Queens", "qr_precheck": 2},
    ],
}

# A 3-occurrence weekly recurring series per "recurring"-group org — first
# occurrence already happened (completed, reviewable), the other two are
# upcoming. Mirrors exactly what create_recurring_quest itself would have
# produced: every occurrence shares one seriesId (the first occurrence's
# own doc id) plus the same recurrenceFrequency/recurrenceUntil (see
# _quest_doc_fields/create_recurring_quest in main.py) — the one thing a
# single seed_org_quests pass can't produce, since that always makes
# standalone quests.
RECURRING_SERIES = {
    "manhattan-community-kitchen": {
        "title": "Weeknight Dinner Service", "capacity": 15,
        "tags": ["community", "food-security"], "location": "Manhattan Community Kitchen, East Harlem",
        "occurrences": [(-7, 5), (7, 4), (14, 2)],
    },
    "green-tomorrow-nyc": {
        "title": "Pollinator Garden Planting", "capacity": 18,
        "tags": ["environment", "outdoors"], "location": "Astoria Park, Queens",
        "occurrences": [(-14, 6), (7, 5), (21, 3)],
    },
}

LOCATION_COORDS = {
    "Manhattan Community Kitchen, East Harlem": (40.7957, -73.9389),
    "Bronx Youth Leadership Center, Bronx": (40.8610, -73.8977),
    "Fordham Library Center, Bronx": (40.8610, -73.8901),
    "Astoria Park, Queens": (40.7794, -73.9235),
    "Socrates Sculpture Park, Queens": (40.7694, -73.9385),
    "Bushwick Inlet Park, Brooklyn": (40.7217, -73.9552),
    "Brooklyn Animal Rescue Shelter": (40.6944, -73.9213),
    "Mott Haven Branch Library, Bronx": (40.8079, -73.9209),
    "NextGen Mentors HQ, Bronx": (40.8090, -73.9226),
    "St. George Senior Center, Staten Island": (40.6437, -74.0765),
    "Riverfront Community Garden, Long Island City": (40.7477, -73.9599),
    "Sunset Park, Brooklyn": (40.6602, -74.0000),
    "Liberty Youth Sports HQ, Brooklyn": (40.6590, -74.0089),
    "Battery Park, Manhattan": (40.7033, -74.0170),
    "Downtown Manhattan": (40.7075, -74.0113),
    "Bay Street Studio, Staten Island": (40.6268, -74.0776),
    "Rockaway Beach, Queens": (40.5834, -73.8171),
    "Queens Volleyball Club HQ, Queens": (40.5852, -73.8155),
}

QUEST_DESCRIPTIONS = {
    "Weekend Meal Prep & Serve": "Join our kitchen crew prepping and serving a full weekend meal service for East Harlem families.",
    "Thanksgiving Food Drive Sorting": "Help sort and pack donated Thanksgiving groceries into family-sized boxes ahead of the holiday.",
    "Weeknight Dinner Service": "Prep, cook, and serve a weeknight dinner for neighbors who rely on our kitchen.",
    "Holiday Meal Packing Day": "Pack holiday meal kits for delivery to families across East Harlem.",
    "Public Speaking Workshop for Teens": "A hands-on workshop where teens practice public speaking with real feedback from mentors.",
    "Civic Leadership Roundtable": "Teens sit down with local civic leaders to talk about what leadership actually looks like day to day.",
    "Youth Leadership Training: Goal Setting": "A session on setting real, trackable leadership goals for the semester ahead.",
    "Student Council Bootcamp": "An intensive day of training for incoming student council members across Bronx schools.",
    "Astoria Park Cleanup": "Bring gloves and good shoes — we're clearing litter and invasive growth along the East River waterfront.",
    "Native Plant Restoration Day": "Help us plant native species that support local pollinators along the Astoria Park shoreline.",
    "Pollinator Garden Planting": "Plant this season's pollinator-friendly bed alongside garden members and neighborhood families.",
    "Socrates Sculpture Park Cleanup": "A full-morning cleanup across Socrates Sculpture Park's waterfront lawns and art installations.",
    "Adoption Fair Volunteer Day": "Help run our outdoor adoption fair — set up, greet visitors, and walk dogs between meet-and-greets.",
    "Shelter Deep-Clean & Enrichment Day": "A deep clean of the shelter plus enrichment activities for animals waiting on their forever homes.",
    "Foster Orientation Night": "Thinking about fostering? Come learn what it actually involves from our current foster network.",
    "Winter Coat & Supply Drive": "Sort donated coats, blankets, and supplies for the animals staying with us through the cold months.",
    "Mentor Match Night": "New mentors meet their matched students for the first time in a low-key, guided setting.",
    "Resume & Interview Workshop": "Mentors run mock interviews and resume reviews for students prepping for their first jobs.",
    "New Mentor Orientation": "Required orientation for anyone joining our mentor roster this cycle.",
    "Career Panel: Careers in Tech": "A panel of working engineers and product managers talk through what their day-to-day actually looks like.",
    "Grocery Run for Seniors": "Pair up with a senior resident for a grocery run and a bit of company.",
    "Tech Help Desk for Seniors": "Drop-in tech help for seniors — phones, video calls, and everything in between.",
    "Friendly Visits Volunteer Training": "Training for new volunteers joining our weekly friendly-visit program.",
    "Senior Center Holiday Party Setup": "Help decorate and set up the senior center for this year's holiday party.",
    "Fall Harvest Volunteer Day": "Harvest this season's vegetables for donation to local food pantries.",
    "Compost Bin Build Day": "Build and install three new compost bins to expand the garden's capacity.",
    "Spring Bed Prep Workshop": "Turn soil, add compost, and get the raised beds ready for spring planting.",
    "Community Planting Day": "Plant this season's seedlings alongside garden members and neighborhood families.",
    "Fall Soccer Coaching Clinic": "A coaching clinic for volunteers running our fall rec-league soccer season.",
    "Flag Football Jamboree Volunteer Day": "Help run stations, keep score, and cheer on our flag football jamboree.",
    "Winter Track Coaching Signup Night": "Sign up to coach or help with our winter indoor track program.",
    "Youth Soccer Tournament Volunteer Day": "Volunteers needed to run our end-of-season youth soccer tournament.",
    "Monthly Neighbor Potluck": "Bring a dish, meet your neighbors — our very first monthly potluck at Battery Park.",
    "Downtown Mural Cleanup Day": "Clean and touch up the community mural wall downtown ahead of its anniversary.",
    "Youth Art Workshop: Community Murals": "Teens design and paint a mural panel with guidance from a working muralist.",
    "Bay Street Pop-Up Gallery Fundraiser": "A one-night pop-up gallery and fundraiser supporting next year's studio scholarships — our very first public event.",
    "Beach Volleyball Clinic for Kids": "A beginner-friendly beach volleyball clinic teaching kids the basics — serving, bumping, and setting.",
    "Fall Rec League Kickoff Tournament": "Help run our fall rec league's opening tournament — court setup, scorekeeping, and gameday hosting.",
    "Referee & Scorekeeper Training Night": "Training for volunteers signing up to referee or keep score for this season's league games.",
    "Winter Indoor League Volunteer Day": "Court setup, check-in, and scorekeeping for a full night of our winter indoor league games.",
}


# --- Demo users ---------------------------------------------------------

USERS = [
    # Iron: 0-99 points
    {"name": "Jordan Ortiz", "points": 0, "interests": ["community", "food-security"]},
    {"name": "Devon Carter", "points": 20, "interests": ["environment", "outdoors"]},
    {"name": "Priya Nair", "points": 40, "interests": ["education", "technology"], "accommodationNeeds": ["wheelchair-accessible"]},
    {"name": "Malik Thompson", "points": 60, "interests": ["youth", "fitness"]},
    {"name": "Sofia Ramirez", "points": 80, "interests": ["arts", "community"]},
    # Bronze: 100-199
    {"name": "Ethan Walsh", "points": 100, "interests": ["environment"]},
    {"name": "Amara Okafor", "points": 120, "interests": ["community", "youth"]},
    {"name": "Liam Chen", "points": 140, "interests": ["technology", "education"]},
    {"name": "Jasmine Rivera", "points": 160, "interests": ["food-security", "community"]},
    {"name": "Noah Kim", "points": 180, "interests": ["outdoors", "fitness"], "accommodationNeeds": ["sensory-friendly"]},
    # Silver: 200-299
    {"name": "Camila Torres", "points": 200, "interests": ["arts", "youth"]},
    {"name": "Tyler Brooks", "points": 220, "interests": ["environment", "outdoors"]},
    {"name": "Aaliyah Jackson", "points": 240, "interests": ["community", "education"], "accommodationNeeds": ["asl-interpretation"]},
    {"name": "Ben Whitfield", "points": 260, "interests": ["fitness", "youth"]},
    {"name": "Grace Nguyen", "points": 280, "interests": ["food-security", "community"]},
    # Gold: 300-399
    {"name": "Marcus Bell", "points": 300, "interests": ["youth", "fitness"]},
    {"name": "Isabella Rossi", "points": 320, "interests": ["arts", "community"]},
    {"name": "Omar Haddad", "points": 340, "interests": ["technology", "education"]},
    {"name": "Chloe Martin", "points": 360, "interests": ["environment", "outdoors"], "accommodationNeeds": ["accessible-parking"]},
    {"name": "Xavier Delgado", "points": 380, "interests": ["community", "food-security"]},
    # Diamond: 400+
    {"name": "Hannah Cohen", "points": 400, "interests": ["community", "education"], "certified": True},
    {"name": "Diego Fernandez", "points": 440, "interests": ["environment", "outdoors"], "certified": True},
    {"name": "Zoe Patterson", "points": 480, "interests": ["youth", "arts"], "certified": False},
    {"name": "Caleb Osei", "points": 520, "interests": ["fitness", "community"], "certified": False},
    {"name": "Lena Whitmore", "points": 560, "interests": ["food-security", "education"], "certified": False, "accommodationNeeds": ["elevator-access"]},
]

# Marcus Bell's completed leader-requested feedback response (see
# seed_feedback_and_journal below) earns the +20 bonus — added here so his
# stored `points` total stays consistent with the bonus his own Journal
# entry shows him as having received. Only Marcus, not any other named
# user, actually gets a bonus-earning completed feedback doc, so this set
# must stay in lockstep with seed_feedback_and_journal's own
# `completed_feedback` list below.
FEEDBACK_BONUS_RECIPIENTS = {"Marcus Bell"}

EXPERIENCE_CYCLE = ["new", "some", "experienced"]
TIME_CYCLE = ["monthly", "weekly", "flexible"]
GROUP_CYCLE = ["solo", "team", "leading"]
MOTIVATION_CYCLE = ["experience", "community", "impact", "requirement"]

# Cycled across every demo user so submit_onboarding's required location/
# placeId/lat/lng (and _has_enough_accessible_org_quests, for the 5 users
# above with accommodationNeeds) have real values to work with — a gap in
# the previous seeder, which left every demo user with no location at all.
# The 5 NYC boroughs — demo users and organizations (see ORGS above) both
# live in the city itself now, not a nearby state.
NY_LOCATIONS = [
    ("Manhattan, NY", "seed-place-manhattan", 40.7831, -73.9712),
    ("Brooklyn, NY", "seed-place-brooklyn", 40.6782, -73.9442),
    ("Queens, NY", "seed-place-queens", 40.7282, -73.7949),
    ("Bronx, NY", "seed-place-bronx", 40.8448, -73.8648),
    ("Staten Island, NY", "seed-place-staten-island", 40.5795, -74.1502),
]

REVIEW_BODIES = [
    "This was my first volunteer event and everyone was incredibly welcoming.",
    "The event was organized really well.",
    "I learned a lot and met some great people.",
    "The description matched the experience perfectly.",
    "Would definitely attend another event.",
]

DEFAULT_IRON_QUESTS = [
    {
        "title": "Introduce Yourself to a Neighbor You've Never Spoken With",
        "description": "Leadership starts with connection. Introduce yourself to a neighbor you've never met before. Have a short conversation, learn their name, and make your community feel a little smaller and more welcoming.",
        "tags": ["community", "neighbor", "communication", "leadership", "confidence"],
        "location": "Your neighborhood",
    },
    {
        "title": "Pick Up at Least 10 Pieces of Litter During a Walk",
        "description": "Small actions create lasting impact. During a walk through your neighborhood or a local park, pick up at least 10 pieces of litter and help make your community cleaner for everyone.",
        "tags": ["environment", "cleanup", "community", "outdoors", "service"],
        "location": "Any local park or neighborhood",
    },
    {
        "title": "Write a Thank-You Note to Someone Who Has Positively Impacted Your Life",
        "description": "Gratitude is a powerful form of leadership. Write a sincere thank-you note to someone who has encouraged, mentored, or supported you. Let them know how they've made a difference in your life.",
        "tags": ["gratitude", "reflection", "kindness", "leadership", "relationships"],
        "location": "Anywhere",
    },
    {
        "title": "Eat Lunch with a Friend or Family Member Without Any Screens",
        "description": "Strong communities are built through meaningful conversations. Share a meal with a friend or family member while keeping phones and screens away. Focus on being fully present and getting to know each other better.",
        "tags": ["family", "friendship", "mindfulness", "community", "connection"],
        "location": "Anywhere",
    },
    {
        "title": "Support a Local Small Business You've Never Visited Before",
        "description": "Discover something new in your community by visiting a locally owned business you've never been to before. Whether it's a café, bookstore, bakery, or shop, your support helps strengthen your local economy.",
        "tags": ["local", "business", "community", "economy", "exploration"],
        "location": "Any local small business",
    },
    {
        "title": "Smile and Greet Five Strangers During Your Day",
        "description": "Leadership often begins with simple acts of kindness. Throughout your day, smile and greet five different people with a friendly hello or good morning. You never know how a small interaction might brighten someone's day.",
        "tags": ["kindness", "confidence", "community", "social", "communication"],
        "location": "Anywhere",
    },
]

# Tiers above Iron unlock as a user's rank rises (see _unlocked_tiers in
# main.py) — the previous seeder only ever created Iron quests, so no
# higher tier had any real data to gate against. One list per tier, same
# shape as DEFAULT_IRON_QUESTS.
BRONZE_QUESTS = [
    {
        "title": "Organize a Small Cleanup With Two Neighbors",
        "description": "Recruit two neighbors and spend an hour cleaning up a stretch of street or a small park together. Leadership starts with getting a small group moving on something that matters.",
        "tags": ["environment", "cleanup", "community", "leadership", "outdoors"],
        "location": "Your neighborhood",
    },
    {
        "title": "Facilitate a Family Game Night With No Devices",
        "description": "Plan and run a screen-free game night for your family or roommates — pick the games, set the rules, keep everyone engaged. Small-scale facilitation is still facilitation.",
        "tags": ["community", "family", "connection", "leadership"],
        "location": "Anywhere",
    },
    {
        "title": "Mentor Someone Younger Through a Skill You Know",
        "description": "Spend an hour teaching a skill you're confident in — cooking, a sport, an instrument, a craft — to someone younger than you. Notice what it takes to explain something clearly.",
        "tags": ["youth", "education", "mentorship", "leadership"],
        "location": "Anywhere",
    },
]

SILVER_QUESTS = [
    {
        "title": "Organize a Donation Drive for a Local Cause",
        "description": "Pick a cause you care about and organize a small donation drive among friends, family, or coworkers — food, clothing, or supplies. Handle the logistics end to end: collecting, sorting, and delivering.",
        "tags": ["community", "food-security", "service", "leadership"],
        "location": "Your neighborhood",
    },
    {
        "title": "Start a Recurring Study or Skill-Share Group",
        "description": "Get a small group together on a regular cadence to study or trade skills — a book club, a coding practice group, a language exchange. Keep it running for at least three sessions.",
        "tags": ["education", "technology", "leadership", "community"],
        "location": "Anywhere",
    },
    {
        "title": "Coach a Pickup Sports Game for Neighborhood Kids",
        "description": "Organize and referee a pickup game for kids in your neighborhood — set teams, keep it fair, keep it fun. A low-stakes way to practice real-time group leadership.",
        "tags": ["youth", "fitness", "leadership", "outdoors"],
        "location": "Any local park",
    },
]

GOLD_QUESTS = [
    {
        "title": "Plan and Run a Neighborhood Event From Scratch",
        "description": "Plan a small neighborhood event — a block party, a potluck, a cleanup day — from the first idea through actually running it. Handle the invites, the logistics, and being the person people ask questions to on the day.",
        "tags": ["community", "leadership", "event-planning", "arts"],
        "location": "Your neighborhood",
    },
    {
        "title": "Start a Recurring Volunteer Meetup You Personally Organize",
        "description": "Start and run your own recurring volunteer meetup — not one hosted by an existing organization, one you organize yourself, start to finish, at least twice.",
        "tags": ["community", "leadership", "organizing"],
        "location": "Anywhere",
    },
]

DIAMOND_QUESTS = [
    {
        "title": "Mentor a Bronze-Rank Leader Through Their Next Quest",
        "description": "Reach out to someone earlier in their leadership journey and walk alongside them through their next quest — talk through what to expect, debrief with them afterward. Leadership at this level means investing in someone else's growth.",
        "tags": ["leadership", "mentorship", "community", "education"],
        "location": "Anywhere",
    },
    {
        "title": "Design and Pitch a New Community Initiative to a Local Org",
        "description": "Identify a real gap in your community, design a concrete initiative to address it, and actually pitch it to a local organization or civic body. Bring a plan, not just an idea.",
        "tags": ["leadership", "community", "organizing", "civic"],
        "location": "Anywhere",
    },
]

TIER_QUEST_LISTS = {
    "iron": DEFAULT_IRON_QUESTS,
    "bronze": BRONZE_QUESTS,
    "silver": SILVER_QUESTS,
    "gold": GOLD_QUESTS,
    "diamond": DIAMOND_QUESTS,
}

# One deterministic completion-state demo per tier: "rsvp_only" (accepted,
# not yet submitted — occupies one of the 2 concurrent side-quest slots,
# see SIDE_QUEST_CONCURRENT_LIMIT), "pending" (photo submitted, awaiting
# admin review), "completed" (approved — real attendance + tier points).
# Only users whose rank actually unlocks a tier are ever assigned to it.
TIER_COMPLETION_PLAN = {
    "iron": [("Jordan Ortiz", "rsvp_only", 0), ("Devon Carter", "pending", 1), ("Priya Nair", "completed", 2)],
    "bronze": [("Liam Chen", "rsvp_only", 2), ("Amara Okafor", "pending", 1), ("Ethan Walsh", "completed", 0)],
    "silver": [("Aaliyah Jackson", "rsvp_only", 2), ("Tyler Brooks", "pending", 1), ("Camila Torres", "completed", 0)],
    "gold": [("Isabella Rossi", "pending", 1), ("Marcus Bell", "completed", 0)],
    "diamond": [("Diego Fernandez", "pending", 1), ("Hannah Cohen", "completed", 0)],
}


def logo_url(name):
    return f"https://api.dicebear.com/9.x/initials/svg?seed={name.replace(' ', '+')}&backgroundType=gradientLinear"


def photo_url(slug, n):
    return f"https://picsum.photos/seed/{slug}-{n}/800/600"


# One real (curl-verified against images.unsplash.com as of this writing)
# photo per completed quest title, reused by every hero who journals about
# that quest — same real-world event, same photo, rather than a different
# generic stock image per attendee. Deliberately per-quest-*title*, not per
# tag/category: two quests under the same org (e.g. the two JC Community
# Kitchen ones below) still get visibly different photos. Only completed
# quests need one — nobody journals about a quest that hasn't happened
# yet. If any of these ever 404, swap in a fresh id from unsplash.com
# rather than leaving a broken <img> in a live demo.
JOURNAL_QUEST_PHOTOS = {
    "Thanksgiving Food Drive Sorting": "https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=800&q=60",
    "Weekend Meal Prep & Serve": "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=800&q=60",
    "Weeknight Dinner Service": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=60",
    "Civic Leadership Roundtable": "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=800&q=60",
    "Public Speaking Workshop for Teens": "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=800&q=60",
    "Native Plant Restoration Day": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=60",
    "Astoria Park Cleanup": "https://images.unsplash.com/photo-1618477388954-7852f32655ec?auto=format&fit=crop&w=800&q=60",
    "Pollinator Garden Planting": "https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=800&q=60",
    "Shelter Deep-Clean & Enrichment Day": "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=60",
    "Adoption Fair Volunteer Day": "https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=800&q=60",
    "Resume & Interview Workshop": "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=800&q=60",
    "Mentor Match Night": "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=60",
    "Tech Help Desk for Seniors": "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=60",
    "Grocery Run for Seniors": "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=60",
    "Compost Bin Build Day": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=800&q=60",
    "Fall Harvest Volunteer Day": "https://images.unsplash.com/photo-1567306301408-9b74779a11af?auto=format&fit=crop&w=800&q=60",
    "Flag Football Jamboree Volunteer Day": "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?auto=format&fit=crop&w=800&q=60",
    "Fall Soccer Coaching Clinic": "https://images.unsplash.com/photo-1551958219-acbc608c6377?auto=format&fit=crop&w=800&q=60",
}


def get_or_create_user(email, password, display_name):
    try:
        return auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return auth.create_user(email=email, password=password, display_name=display_name)


# Removes every account from the *previous* generation of this seeder
# (different email domain — see OLD_* above) so re-running this file
# replaces demo accounts instead of leaving stale duplicates behind
# alongside the new @lead-dux.app ones. Looked up by email, so this can
# never touch a real (non-demo) account.
def wipe_old_demo_accounts():
    old_emails = (
        [OLD_ADMIN_EMAIL]
        + OLD_ORG_EMAILS
        + [f"{u['name'].lower().replace(' ', '.')}@{OLD_USER_EMAIL_DOMAIN}" for u in USERS]
    )
    removed = 0
    for email in old_emails:
        try:
            user = auth.get_user_by_email(email)
        except auth.UserNotFoundError:
            continue
        db.collection("organizations").document(user.uid).delete()
        db.collection("users").document(user.uid).delete()
        db.collection("ORGREQ").document(user.uid).delete()
        auth.delete_user(user.uid)
        removed += 1
    print(f"  Removed {removed} old demo account(s) from the previous email domain")


# One-off rename: "Maria Ortiz" became "Jordan Ortiz" in USERS above.
# get_or_create_user (used by seed_users) only ever looks up by the
# CURRENT derived email, so without this the account from a previous run
# would just sit around under maria.ortiz@lead-dux.app, unreferenced, while
# seed_users created a brand-new jordan.ortiz@lead-dux.app account (and
# lost the original's uid, rank/points history, etc. in the process). A
# no-op on a completely fresh project, where the old email never existed.
def rename_demo_user(old_name, new_name):
    old_email = f"{old_name.lower().replace(' ', '.')}@{EMAIL_DOMAIN}"
    new_email = f"{new_name.lower().replace(' ', '.')}@{EMAIL_DOMAIN}"
    try:
        user = auth.get_user_by_email(old_email)
    except auth.UserNotFoundError:
        return
    auth.update_user(user.uid, email=new_email, display_name=new_name)
    db.collection("users").document(user.uid).set(
        {"name": new_name, "email": new_email}, merge=True
    )
    print(f"  Renamed demo user: {old_name} -> {new_name} ({user.uid})")


def seed_admin():
    user = get_or_create_user(ADMIN_EMAIL, DEMO_PASSWORD, ADMIN_NAME)
    auth.set_custom_user_claims(user.uid, {"role": "admin"})
    admins_ref = db.collection("config").document("admins")
    admins_snap = admins_ref.get()
    emails = set(admins_snap.to_dict().get("emails", [])) if admins_snap.exists else set()
    emails.add(ADMIN_EMAIL)
    admins_ref.set({"emails": sorted(emails)})
    print(f"Admin ready: {ADMIN_EMAIL} ({user.uid})")
    return user.uid


def seed_organizations():
    org_uids = {}
    for org in ORGS:
        user = get_or_create_user(org["email"], DEMO_PASSWORD, org["name"])
        auth.set_custom_user_claims(user.uid, {"role": "organization"})
        org_uids[org["slug"]] = user.uid

        db.collection("organizations").document(user.uid).set({
            "name": org["name"],
            "email": org["email"],
            "phone": org["phone"],
            "location": f"{org['city']}, {org['state']}",
            "reason": org["reason"],
            "ltag": [],
            "etag": [],
            "verified": True,
            "logoUrl": logo_url(org["name"]),
            "category": org["category"],
            "missionStatement": org["missionStatement"],
            "city": org["city"],
            "state": org["state"],
            "website": org["website"],
            "contactEmail": org["email"],
            "socialLinks": org["social"],
            "photos": [photo_url(org["slug"], i) for i in range(1, org["photos"] + 1)],
            "reviewCount": 0,
            "avgRating": 0,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        print(f"Organization ready: {org['name']} <{org['email']}> ({user.uid})")
    return org_uids


def seed_users():
    user_uids = []
    for i, u in enumerate(USERS):
        email = f"{u['name'].lower().replace(' ', '.')}@{EMAIL_DOMAIN}"
        user = get_or_create_user(email, DEMO_PASSWORD, u["name"])
        auth.set_custom_user_claims(user.uid, {"role": "user"})

        points = u["points"] + (20 if u["name"] in FEEDBACK_BONUS_RECIPIENTS else 0)
        rank = main._rank_for_points(points)
        location, place_id, lat, lng = NY_LOCATIONS[i % len(NY_LOCATIONS)]
        doc = {
            "email": email,
            "name": u["name"],
            "age": 22 + (i % 40),
            "location": location,
            "placeId": place_id,
            "lat": lat,
            "lng": lng,
            "interests": u["interests"],
            "accommodationNeeds": u.get("accommodationNeeds", []),
            "experienceLevel": EXPERIENCE_CYCLE[i % len(EXPERIENCE_CYCLE)],
            "experienceLevelOther": "",
            "timeAvailability": TIME_CYCLE[i % len(TIME_CYCLE)],
            "timeAvailabilityOther": "",
            "groupPreference": GROUP_CYCLE[i % len(GROUP_CYCLE)],
            "groupPreferenceOther": "",
            "motivation": MOTIVATION_CYCLE[i % len(MOTIVATION_CYCLE)],
            "motivationOther": "",
            "leaderGoal": "Build the confidence to organize something in my own neighborhood.",
            "isSuspended": False,
            "points": points,
            "rank": rank,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if u.get("certified"):
            doc["certificateIssued"] = True
            doc["certificateIssuedAt"] = NOW - timedelta(days=10)
        db.collection("users").document(user.uid).set(doc, merge=True)
        user_uids.append({"uid": user.uid, "email": email, "name": u["name"], "rank": rank})
        print(f"User ready: {u['name']} <{email}> — {rank} ({points} pts)")
    return user_uids


# Wipes every document this script itself would have created — every seed
# quest/series/attendance/photoSubmission/feedbackRequest doc id is
# deterministically prefixed "seed-" (quest_id above; attendance/
# photoSubmissions/feedbackRequests all key off {eventId}_{userId} via
# main.py's _attendance_doc_id, so they inherit the same prefix through
# eventId) — never touches a real org's real quest data, even if this runs
# against a project that has both. Run before reseeding so a template
# change actually lands, rather than just upserting on top of stale docs.
def wipe_old_seed_data():
    def delete_prefixed(collection_name):
        deleted = 0
        batch = db.batch()
        pending = 0
        for doc in db.collection(collection_name).stream():
            if not doc.id.startswith("seed-"):
                continue
            batch.delete(doc.reference)
            deleted += 1
            pending += 1
            if pending >= 400:
                batch.commit()
                batch = db.batch()
                pending = 0
        if pending > 0:
            batch.commit()
        print(f"  Deleted {deleted} old seed docs from {collection_name}")

    # questSeries/{id}/reviews is a subcollection — deleting the parent doc
    # doesn't cascade, so clear it first or it'd linger unreachable-but-not-
    # actually-gone.
    for series_doc in db.collection("questSeries").stream():
        if not series_doc.id.startswith("seed-"):
            continue
        for review_doc in series_doc.reference.collection("reviews").stream():
            review_doc.reference.delete()

    delete_prefixed("questSeries")
    delete_prefixed("quests")
    delete_prefixed("attendance")
    delete_prefixed("photoSubmissions")
    delete_prefixed("feedbackRequests")


# users/{uid}/journal and users/{uid}/notifications are subcollections, so
# the top-level wipe above can't reach them — cleared per demo user
# instead. Every doc in both is something this script itself created for a
# demo account (real per-user notifications/journal are never touched,
# since this only ever runs for the fixed demo user list).
def wipe_seed_user_activity(user_uids):
    for u in user_uids:
        user_ref = db.collection("users").document(u["uid"])
        for doc in user_ref.collection("journal").stream():
            if doc.id.startswith("seed-"):
                doc.reference.delete()
        for doc in user_ref.collection("notifications").stream():
            doc.reference.delete()


def _mint_qr_fields():
    return {"qrToken": secrets.token_urlsafe(24), "qrTokenVersion": 0}


def seed_org_quests(org_uids, user_uids):
    """Returns a list of completed-quest records (with attendee uids) so
    reviews/photo-submissions/feedback/journal can be drawn from real
    attendees, plus the full list of quest docs actually created (for the
    org dashboard's "your quests" screen to have plenty to show)."""
    completed_quests = []
    attendee_cursor = 0
    n_users = len(user_uids)

    def next_attendees(count):
        nonlocal attendee_cursor
        picked = []
        for _ in range(count):
            picked.append(user_uids[attendee_cursor % n_users]["uid"])
            attendee_cursor += 1
        return picked

    for org in ORGS:
        org_uid = org_uids[org["slug"]]
        for template in QUEST_TEMPLATES[org["slug"]]:
            quest_id = f"seed-{org['slug']}-{template['key']}"
            quest_ref = db.collection("quests").document(quest_id)
            event_date = NOW + timedelta(days=template["days"], hours=18)
            is_completed = template["days"] < 0

            attendees = next_attendees(template["count"])
            lat, lng = LOCATION_COORDS.get(template["location"], (None, None))
            accommodation_tags, accommodation_details = _next_accommodation()
            qr_fields = _mint_qr_fields()

            quest_ref.set({
                "title": template["title"],
                "description": QUEST_DESCRIPTIONS[template["title"]],
                "tags": template["tags"],
                "location": template["location"],
                "placeId": None,
                "lat": lat,
                "lng": lng,
                "accommodationTags": accommodation_tags,
                "accommodationDetails": accommodation_details,
                "timezone": "America/New_York",
                "capacity": template["capacity"],
                "seriesId": quest_id,
                "recurrenceFrequency": None,
                "recurrenceUntil": None,
                "eventDate": event_date,
                "eventEndTime": event_date + timedelta(hours=3),
                "orgId": org_uid,
                "orgName": org["name"],
                "isDefault": False,
                "tier": None,
                "rsvpd": attendees,
                "createdAt": firestore.SERVER_TIMESTAMP,
                **qr_fields,
            })

            # qr_precheck: a handful of an upcoming event's own attendees
            # are seeded as already checked in via QR (backend has no
            # "too early" check — see check_in_to_event's module note in
            # main.py — only that the check-in window hasn't closed yet),
            # sitting right alongside others who are RSVP'd but haven't
            # scanned in yet. Demonstrates every QR attendance state on one
            # real, currently-upcoming event rather than only ever on
            # already-completed ones.
            precheck_n = template.get("qr_precheck", 0)
            checked_in_now = attendees[:precheck_n] if precheck_n else []

            if is_completed or checked_in_now:
                checked_in_uids = attendees if is_completed else checked_in_now
                for uid in checked_in_uids:
                    checkin_time = (event_date + timedelta(hours=1)) if is_completed else NOW
                    main._attendance_ref(db, quest_id, uid).set({
                        "userId": uid,
                        "orgId": org_uid,
                        "eventId": quest_id,
                        "checkedInAt": checkin_time,
                        "pointsAwarded": main.ORG_QUEST_BASE_POINTS,
                        "qrToken": qr_fields["qrToken"],
                        "createdAt": checkin_time,
                    })
                    # Same private per-user journal entry check_in_to_event
                    # itself creates on a real check-in — see its module
                    # note in main.py — so the Journal page has real rows
                    # to show, not just ones this seeder specially crafts
                    # further down (see seed_feedback_and_journal).
                    db.collection("users").document(uid).collection("journal").document(quest_id).set({
                        "questId": quest_id,
                        "questTitle": template["title"],
                        "seriesId": quest_id,
                        "orgId": org_uid,
                        "orgName": org["name"],
                        "eventDate": event_date,
                        "reflectionBody": "",
                        "reflectionUpdatedAt": None,
                        "createdAt": firestore.SERVER_TIMESTAMP,
                        "requestStatus": None,
                    }, merge=True)
                if is_completed:
                    completed_quests.append({
                        "quest_id": quest_id, "org_uid": org_uid, "org_name": org["name"],
                        "event_date": event_date, "attendees": attendees, "title": template["title"],
                    })

            status = "completed" if is_completed else ("full" if len(attendees) >= template["capacity"] else "upcoming")
            print(f"  Quest: {template['title']} ({org['name']}) — {status}, {len(attendees)}/{template['capacity']}")

    return completed_quests


def seed_recurring_series(org_uids, user_uids):
    """A 3-occurrence weekly recurring series per RECURRING_SERIES org —
    see its own module note above. Returns any completed occurrences in
    the same shape seed_org_quests' completed_quests uses, so reviews can
    be drawn from them too."""
    completed_quests = []
    attendee_cursor = 1000  # offset so this doesn't retrace seed_org_quests' own cursor sequence
    n_users = len(user_uids)

    def next_attendees(count):
        nonlocal attendee_cursor
        picked = []
        for _ in range(count):
            picked.append(user_uids[attendee_cursor % n_users]["uid"])
            attendee_cursor += 1
        return picked

    for slug, series in RECURRING_SERIES.items():
        org_uid = org_uids[slug]
        org_name = next(o["name"] for o in ORGS if o["slug"] == slug)
        lat, lng = LOCATION_COORDS.get(series["location"], (None, None))
        occurrence_dates = [NOW + timedelta(days=days, hours=18) for days, _ in series["occurrences"]]
        series_id = f"seed-{slug}-series-0"
        until = occurrence_dates[-1]

        for i, (days, count) in enumerate(series["occurrences"]):
            quest_id = f"seed-{slug}-series-{i}"
            event_date = occurrence_dates[i]
            is_completed = days < 0
            attendees = next_attendees(count)
            accommodation_tags, accommodation_details = _next_accommodation()

            db.collection("quests").document(quest_id).set({
                "title": series["title"],
                "description": QUEST_DESCRIPTIONS[series["title"]],
                "tags": series["tags"],
                "location": series["location"],
                "placeId": None,
                "lat": lat,
                "lng": lng,
                "accommodationTags": accommodation_tags,
                "accommodationDetails": accommodation_details,
                "timezone": "America/New_York",
                "capacity": series["capacity"],
                "seriesId": series_id,
                "recurrenceFrequency": "weekly",
                "recurrenceUntil": until,
                "eventDate": event_date,
                "eventEndTime": event_date + timedelta(hours=3),
                "orgId": org_uid,
                "orgName": org_name,
                "isDefault": False,
                "tier": None,
                "rsvpd": attendees,
                "createdAt": firestore.SERVER_TIMESTAMP,
                **_mint_qr_fields(),
            })

            if is_completed:
                for uid in attendees:
                    checkin_time = event_date + timedelta(hours=1)
                    main._attendance_ref(db, quest_id, uid).set({
                        "userId": uid, "orgId": org_uid, "eventId": quest_id,
                        "checkedInAt": checkin_time, "pointsAwarded": main.ORG_QUEST_BASE_POINTS,
                        "qrToken": "seed-token", "createdAt": checkin_time,
                    })
                    db.collection("users").document(uid).collection("journal").document(quest_id).set({
                        "questId": quest_id, "questTitle": series["title"], "seriesId": series_id,
                        "orgId": org_uid, "orgName": org_name, "eventDate": event_date,
                        "reflectionBody": "", "reflectionUpdatedAt": None,
                        "createdAt": firestore.SERVER_TIMESTAMP, "requestStatus": None,
                    }, merge=True)
                completed_quests.append({
                    "quest_id": quest_id, "org_uid": org_uid, "org_name": org_name,
                    "event_date": event_date, "attendees": attendees, "title": series["title"],
                })

            status = "completed" if is_completed else "upcoming"
            print(f"  Quest: {series['title']} ({org_name}) [series, occurrence {i + 1}/{len(series['occurrences'])}] — {status}, {len(attendees)}/{series['capacity']}")

    return completed_quests


def seed_reviews(completed_quests, org_uids):
    ratings_cycle = [5, 5, 4, 5, 4, 3, 5, 4]  # mostly 5/4, occasional 3
    org_ref_by_uid = {uid: db.collection("organizations").document(uid) for uid in org_uids.values()}

    reviews_by_quest = {}
    for cq in completed_quests:
        # 4-12 reviews per org overall, drawn from real attendees of that
        # quest — cap at min(len(attendees), a per-quest share).
        reviewer_count = min(len(cq["attendees"]), max(2, len(cq["attendees"]) // 2))
        reviewers = cq["attendees"][:reviewer_count]
        reviews_by_quest[cq["quest_id"]] = reviewers

    review_index = 0
    for cq in completed_quests:
        series_id = cq["quest_id"].rsplit("-series-", 1)[0] + "-series-0" if "-series-" in cq["quest_id"] else cq["quest_id"]
        series_ref = db.collection("questSeries").document(series_id)
        org_ref = org_ref_by_uid[cq["org_uid"]]
        review_count = 0
        rating_sum = 0
        for uid in reviews_by_quest[cq["quest_id"]]:
            rating = ratings_cycle[review_index % len(ratings_cycle)]
            body = REVIEW_BODIES[review_index % len(REVIEW_BODIES)]
            review_index += 1

            review_ref = main._review_ref(db, series_id, uid, cq["quest_id"])
            review_ref.set({
                "uid": uid,
                "questId": cq["quest_id"],
                "eventDate": cq["event_date"],
                "rating": rating,
                "body": body,
                "createdAt": cq["event_date"] + timedelta(days=1),
            })
            review_count += 1
            rating_sum += rating

        if review_count:
            series_snap = series_ref.get()
            series_data = series_snap.to_dict() or {}
            series_current_count = series_data.get("reviewCount", 0)
            series_current_avg = series_data.get("avgRating", 0)
            series_new_count = series_current_count + review_count
            series_new_avg = ((series_current_avg * series_current_count) + rating_sum) / series_new_count
            series_ref.set({"reviewCount": series_new_count, "avgRating": series_new_avg}, merge=True)

            org_snap = org_ref.get()
            org_data = org_snap.to_dict() or {}
            org_current_count = org_data.get("reviewCount", 0)
            org_current_avg = org_data.get("avgRating", 0)
            org_new_count = org_current_count + review_count
            org_new_avg = ((org_current_avg * org_current_count) + rating_sum) / org_new_count
            org_ref.set({"reviewCount": org_new_count, "avgRating": org_new_avg}, merge=True)
            print(f"  Reviews: {cq['quest_id']} — {review_count} reviews, avg {rating_sum / review_count:.1f}")


# Every tier's self-directed side quests, plus the deterministic
# completion-state demo from TIER_COMPLETION_PLAN (rsvp-only/pending/
# completed) so the Side Quest page and admin's photo-moderation queue
# both have real, immediately-testable data the moment this finishes — no
# need to manually RSVP or submit anything first.
def seed_default_and_tier_quests(user_uids, admin_uid):
    name_to_uid = {row["name"]: row["uid"] for row in user_uids}

    quest_ids_by_tier = {}
    title_by_quest_id = {}
    for tier, quests in TIER_QUEST_LISTS.items():
        ids = []
        for quest in quests:
            quest_id = f"seed-default-{tier}-{quest['title'][:30].lower().replace(' ', '-').replace(chr(39), '')}"
            title_by_quest_id[quest_id] = quest["title"]
            db.collection("quests").document(quest_id).set({
                "title": quest["title"],
                "description": quest["description"],
                "tags": quest["tags"],
                "location": quest["location"],
                "placeId": None,
                "lat": None,
                "lng": None,
                "accommodationTags": [],
                "accommodationDetails": None,
                "timezone": "America/New_York",
                "capacity": None,
                "seriesId": quest_id,
                "recurrenceFrequency": None,
                "recurrenceUntil": None,
                "eventDate": None,
                "eventEndTime": None,
                "orgId": None,
                "orgName": None,
                "isDefault": True,
                "tier": tier,
                "rsvpd": [],
                "createdAt": firestore.SERVER_TIMESTAMP,
                **_mint_qr_fields(),
            })
            ids.append(quest_id)
            print(f"Default {tier.title()} quest ready: {quest['title']}")
        quest_ids_by_tier[tier] = ids

    # Wire up the deterministic rsvp-only/pending/completed demo per tier.
    for tier, plan in TIER_COMPLETION_PLAN.items():
        quest_ids = quest_ids_by_tier[tier]
        tier_points = main.TIER_BASE_POINTS[tier]
        for user_name, state, quest_index in plan:
            uid = name_to_uid.get(user_name)
            if uid is None or quest_index >= len(quest_ids):
                continue
            quest_id = quest_ids[quest_index]
            quest_title = title_by_quest_id[quest_id]
            db.collection("quests").document(quest_id).update({"rsvpd": firestore.ArrayUnion([uid])})

            if state != "rsvp_only":
                user_name_str = next((u["name"] for u in user_uids if u["uid"] == uid), None)
                photo_ref = main._photo_submission_ref(db, quest_id, uid)
                reflection = "This challenge pushed me a little outside my comfort zone, but I'm glad I followed through on it."
                photo_url_value = photo_url(f"{tier}-{quest_index}", 1)

                if state == "pending":
                    photo_ref.set({
                        "questId": quest_id, "userId": uid, "orgId": None, "isDefault": True,
                        "questTitle": quest_title, "userName": user_name_str,
                        "storagePath": photo_url_value, "contentType": "image/jpeg",
                        "reflection": reflection, "status": "pending", "pointsAwarded": 0,
                        "rejectionReason": None, "reviewedAt": None, "reviewedBy": None,
                        "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
                    })
                elif state == "completed":
                    photo_ref.set({
                        "questId": quest_id, "userId": uid, "orgId": None, "isDefault": True,
                        "questTitle": quest_title, "userName": user_name_str,
                        "storagePath": photo_url_value, "contentType": "image/jpeg",
                        "reflection": reflection, "status": "approved", "pointsAwarded": tier_points,
                        "rejectionReason": None, "reviewedAt": firestore.SERVER_TIMESTAMP, "reviewedBy": admin_uid,
                        "createdAt": NOW - timedelta(days=3), "updatedAt": firestore.SERVER_TIMESTAMP,
                    })
                    main._attendance_ref(db, quest_id, uid).set({
                        "userId": uid, "orgId": None, "eventId": quest_id,
                        "checkedInAt": NOW - timedelta(days=3), "pointsAwarded": tier_points,
                        "qrToken": None, "createdAt": NOW - timedelta(days=3),
                    })
            print(f"  {tier.title()} side quest '{quest_title}' — {user_name}: {state}")


def seed_org_quest_photo_submissions(completed_quests, org_uids, admin_uid):
    """A few proof-of-participation bonus photos on top of already-checked-
    in organization quests — one pending (org's own queue), one approved,
    one rejected, so PendingPhotoSubmissions has a real mix to review
    immediately rather than an empty "no pending submissions" page."""
    if len(completed_quests) < 3:
        return
    picks = [
        (completed_quests[0], "pending"),
        (completed_quests[min(1, len(completed_quests) - 1)], "approved"),
        (completed_quests[min(2, len(completed_quests) - 1)], "rejected"),
    ]
    for cq, state in picks:
        uid = cq["attendees"][0]
        user_snap = db.collection("users").document(uid).get()
        user_name = user_snap.to_dict().get("name") if user_snap.exists else None
        ref = main._photo_submission_ref(db, cq["quest_id"], uid)
        photo_url_value = photo_url(f"org-bonus-{cq['quest_id']}", 1)
        base = {
            "questId": cq["quest_id"], "userId": uid, "orgId": cq["org_uid"], "isDefault": False,
            "questTitle": cq["title"], "userName": user_name,
            "storagePath": photo_url_value, "contentType": "image/jpeg",
            "reflection": None, "createdAt": cq["event_date"] + timedelta(hours=2),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if state == "pending":
            ref.set({**base, "status": "pending", "pointsAwarded": 0, "rejectionReason": None, "reviewedAt": None, "reviewedBy": None})
        elif state == "approved":
            ref.set({**base, "status": "approved", "pointsAwarded": main.PHOTO_BONUS_POINTS, "rejectionReason": None, "reviewedAt": firestore.SERVER_TIMESTAMP, "reviewedBy": cq["org_uid"]})
        else:
            ref.set({**base, "status": "rejected", "pointsAwarded": 0, "rejectionReason": "Photo doesn't clearly show participation at the event — could you resubmit with the event visible in frame?", "reviewedAt": firestore.SERVER_TIMESTAMP, "reviewedBy": cq["org_uid"]})
        print(f"  Org-quest bonus photo: {cq['title']} — {user_name}: {state}")

    # A few more pending photos specifically for Manhattan Community
    # Kitchen — the org most manual test/demo sessions log into — so
    # PendingPhotoReview's bento grid + swipe stack has real volume to
    # exercise instead of a single-tile queue. Drawn from each of that
    # org's own completed quests' real attendees (skipping attendees[0],
    # already used by the single "pending" pick above if that quest is
    # completed_quests[0]).
    jc_org_uid = org_uids.get("manhattan-community-kitchen")
    jc_quests = [cq for cq in completed_quests if cq["org_uid"] == jc_org_uid]
    extra_picks = [(cq, uid) for cq in jc_quests for uid in cq["attendees"][1:3]]
    for i, (cq, uid) in enumerate(extra_picks):
        user_snap = db.collection("users").document(uid).get()
        user_name = user_snap.to_dict().get("name") if user_snap.exists else None
        ref = main._photo_submission_ref(db, cq["quest_id"], uid)
        photo_url_value = photo_url(f"org-bonus-extra-{cq['quest_id']}-{i}", 1)
        ref.set({
            "questId": cq["quest_id"], "userId": uid, "orgId": cq["org_uid"], "isDefault": False,
            "questTitle": cq["title"], "userName": user_name,
            "storagePath": photo_url_value, "contentType": "image/jpeg",
            "reflection": None, "createdAt": cq["event_date"] + timedelta(hours=2 + i),
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "status": "pending", "pointsAwarded": 0, "rejectionReason": None,
            "reviewedAt": None, "reviewedBy": None,
        })
    print(f"  Extra JC Community Kitchen pending photos: {len(extra_picks)}")


def _ensure_attended(cq, uid):
    """Guarantees (quest, uid) really has an attendance doc + journal entry
    — used below to attach feedback/reflection demos to specific NAMED
    users regardless of where the attendee-cycling cursor in
    seed_org_quests happened to place them, so a named user's stored
    `points` (see FEEDBACK_BONUS_RECIPIENTS in seed_users) always lines up
    with real, visible activity of theirs."""
    db.collection("quests").document(cq["quest_id"]).update({"rsvpd": firestore.ArrayUnion([uid])})
    attendance_ref = main._attendance_ref(db, cq["quest_id"], uid)
    if not attendance_ref.get().exists:
        checkin_time = cq["event_date"] + timedelta(hours=1)
        attendance_ref.set({
            "userId": uid, "orgId": cq["org_uid"], "eventId": cq["quest_id"],
            "checkedInAt": checkin_time, "pointsAwarded": main.ORG_QUEST_BASE_POINTS,
            "qrToken": "seed-token", "createdAt": checkin_time,
        })
    main._journal_ref(db, uid, cq["quest_id"]).set({
        "questId": cq["quest_id"], "questTitle": cq["title"], "seriesId": cq["quest_id"],
        "orgId": cq["org_uid"], "orgName": cq["org_name"], "eventDate": cq["event_date"],
        "reflectionBody": "", "reflectionUpdatedAt": None,
        "createdAt": firestore.SERVER_TIMESTAMP, "requestStatus": None,
    }, merge=True)


def seed_feedback_and_journal(completed_quests, user_uids):
    """Leader-requested feedback in both a pending (awaiting the org's
    response) and completed (some earning the bonus, one not) state, plus
    a couple of real journal reflections — so the Journal page and the
    org/admin "pending feedback requests" queue both have real content.
    Targets specific named users (via _ensure_attended) rather than
    whichever uid the attendee-cycling cursor happens to land on, so the
    bonus-earning case stays consistent with FEEDBACK_BONUS_RECIPIENTS'
    point bump in seed_users above."""
    if len(completed_quests) < 2:
        return
    name_to_uid = {row["name"]: row["uid"] for row in user_uids}
    cq_a, cq_b = completed_quests[0], completed_quests[1]

    # Two real reflections.
    for name, cq, text in [
        ("Sofia Ramirez", cq_a, "Showing up felt small at the time, but seeing how many people we actually served made it click why this matters."),
        ("Xavier Delgado", cq_b, "I was nervous going in, but everyone made it easy to jump in and help without needing much direction."),
    ]:
        uid = name_to_uid[name]
        _ensure_attended(cq, uid)
        db.collection("users").document(uid).collection("journal").document(cq["quest_id"]).set({
            "reflectionBody": text, "reflectionUpdatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)

    # Pending feedback requests (leader asked, org hasn't answered yet) —
    # Grace Nguyen plus two more, so PendingFeedbackList has more than a
    # single row to expand/step through. requesterName is denormalized here
    # by hand (see request_quest_feedback in main.py, which does the same
    # via the Admin SDK) since this script writes the doc directly rather
    # than calling that callable.
    pending_feedback = [
        ("Grace Nguyen", cq_a),
        ("Amara Okafor", cq_b),
        ("Camila Torres", cq_a),
    ]
    for name, cq in pending_feedback:
        uid = name_to_uid[name]
        _ensure_attended(cq, uid)
        expires_at = NOW + timedelta(days=main.FEEDBACK_REQUEST_WINDOW_DAYS)
        main._feedback_request_ref(db, cq["quest_id"], uid).set({
            "questId": cq["quest_id"], "uid": uid, "requesterName": name,
            "orgId": cq["org_uid"], "orgName": cq["org_name"],
            "questTitle": cq["title"], "eventDate": cq["event_date"], "requestedAt": firestore.SERVER_TIMESTAMP,
            "expiresAt": expires_at, "status": "pending", "answers": None, "extraThoughts": None,
            "score": None, "pointsAwarded": 0, "completedAt": None,
        })
        main._journal_ref(db, uid, cq["quest_id"]).set({
            "requestStatus": "pending", "requestedAt": firestore.SERVER_TIMESTAMP, "expiresAt": expires_at,
        }, merge=True)
    print(f"  Pending feedback requests: {', '.join(name for name, _ in pending_feedback)}")

    # Two completed feedback requests — Marcus Bell earned the bonus
    # (matches FEEDBACK_BONUS_RECIPIENTS' point bump in seed_users above),
    # Omar Haddad scored under FEEDBACK_SCORE_THRESHOLD and earned nothing.
    # summary/growthArea are hand-written here (not generated) since
    # seeding shouldn't depend on a live GEMINI_API_KEY — same shape
    # _generate_feedback_summary in functions/main.py would actually
    # produce for these answers, never a number among them.
    completed_feedback = [
        (
            "Marcus Bell", cq_b,
            {"engagement": 9, "presence": 8, "involvement": 9, "initiative": 8, "attitude": 9},
            "Genuinely one of our most reliable volunteers this month.", True,
            "Marcus brought strong participation and engagement to every shift, staying actively "
            "involved from start to finish. His presence and attentiveness were consistently "
            "reliable, and his contributions helped keep the group on track throughout. He also "
            "showed meaningful initiative, stepping in to help without needing to be asked. On top "
            "of all that, his attitude and cooperation made him easy to work alongside — exactly "
            "the kind of volunteer we hope to see again.",
            "",
        ),
        (
            "Omar Haddad", cq_a,
            {"engagement": 5, "presence": 4, "involvement": 5, "initiative": 3, "attitude": 5},
            "Showed up and did the work, but seemed distracted for most of the shift.", False,
            "Omar showed up and engaged with the group throughout the quest, contributing to the "
            "shared task alongside the rest of the team. His attitude stayed cooperative, and there "
            "were moments where his presence added to the group's effort. There's room to grow in "
            "how consistently he stays attentive and engaged throughout a full shift.",
            "Building more consistent initiative — stepping up and helping without waiting to be "
            "asked — would make the biggest difference next time.",
        ),
    ]
    for name, cq, answers, extra_thoughts, earns_bonus, summary, growth_area in completed_feedback:
        uid = name_to_uid[name]
        _ensure_attended(cq, uid)
        score = round(sum(answers.values()) / len(answers), 1)
        points = main.FEEDBACK_BONUS_POINTS if earns_bonus else 0
        main._feedback_request_ref(db, cq["quest_id"], uid).set({
            "questId": cq["quest_id"], "uid": uid, "requesterName": name,
            "orgId": cq["org_uid"], "orgName": cq["org_name"],
            "questTitle": cq["title"], "eventDate": cq["event_date"], "requestedAt": NOW - timedelta(days=4),
            "expiresAt": NOW + timedelta(days=10), "status": "completed", "answers": answers,
            "extraThoughts": extra_thoughts, "score": score, "summary": summary, "growthArea": growth_area,
            "pointsAwarded": points, "completedAt": NOW - timedelta(days=2),
        })
        main._journal_ref(db, uid, cq["quest_id"]).set({
            "requestStatus": "completed", "answers": answers, "extraThoughts": extra_thoughts,
            "score": score, "summary": summary, "growthArea": growth_area, "pointsAwarded": points,
            "completedAt": NOW - timedelta(days=2), "notified": False, "read": False,
        }, merge=True)
    print("  Completed feedback requests: Marcus Bell earned the bonus, Omar Haddad did not")


# A curated set of "hero" demo accounts (a couple per rank tier) with a
# real, individually-written journal — reflections + a matching background
# picture on most entries, so anyone logging in as one of these during a
# live demo sees a populated, personal-feeling Journal rather than the
# blank-reflection/no-picture default every other seeded attendance leaves
# behind. Deliberately NOT every demo user — writing this much unique copy
# for all 25 would either take forever or read as obviously templated;
# better to go deep on a few than shallow on everyone.
#
# Journal depth scales with rank (2 entries for a brand-new Iron member up
# to 5 for a veteran Diamond one) — both more realistic than uniform
# coverage and a better demo arc, since it lets the team show a thin,
# just-starting-out journal next to a rich, years-of-activity one. Every
# hero keeps exactly one attended entry with no reflection/picture at all,
# so the demo can also show (or live-fill) the "tap to reflect" empty
# state rather than presenting an unrealistically perfect account.
HERO_JOURNALS = {
    "Jordan Ortiz": {
        "filled": [
            ("Thanksgiving Food Drive Sorting", "This was my very first quest and I had no idea what to expect. Turns out sorting canned goods for three hours with total strangers is a great way to make friends fast — we packed something like 40 family boxes by the end of the shift."),
        ],
        "blank": "Weekend Meal Prep & Serve",
    },
    "Sofia Ramirez": {
        # She already has a reflection on Thanksgiving Food Drive Sorting
        # from seed_feedback_and_journal above — these add to that, not
        # replace it.
        "filled": [
            ("Shelter Deep-Clean & Enrichment Day", "Not exactly the community cause I expected to end up at, but scrubbing kennels next to people who clearly do this every week without complaint was humbling. Made me want to say yes to more things outside my usual lane."),
        ],
        "blank": "Adoption Fair Volunteer Day",
    },
    "Amara Okafor": {
        "filled": [
            ("Civic Leadership Roundtable", "Got to sit across from an actual city council member and ask her what she wished she'd known before running for office. Her answer — \"that the boring meetings are where the real work happens\" — has stuck with me since."),
            ("Public Speaking Workshop for Teens", "I went in assuming I'd just be helping teens with eye contact and pacing, but half of them gave feedback on MY sample speech that was sharper than anything I'd have caught myself. Left more prepared than I arrived."),
        ],
        "blank": "Mentor Match Night",
    },
    "Ethan Walsh": {
        "filled": [
            ("Native Plant Restoration Day", "Learned the hard way that 'native plant' doesn't mean 'easy to plant' — half our seedlings needed a specific soil depth I was definitely eyeballing wrong for the first hour. Got better by the end."),
            ("Astoria Park Cleanup", "Filled eleven contractor bags along maybe a quarter mile of trail. Kept thinking about how none of that litter blows in from nowhere — it's just what gets left behind, one piece at a time, by people who probably meant to pick it up later."),
        ],
        "blank": "Pollinator Garden Planting",
    },
    "Grace Nguyen": {
        "filled": [
            ("Weekend Meal Prep & Serve", "Thirteen of us on the line and it still felt like we were racing the clock right up until the doors opened. Worth it the second I saw the first family go back for seconds."),
            ("Weeknight Dinner Service", "Weeknight shifts hit differently than the weekend ones — smaller crew, faster pace, less time to think. I like it more, honestly. Less room to hang back."),
        ],
        "blank": "Fall Harvest Volunteer Day",
    },
    "Marcus Bell": {
        "filled": [
            ("Flag Football Jamboree Volunteer Day", "Ran the scoreboard table for six straight games and somehow still don't know all the rules of flag football. The kids did not let me forget a single missed flag pull."),
            ("Fall Soccer Coaching Clinic", "Picked up more from watching the actual coaches manage twelve overtired ten-year-olds at once than from anything I've read about leadership. Patience is a coachable skill, apparently."),
            ("Civic Leadership Roundtable", "Went to support a friend who was presenting and ended up staying for the whole thing. Didn't expect a room of teenagers to ask harder questions than most adults I know."),
        ],
        "blank": "Public Speaking Workshop for Teens",
    },
    "Omar Haddad": {
        "filled": [
            ("Tech Help Desk for Seniors", "Spent forty-five minutes helping one man video call his granddaughter for the first time. He teared up. I did too, a little, and I'm not going to pretend otherwise."),
            ("Resume & Interview Workshop", "Reviewed six resumes back to back and gave the same piece of advice five times: cut the objective statement, nobody reads it. Small fix, real difference in how each one read afterward."),
            ("Mentor Match Night", "Matched with a student who wants to go into the exact field I do. Strange, good kind of pressure to suddenly be someone's example of what that path can look like."),
        ],
        "blank": "Grocery Run for Seniors",
    },
    "Hannah Cohen": {
        "filled": [
            ("Shelter Deep-Clean & Enrichment Day", "Years of doing this kind of work and I still forget how much of it is just repetition — clean, refill, repeat — until one dog leans into your hand mid-scrub and you remember exactly why you keep coming back."),
            ("Compost Bin Build Day", "Built three bins with a crew that had never used a drill before today. Watching someone go from nervous to confident over one afternoon is most of why I keep signing up for build days specifically."),
            ("Civic Leadership Roundtable", "Sat in on this one as a mentor rather than a participant for the first time. Strange to realize I had more to offer just by staying quiet and letting the teens actually run the discussion."),
            ("Grocery Run for Seniors", "Same resident I've been paired with for three months now, and this was the first time she asked about my week before I could ask about hers. That's the whole point, really."),
        ],
        "blank": "Fall Harvest Volunteer Day",
    },
}


def seed_hero_journal_entries(completed_quests, user_uids):
    name_to_uid = {row["name"]: row["uid"] for row in user_uids}
    by_title = {cq["title"]: cq for cq in completed_quests}
    filled_count = 0

    for name, plan in HERO_JOURNALS.items():
        uid = name_to_uid[name]
        for i, (title, reflection) in enumerate(plan["filled"]):
            cq = by_title[title]
            _ensure_attended(cq, uid)
            db.collection("users").document(uid).collection("journal").document(cq["quest_id"]).set({
                "reflectionBody": reflection,
                "reflectionUpdatedAt": firestore.SERVER_TIMESTAMP,
                "thumbnailUrl": JOURNAL_QUEST_PHOTOS.get(title),
            }, merge=True)
            filled_count += 1
        blank_cq = by_title[plan["blank"]]
        _ensure_attended(blank_cq, uid)
    print(f"  Hero journals: {len(HERO_JOURNALS)} users, {filled_count} reflections + matching photos, 1 blank entry each")

    # Jordan Ortiz's Thanksgiving Food Drive Sorting entry additionally gets
    # a completed feedback response — a concrete "reflection already
    # written, feedback arrives afterward" example for the Journal page
    # (FeedbackStatus renders below the reflection body there, set off by
    # its own divider), same shape as seed_feedback_and_journal's own
    # completed_feedback cases above, just targeted at a specific named
    # hero/quest instead of whichever completed_quests[0]/[1] happen to be.
    jordan_uid = name_to_uid["Jordan Ortiz"]
    jordan_cq = by_title["Thanksgiving Food Drive Sorting"]
    _ensure_attended(jordan_cq, jordan_uid)
    jordan_answers = {"engagement": 9, "presence": 9, "involvement": 8, "initiative": 8, "attitude": 10}
    jordan_score = round(sum(jordan_answers.values()) / len(jordan_answers), 1)
    jordan_points = main.FEEDBACK_BONUS_POINTS if jordan_score >= main.FEEDBACK_SCORE_THRESHOLD else 0
    jordan_extra_thoughts = (
        "Jordan jumped right in without needing much direction, even as a first-timer — exactly "
        "the energy we hope every new volunteer brings."
    )
    # Hand-written, not generated — seeding shouldn't depend on a live
    # GEMINI_API_KEY. Every category is 8+ here, so growthArea stays empty
    # per _generate_feedback_summary's own rule 7.
    jordan_summary = (
        "You were actively engaged throughout the quest and consistently stayed focused on the "
        "experience. Your contributions helped move the group forward, and you regularly stepped "
        "up to help when opportunities arose. You maintained a positive, cooperative attitude that "
        "made working together enjoyable, and your overall presence strengthened the team's "
        "success. Keep bringing this level of energy and teamwork to future quests."
    )
    jordan_growth_area = ""
    main._feedback_request_ref(db, jordan_cq["quest_id"], jordan_uid).set({
        "questId": jordan_cq["quest_id"], "uid": jordan_uid, "requesterName": "Jordan Ortiz",
        "orgId": jordan_cq["org_uid"], "orgName": jordan_cq["org_name"],
        "questTitle": jordan_cq["title"], "eventDate": jordan_cq["event_date"],
        "requestedAt": NOW - timedelta(days=3), "expiresAt": NOW + timedelta(days=11),
        "status": "completed", "answers": jordan_answers, "extraThoughts": jordan_extra_thoughts,
        "score": jordan_score, "summary": jordan_summary, "growthArea": jordan_growth_area,
        "pointsAwarded": jordan_points, "completedAt": NOW - timedelta(days=1),
    })
    main._journal_ref(db, jordan_uid, jordan_cq["quest_id"]).set({
        "requestStatus": "completed", "answers": jordan_answers, "extraThoughts": jordan_extra_thoughts,
        "score": jordan_score, "summary": jordan_summary, "growthArea": jordan_growth_area,
        "pointsAwarded": jordan_points, "completedAt": NOW - timedelta(days=1),
        "notified": False, "read": False,
    }, merge=True)
    print(f"  Jordan Ortiz completed feedback: Thanksgiving Food Drive Sorting, score {jordan_score}")


def seed_notifications(user_uids):
    """One quest_cancelled and one quest_rescheduled notice — see
    NotificationBanner.jsx — so the member Home screen's must-dismiss
    banner has something real to show without needing to actually delete
    or reschedule a live quest first."""
    by_name = {row["name"]: row["uid"] for row in user_uids}
    main._notify_user(
        db, by_name["Jordan Ortiz"], kind="quest_cancelled",
        quest_id="seed-demo-cancelled-quest", quest_title="Fall Cleanup Meetup",
    )
    main._notify_user(
        db, by_name["Devon Carter"], kind="quest_rescheduled",
        quest_id="seed-demo-rescheduled-quest", quest_title="Riverside Trail Restoration",
        extra={"newEventDate": NOW + timedelta(days=20)},
    )
    print("  Notifications: quest_cancelled -> Jordan Ortiz, quest_rescheduled -> Devon Carter")


PENDING_ORG_APPLICATIONS = [
    {
        "email": f"riverside.arts@{EMAIL_DOMAIN}", "name": "Riverside Arts Collective",
        "phone": "(718) 555-0199", "location": "Brooklyn, NY", "placeId": "seed-place-brooklyn",
        "reason": "We're a small group of working artists looking to run free weekend workshops along the waterfront.",
    },
    {
        "email": f"northward.trades@{EMAIL_DOMAIN}", "name": "Northward Trade Skills Initiative",
        "phone": "(718) 555-0188", "location": "Bronx, NY", "placeId": "seed-place-bronx",
        "reason": "We teach basic home-repair and trade skills to young adults aging out of foster care and want to start hosting hands-on volunteer sessions.",
    },
]


def seed_pending_org_applications():
    for app in PENDING_ORG_APPLICATIONS:
        user = get_or_create_user(app["email"], DEMO_PASSWORD, app["name"])
        # Skip resetting role/ORGREQ if this demo application has already
        # been approved (organizations/{uid} exists) since a previous run —
        # a tester approving it is the whole point of seeding it as
        # "pending" in the first place, so re-running this shouldn't yank
        # it back to pending underneath them.
        if db.collection("organizations").document(user.uid).get().exists:
            print(f"Pending organization application already approved, left as-is: {app['name']} <{app['email']}>")
            continue
        auth.set_custom_user_claims(user.uid, {"role": "pending_org"})
        db.collection("ORGREQ").document(user.uid).set({
            "name": app["name"], "email": app["email"], "phone": app["phone"],
            "location": app["location"], "placeId": app["placeId"], "reason": app["reason"],
            "status": "pending", "createdAt": firestore.SERVER_TIMESTAMP,
        })
        print(f"Pending organization application ready: {app['name']} <{app['email']}>")


def print_demo_accounts(org_uids, user_uids):
    print("\n" + "=" * 72)
    print("DEMO ACCOUNTS")
    print("=" * 72)
    print(f"\nAdmin")
    print(f"  {'Leadership Quest Admin':<28} {ADMIN_EMAIL:<32} admin")

    print("\nOrganizations")
    for org in ORGS:
        print(f"  {org['name']:<32} {org['email']:<32} organization")

    print("\nPending organization applications (admin dashboard test data)")
    for app in PENDING_ORG_APPLICATIONS:
        print(f"  {app['name']:<32} {app['email']:<32} pending_org")

    print("\nUsers")
    for u in user_uids:
        print(f"  {u['name']:<20} {u['email']:<32} user  ({u['rank']})")

    print(f"\nPassword for every account above: {DEMO_PASSWORD}")
    print("\n" + "=" * 72)


def main_seed():
    print("Removing accounts from the previous seed generation...")
    wipe_old_demo_accounts()

    print("\nRenaming carried-over demo users...")
    rename_demo_user("Maria Ortiz", "Jordan Ortiz")

    print("\nWiping old seed quest/series/attendance/photo/feedback docs...")
    wipe_old_seed_data()

    print("\nSeeding admin...")
    admin_uid = seed_admin()

    print("\nSeeding organizations...")
    org_uids = seed_organizations()

    print("\nSeeding demo users...")
    user_uids = seed_users()

    print("\nClearing previously seeded journal/notification activity...")
    wipe_seed_user_activity(user_uids)

    print("\nSeeding organization quests + attendance...")
    completed_quests = seed_org_quests(org_uids, user_uids)

    print("\nSeeding recurring quest series...")
    completed_quests += seed_recurring_series(org_uids, user_uids)

    print("\nSeeding reviews + Trust Scores...")
    seed_reviews(completed_quests, org_uids)

    print("\nSeeding side quests (Iron through Diamond) + completion states...")
    seed_default_and_tier_quests(user_uids, admin_uid)

    print("\nSeeding organization-quest bonus photo submissions...")
    seed_org_quest_photo_submissions(completed_quests, org_uids, admin_uid)

    print("\nSeeding leader-requested feedback + journal reflections...")
    seed_feedback_and_journal(completed_quests, user_uids)

    print("\nSeeding hero-account journal reflections + background photos...")
    seed_hero_journal_entries(completed_quests, user_uids)

    print("\nSeeding notification-banner demo data...")
    seed_notifications(user_uids)

    print("\nSeeding pending organization applications...")
    seed_pending_org_applications()

    print_demo_accounts(org_uids, user_uids)
    print("\nDone.")


if __name__ == "__main__":
    main_seed()
