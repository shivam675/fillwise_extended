import os
import json
import re
import uuid
import logging
import tempfile
import shutil
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

import httpx
from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from docx import Document
import pdfplumber
import mammoth

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = mongo_client[os.environ['DB_NAME']]

app = FastAPI(title="Document Filling Agent")
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

STORAGE_DIR = Path(tempfile.gettempdir()) / "docfiller"
STORAGE_DIR.mkdir(exist_ok=True, parents=True)

# In-memory job cache
jobs: Dict[str, Any] = {}

# Marker regex patterns
PLACEHOLDER_PATTERN = re.compile(r'\{\$([^}]+)\}')   # {$name}
RULE_PATTERN = re.compile(r'\[\$([^\]]+)\]')           # [$rule instruction]


# ─── Text Extraction ──────────────────────────────────────────────────────────

def extract_text_from_pdf(path: str) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                pages.append(t)
    return "\n\n".join(pages)


def extract_text_from_docx(path: str) -> str:
    with open(path, "rb") as f:
        result = mammoth.extract_raw_text(f)
    return result.value


def extract_text_from_doc(path: str) -> str:
    tmp = tempfile.mkdtemp()
    try:
        subprocess.run(
            ['libreoffice', '--headless', '--convert-to', 'docx', '--outdir', tmp, path],
            timeout=30, check=True, capture_output=True
        )
        converted = Path(tmp) / f"{Path(path).stem}.docx"
        if converted.exists():
            return extract_text_from_docx(str(converted))
    except Exception as e:
        logger.warning(f"DOC conversion failed: {e}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return ""


def extract_source_text(path: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == '.pdf':
        return extract_text_from_pdf(path)
    elif ext == '.docx':
        return extract_text_from_docx(path)
    elif ext == '.doc':
        return extract_text_from_doc(path)
    raise ValueError(f"Unsupported format: {ext}")


# ─── Template Scanning ────────────────────────────────────────────────────────

def scan_text_for_markers(text: str) -> List[Dict]:
    found = []
    for m in PLACEHOLDER_PATTERN.finditer(text):
        found.append({
            "type": "placeholder",
            "marker": m.group(0),
            "name": m.group(1),
        })
    for m in RULE_PATTERN.finditer(text):
        found.append({
            "type": "rule",
            "marker": m.group(0),
            "instruction": m.group(1),
        })
    return found


def scan_docx_for_markers(path: str) -> List[Dict]:
    doc = Document(path)
    seen: set = set()
    results: List[Dict] = []

    def process_para(para):
        text = para.text
        if not text.strip():
            return
        for m in scan_text_for_markers(text):
            if m['marker'] not in seen:
                seen.add(m['marker'])
                results.append(m)

    for para in doc.paragraphs:
        process_para(para)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    process_para(para)
    for section in doc.sections:
        for hf in [section.header, section.footer]:
            if hf:
                for para in hf.paragraphs:
                    process_para(para)
    return results


# ─── Template Filling ─────────────────────────────────────────────────────────

def replace_in_para(para, replacements: Dict[str, str]):
    full = para.text
    if not any(k in full for k in replacements):
        return

    # Single-run replacements first (preserves formatting)
    for run in para.runs:
        if not run.text:
            continue
        new_text = run.text
        for marker, value in replacements.items():
            if marker in new_text:
                new_text = new_text.replace(marker, str(value))
        if new_text != run.text:
            run.text = new_text

    # If markers still span multiple runs, merge into first run
    remaining = para.text
    if any(k in remaining for k in replacements):
        new_full = remaining
        for marker, value in replacements.items():
            new_full = new_full.replace(marker, str(value))
        if para.runs:
            para.runs[0].text = new_full
            for run in para.runs[1:]:
                run.text = ""


def fill_docx_template(template_path: str, output_path: str, replacements: Dict[str, str]):
    doc = Document(template_path)
    for para in doc.paragraphs:
        replace_in_para(para, replacements)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    replace_in_para(para, replacements)
    for section in doc.sections:
        for hf in [section.header, section.footer]:
            if hf:
                for para in hf.paragraphs:
                    replace_in_para(para, replacements)
    doc.save(output_path)


def convert_docx_to_pdf(docx_path: str, pdf_path: str) -> bool:
    try:
        import sys
        if sys.platform == 'win32':
            from docx2pdf import convert
            convert(docx_path, pdf_path)
            return Path(pdf_path).exists()
        else:
            out_dir = str(Path(pdf_path).parent)
            subprocess.run(
                ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', out_dir, docx_path],
                timeout=120, capture_output=True, text=True, check=True
            )
            expected = Path(out_dir) / f"{Path(docx_path).stem}.pdf"
            if expected.exists():
                if str(expected) != pdf_path:
                    shutil.move(str(expected), pdf_path)
                return True
    except Exception as e:
        logger.error(f"PDF conversion error: {e}")
    return False


# ─── Ollama Integration ───────────────────────────────────────────────────────

async def call_ollama(ollama_url: str, model: str, messages: list) -> str:
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(
            f"{ollama_url}/api/chat",
            json={"model": model, "messages": messages, "stream": False,
                  "options": {"temperature": 0.1}}
        )
        resp.raise_for_status()
        return resp.json()['message']['content']


def extract_json_from_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split('\n')
        text = '\n'.join(l for l in lines if not l.startswith("```"))
    # Try to find JSON object
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        return json.loads(match.group(0))
    return json.loads(text)


async def fill_markers_with_ollama(
    source_text: str,
    markers: List[Dict],
    ollama_url: str,
    model: str,
    job_id: str
) -> Dict[str, str]:
    if not markers:
        return {}

    # Truncate source text to ~12000 chars (~3000 tokens) to fit context
    max_len = 12000
    truncated = source_text[:max_len]
    if len(source_text) > max_len:
        truncated += "\n\n[... document continues ...]"

    # Build marker descriptions
    markers_desc = {}
    for i, m in enumerate(markers):
        if m['type'] == 'placeholder':
            markers_desc[f"marker_{i}"] = {
                "marker": m['marker'],
                "type": "placeholder",
                "task": f"Extract the exact value for '{m['name']}' from the source document."
            }
        else:
            markers_desc[f"marker_{i}"] = {
                "marker": m['marker'],
                "type": "rule",
                "task": f"Apply this instruction: {m['instruction']}"
            }

    system = (
        "You are an intelligent document-filling agent. "
        "Analyze the source document and fill template markers exactly as instructed. "
        "For TYPE 1 ({$placeholder}): extract the exact value, return only the value. "
        "For TYPE 2 ([$rule]): apply the rule, return only the generated content. "
        "If info is missing, return 'MISSING: [reason]'. "
        "Return ONLY valid JSON, nothing else."
    )

    user_msg = (
        f"SOURCE DOCUMENT:\n---\n{truncated}\n---\n\n"
        f"Fill these markers. Return a JSON object with marker IDs as keys:\n"
        f"{json.dumps(markers_desc, indent=2)}\n\n"
        f"Return ONLY a JSON object like: {{\"marker_0\": \"value\", \"marker_1\": \"value\", ...}}"
    )

    # Batch attempt
    try:
        raw = await call_ollama(ollama_url, model, [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg}
        ])
        result = extract_json_from_response(raw)
        replacements = {}
        for i, m in enumerate(markers):
            key = f"marker_{i}"
            if key in result:
                replacements[m['marker']] = str(result[key])
        if replacements:
            return replacements
    except Exception as e:
        logger.warning(f"Batch LLM failed ({e}), falling back to individual calls")

    # Individual fallback
    replacements = {}
    for i, m in enumerate(markers):
        try:
            if m['type'] == 'placeholder':
                prompt = (
                    f"SOURCE DOCUMENT:\n---\n{truncated}\n---\n\n"
                    f"Extract the value for the placeholder '{m['name']}'. "
                    f"Return ONLY the extracted value, nothing else."
                )
            else:
                prompt = (
                    f"SOURCE DOCUMENT:\n---\n{truncated}\n---\n\n"
                    f"Apply this instruction: {m['instruction']}\n"
                    f"Return ONLY the result, nothing else."
                )
            value = await call_ollama(ollama_url, model, [
                {"role": "system", "content": "You are a document analyst. Return only the requested content, no explanation."},
                {"role": "user", "content": prompt}
            ])
            replacements[m['marker']] = value.strip()
        except Exception as e2:
            logger.error(f"Individual fill failed for {m['marker']}: {e2}")
            replacements[m['marker']] = f'[MISSING: insufficient source data for "{m["marker"]}"]'

        # Update progress
        progress = 20 + int((i + 1) / len(markers) * 70)
        if job_id in jobs:
            jobs[job_id].update({
                'progress': progress,
                'markers_filled': i + 1,
                'message': f'Filled {i+1}/{len(markers)} markers...'
            })
            await update_job(job_id)

    return replacements


# ─── Job Persistence ──────────────────────────────────────────────────────────

async def update_job(job_id: str):
    if job_id not in jobs:
        return
    data = {k: v for k, v in jobs[job_id].items()
            if k not in ('docx_path', 'pdf_path')}  # Don't store file paths in DB
    if isinstance(data.get('created_at'), datetime):
        data['created_at'] = data['created_at'].isoformat()
    await db.jobs.update_one({'job_id': job_id}, {'$set': data}, upsert=True)


# ─── Background Processing ────────────────────────────────────────────────────

async def process_job(
    job_id: str, source_path: str, source_filename: str,
    template_path: str, template_filename: str,
    ollama_url: str, model: str
):
    start = datetime.now(timezone.utc)
    try:
        jobs[job_id].update({'status': 'processing', 'message': 'Reading source document...', 'progress': 5})
        await update_job(job_id)

        source_text = extract_source_text(source_path, source_filename)
        if not source_text.strip():
            raise ValueError("Could not extract text from source document")

        jobs[job_id].update({'message': 'Scanning template for markers...', 'progress': 15})
        await update_job(job_id)

        markers = scan_docx_for_markers(template_path)
        jobs[job_id].update({
            'markers_found': len(markers),
            'message': f'Found {len(markers)} marker(s). Filling with AI...',
            'progress': 20
        })
        await update_job(job_id)

        replacements = await fill_markers_with_ollama(
            source_text, markers, ollama_url, model, job_id
        )

        jobs[job_id].update({'message': 'Writing filled document...', 'progress': 92})
        await update_job(job_id)

        job_dir = STORAGE_DIR / job_id
        job_dir.mkdir(exist_ok=True)
        docx_out = str(job_dir / "filled_document.docx")
        fill_docx_template(template_path, docx_out, replacements)

        jobs[job_id].update({'message': 'Converting to PDF...', 'progress': 95})
        await update_job(job_id)

        pdf_out = str(job_dir / "filled_document.pdf")
        pdf_ok = convert_docx_to_pdf(docx_out, pdf_out)

        elapsed = (datetime.now(timezone.utc) - start).total_seconds()
        jobs[job_id].update({
            'status': 'done',
            'progress': 100,
            'message': 'Document filled successfully!',
            'markers_filled': len(replacements),
            'processing_time': round(elapsed, 1),
            'has_pdf': pdf_ok,
            'docx_path': docx_out,
            'pdf_path': pdf_out if pdf_ok else None
        })
        await update_job(job_id)

    except Exception as e:
        logger.exception(f"Job {job_id} failed: {e}")
        jobs[job_id].update({'status': 'error', 'message': 'Processing failed', 'error': str(e), 'progress': 0})
        await update_job(job_id)
    finally:
        for p in [source_path, template_path]:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


# ─── API Routes ───────────────────────────────────────────────────────────────

@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/check-ollama")
async def check_ollama(ollama_url: str = "http://localhost:11434"):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                return {"connected": True, "model_count": len(data.get('models', [])), "url": ollama_url}
    except Exception:
        pass
    return {"connected": False, "url": ollama_url}


@api_router.get("/models")
async def list_models(ollama_url: str = "http://localhost:11434"):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [
                {
                    "name": m.get('name', ''),
                    "size": m.get('size', 0),
                    "parameter_size": m.get('details', {}).get('parameter_size', ''),
                    "family": m.get('details', {}).get('family', ''),
                    "quantization": m.get('details', {}).get('quantization_level', '')
                }
                for m in data.get('models', [])
            ]
            return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to Ollama: {str(e)}")


@api_router.post("/analyze-template")
async def analyze_template(template: UploadFile = File(...)):
    if not template.filename.lower().endswith('.docx'):
        raise HTTPException(status_code=400, detail="Template must be a .docx file")
    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
        tmp.write(await template.read())
        tmp_path = tmp.name
    try:
        markers = scan_docx_for_markers(tmp_path)
        return {
            "filename": template.filename,
            "marker_count": len(markers),
            "placeholders": [m for m in markers if m['type'] == 'placeholder'],
            "rules": [m for m in markers if m['type'] == 'rule']
        }
    finally:
        os.unlink(tmp_path)


@api_router.post("/process")
async def process_documents(
    background_tasks: BackgroundTasks,
    source: UploadFile = File(...),
    template: UploadFile = File(...),
    ollama_url: str = Form("http://localhost:11434"),
    model: str = Form(...)
):
    src_ext = Path(source.filename).suffix.lower()
    if src_ext not in ['.pdf', '.doc', '.docx']:
        raise HTTPException(status_code=400, detail="Source must be PDF, DOC, or DOCX")
    if not template.filename.lower().endswith('.docx'):
        raise HTTPException(status_code=400, detail="Template must be a .docx file")

    job_id = str(uuid.uuid4())
    source_path = str(STORAGE_DIR / f"{job_id}_source{src_ext}")
    template_path = str(STORAGE_DIR / f"{job_id}_template.docx")

    with open(source_path, 'wb') as f:
        f.write(await source.read())
    with open(template_path, 'wb') as f:
        f.write(await template.read())

    jobs[job_id] = {
        'job_id': job_id,
        'status': 'pending',
        'progress': 0,
        'message': 'Job queued...',
        'markers_found': 0,
        'markers_filled': 0,
        'source_filename': source.filename,
        'template_filename': template.filename,
        'processing_time': None,
        'error': None,
        'created_at': datetime.now(timezone.utc)
    }
    await update_job(job_id)

    background_tasks.add_task(
        process_job, job_id=job_id,
        source_path=source_path, source_filename=source.filename,
        template_path=template_path, template_filename=template.filename,
        ollama_url=ollama_url, model=model
    )
    return {"job_id": job_id, "status": "pending"}


@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    if job_id in jobs:
        job = jobs[job_id]
        data = {k: v for k, v in job.items() if k not in ('docx_path', 'pdf_path')}
        if isinstance(data.get('created_at'), datetime):
            data['created_at'] = data['created_at'].isoformat()
        job_dir = STORAGE_DIR / job_id
        data['has_docx'] = (job_dir / "filled_document.docx").exists()
        data['has_pdf'] = (job_dir / "filled_document.pdf").exists()
        return data
    job = await db.jobs.find_one({'job_id': job_id}, {'_id': 0})
    if job:
        job_dir = STORAGE_DIR / job_id
        job['has_docx'] = (job_dir / "filled_document.docx").exists()
        job['has_pdf'] = (job_dir / "filled_document.pdf").exists()
        return job
    raise HTTPException(status_code=404, detail="Job not found")


@api_router.get("/download/{job_id}/{fmt}")
async def download_file(job_id: str, fmt: str):
    if fmt not in ('docx', 'pdf'):
        raise HTTPException(status_code=400, detail="Format must be 'docx' or 'pdf'")

    # Check in-memory cache first, then MongoDB
    job = jobs.get(job_id)
    if not job:
        job = await db.jobs.find_one({'job_id': job_id}, {'_id': 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get('status') != 'done':
        raise HTTPException(status_code=400, detail="Job not completed")

    # Derive file paths from job_id (predictable pattern, survives server restart)
    job_dir = STORAGE_DIR / job_id
    if fmt == 'docx':
        fpath = str(job_dir / "filled_document.docx")
        media = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        fname = 'filled_document.docx'
    else:
        fpath = str(job_dir / "filled_document.pdf")
        media = 'application/pdf'
        fname = 'filled_document.pdf'

    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail=f"{fmt.upper()} file not available")

    return FileResponse(path=fpath, media_type=media, filename=fname,
                        headers={"Content-Disposition": f"attachment; filename={fname}"})


app.include_router(api_router)


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()
