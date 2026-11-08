import pytest
from app import app
from triage import detect_red_flags


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_home_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"MediGuide" in response.data


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"


def test_medicines_endpoint(client):
    response = client.get("/api/medicines")
    assert response.status_code == 200
    data = response.get_json()
    assert "medicines" in data
    assert len(data["medicines"]) > 0


def test_emergency_triage():
    result = detect_red_flags("I have crushing chest pain and shortness of breath")
    assert result["triage_level"] == "emergency"
    assert len(result["signals"]) > 0


def test_caution_triage():
    result = detect_red_flags("I have a mild fever")
    assert result["triage_level"] == "caution"

