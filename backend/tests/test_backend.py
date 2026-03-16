"""Backend API tests for Document Filling Agent"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealth:
    """Health check endpoint"""

    def test_health_returns_ok(self):
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "ok"


class TestCheckOllama:
    """Ollama connection check endpoint"""

    def test_check_ollama_returns_connected_false(self):
        resp = requests.get(f"{BASE_URL}/api/check-ollama", params={"ollama_url": "http://localhost:11434"})
        assert resp.status_code == 200
        data = resp.json()
        assert "connected" in data
        assert data["connected"] is False

    def test_check_ollama_has_url_field(self):
        resp = requests.get(f"{BASE_URL}/api/check-ollama", params={"ollama_url": "http://localhost:11434"})
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data


class TestModels:
    """Models endpoint - should return 503 when Ollama offline"""

    def test_models_returns_503_when_offline(self):
        resp = requests.get(f"{BASE_URL}/api/models", params={"ollama_url": "http://localhost:11434"})
        assert resp.status_code == 503


class TestAnalyzeTemplate:
    """Template analysis endpoint"""

    def test_analyze_template_with_valid_docx(self):
        with open("/tmp/test_template.docx", "rb") as f:
            resp = requests.post(
                f"{BASE_URL}/api/analyze-template",
                files={"template": ("test_template.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "placeholders" in data
        assert "rules" in data
        assert "marker_count" in data

    def test_analyze_template_detects_placeholders(self):
        with open("/tmp/test_template.docx", "rb") as f:
            resp = requests.post(
                f"{BASE_URL}/api/analyze-template",
                files={"template": ("test_template.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            )
        data = resp.json()
        placeholders = data.get("placeholders", [])
        rules = data.get("rules", [])
        total = len(placeholders) + len(rules)
        assert total > 0, f"Expected markers in test template, got 0. Full response: {data}"

    def test_analyze_template_rejects_non_docx(self):
        resp = requests.post(
            f"{BASE_URL}/api/analyze-template",
            files={"template": ("test.pdf", b"fake pdf content", "application/pdf")}
        )
        assert resp.status_code == 400

    def test_analyze_template_placeholder_type(self):
        """Placeholders must have type=placeholder"""
        with open("/tmp/test_template.docx", "rb") as f:
            resp = requests.post(
                f"{BASE_URL}/api/analyze-template",
                files={"template": ("test_template.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            )
        data = resp.json()
        for p in data.get("placeholders", []):
            assert p.get("type") == "placeholder"

    def test_analyze_template_rule_type(self):
        """Rules must have type=rule"""
        with open("/tmp/test_template.docx", "rb") as f:
            resp = requests.post(
                f"{BASE_URL}/api/analyze-template",
                files={"template": ("test_template.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            )
        data = resp.json()
        for r in data.get("rules", []):
            assert r.get("type") == "rule"


class TestProcessEndpoint:
    """Process endpoint - should accept files and return job_id"""

    def test_process_returns_job_id(self):
        with open("/tmp/test_source.docx", "rb") as src, open("/tmp/test_template.docx", "rb") as tpl:
            resp = requests.post(
                f"{BASE_URL}/api/process",
                files={
                    "source": ("source.docx", src, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                    "template": ("template.docx", tpl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                },
                data={"ollama_url": "http://localhost:11434", "model": "llama3.2"}
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "job_id" in data
        assert data.get("status") == "pending"

    def test_get_job_status(self):
        """Create a job then check status"""
        with open("/tmp/test_source.docx", "rb") as src, open("/tmp/test_template.docx", "rb") as tpl:
            resp = requests.post(
                f"{BASE_URL}/api/process",
                files={
                    "source": ("source.docx", src, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                    "template": ("template.docx", tpl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                },
                data={"ollama_url": "http://localhost:11434", "model": "llama3.2"}
            )
        job_id = resp.json()["job_id"]
        job_resp = requests.get(f"{BASE_URL}/api/jobs/{job_id}")
        assert job_resp.status_code == 200
        job_data = job_resp.json()
        assert "status" in job_data
        assert "progress" in job_data

    def test_get_job_not_found(self):
        resp = requests.get(f"{BASE_URL}/api/jobs/nonexistent-job-id-12345")
        assert resp.status_code == 404
