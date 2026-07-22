# Seeds a full presentation-ready demo dataset: verified organizations with
# complete profiles (mission, contact info, socials, photos), a realistic
# spread of organization quests (upcoming/nearly full/full/completed),
# demo users at every rank with believable quest history, reviews/Trust
# Scores, and the 6 default Iron neighborhood quests. Never deployed (no
# @https_fn decorator anywhere in this file) — same one-time-local pattern
# as bootstrap_admin.py/seed_quests.py.
#
# Reuses main.py's already-initialized Firebase app plus its own
# rank/points/attendance/review helpers (_rank_for_points, _attendance_ref,
# _review_ref, ORG_QUEST_BASE_POINTS, TIER_BASE_POINTS) rather than
# reimplementing that logic, so seeded data is always shape-correct with
# whatever the deployed app actually reads.
#
# Safe to re-run — organizations/users are looked up by email first, so a
# second run updates existing accounts instead of duplicating them. Quest/
# attendance/review docs use deterministic ids for the same reason.
#
# Usage (against production — a real service account key):
#   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
#   cd functions && source venv/bin/activate && python3 seed_demo_data.py
#
# Usage (against the local emulator suite instead, for a dry run):
#   firebase emulators:start --only auth,firestore,functions   # separate terminal
#   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
#   export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
#   cd functions && source venv/bin/activate && python3 seed_demo_data.py

from datetime import datetime, timedelta, timezone

import main

firestore = main.firestore
auth = main.auth
db = firestore.client()

DEMO_PASSWORD = "password123"
NOW = datetime.now(timezone.utc)

ADMIN_EMAIL = "admin@leadershipquest.com"
ADMIN_NAME = "Leadership Quest Admin"


# --- Organizations -----------------------------------------------------

