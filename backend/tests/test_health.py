from fastapi.testclient import TestClient

from studyhub.api.app import app


def test_health_pubblico_senza_token_e_senza_dati():
    """Il launcher apri_studyhub.vbs controlla /api/health senza cookie: deve rispondere 200."""
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_storage_resta_protetto():
    assert TestClient(app).get("/api/storage").status_code == 401
