import datetime as dt

import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_quest


def get_host_reflection(fake_firestore, org_id, quest_id):
    return main._host_reflection_ref(fake_firestore.client(), org_id, quest_id).get().to_dict()


class TestSubmitHostReflection:
    def test_org_can_reflect_on_a_hosted_quest(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        result = call(main.submit_host_reflection, make_request(
            data={"questId": "quest-1", "body": "Turnout was great, ran short on supplies."},
            uid="org-1", role="organization",
        ))

        assert result == {"success": True}
        reflection = get_host_reflection(fake_firestore, "org-1", "quest-1")
        assert reflection["reflectionBody"] == "Turnout was great, ran short on supplies."
        assert reflection["questId"] == "quest-1"

    def test_updating_an_existing_reflection_overwrites_the_body(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )
        call(main.submit_host_reflection, make_request(
            data={"questId": "quest-1", "body": "First draft."}, uid="org-1", role="organization",
        ))
        call(main.submit_host_reflection, make_request(
            data={"questId": "quest-1", "body": "Revised thoughts."}, uid="org-1", role="organization",
        ))

        reflection = get_host_reflection(fake_firestore, "org-1", "quest-1")
        assert reflection["reflectionBody"] == "Revised thoughts."

    def test_rejects_reflection_before_the_quest_has_happened(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_host_reflection, make_request(
                data={"questId": "quest-1", "body": "Too soon."}, uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_a_non_owning_organization(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_host_reflection, make_request(
                data={"questId": "quest-1", "body": "Not mine to reflect on."}, uid="org-2", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_reflect_on_behalf_of_the_owning_org(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        result = call(main.submit_host_reflection, make_request(
            data={"questId": "quest-1", "body": "Admin-entered reflection."}, uid="admin-1", role="admin",
        ))

        assert result == {"success": True}
        # Stored under the owning org, not the admin who made the call.
        reflection = get_host_reflection(fake_firestore, "org-1", "quest-1")
        assert reflection["reflectionBody"] == "Admin-entered reflection."

    def test_rejects_a_quest_with_no_owning_organization(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId=None,
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_host_reflection, make_request(
                data={"questId": "quest-1", "body": "No org to speak for."}, uid="admin-1", role="admin",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_a_missing_quest(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_host_reflection, make_request(
                data={"questId": "no-such-quest", "body": "Doesn't matter."}, uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.NOT_FOUND

    def test_rejects_a_body_that_is_too_long(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_host_reflection, make_request(
                data={"questId": "quest-1", "body": "x" * (main.HOST_REFLECTION_MAX_LENGTH + 1)},
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT
