# Run this once, locally, to seed a handful of sample quests — there's no
# quest-authoring UI yet, so this is the only way any quest data exists.
# Never deployed (no @https_fn decorator).
#
# Usage:
#   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
#   python seed_quests.py

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
    for quest in SAMPLE_QUESTS:
        db.collection("quests").add({
            **quest,
            "orgId": None,
            "orgName": "Neighborhood",
            "isDefault": True,
            "rsvpd": [],
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    print(f"Seeded {len(SAMPLE_QUESTS)} quests.")
