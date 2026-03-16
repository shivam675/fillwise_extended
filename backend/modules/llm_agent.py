import httpx
import json
import logging
import os
from typing import Optional, List

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
logger = logging.getLogger(__name__)

TERM_MAP = {
    "COMPANY": ["company", "corporation", "organization", "entity", "firm"],
    "NAME": ["name", "title", "called", "designation"],
    "DATE": ["date", "day", "dated", "effective", "signed"],
    "ADDRESS": ["address", "location", "premises", "registered at"],
    "AMOUNT": ["amount", "value", "sum", "total", "price", "cost"],
    "NUMBER": ["number", "no", "count", "quantity", "ref"],
    "DURATION": ["duration", "period", "term", "months", "years", "days"],
    "PARTY": ["party", "client", "vendor", "supplier", "customer", "contractor"],
    "CONTRACT": ["contract", "agreement", "deed", "instrument"],
    "INDUSTRY": ["industry", "sector", "field", "domain", "business"],
    "STANDARD": ["standard", "norm", "specification", "requirement"],
    "PERCENT": ["percent", "percentage", "%", "rate", "proportion"],
    "EMAIL": ["email", "e-mail", "contact", "correspondence"],
}


class OllamaAgent:
    def __init__(self, model: str = None):
        self.model = model
        self.base_url = OLLAMA_URL

    async def list_models(self) -> List[str]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                return [m["name"] for m in data.get("models", [])]
        except Exception as e:
            logger.error(f"list_models failed: {e}")
            return []

    async def generate_json(self, prompt: str, system: str = None) -> dict:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }
        if system:
            payload["system"] = system
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(f"{self.base_url}/api/generate", json=payload)
                resp.raise_for_status()
                raw = resp.json().get("response", "{}")
                return json.loads(raw)
        except json.JSONDecodeError:
            logger.error("JSON decode error from LLM")
            return {"value": "", "confidence": 0.0, "source_reference": ""}
        except Exception as e:
            logger.error(f"generate_json failed: {e}")
            return {"value": "", "confidence": 0.0, "source_reference": ""}

    async def get_embedding(self, text: str) -> Optional[List[float]]:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/embed",
                    json={"model": self.model, "input": [text]},
                )
                resp.raise_for_status()
                embeddings = resp.json().get("embeddings", [])
                return embeddings[0] if embeddings else None
        except Exception as e:
            logger.warning(f"get_embedding failed (will use keyword fallback): {e}")
            return None

    async def generate_semantic_meaning(
        self, placeholder_text: str, context_before: str, context_after: str
    ) -> dict:
        inner = placeholder_text.strip("[]")
        words = inner.split()
        all_upper = all(w.replace("_", "").replace(" ", "").isupper() for w in words if w)

        if all_upper and len(inner) < 60:
            # Rule-based semantic meaning for simple ALL_CAPS placeholders
            readable = inner.replace("_", " ").lower()
            related = self._basic_related_terms(inner)
            return {
                "semantic_meaning": f"the {readable} value in the document",
                "related_terms": related,
                "search_query": f"{readable} " + " ".join(related),
            }

        # LLM-based for instruction placeholders
        prompt = (
            f"Given a template placeholder in a legal/business document:\n"
            f"Placeholder: {placeholder_text}\n"
            f'Context before: "{context_before}"\n'
            f'Context after: "{context_after}"\n\n'
            f"Return JSON with semantic meaning and related search terms:\n"
            f'{{"semantic_meaning": "...", "related_terms": ["term1", "term2", "term3"]}}'
        )
        result = await self.generate_json(prompt)
        sm = result.get("semantic_meaning", placeholder_text)
        rt = result.get("related_terms", [])
        return {
            "semantic_meaning": sm,
            "related_terms": rt,
            "search_query": f"{sm} " + " ".join(rt),
        }

    def _basic_related_terms(self, inner: str) -> List[str]:
        words = inner.upper().replace("_", " ").split()
        related = []
        for word in words:
            for key, terms in TERM_MAP.items():
                if key in word:
                    related.extend(terms[:3])
                    break
        if not related:
            related = [inner.replace("_", " ").lower()]
        return list(dict.fromkeys(related))[:5]