ORGS = [
    {
        "slug": "jc-community-kitchen", "name": "Jersey City Community Kitchen",
        "email": "volunteer@jccommunitykitchen.org", "category": "Food Pantry",
        "city": "Jersey City", "state": "NJ", "phone": "(201) 555-0142",
        "website": "https://jccommunitykitchen.org",
        "missionStatement": "Ensuring every neighbor in Jersey City has access to a warm meal and a welcoming table.",
        "reason": "We started in a church basement in 2014 packing lunches for day laborers, and now we run a full community kitchen five days a week.",
        "social": {"instagram": "https://instagram.com/jccommunitykitchen", "facebook": "https://facebook.com/jccommunitykitchen"},
        "photos": 8,
    },
    {
        "slug": "hudson-youth-leadership", "name": "Hudson Youth Leadership Center",
        "email": "info@hudsonyouthleadership.org", "category": "Youth Leadership",
        "city": "Union City", "state": "NJ", "phone": "(201) 555-0198",
        "website": "https://hudsonyouthleadership.org",
        "missionStatement": "Building tomorrow's community leaders through mentorship, public speaking, and hands-on civic projects.",
        "reason": "Hudson County teens told us they wanted more say in their own neighborhoods — this Center is our answer.",
        "social": {"instagram": "https://instagram.com/hudsonyouthleadership", "facebook": "https://facebook.com/hudsonyouthleadership", "youtube": "https://youtube.com/@hudsonyouthleadership"},
        "photos": 10,
    },
    {
        "slug": "green-tomorrow-nj", "name": "Green Tomorrow NJ",
        "email": "admin@green-tomorrow.org", "category": "Environmental",
        "city": "Montclair", "state": "NJ", "phone": "(973) 555-0176",
        "website": "https://green-tomorrow.org",
        "missionStatement": "A cleaner, greener New Jersey, one park cleanup and native planting at a time.",
        "reason": "Founded by a handful of Montclair neighbors after a particularly bad litter season along the Third River.",
        "social": {"instagram": "https://instagram.com/greentomorrownj", "twitter": "https://x.com/greentomorrownj"},
        "photos": 12,
    },
    {
        "slug": "hoboken-animal-rescue", "name": "Hoboken Animal Rescue",
        "email": "events@hobokenrescue.org", "category": "Animal Rescue",
        "city": "Hoboken", "state": "NJ", "phone": "(201) 555-0133",
        "website": "https://hobokenrescue.org",
        "missionStatement": "No adoptable animal in Hudson County should wait more than 60 days for a home.",
        "reason": "What began as one foster home in a Hoboken brownstone is now a full rescue network across Hudson County.",
        "social": {"instagram": "https://instagram.com/hobokenrescue", "facebook": "https://facebook.com/hobokenrescue", "tiktok": "https://tiktok.com/@hobokenrescue"},
        "photos": 9,
    },
    {
        "slug": "nextgen-mentors", "name": "NextGen Mentors",
        "email": "hello@nextgenmentors.org", "category": "Education",
        "city": "Newark", "state": "NJ", "phone": "(973) 555-0154",
        "website": "https://nextgenmentors.org",
        "missionStatement": "Pairing Newark students with working professionals who looked like them growing up.",
        "reason": "Every mentor in our program was once a mentee — the whole model is built on paying it forward.",
        "social": {"instagram": "https://instagram.com/nextgenmentors", "linkedin": "https://linkedin.com/company/nextgenmentors"},
        "photos": 7,
    },
    {
        "slug": "garden-state-volunteers", "name": "Garden State Volunteers",
        "email": "team@gardenstatevolunteers.org", "category": "Senior Services",
        "city": "Bayonne", "state": "NJ", "phone": "(201) 555-0187",
        "website": "https://gardenstatevolunteers.org",
        "missionStatement": "Keeping Bayonne's senior residents connected, independent, and never alone on a Tuesday afternoon.",
        "reason": "We run grocery runs, friendly visits, and tech-help sessions for seniors across Bayonne.",
        "social": {"facebook": "https://facebook.com/gardenstatevolunteers"},
        "photos": 6,
    },
    {
        "slug": "riverfront-community-garden", "name": "Riverfront Community Garden",
        "email": "director@communitygarden.org", "category": "Community Garden",
        "city": "Weehawken", "state": "NJ", "phone": "(201) 555-0165",
        "website": "https://communitygarden.org",
        "missionStatement": "Turning an unused lot along the Hudson into fresh vegetables for the families who need them most.",
        "reason": "The garden started with six raised beds behind the rec center — we're up to forty now.",
        "social": {"instagram": "https://instagram.com/riverfrontgarden", "facebook": "https://facebook.com/riverfrontgarden"},
        "photos": 11,
    },
    {
        "slug": "liberty-youth-sports", "name": "Liberty Youth Sports",
        "email": "contact@libertysports.org", "category": "Community Sports",
        "city": "Jersey City", "state": "NJ", "phone": "(201) 555-0121",
        "website": "https://libertysports.org",
        "missionStatement": "Every kid in Jersey City deserves a team, a coach, and a place to belong.",
        "reason": "We field rec-league soccer, flag football, and track teams for kids who'd otherwise sit the season out.",
        "social": {"instagram": "https://instagram.com/libertyyouthsports", "facebook": "https://facebook.com/libertyyouthsports", "youtube": "https://youtube.com/@libertyyouthsports"},
        "photos": 9,
    },
    {
        "slug": "downtown-neighborhood-alliance", "name": "Downtown Neighborhood Alliance",
        "email": "hello@downtownalliance.org", "category": "Neighborhood Association",
        "city": "Jersey City", "state": "NJ", "phone": "(201) 555-0110",
        "website": "https://downtownalliance.org",
        "missionStatement": "A stronger downtown starts with neighbors who actually know each other.",
        "reason": "Block parties, safety walks, and a monthly potluck — small things that add up to a real community.",
        "social": {"instagram": "https://instagram.com/downtownallianceJC", "facebook": "https://facebook.com/downtownallianceJC"},
        "photos": 8,
    },
    {
        "slug": "creative-futures-collective", "name": "Creative Futures Collective",
        "email": "studio@creativefutures.org", "category": "Arts & Culture",
        "city": "Newark", "state": "NJ", "phone": "(973) 555-0143",
        "website": "https://creativefutures.org",
        "missionStatement": "Free studio space and real audiences for Newark's next generation of working artists.",
        "reason": "We turned a vacant storefront on Halsey Street into a gallery, workshop, and performance space.",
        "social": {"instagram": "https://instagram.com/creativefuturesnwk", "tiktok": "https://tiktok.com/@creativefuturesnwk", "youtube": "https://youtube.com/@creativefuturesnwk"},
        "photos": 10,
    },
]


