import datetime as dt

import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_quest, seed_user


def make_org(fake_firestore, uid, name="Trail Org"):
    fake_firestore.client().collection("organizations").document(uid).set({"name": name})


def create_quest_payload(**overrides):
    payload = {
        "title": "Trail Cleanup",
        "description": "Pick up litter.",
        "tags": ["environment"],
        "eventDate": "2026-07-20T14:00",
        "eventEndTime": None,
        "timezone": "UTC",
        "location": "Riverside Park",
    }
    payload.update(overrides)
    return payload


class TestCreateQuest:
    def test_creates_quest_with_new_fields(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_quest, make_request(
            data=create_quest_payload(capacity=10, timezone="America/New_York"),
            uid="org-1", role="organization",
        ))

        quest = fake_firestore.client().collection("quests").document(result["questId"]).get().to_dict()
        assert quest["timezone"] == "America/New_York"
        assert quest["location"] == "Riverside Park"
        assert quest["capacity"] == 10
        # A standalone quest is its own series of one.
        assert quest["seriesId"] == result["questId"]
        assert quest["recurrenceFrequency"] is None

    def test_localizes_naive_datetime_to_the_given_timezone(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_quest, make_request(
            data=create_quest_payload(timezone="America/New_York"),
            uid="org-1", role="organization",
        ))

        quest = fake_firestore.client().collection("quests").document(result["questId"]).get().to_dict()
        # 2:00 PM Eastern (EDT, UTC-4 in July) is 6:00 PM UTC — not 2:00 PM
        # UTC, which is what you'd get from naively slapping a UTC label on
        # the wall-clock string instead of actually localizing it.
        assert quest["eventDate"] == dt.datetime(2026, 7, 20, 18, 0, tzinfo=dt.timezone.utc)

    def test_rejects_invalid_timezone(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_quest, make_request(
                data=create_quest_payload(timezone="Not/AZone"), uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    @pytest.mark.parametrize("bad_capacity", [0, -1, 1.5, "10", True])
    def test_rejects_invalid_capacity(self, fake_firestore, make_request, call, bad_capacity):
        make_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_quest, make_request(
                data=create_quest_payload(capacity=bad_capacity), uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


class TestCreateRecurringQuest:
    def test_weekly_occurrence_dates_are_correct(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00", frequency="weekly", until="2026-07-22T00:00"),
            uid="org-1", role="organization",
        ))

        docs = [fake_firestore.client().collection("quests").document(qid).get().to_dict() for qid in result["questIds"]]
        days = sorted(d["eventDate"].day for d in docs)
        assert days == [1, 8, 15, 22]

    def test_daily_occurrences(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00", frequency="daily", until="2026-07-05T00:00"),
            uid="org-1", role="organization",
        ))

        assert len(result["questIds"]) == 5

    def test_monthly_occurrences_clamp_short_months(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(eventDate="2027-01-31T14:00", frequency="monthly", until="2027-04-01T00:00"),
            uid="org-1", role="organization",
        ))

        docs = [fake_firestore.client().collection("quests").document(qid).get().to_dict() for qid in result["questIds"]]
        month_days = sorted((d["eventDate"].month, d["eventDate"].day) for d in docs)
        # Jan 31 -> Feb 28 (2027 isn't a leap year, so Feb 31 clamps down) -> Mar 31.
        # Apr 30 would be next but falls after the April 1 cutoff.
        assert month_days == [(1, 31), (2, 28), (3, 31)]

    def test_all_occurrences_share_one_series_id(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        result = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(frequency="weekly", until="2026-07-22T00:00"),
            uid="org-1", role="organization",
        ))

        docs = [fake_firestore.client().collection("quests").document(qid).get().to_dict() for qid in result["questIds"]]
        assert len({d["seriesId"] for d in docs}) == 1
        assert result["seriesId"] in {d["seriesId"] for d in docs}

    def test_rejects_invalid_frequency(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_recurring_quest, make_request(
                data=create_quest_payload(frequency="hourly", until="2026-07-22T00:00"),
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_until_before_first_event_date(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_recurring_quest, make_request(
                data=create_quest_payload(
                    eventDate="2026-07-20T14:00", frequency="weekly", until="2026-07-01T00:00",
                ),
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_when_exceeding_max_instances(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_recurring_quest, make_request(
                data=create_quest_payload(
                    eventDate="2026-01-01T14:00", frequency="daily", until="2026-12-31T00:00",
                ),
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_admin_creates_a_recurring_default_quest(self, fake_firestore, make_request, call):
        result = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(frequency="weekly", until="2026-07-22T00:00"),
            uid="admin-1", role="admin",
        ))

        docs = [fake_firestore.client().collection("quests").document(qid).get().to_dict() for qid in result["questIds"]]
        assert all(d["orgId"] is None and d["orgName"] == "Neighborhood" and d["isDefault"] is True for d in docs)

    def test_rejects_non_admin_non_org_caller(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_recurring_quest, make_request(
                data=create_quest_payload(frequency="weekly", until="2026-07-22T00:00"),
                uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


class TestMakeQuestRecurring:
    def test_converts_standalone_quest_and_generates_remaining_dates(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")
        created = call(main.create_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00"), uid="org-1", role="organization",
        ))

        result = call(main.make_quest_recurring, make_request(
            data={"questId": created["questId"], "frequency": "weekly", "until": "2026-07-22T00:00"},
            uid="org-1", role="organization",
        ))

        assert len(result["questIds"]) == 4
        assert created["questId"] in result["questIds"]
        docs = [fake_firestore.client().collection("quests").document(qid).get().to_dict() for qid in result["questIds"]]
        assert len({d["seriesId"] for d in docs}) == 1
        assert all(d["title"] == "Trail Cleanup" for d in docs)

    def test_rejects_quest_already_in_a_series(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")
        first = call(main.create_recurring_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00", frequency="weekly", until="2026-07-22T00:00"),
            uid="org-1", role="organization",
        ))

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.make_quest_recurring, make_request(
                data={"questId": first["questIds"][0], "frequency": "weekly", "until": "2026-08-22T00:00"},
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_non_owner(self, fake_firestore, make_request, call):
        make_org(fake_firestore, "org-1")
        created = call(main.create_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00"), uid="org-1", role="organization",
        ))

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.make_quest_recurring, make_request(
                data={"questId": created["questId"], "frequency": "weekly", "until": "2026-07-22T00:00"},
                uid="org-2", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_convert_a_default_quest(self, fake_firestore, make_request, call):
        created = call(main.create_default_quest, make_request(
            data=create_quest_payload(eventDate="2026-07-01T14:00"), uid="admin-1", role="admin",
        ))

        result = call(main.make_quest_recurring, make_request(
            data={"questId": created["questId"], "frequency": "weekly", "until": "2026-07-22T00:00"},
            uid="admin-1", role="admin",
        ))

        assert len(result["questIds"]) == 4


class TestDeleteQuest:
    def test_deletes_only_this_occurrence_leaves_series_siblings_intact(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="series-1")
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="series-1")

        call(main.delete_quest, make_request(data={"questId": "occ-1"}, uid="org-1", role="organization"))

        db = fake_firestore.client()
        assert not db.collection("quests").document("occ-1").get().exists
        assert db.collection("quests").document("occ-2").get().exists

    def test_deletes_attendance_for_that_instance_only(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="series-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "occ-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.delete_quest, make_request(data={"questId": "occ-1"}, uid="org-1", role="organization"))

        assert not main._attendance_ref(fake_firestore.client(), "occ-1", "user-1").get().exists

    def test_deleting_one_of_several_occurrences_keeps_series_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_attendance(fake_firestore, "occ-1", "user-1")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Great!"}, uid="user-1", role="user",
        ))

        # Deleting the very date the review was left on — the series
        # continues via occ-2, so the review must survive.
        call(main.delete_quest, make_request(data={"questId": "occ-1"}, uid="org-1", role="organization"))

        db = fake_firestore.client()
        assert db.collection("questSeries").document("occ-1").get().exists
        assert main._review_ref(db, "occ-1", "user-1", "occ-1").get().exists

    def test_deleting_the_last_occurrence_still_keeps_its_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1")
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Great!"}, uid="user-1", role="user",
        ))

        # Deleting a single occurrence — even the very last one left in its
        # series — never touches reviews (see _delete_quest). Only deleting
        # the whole series/organization/account does that (see
        # TestDeleteQuestSeries.test_full_series_delete_cleans_up_reviews).
        call(main.delete_quest, make_request(data={"questId": "quest-1"}, uid="org-1", role="organization"))

        db = fake_firestore.client()
        assert db.collection("questSeries").document("quest-1").get().exists
        assert main._review_ref(db, "quest-1", "user-1", "quest-1").get().exists


class TestDeleteQuestSeries:
    def test_deletes_every_instance_in_the_series(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1")
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_quest(fake_firestore, "occ-3", orgId="org-1", seriesId="occ-1")

        result = call(main.delete_quest_series, make_request(
            data={"questId": "occ-2"}, uid="org-1", role="organization",
        ))

        db = fake_firestore.client()
        assert result["deletedCount"] == 3
        assert not db.collection("quests").document("occ-1").get().exists
        assert not db.collection("quests").document("occ-2").get().exists
        assert not db.collection("quests").document("occ-3").get().exists

    def test_leaves_other_series_untouched(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1")
        seed_quest(fake_firestore, "other-1", orgId="org-1", seriesId="other-1")

        call(main.delete_quest_series, make_request(data={"questId": "occ-1"}, uid="org-1", role="organization"))

        assert fake_firestore.client().collection("quests").document("other-1").get().exists

    def test_keep_quest_id_preserves_one_occurrence_and_collapses_it(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1",
                   recurrenceFrequency="weekly", recurrenceUntil=dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc))
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1",
                   recurrenceFrequency="weekly", recurrenceUntil=dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc))
        seed_quest(fake_firestore, "occ-3", orgId="org-1", seriesId="occ-1",
                   recurrenceFrequency="weekly", recurrenceUntil=dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc))

        result = call(main.delete_quest_series, make_request(
            data={"questId": "occ-1", "keepQuestId": "occ-2"}, uid="org-1", role="organization",
        ))

        db = fake_firestore.client()
        assert result["deletedCount"] == 2
        assert result["keptQuestId"] == "occ-2"
        assert not db.collection("quests").document("occ-1").get().exists
        assert not db.collection("quests").document("occ-3").get().exists
        kept = db.collection("quests").document("occ-2").get().to_dict()
        # seriesId is deliberately left as the original "occ-1" rather than
        # reset to "occ-2" — that's what keeps any reviews already left on
        # this series attached to the survivor (see submit_review).
        assert kept["seriesId"] == "occ-1"
        assert kept["recurrenceFrequency"] is None
        assert kept["recurrenceUntil"] is None

    def test_keep_quest_id_preserves_series_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_attendance(fake_firestore, "occ-1", "user-1")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Great!"}, uid="user-1", role="user",
        ))

        call(main.delete_quest_series, make_request(
            data={"questId": "occ-1", "keepQuestId": "occ-2"}, uid="org-1", role="organization",
        ))

        db = fake_firestore.client()
        assert db.collection("questSeries").document("occ-1").get().exists
        assert main._review_ref(db, "occ-1", "user-1", "occ-1").get().exists
        # The review was left on occ-1 specifically, so looking it up via
        # occ-2 (a different, un-reviewed date) correctly comes back empty
        # — get_my_review is scoped per occurrence, not per series.
        result = call(main.get_my_review, make_request(data={"questId": "occ-2"}, uid="user-1", role="user"))
        assert result["review"] is None

    def test_full_series_delete_cleans_up_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_attendance(fake_firestore, "occ-1", "user-1")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Great!"}, uid="user-1", role="user",
        ))

        call(main.delete_quest_series, make_request(data={"questId": "occ-1"}, uid="org-1", role="organization"))

        db = fake_firestore.client()
        assert not db.collection("questSeries").document("occ-1").get().exists
        assert not main._review_ref(db, "occ-1", "user-1", "occ-1").get().exists

    def test_rejects_non_owner(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.delete_quest_series, make_request(
                data={"questId": "occ-1"}, uid="org-2", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_delete_any_series(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1")
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")

        result = call(main.delete_quest_series, make_request(
            data={"questId": "occ-1"}, uid="admin-1", role="admin",
        ))

        assert result["deletedCount"] == 2


class TestRsvpCapacity:
    def test_rejects_rsvp_when_full(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", capacity=1, rsvpd=["user-1"])

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-2", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_allows_rsvp_under_capacity(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", capacity=2, rsvpd=["user-1"])

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-2", role="user"))

        assert result["success"] is True

    def test_already_rsvpd_member_unaffected_by_full_capacity(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", capacity=1, rsvpd=["user-1"])

        # user-1 is already counted in that one filled spot — re-RSVPing
        # (e.g. a retried request) must not get rejected as "full".
        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert result["success"] is True

    def test_unlimited_capacity_never_rejects(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", capacity=None, rsvpd=["user-1", "user-2", "user-3"])

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-4", role="user"))

        assert result["success"] is True
