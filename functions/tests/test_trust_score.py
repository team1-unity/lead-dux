import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_organization, seed_quest


def get_org(fake_firestore, org_id):
    return fake_firestore.client().collection("organizations").document(org_id).get().to_dict()


def submit(make_request, call, quest_id, uid, rating):
    call(main.submit_review, make_request(
        data={"questId": quest_id, "rating": rating, "body": "review body"}, uid=uid, role="user",
    ))


class TestOrgTrustScoreRollup:
    def test_rolls_up_across_multiple_series_for_the_same_org(self, fake_firestore, make_request, call):
        # Two standalone quests (each its own series) owned by the same org.
        seed_quest(fake_firestore, "quest-A", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-A", "user-1", status="checked_in")
        seed_quest(fake_firestore, "quest-B", orgId="org-1", rsvpd=["user-2"])
        seed_attendance(fake_firestore, "quest-B", "user-2", status="checked_in")

        submit(make_request, call, "quest-A", "user-1", 5)
        submit(make_request, call, "quest-B", "user-2", 3)

        org = get_org(fake_firestore, "org-1")
        assert org["reviewCount"] == 2
        assert org["avgRating"] == 4

        # Each series' own aggregate stays independent of the org-wide one.
        series_a = fake_firestore.client().collection("questSeries").document("quest-A").get().to_dict()
        series_b = fake_firestore.client().collection("questSeries").document("quest-B").get().to_dict()
        assert series_a == {"reviewCount": 1, "avgRating": 5}
        assert series_b == {"reviewCount": 1, "avgRating": 3}

    def test_creates_org_doc_rollup_even_if_org_doc_never_existed(self, fake_firestore, make_request, call):
        # Mirrors the questSeries doc's own "may not exist yet" case — an
        # org that somehow has quests but no profile doc still gets a
        # reviewCount/avgRating rollup rather than the write failing.
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        submit(make_request, call, "quest-1", "user-1", 4)

        assert get_org(fake_firestore, "org-1") == {"reviewCount": 1, "avgRating": 4}

    def test_does_not_affect_a_different_organization(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        seed_organization(fake_firestore, "org-2", reviewCount=5, avgRating=2.0)

        submit(make_request, call, "quest-1", "user-1", 5)

        assert get_org(fake_firestore, "org-2")["reviewCount"] == 5
        assert get_org(fake_firestore, "org-2")["avgRating"] == 2.0


class TestListOrganizationTrustTags:
    def _entry(self, result, org_id):
        return next(o for o in result["organizations"] if o["orgId"] == org_id)

    def test_new_below_min_reviews_even_with_a_perfect_average(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-A", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-A", "user-1", status="checked_in")
        seed_quest(fake_firestore, "quest-B", orgId="org-1", rsvpd=["user-2"])
        seed_attendance(fake_firestore, "quest-B", "user-2", status="checked_in")
        submit(make_request, call, "quest-A", "user-1", 5)
        submit(make_request, call, "quest-B", "user-2", 5)

        result = call(main.list_organization_trust_tags, make_request(uid="user-3", role="user"))

        assert self._entry(result, "org-1")["trustStatus"] == "new"

    def test_trustworthy_once_eligible_and_score_clears_the_bar(self, fake_firestore, make_request, call):
        # avgRating 4 (out of 5) -> Trust Score 80/100 == TRUST_SCORE_TAG_THRESHOLD.
        for i, rating in enumerate([5, 3, 4]):
            quest_id = f"quest-{i}"
            uid = f"user-{i}"
            seed_quest(fake_firestore, quest_id, orgId="org-1", rsvpd=[uid])
            seed_attendance(fake_firestore, quest_id, uid, status="checked_in")
            submit(make_request, call, quest_id, uid, rating)

        result = call(main.list_organization_trust_tags, make_request(uid="user-99", role="user"))

        assert self._entry(result, "org-1")["trustStatus"] == "trustworthy"

    def test_under_review_when_eligible_and_at_or_below_the_flag_bar(self, fake_firestore, make_request, call):
        # avgRating 3.0 -> Trust Score 60/100 == TRUST_SCORE_FLAG_THRESHOLD.
        seed_organization(fake_firestore, "org-1", reviewCount=4, avgRating=3.0)

        result = call(main.list_organization_trust_tags, make_request(uid="user-1", role="user"))

        assert self._entry(result, "org-1")["trustStatus"] == "under_review"

    def test_no_tag_in_the_unremarkable_middle(self, fake_firestore, make_request, call):
        # avgRating 3.5 -> Trust Score 70/100: enough reviews, but neither
        # clearly good (>=80) nor clearly bad (<=60) — no tag either way.
        seed_organization(fake_firestore, "org-1", reviewCount=4, avgRating=3.5)

        result = call(main.list_organization_trust_tags, make_request(uid="user-1", role="user"))

        assert self._entry(result, "org-1")["trustStatus"] is None

    def test_new_organization_with_no_reviews_yet(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1")

        result = call(main.list_organization_trust_tags, make_request(uid="user-1", role="user"))

        assert self._entry(result, "org-1")["trustStatus"] == "new"

    def test_never_exposes_the_underlying_numbers(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1", reviewCount=10, avgRating=4.9)

        result = call(main.list_organization_trust_tags, make_request(uid="user-1", role="user"))

        entry = self._entry(result, "org-1")
        assert set(entry.keys()) == {"orgId", "trustStatus"}

    def test_any_signed_in_user_can_call_it(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1")
        # No role restriction — same reasoning as list_quest_reviews:
        # prospective attendees need this to decide whether to RSVP.
        result = call(main.list_organization_trust_tags, make_request(uid="user-1", role="onboarding_user"))
        assert self._entry(result, "org-1")["trustStatus"] == "new"


class TestAdminListOrganizationsFlagging:
    def test_not_flagged_below_min_reviews_even_with_bad_average(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1", reviewCount=2, avgRating=1.0)

        result = call(main.admin_list_organizations, make_request(uid="admin-1", role="admin"))

        org = next(o for o in result["organizations"] if o["uid"] == "org-1")
        assert org["flagged"] is False

    def test_flagged_once_eligible_and_at_or_below_threshold(self, fake_firestore, make_request, call):
        # avgRating 3.0 (out of 5) rescales to trustScore 60 (out of 100),
        # exactly TRUST_SCORE_FLAG_THRESHOLD.
        seed_organization(fake_firestore, "org-1", reviewCount=3, avgRating=3.0)

        result = call(main.admin_list_organizations, make_request(uid="admin-1", role="admin"))

        org = next(o for o in result["organizations"] if o["uid"] == "org-1")
        assert org["trustScore"] == main.TRUST_SCORE_FLAG_THRESHOLD
        assert org["flagged"] is True

    def test_not_flagged_when_eligible_and_above_threshold(self, fake_firestore, make_request, call):
        # avgRating 3.5 -> trustScore 70, above the 60 flag threshold.
        seed_organization(fake_firestore, "org-1", reviewCount=5, avgRating=3.5)

        result = call(main.admin_list_organizations, make_request(uid="admin-1", role="admin"))

        org = next(o for o in result["organizations"] if o["uid"] == "org-1")
        assert org["trustScore"] == 70
        assert org["flagged"] is False

    def test_brand_new_org_with_zero_reviews_is_not_flagged(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1")

        result = call(main.admin_list_organizations, make_request(uid="admin-1", role="admin"))

        org = next(o for o in result["organizations"] if o["uid"] == "org-1")
        assert org["flagged"] is False
        assert org["reviewCount"] == 0
        assert org["avgRating"] == 0
        assert org["trustScore"] == 0

    def test_requires_admin_role(self, fake_firestore, make_request, call):
        seed_organization(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.admin_list_organizations, make_request(uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    # approve_organization itself (which seeds reviewCount:0/avgRating:0 on a
    # freshly-approved org) isn't covered here — it also calls
    # auth.set_custom_user_claims, and no fixture in this suite fakes
    # firebase_admin.auth (every other test that would exercise it has the
    # same gap; see test_attendance.py's pre-existing firestore.Increment
    # gap for a similar case). Covered by inspection instead: the change is
    # two literal keys added to an existing .set() call.