# --- Quest templates per org (4 each: 2 completed, 1 upcoming, 1 nearly-full-or-full) ---

QUEST_TEMPLATES = {
    "jc-community-kitchen": [
        {"key": "A", "title": "Weekend Meal Prep & Serve", "days": -35, "capacity": 15, "count": 12, "tags": ["community", "food security"], "location": "JC Community Kitchen, Jersey City"},
        {"key": "B", "title": "Thanksgiving Food Drive Sorting", "days": -60, "capacity": 10, "count": 6, "tags": ["community", "food security"], "location": "JC Community Kitchen, Jersey City"},
        {"key": "upcoming", "title": "Weeknight Dinner Service", "days": 10, "capacity": 15, "count": 4, "tags": ["community", "food security"], "location": "JC Community Kitchen, Jersey City"},
        {"key": "near_full", "title": "Holiday Meal Packing Day", "days": 5, "capacity": 15, "count": 14, "tags": ["community", "food security"], "location": "JC Community Kitchen, Jersey City"},
    ],
    "hudson-youth-leadership": [
        {"key": "A", "title": "Public Speaking Workshop for Teens", "days": -28, "capacity": 20, "count": 15, "tags": ["youth", "education"], "location": "Hudson Youth Leadership Center, Union City"},
        {"key": "B", "title": "Civic Leadership Roundtable", "days": -50, "capacity": 12, "count": 7, "tags": ["youth", "community"], "location": "Union City Library"},
        {"key": "upcoming", "title": "Youth Leadership Training: Goal Setting", "days": 14, "capacity": 20, "count": 5, "tags": ["youth", "education"], "location": "Hudson Youth Leadership Center, Union City"},
        {"key": "full", "title": "Student Council Bootcamp", "days": 7, "capacity": 12, "count": 12, "tags": ["youth", "education"], "location": "Hudson Youth Leadership Center, Union City"},
    ],
    "green-tomorrow-nj": [
        {"key": "A", "title": "Third River Park Cleanup", "days": -21, "capacity": 20, "count": 18, "tags": ["environment", "outdoors"], "location": "Third River Park, Montclair"},
        {"key": "B", "title": "Native Plant Restoration Day", "days": -45, "capacity": 12, "count": 9, "tags": ["environment", "outdoors"], "location": "Edgemont Park, Montclair"},
        {"key": "upcoming", "title": "Fall Leaf Composting Workshop", "days": 12, "capacity": 25, "count": 6, "tags": ["environment"], "location": "Edgemont Park, Montclair"},
        {"key": "near_full", "title": "Branch Brook Park Cleanup", "days": 4, "capacity": 25, "count": 22, "tags": ["environment", "outdoors"], "location": "Branch Brook Park, Montclair"},
    ],
    "hoboken-animal-rescue": [
        {"key": "A", "title": "Adoption Fair Volunteer Day", "days": -30, "capacity": 12, "count": 10, "tags": ["community", "outdoors"], "location": "Church Square Park, Hoboken"},
        {"key": "B", "title": "Shelter Deep-Clean & Enrichment Day", "days": -55, "capacity": 8, "count": 5, "tags": ["community"], "location": "Hoboken Animal Rescue Shelter"},
        {"key": "upcoming", "title": "Foster Orientation Night", "days": 9, "capacity": 10, "count": 3, "tags": ["community", "education"], "location": "Hoboken Animal Rescue Shelter"},
        {"key": "full", "title": "Winter Coat & Supply Drive", "days": 6, "capacity": 8, "count": 8, "tags": ["community"], "location": "Hoboken Animal Rescue Shelter"},
    ],
    "nextgen-mentors": [
        {"key": "A", "title": "Mentor Match Night", "days": -24, "capacity": 20, "count": 14, "tags": ["education", "youth"], "location": "Newark Public Library"},
        {"key": "B", "title": "Resume & Interview Workshop", "days": -48, "capacity": 10, "count": 6, "tags": ["education"], "location": "NextGen Mentors HQ, Newark"},
        {"key": "upcoming", "title": "New Mentor Orientation", "days": 16, "capacity": 12, "count": 4, "tags": ["education", "community"], "location": "NextGen Mentors HQ, Newark"},
        {"key": "near_full", "title": "Career Panel: Careers in Tech", "days": 5, "capacity": 20, "count": 18, "tags": ["education", "technology"], "location": "Newark Public Library"},
    ],
    "garden-state-volunteers": [
        {"key": "A", "title": "Grocery Run for Seniors", "days": -33, "capacity": 10, "count": 8, "tags": ["community"], "location": "Bayonne Senior Center"},
        {"key": "B", "title": "Tech Help Desk for Seniors", "days": -62, "capacity": 6, "count": 4, "tags": ["community", "technology"], "location": "Bayonne Senior Center"},
        {"key": "upcoming", "title": "Friendly Visits Volunteer Training", "days": 11, "capacity": 10, "count": 2, "tags": ["community"], "location": "Bayonne Senior Center"},
        {"key": "full", "title": "Senior Center Holiday Party Setup", "days": 8, "capacity": 10, "count": 10, "tags": ["community"], "location": "Bayonne Senior Center"},
    ],
    "riverfront-community-garden": [
        {"key": "A", "title": "Fall Harvest Volunteer Day", "days": -26, "capacity": 20, "count": 16, "tags": ["community", "outdoors"], "location": "Riverfront Community Garden, Weehawken"},
        {"key": "B", "title": "Compost Bin Build Day", "days": -52, "capacity": 10, "count": 7, "tags": ["environment", "outdoors"], "location": "Riverfront Community Garden, Weehawken"},
        {"key": "upcoming", "title": "Spring Bed Prep Workshop", "days": 18, "capacity": 20, "count": 5, "tags": ["community", "outdoors"], "location": "Riverfront Community Garden, Weehawken"},
        {"key": "near_full", "title": "Community Planting Day", "days": 3, "capacity": 20, "count": 19, "tags": ["community", "outdoors"], "location": "Riverfront Community Garden, Weehawken"},
    ],
    "liberty-youth-sports": [
        {"key": "A", "title": "Fall Soccer Coaching Clinic", "days": -20, "capacity": 15, "count": 11, "tags": ["youth", "fitness"], "location": "Lincoln Park, Jersey City"},
        {"key": "B", "title": "Flag Football Jamboree Volunteer Day", "days": -44, "capacity": 10, "count": 6, "tags": ["youth", "fitness"], "location": "Lincoln Park, Jersey City"},
        {"key": "upcoming", "title": "Winter Track Coaching Signup Night", "days": 13, "capacity": 15, "count": 3, "tags": ["youth", "fitness"], "location": "Liberty Youth Sports HQ, Jersey City"},
        {"key": "full", "title": "Youth Soccer Tournament Volunteer Day", "days": 6, "capacity": 15, "count": 15, "tags": ["youth", "fitness"], "location": "Lincoln Park, Jersey City"},
    ],
    "downtown-neighborhood-alliance": [
        {"key": "A", "title": "Neighborhood Safety Walk", "days": -29, "capacity": 12, "count": 9, "tags": ["community"], "location": "Downtown Jersey City"},
        {"key": "B", "title": "Fall Block Party Cleanup", "days": -58, "capacity": 15, "count": 13, "tags": ["community", "outdoors"], "location": "Van Vorst Park, Jersey City"},
        {"key": "upcoming", "title": "Monthly Neighbor Potluck", "days": 10, "capacity": 30, "count": 6, "tags": ["community"], "location": "Van Vorst Park, Jersey City"},
        {"key": "near_full", "title": "Downtown Mural Cleanup Day", "days": 4, "capacity": 20, "count": 17, "tags": ["community", "arts"], "location": "Downtown Jersey City"},
    ],
    "creative-futures-collective": [
        {"key": "A", "title": "Open Studio Volunteer Night", "days": -23, "capacity": 12, "count": 9, "tags": ["arts", "community"], "location": "Halsey Street Studio, Newark"},
        {"key": "B", "title": "Gallery Install Volunteer Day", "days": -49, "capacity": 8, "count": 5, "tags": ["arts"], "location": "Halsey Street Studio, Newark"},
        {"key": "upcoming", "title": "Youth Art Workshop: Community Murals", "days": 15, "capacity": 16, "count": 4, "tags": ["arts", "youth"], "location": "Halsey Street Studio, Newark"},
        {"key": "full", "title": "Halsey Street Pop-Up Gallery Fundraiser", "days": 5, "capacity": 10, "count": 10, "tags": ["arts", "community"], "location": "Halsey Street Studio, Newark"},
    ],
}

