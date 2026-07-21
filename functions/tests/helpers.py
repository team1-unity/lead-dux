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
    """Seeds a checked-in attendance record — this collection now only ever
    holds people who've actually checked in (see check_in_to_event), so
    calling this at all means "this user has attended". Tests that need a
    user who's RSVP'd but NOT yet attended should simply not call this."""
    attendance = {
        "userId": uid,
        "orgId": "org-1",
        "eventId": quest_id,
        "checkedInAt": dt.datetime.now(dt.timezone.utc),
        "pointsAwarded": 20,
        "qrToken": "valid-token",
        "createdAt": dt.datetime.now(dt.timezone.utc),
    }
    attendance.update(overrides)
    main._attendance_ref(fake_firestore.client(), quest_id, uid).set(attendance)
    return attendance


def seed_user(fake_firestore, uid, name, email, **overrides):
    user = {"name": name, "email": email}
    user.update(overrides)
    fake_firestore.client().collection("users").document(uid).set(user)


def seed_blob(fake_storage, path, **overrides):
    """Seeds a Storage blob as if a real upload already landed there —
    tests for submit_quest_photo call this instead of actually uploading
    anything, since the fake has no real bytes to store."""
    blob = fake_storage.bucket().blob(path)
    blob._exists = True
    blob.size = 1000
    blob.content_type = "image/jpeg"
    for key, value in overrides.items():
        setattr(blob, key, value)
    return blob


def seed_photo_submission(fake_firestore, quest_id, uid, **overrides):
    submission = {
        "questId": quest_id,
        "userId": uid,
        "orgId": "org-1",
        "isDefault": False,
        "questTitle": "Trail Cleanup",
        "userName": "Alex",
        "storagePath": f"photoSubmissions/{quest_id}_{uid}/1.jpg",
        "contentType": "image/jpeg",
        "status": "pending",
        "pointsAwarded": 0,
        "rejectionReason": None,
        "reviewedAt": None,
        "reviewedBy": None,
    }
    submission.update(overrides)
    main._photo_submission_ref(fake_firestore.client(), quest_id, uid).set(submission)
    return submission


def seed_org(fake_firestore, uid, **overrides):
    org = {
        "name": "Trail Org",
        "email": "org@example.com",
        "phone": "555-0100",
        "location": "Riverside",
        "reason": "We clean up trails.",
        "ltag": [],
        "etag": [],
        "verified": True,
        "ratingSum": 0,
        "ratingCount": 0,
    }
    org.update(overrides)
    fake_firestore.client().collection("organizations").document(uid).set(org)
    return org
