import pytest
from fastapi.testclient import TestClient

from danazogi.api import app


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture
def connect(client):
    def _connect(persona: str, banks: list[str] | None = None, **extra):
        from danazogi.data.mock_open_banking import PERSONAS
        r = client.post("/api/consents", json={"persona_id": persona, "banks": banks or PERSONAS[persona]["banks"], **extra})
        assert r.status_code == 201, r.text
        body = r.json()
        return body["consent_id"], {"X-Consent-Token": body["token"]}
    return _connect
