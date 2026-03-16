import re
import uuid
import logging
from typing import Dict, Any, Optional, List
from modules.source_analyzer import SourceAnalyzer

logger = logging.getLogger(__name__)

DATE_PATTERNS = [
    r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b",
    r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{4}\b",
    r"\b\d{4}-\d{2}-\d{2}\b",
]
MONEY_PATTERNS = [
    r"[\$£€₹]\s?\d[\d,]*(?:\.\d{2})?",
    r"\b\d[\d,]*(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR|dollars?|euros?)\b",
]
COMPANY_PATTERNS = [
    r"\b[A-Z][A-Za-z\s&\.]+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Limited|Corporation|Company|Co\.?|PLC|LLP|LP)\b",
]
NUMBER_PATTERNS = [r"\b\d[\d,]*(?:\.\d+)?\b"]
PERCENT_PATTERNS = [r"\b\d+(?:\.\d+)?%\b"]
EMAIL_PATTERNS = [r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"]

KEYWORD_RULES = {
    "DATE": DATE_PATTERNS,
    "DAY": DATE_PATTERNS,
    "MONTH": DATE_PATTERNS,
    "YEAR": DATE_PATTERNS,
    "AMOUNT": MONEY_PATTERNS + NUMBER_PATTERNS,
    "PRICE": MONEY_PATTERNS + NUMBER_PATTERNS,
    "COST": MONEY_PATTERNS + NUMBER_PATTERNS,
    "VALUE": MONEY_PATTERNS + NUMBER_PATTERNS,
    "FEE": MONEY_PATTERNS + NUMBER_PATTERNS,
    "PAYMENT": MONEY_PATTERNS + NUMBER_PATTERNS,
    "SALARY": MONEY_PATTERNS + NUMBER_PATTERNS,
    "NUMBER": NUMBER_PATTERNS,
    "NO": NUMBER_PATTERNS,
    "COUNT": NUMBER_PATTERNS,
    "QTY": NUMBER_PATTERNS,
    "QUANTITY": NUMBER_PATTERNS,
    "COMPANY": COMPANY_PATTERNS,
    "CORPORATION": COMPANY_PATTERNS,
    "ORGANIZATION": COMPANY_PATTERNS,
    "VENDOR": COMPANY_PATTERNS,
    "CLIENT": COMPANY_PATTERNS,
    "PARTY": COMPANY_PATTERNS,
    "EMPLOYER": COMPANY_PATTERNS,
    "EMPLOYEE": COMPANY_PATTERNS,
    "CONTRACTOR": COMPANY_PATTERNS,
    "SUPPLIER": COMPANY_PATTERNS,
    "PERCENT": PERCENT_PATTERNS,
    "PERCENTAGE": PERCENT_PATTERNS,
    "RATE": PERCENT_PATTERNS,
    "EMAIL": EMAIL_PATTERNS,
}


def try_rule_based(placeholder_text: str, context: str) -> Optional[Dict]:
    words = placeholder_text.strip("[]").upper().replace("_", " ").split()
    for word in words:
        patterns = KEYWORD_RULES.get(word)
        if patterns:
            for pat in patterns:
                m = re.search(pat, context)
                if m:
                    return {"value": m.group(0).strip(), "confidence": 0.75, "method": f"regex_{word.lower()}"}
    return None


class ExtractionEngine:
    def __init__(self, db, agent, session_dir: str):
        self.db = db
        self.agent = agent
        self.session_dir = session_dir
        self.analyzer = SourceAnalyzer()

    async def extract_value(
        self, session_id: str, template_map: Dict, semantic_info: Optional[Dict]
    ) -> Dict:
        ph_text = template_map["placeholder_text"]
        ph_type = template_map["placeholder_type"]
        ph_id = template_map["placeholder_id"]

        # Build search query using Semantic Placeholder Index
        search_query = (
            semantic_info.get("search_query", ph_text) if semantic_info else ph_text.strip("[]").replace("_", " ")
        )

        # Semantic search via FAISS
        chunk_ids = []
        q_emb = await self.agent.get_embedding(search_query)
        if q_emb:
            chunk_ids = self.analyzer.search_similar_chunks(self.session_dir, q_emb, top_k=5)

        # Fallback: keyword search
        if not chunk_ids:
            chunk_ids = await self._keyword_search(session_id, search_query)

        # Fetch chunk texts
        chunks = []
        if chunk_ids:
            chunks = await self.db.source_chunks.find(
                {"_id": {"$in": chunk_ids}}, {"_id": 1, "text": 1, "chunk_id": 1}
            ).to_list(10)
        else:
            chunks = await self.db.source_chunks.find(
                {"session_id": session_id}, {"_id": 1, "text": 1, "chunk_id": 1}
            ).limit(3).to_list(3)

        context = "\n\n".join(c["text"] for c in chunks[:3])
        src_chunk_id = chunks[0]["_id"] if chunks else ""

        result = {
            "_id": str(uuid.uuid4()),
            "session_id": session_id,
            "placeholder_id": ph_id,
            "placeholder_text": ph_text,
            "placeholder_type": ph_type,
            "suggested_value": "",
            "confidence_score": 0.0,
            "source_chunk_id": src_chunk_id,
            "source_chunk_text": context[:600] if context else "",
            "generation_method": "none",
            "status": "pending",
            "final_value": None,
            "context_before": template_map.get("context_before", ""),
            "context_after": template_map.get("context_after", ""),
        }

        if ph_type == "instruction":
            llm_res = await self._generate_instruction(ph_text, context, semantic_info)
            result.update(
                {
                    "suggested_value": llm_res.get("value", ""),
                    "confidence_score": float(llm_res.get("confidence", 0.8)),
                    "generation_method": "instruction_llm",
                }
            )
        else:
            rule = try_rule_based(ph_text, context)
            if rule and rule["confidence"] >= 0.7:
                result.update(
                    {
                        "suggested_value": rule["value"],
                        "confidence_score": rule["confidence"],
                        "generation_method": rule["method"],
                    }
                )
            else:
                llm_res = await self._llm_extract(ph_text, context, semantic_info)
                result.update(
                    {
                        "suggested_value": llm_res.get("value", ""),
                        "confidence_score": float(llm_res.get("confidence", 0.0)),
                        "source_chunk_id": llm_res.get("source_reference", src_chunk_id),
                        "generation_method": "llm",
                    }
                )

        return result

    async def _keyword_search(self, session_id: str, query: str, limit: int = 5) -> List[str]:
        kws = [w for w in query.lower().split()[:6] if len(w) > 3]
        if not kws:
            return []
        filters = [{"text": {"$regex": kw, "$options": "i"}} for kw in kws]
        docs = await self.db.source_chunks.find(
            {"session_id": session_id, "$or": filters}, {"_id": 1}
        ).limit(limit).to_list(limit)
        return [d["_id"] for d in docs]

    async def _llm_extract(self, ph_text: str, context: str, sem: Optional[Dict]) -> Dict:
        sm = sem.get("semantic_meaning", "") if sem else ""
        rt = ", ".join(sem.get("related_terms", [])) if sem else ""
        system = (
            "You are a precise information extraction system for document generation. "
            "Extract the exact value requested. Return ONLY valid JSON."
        )
        prompt = (
            f"Template placeholder: {ph_text}\n"
            f"Semantic meaning: {sm}\n"
            f"Look for terms like: {rt}\n\n"
            f"Source document context:\n{context}\n\n"
            f"Extract the value. Return JSON:\n"
            f'{{"value": "extracted value", "confidence": 0.0, "source_reference": "where found"}}'
        )
        return await self.agent.generate_json(prompt, system)

    async def _generate_instruction(self, instruction: str, context: str, sem: Optional[Dict]) -> Dict:
        system = (
            "You are a professional document writer specializing in legal and business documents. "
            "Generate clear, formal content. Return ONLY valid JSON."
        )
        prompt = (
            f"Instruction: {instruction}\n\n"
            f"Source document context:\n{context}\n\n"
            f"Generate the requested content in formal document language. Return JSON:\n"
            f'{{"value": "generated content", "confidence": 0.9, "source_reference": "source document"}}'
        )
        return await self.agent.generate_json(prompt, system)
