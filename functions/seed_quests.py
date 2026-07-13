# Run this once, locally, to seed a handful of sample quests — there's no
# quest-authoring UI yet, so this is the only way any quest data exists.
# Never deployed (no @https_fn decorator).
#
# Usage:
#   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
#   python seed_quests.py

from datetime import datetime, timedelta, timezone

from firebase_admin import firestore, initialize_app

SAMPLE_QUESTS = [
    {"title": "Community Garden Cleanup", "description": "Help tend the neighborhood garden for a morning.", "tags": ["environment", "community", "outdoors"]},
    {"title": "Youth Coding Workshop", "description": "Assist teens building their first website.", "tags": ["education", "technology", "youth"]},
    {"title": "Neighborhood Mural Project", "description": "Paint a mural celebrating local history.", "tags": ["arts", "community"]},
    {"title": "Food Bank Sorting Day", "description": "Sort and pack donations at the local food bank.", "tags": ["community", "food security"]},
    {"title": "Trail Restoration Hike", "description": "Repair erosion damage on a popular hiking trail.", "tags": ["environment", "outdoors", "fitness"]},
]

if __name__ == "__main__":
    initialize_app()
    db = firestore.client()
    # Spread a week apart so RSVP/check-in testing has a mix of quests with
    # different eventDate windows, rather than all expiring at once.
    now = datetime.now(timezone.utc)
    for i, quest in enumerate(SAMPLE_QUESTS):
        db.collection("quests").add({
            **quest,
            "eventDate": now + timedelta(days=7 * (i + 1)),
            "eventEndTime": None,
            "orgId": None,
            "orgName": "Neighborhood",
            "isDefault": True,
            "rsvpd": [],
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    print(f"Seeded {len(SAMPLE_QUESTS)} quests.")
