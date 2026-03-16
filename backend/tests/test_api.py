"""Backend API tests for DocuGen AI"""
import pytest
import requests
import os
import io
from docx import Document

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


def make_simple_docx(content="Hello [NAME] from [COMPANY]"):
    doc = Document()
    doc.add_paragraph(content)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf


class TestHealth:
    def test_health_ok(self):
        r = requests.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestOllama:
    def test_models_returns_list(self):
        r = requests.get(f"{BASE_URL}/api/ollama/models")
        assert r.status_code == 200
        data = r.json()
        assert "models" in data
        assert isinstance(data["models"], list)
        # Ollama may not be running; empty list is acceptable
        print(f"Models returned: {data['models']}")


class TestSessions:
    def test_list_sessions(self):
        r = requests.get(f"{BASE_URL}/api/sessions")
        assert r.status_code == 200
        data = r.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)

    def test_create_session_returns_id(self):
        tmpl = make_simple_docx("[COMPANY_NAME] contract for [CLIENT_NAME] dated [DATE]")
        src = make_simple_docx("The company is Acme Corp. Client: John Doe. Date: Jan 1 2025.")
        files = {
            "template_file": ("template.docx", tmpl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "source_file": ("source.docx", src, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        }
        data = {"model": "test-model"}
        r = requests.post(f"{BASE_URL}/api/sessions", files=files, data=data)
        assert r.status_code == 200
        resp = r.json()
        assert "session_id" in resp
        assert isinstance(resp["session_id"], str)
        print(f"Session created: {resp['session_id']}")
        return resp["session_id"]

    def test_create_session_invalid_template(self):
        """Template must be .docx"""
        files = {
            "template_file": ("template.txt", io.BytesIO(b"some text"), "text/plain"),
            "source_file": ("source.docx", make_simple_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        }
        data = {"model": "test-model"}
        r = requests.post(f"{BASE_URL}/api/sessions", files=files, data=data)
        assert r.status_code == 400

    def test_session_status_not_found(self):
        r = requests.get(f"{BASE_URL}/api/sessions/nonexistent-id-123/status")
        assert r.status_code == 404

    def test_session_status_after_create(self):
        tmpl = make_simple_docx("[COMPANY_NAME] doc")
        src = make_simple_docx("Company is Test Inc.")
        files = {
            "template_file": ("template.docx", tmpl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "source_file": ("source.docx", src, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        }
        r = requests.post(f"{BASE_URL}/api/sessions", files=files, data={"model": "test-model"})
        session_id = r.json()["session_id"]

        sr = requests.get(f"{BASE_URL}/api/sessions/{session_id}/status")
        assert sr.status_code == 200
        status = sr.json()
        assert "status" in status
        assert status["status"] == "created"
        # _id should NOT be in response
        assert "_id" not in status
