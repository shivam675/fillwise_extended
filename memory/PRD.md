# DocuGen AI — Product Requirements Document

## Problem Statement
Build a full-stack web application that generates structured documents from templates using a locally hosted LLM via Ollama. Users upload DOCX templates containing placeholders and instruction blocks, plus a source document (DOCX or PDF). The system analyzes both, extracts information, and generates a final rendered document preserving all template formatting.

## Architecture

### Stack
- **Frontend**: React 19, Tailwind CSS, shadcn/ui, Lucide React, Sonner toasts
- **Backend**: FastAPI (Python), Motor (async MongoDB), FAISS (vector search)
- **Database**: MongoDB (sessions, template maps, source chunks, extraction results, generation logs)
- **Vector Store**: FAISS (on-disk per session index)
- **LLM**: Ollama (local, user-managed)
- **PDF**: LibreOffice headless
- **File Storage**: /tmp/docugen/{session_id}/

### Key Data Structures
1. **Template Map** — placeholder_id, placeholder_text, type (simple/instruction), page_number, paragraph_index, context_before, context_after
2. **Semantic Placeholder Index** — semantic_meaning, related_terms, search_query (per placeholder)
3. **Source Chunks** — text, page_number, embedding_vector (stored in MongoDB + FAISS)
4. **Extraction Results** — suggested_value, confidence_score, source_chunk_text, generation_method, final_value
5. **Generation Logs** — full traceability per placeholder

### Backend Modules
- `modules/llm_agent.py` — Ollama API client (list models, generate JSON, get embeddings, semantic meaning)
- `modules/template_parser.py` — DOCX XML parsing, placeholder detection, classification
- `modules/source_analyzer.py` — Text extraction (DOCX/PDF), chunking, FAISS index build/search
- `modules/extraction_engine.py` — Rule-based (regex) + LLM extraction, instruction generation
- `modules/docx_renderer.py` — Multi-run-aware placeholder replacement preserving formatting
- `modules/pdf_converter.py` — LibreOffice headless DOCX→PDF

### Frontend Pages
- `/` — UploadPage: drag-drop zones, Ollama model selector, submit
- `/processing/:id` — ProcessingPage: polling stage tracker with 5 stages
- `/approval/:id` — ApprovalPage: review/edit all placeholder values with confidence scores
- `/success/:id` — SuccessPage: DOCX+PDF download + generation traceability log table

## What's Implemented (as of 2026-03-16)

### Core Pipeline
- [x] Template DOCX parsing — finds `[PLACEHOLDER]` and `[Instruction text...]` patterns
- [x] Semantic Placeholder Index — rule-based for SIMPLE, LLM for INSTRUCTION types
- [x] Source document analysis — DOCX (python-docx) and PDF (PyMuPDF/PyPDF2)
- [x] Semantic chunking + FAISS embeddings
- [x] Ollama embedding via `/api/embed` endpoint
- [x] Extraction Engine: regex rules → LLM fallback (JSON format enforced)
- [x] DOCX rendering with multi-run placeholder replacement (preserves font/formatting)
- [x] PDF generation via LibreOffice headless
- [x] Generation traceability logs
- [x] Approval/review page with confidence badges, source evidence expansion
- [x] Session management (MongoDB, full lifecycle)

### Design
- [x] Swiss Utility design system (Outfit/Inter/JetBrains Mono fonts)
- [x] Light theme, 4-step progress indicator
- [x] Drag-and-drop file upload zones
- [x] Animated processing stages
- [x] data-testid on all interactive elements

## User Configuration
- Ollama must be running locally: `ollama serve`
- Default Ollama URL: http://localhost:11434
- Backend .env: OLLAMA_URL, MONGO_URL, DB_NAME, CORS_ORIGINS

## Prioritized Backlog

### P0 (Required for production use)
- [ ] Ollama tunnel support (CORS) when running in different network
- [ ] Chunked/streaming progress updates (WebSocket instead of polling)
- [ ] Template placeholder validation before processing (show preview)
- [ ] Handle very large source documents (>100 pages) with pagination

### P1 (High value)
- [ ] Multiple document generation (batch mode)
- [ ] Save/load sessions (history page already scaffolded)
- [ ] Template library (save frequently used templates)
- [ ] Per-placeholder LLM regenerate button on approval page
- [ ] Export generation config as JSON for reproducibility

### P2 (Nice to have)
- [ ] Inline DOCX preview using docx-preview.js
- [ ] Side-by-side diff view (template vs rendered)
- [ ] Multiple source documents per session
- [ ] Webhook notifications when processing completes
- [ ] Docker Compose for one-command local setup