QUEST_DESCRIPTIONS = {
    "Weekend Meal Prep & Serve": "Join our kitchen crew prepping and serving a full weekend meal service for Jersey City families.",
    "Thanksgiving Food Drive Sorting": "Help sort and pack donated Thanksgiving groceries into family-sized boxes ahead of the holiday.",
    "Weeknight Dinner Service": "Prep, cook, and serve a weeknight dinner for neighbors who rely on our kitchen.",
    "Holiday Meal Packing Day": "Pack holiday meal kits for delivery to families across Jersey City.",
    "Public Speaking Workshop for Teens": "A hands-on workshop where teens practice public speaking with real feedback from mentors.",
    "Civic Leadership Roundtable": "Teens sit down with local civic leaders to talk about what leadership actually looks like day to day.",
    "Youth Leadership Training: Goal Setting": "A session on setting real, trackable leadership goals for the semester ahead.",
    "Student Council Bootcamp": "An intensive day of training for incoming student council members across Hudson County schools.",
    "Third River Park Cleanup": "Bring gloves and good shoes — we're clearing litter and invasive growth along the Third River.",
    "Native Plant Restoration Day": "Help us plant native species that support local pollinators along the Edgemont Park trail.",
    "Fall Leaf Composting Workshop": "Learn how to turn fallen leaves into next season's compost, then help us start this year's pile.",
    "Branch Brook Park Cleanup": "A full-morning cleanup across Branch Brook Park's cherry blossom groves.",
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
    "Neighborhood Safety Walk": "An evening walk through downtown to flag broken streetlights, potholes, and safety concerns.",
    "Fall Block Party Cleanup": "Help pack up and clean up after our biggest block party of the year.",
    "Monthly Neighbor Potluck": "Bring a dish, meet your neighbors — our monthly potluck at Van Vorst Park.",
    "Downtown Mural Cleanup Day": "Clean and touch up the community mural wall downtown ahead of its anniversary.",
    "Open Studio Volunteer Night": "Help host our monthly open studio night for local working artists.",
    "Gallery Install Volunteer Day": "Hang and light this season's gallery show alongside our curators.",
    "Youth Art Workshop: Community Murals": "Teens design and paint a mural panel with guidance from a working muralist.",
    "Halsey Street Pop-Up Gallery Fundraiser": "A one-night pop-up gallery and fundraiser supporting next year's studio scholarships.",
}


