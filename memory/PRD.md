# DocFiller AI — PRD

## Problem Statement
Intelligent document-filling agent web app. Users upload a SOURCE DOCUMENT (PDF/DOCX/DOC) and a TEMPLATE DOCUMENT (DOCX with markers). The app uses locally-running Ollama LLM to deeply understand the source document and fill all template markers automatically. Output: both DOCX and PDF.

**Marker Types:**
- `{$placeholder_name}` — Simple extraction: find the value from source doc
- `[$rule_instruction]` — Rule-based: apply the instruction to generate content

## User Choices
- App type: Web app (UI)
- AI: Ollama local models (user-selectable dropdown)
- Output: Both DOCX and PDF
- Source formats: PDF, DOC, DOCX
- No API key required (Ollama is local)

## Architecture

**Stack:** React + FastAPI + MongoDB

**Backend Endpoints (all prefixed /api):**
- `GET /health` — Health check
- `GET /check-ollama?ollama_url=` — Check Ollama connectivity
- `GET /models?ollama_url=` — List available Ollama models
- `POST /analyze-template` — Scan DOCX for markers, return list
- `POST /process` — Upload source + template, start background job
- `GET /jobs/{job_id}` — Poll job status
- `GET /download/{job_id}/{fmt}` — Download filled DOCX or PDF

**Key Libraries:**
- Backend: `python-docx`, `pdfplumber`, `mammoth`, `httpx`
- System: `LibreOffice 7.4` (DOCX→PDF conversion)
- Frontend: React, Lucide React, Axios, Tailwind CSS

## UI Flow (3-Step Wizard)
1. **Configure**: Enter Ollama URL, test connection, select model from dropdown
2. **Upload**: Drop source doc + template, auto-detect markers on template upload
3. **Process**: Summary → Fill Document → Progress bar + log → Download DOCX/PDF

## What's Been Implemented (March 2026)

### MVP - COMPLETE
- [x] 3-step wizard UI (Configure → Upload → Process)
- [x] Ollama connectivity check with live status badge
- [x] Dynamic model list from Ollama API
- [x] File drag-and-drop for source (PDF/DOC/DOCX) and template (DOCX)
- [x] Auto template analysis on upload — shows all markers as colored pills
- [x] Batch LLM processing (single call for all markers) with individual fallback
- [x] Marker type support: `{$placeholder}` and `[$rule]`
- [x] DOCX template filling with run-level formatting preservation
- [x] DOCX → PDF conversion via LibreOffice
- [x] Background job processing with polling (1.5s interval)
- [x] Real-time processing log with progress bar
- [x] Download DOCX + PDF
- [x] Job persistence to MongoDB (survives server restart)
- [x] Download endpoint reads from filesystem (survives server restart)

## Testing Status
- Backend: 12/12 API tests passing
- Frontend: UI verified via screenshot (Playwright browser automation crashes in environment)
- Document filling: verified correct with real DOCX files
- PDF conversion: verified working (LibreOffice)

## Prioritized Backlog

### P1 (High Priority)
- [ ] Add file cleanup/TTL for old job files in /tmp/docfiller
- [ ] Source text chunking for very large docs (>12000 chars)
- [ ] Better error messages when Ollama model is too slow / times out

### P2 (Medium Priority)
- [ ] Processing history (list of past jobs)
- [ ] Template marker highlighting (show which markers were filled vs missing)
- [ ] Support for DOC source files (LibreOffice conversion path)
- [ ] Progress streaming via SSE instead of polling

### P3 / Future
- [ ] Template library (save and reuse templates)
- [ ] Side-by-side diff view (original template vs filled)
- [ ] Batch processing (multiple source docs, same template)
- [ ] Export to Google Docs

## Known Limitations
- Ollama must be running locally (or accessible via URL)
- Large source docs (>12000 chars) are truncated before sending to LLM
- No auth — any user with URL can use the app
