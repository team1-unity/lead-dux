import datetime as dt

import main


def seed_quest(fake_firestore, quest_id, **overrides):
    quest = {
        "title": "Trail Cleanup",
        "description": "Pick up litter along the river trail.",
        "tags": [],
        "eventDate": dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1),
        "eventEndTime": None,
        "orgId": "org-1",
        "orgName": "Trail Org",
        "isDefault": False,
        "rsvpd": [],
    }
    quest.update(overrides)
    fake_firestore.client().collection("quests").document(quest_id).set(quest)
    return quest


def seed_attendance(fake_firestore, quest_id, uid, **overrides):
    attendance = {
        "token": "valid-token",
        "status": "rsvpd",
        "qrExpiresAt": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1),
        "checkedInAt": None,
    }
    attendance.update(overrides)
    main._attendance_ref(fake_firestore.client(), quest_id, uid).set(attendance)
    return attendance


def seed_user(fake_firestore, uid, name, email):
    fake_firestore.client().collection("users").document(uid).set({"name": name, "email": email})