# --- Demo users ---------------------------------------------------------

USERS = [
    # Iron: 0-99 points
    {"name": "Maria Ortiz", "points": 0, "interests": ["community", "food security"]},
    {"name": "Devon Carter", "points": 20, "interests": ["environment", "outdoors"]},
    {"name": "Priya Nair", "points": 40, "interests": ["education", "technology"]},
    {"name": "Malik Thompson", "points": 60, "interests": ["youth", "fitness"]},
    {"name": "Sofia Ramirez", "points": 80, "interests": ["arts", "community"]},
    # Bronze: 100-199
    {"name": "Ethan Walsh", "points": 100, "interests": ["environment"]},
    {"name": "Amara Okafor", "points": 120, "interests": ["community", "youth"]},
    {"name": "Liam Chen", "points": 140, "interests": ["technology", "education"]},
    {"name": "Jasmine Rivera", "points": 160, "interests": ["food security", "community"]},
    {"name": "Noah Kim", "points": 180, "interests": ["outdoors", "fitness"]},
    # Silver: 200-299
    {"name": "Camila Torres", "points": 200, "interests": ["arts", "youth"]},
    {"name": "Tyler Brooks", "points": 220, "interests": ["environment", "outdoors"]},
    {"name": "Aaliyah Jackson", "points": 240, "interests": ["community", "education"]},
    {"name": "Ben Whitfield", "points": 260, "interests": ["fitness", "youth"]},
    {"name": "Grace Nguyen", "points": 280, "interests": ["food security", "community"]},
    # Gold: 300-399
    {"name": "Marcus Bell", "points": 300, "interests": ["youth", "fitness"]},
    {"name": "Isabella Rossi", "points": 320, "interests": ["arts", "community"]},
    {"name": "Omar Haddad", "points": 340, "interests": ["technology", "education"]},
    {"name": "Chloe Martin", "points": 360, "interests": ["environment", "outdoors"]},
    {"name": "Xavier Delgado", "points": 380, "interests": ["community", "food security"]},
    # Diamond: 400+
    {"name": "Hannah Cohen", "points": 400, "interests": ["community", "education"], "certified": True},
    {"name": "Diego Fernandez", "points": 440, "interests": ["environment", "outdoors"], "certified": True},
    {"name": "Zoe Patterson", "points": 480, "interests": ["youth", "arts"], "certified": False},
    {"name": "Caleb Osei", "points": 520, "interests": ["fitness", "community"], "certified": False},
    {"name": "Lena Whitmore", "points": 560, "interests": ["food security", "education"], "certified": False},
]

EXPERIENCE_CYCLE = ["new", "some", "experienced"]
TIME_CYCLE = ["monthly", "weekly", "flexible"]
GROUP_CYCLE = ["solo", "team", "leading"]
MOTIVATION_CYCLE = ["experience", "community", "impact", "requirement"]

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


def logo_url(name):
    return f"https://api.dicebear.com/9.x/initials/svg?seed={name.replace(' ', '+')}&backgroundType=gradientLinear"


def photo_url(slug, n):
    return f"https://picsum.photos/seed/{slug}-{n}/800/600"


def get_or_create_user(email, password, display_name):
    try:
        return auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return auth.create_user(email=email, password=password, display_name=display_name)


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
        email = f"{u['name'].lower().replace(' ', '.')}@demo.leadershipquest.app"
        user = get_or_create_user(email, DEMO_PASSWORD, u["name"])
        auth.set_custom_user_claims(user.uid, {"role": "user"})

        rank = main._rank_for_points(u["points"])
        doc = {
            "email": email,
            "name": u["name"],
            "age": 22 + (i % 40),
            "interests": u["interests"],
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
            "points": u["points"],
            "rank": rank,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if u.get("certified"):
            doc["certificateIssued"] = True
            doc["certificateIssuedAt"] = NOW - timedelta(days=10)
        db.collection("users").document(user.uid).set(doc, merge=True)
        user_uids.append({"uid": user.uid, "email": email, "name": u["name"], "rank": rank})
        print(f"User ready: {u['name']} <{email}> — {rank} ({u['points']} pts)")
    return user_uids


def seed_org_quests(org_uids, user_uids):
    """Returns a list of completed-quest records (with attendee uids) so
    reviews can be drawn from real attendees."""
    completed_quests = []
    attendee_cursor = 0
    n_users = len(user_uids)

    for org in ORGS:
        org_uid = org_uids[org["slug"]]
        for template in QUEST_TEMPLATES[org["slug"]]:
            quest_id = f"seed-{org['slug']}-{template['key']}"
            quest_ref = db.collection("quests").document(quest_id)
            event_date = NOW + timedelta(days=template["days"], hours=18)
            is_completed = template["days"] < 0

            # Cycle attendees/RSVPs across the whole user pool so people
            # naturally overlap across multiple organizations.
            attendees = []
            for _ in range(template["count"]):
                attendees.append(user_uids[attendee_cursor % n_users]["uid"])
                attendee_cursor += 1

            quest_ref.set({
                "title": template["title"],
                "description": QUEST_DESCRIPTIONS[template["title"]],
                "tags": template["tags"],
                "location": template["location"],
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
            })

            if is_completed:
                for uid in attendees:
                    main._attendance_ref(db, quest_id, uid).set({
                        "userId": uid,
                        "orgId": org_uid,
                        "eventId": quest_id,
                        "checkedInAt": event_date + timedelta(hours=1),
                        "pointsAwarded": main.ORG_QUEST_BASE_POINTS,
                        "qrToken": "seed-token",
                        "createdAt": event_date + timedelta(hours=1),
                    })
                completed_quests.append({"quest_id": quest_id, "org_uid": org_uid, "event_date": event_date, "attendees": attendees})

            status = "completed" if is_completed else ("full" if len(attendees) >= template["capacity"] else "upcoming")
            print(f"  Quest: {template['title']} ({org['name']}) — {status}, {len(attendees)}/{template['capacity']}")

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
        series_ref = db.collection("questSeries").document(cq["quest_id"])
        org_ref = org_ref_by_uid[cq["org_uid"]]
        review_count = 0
        rating_sum = 0
        for uid in reviews_by_quest[cq["quest_id"]]:
            rating = ratings_cycle[review_index % len(ratings_cycle)]
            body = REVIEW_BODIES[review_index % len(REVIEW_BODIES)]
            review_index += 1

            review_ref = main._review_ref(db, cq["quest_id"], uid, cq["quest_id"])
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
            series_ref.set({"reviewCount": review_count, "avgRating": rating_sum / review_count}, merge=True)
            org_snap = org_ref.get()
            org_data = org_snap.to_dict() or {}
            org_current_count = org_data.get("reviewCount", 0)
            org_current_avg = org_data.get("avgRating", 0)
            org_new_count = org_current_count + review_count
            org_new_avg = ((org_current_avg * org_current_count) + rating_sum) / org_new_count
            org_ref.set({"reviewCount": org_new_count, "avgRating": org_new_avg}, merge=True)
            print(f"  Reviews: {cq['quest_id']} — {review_count} reviews, avg {rating_sum / review_count:.1f}")


def seed_default_iron_quests():
    far_future = NOW + timedelta(days=365 * 5)
    for quest in DEFAULT_IRON_QUESTS:
        quest_id = f"seed-default-{quest['title'][:30].lower().replace(' ', '-').replace(chr(39), '')}"
        db.collection("quests").document(quest_id).set({
            "title": quest["title"],
            "description": quest["description"],
            "tags": quest["tags"],
            "location": quest["location"],
            "timezone": "America/New_York",
            "capacity": None,
            "seriesId": quest_id,
            "recurrenceFrequency": None,
            "recurrenceUntil": None,
            "eventDate": NOW,
            "eventEndTime": far_future,
            "orgId": None,
            "orgName": "Neighborhood",
            "isDefault": True,
            "tier": "iron",
            "rsvpd": [],
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        print(f"Default Iron quest ready: {quest['title']}")


def print_demo_accounts(org_uids, user_uids):
    print("\n" + "=" * 72)
    print("DEMO ACCOUNTS")
    print("=" * 72)
    print(f"\nAdmin\n  {ADMIN_EMAIL} / {DEMO_PASSWORD}")

    print("\nOrganizations")
    for org in ORGS:
        print(f"  {org['name']:<32} {org['email']:<32} / {DEMO_PASSWORD}")

    print("\nUsers (sample)")
    for u in user_uids[::5] + user_uids[-1:]:
        print(f"  {u['name']:<20} {u['email']:<40} / {DEMO_PASSWORD}  ({u['rank']})")
    print("\n" + "=" * 72)


def main_seed():
    print("Seeding admin...")
    seed_admin()

    print("\nSeeding organizations...")
    org_uids = seed_organizations()

    print("\nSeeding demo users...")
    user_uids = seed_users()

    print("\nSeeding organization quests + attendance...")
    completed_quests = seed_org_quests(org_uids, user_uids)

    print("\nSeeding reviews + Trust Scores...")
    seed_reviews(completed_quests, org_uids)

    print("\nSeeding default Iron neighborhood quests...")
    seed_default_iron_quests()

    print_demo_accounts(org_uids, user_uids)
    print("\nDone.")


if __name__ == "__main__":
    main_seed()
