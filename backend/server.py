from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import logging
import uuid

from datetime import datetime, timezone
from modules.llm_agent import OllamaAgent
from modules.template_parser import TemplateParser
from modules.source_analyzer import SourceAnalyzer
from modules.extraction_engine import ExtractionEngine
from modules.docx_renderer import DocxRenderer
from modules.pdf_converter import PdfConverter

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_client = AsyncIOMotorClient(mongo_url)
db = db_client[os.environ["DB_NAME"]]

UPLOAD_DIR = Path("/tmp/docugen")
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="DocuGen AI")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc).isoformat()


# ────────────────────────────── HEALTH ──────────────────────────────

@api_router.get("/health")
async def health():
    return {"status": "ok"}


# ────────────────────────────── OLLAMA ──────────────────────────────

@api_router.get("/ollama/models")
async def get_models():
    agent = OllamaAgent()
    models = await agent.list_models()
    return {"models": models}


# ────────────────────────────── SESSIONS ──────────────────────────────

@api_router.post("/sessions")
async def create_session(
    template_file: UploadFile = File(...),
    source_file: UploadFile = File(...),
    model: str = Form(...),
):
    session_id = str(uuid.uuid4())
    uploads_dir = UPLOAD_DIR / session_id / "uploads"
    outputs_dir = UPLOAD_DIR / session_id / "outputs"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(exist_ok=True)

    tmpl_ext = Path(template_file.filename).suffix.lower()
    if tmpl_ext != ".docx":
        raise HTTPException(400, "Template must be a .docx file")
    tmpl_path = uploads_dir / "template.docx"
    tmpl_path.write_bytes(await template_file.read())

    src_ext = Path(source_file.filename).suffix.lower()
    if src_ext not in [".docx", ".pdf"]:
        raise HTTPException(400, "Source document must be .docx or .pdf")
    src_path = uploads_dir / f"source{src_ext}"
    src_path.write_bytes(await source_file.read())

    doc = {
        "_id": session_id,
        "status": "created",
        "stage": None,
        "stage_progress": 0,
        "stage_message": "Ready to process",
        "template_filename": template_file.filename,
        "source_filename": source_file.filename,
        "template_path": str(tmpl_path),
        "source_path": str(src_path),
        "source_ext": src_ext,
        "selected_model": model,
        "placeholder_count": 0,
        "resolved_count": 0,
        "error_message": None,
        "created_at": now(),
        "updated_at": now(),
    }
    await db.sessions.insert_one(doc)
    return {"session_id": session_id}


@api_router.post("/sessions/{session_id}/process")
async def process_session(session_id: str, background_tasks: BackgroundTasks):
    session = await db.sessions.find_one({"_id": session_id})
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] not in ["created", "failed"]:
        raise HTTPException(400, f"Cannot process: status is {session['status']}")

    await db.sessions.update_one(
        {"_id": session_id},
        {"$set": {"status": "processing", "stage": "initializing", "stage_progress": 5, "updated_at": now()}},
    )
    background_tasks.add_task(run_pipeline, session_id)
    return {"status": "processing"}


@api_router.get("/sessions/{session_id}/status")
async def session_status(session_id: str):
    session = await db.sessions.find_one({"_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@api_router.get("/sessions/{session_id}/results")
async def session_results(session_id: str):
    results = (
        await db.extraction_results.find({"session_id": session_id}, {"_id": 0})
        .sort("order_index", 1)
        .to_list(1000)
    )
    return {"results": results}


@api_router.post("/sessions/{session_id}/finalize")
async def finalize(session_id: str, body: dict, background_tasks: BackgroundTasks):
    session = await db.sessions.find_one({"_id": session_id})
    if not session:
        raise HTTPException(404, "Session not found")

    approved = body.get("approved_values", {})
    for ph_id, value in approved.items():
        await db.extraction_results.update_one(
            {"session_id": session_id, "placeholder_id": ph_id},
            {"$set": {"final_value": value, "status": "accepted"}},
        )

    await db.sessions.update_one(
        {"_id": session_id},
        {"$set": {"status": "rendering", "stage": "rendering", "stage_progress": 95, "updated_at": now()}},
    )
    background_tasks.add_task(run_render, session_id)
    return {"status": "rendering"}


@api_router.get("/sessions/{session_id}/download/{file_type}")
async def download_file(session_id: str, file_type: str):
    if file_type not in ["docx", "pdf"]:
        raise HTTPException(400, "file_type must be docx or pdf")
    path = UPLOAD_DIR / session_id / "outputs" / f"output.{file_type}"
    if not path.exists():
        raise HTTPException(404, f"{file_type.upper()} not ready yet")
    mt = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if file_type == "docx"
        else "application/pdf"
    )
    return FileResponse(str(path), media_type=mt, filename=f"generated_document.{file_type}")


@api_router.get("/sessions/{session_id}/logs")
async def get_logs(session_id: str):
    logs = await db.generation_logs.find({"session_id": session_id}, {"_id": 0}).to_list(1000)
    return {"logs": logs}


@api_router.get("/sessions")
async def list_sessions():
    sessions = (
        await db.sessions.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    )
    return {"sessions": sessions}


# ────────────────────────────── PIPELINE ──────────────────────────────

async def set_stage(session_id: str, stage: str, progress: int, message: str = ""):
    await db.sessions.update_one(
        {"_id": session_id},
        {"$set": {"stage": stage, "stage_progress": progress, "stage_message": message, "updated_at": now()}},
    )


async def run_pipeline(session_id: str):
    try:
        session = await db.sessions.find_one({"_id": session_id})
        model = session["selected_model"]
        tmpl_path = session["template_path"]
        src_path = session["source_path"]
        src_ext = session["source_ext"]
        agent = OllamaAgent(model)

        # Stage 1: Parse template
        await set_stage(session_id, "template_parsing", 10, "Parsing template structure...")
        parser = TemplateParser()
        parsed = parser.parse(tmpl_path)
        template_maps = parsed["template_maps"]

        if not template_maps:
            await db.sessions.update_one(
                {"_id": session_id},
                {"$set": {"status": "failed", "error_message": "No placeholders found in template. Ensure your template uses [PLACEHOLDER_NAME] format.", "updated_at": now()}},
            )
            return

        for tm in template_maps:
            await db.template_maps.insert_one(dict(tm))

        # Stage 2: Semantic Placeholder Index
        await set_stage(session_id, "semantic_indexing", 22, f"Building semantic index for {len(template_maps)} placeholders...")
        semantic_map = {}
        for tm in template_maps:
            sem = await agent.generate_semantic_meaning(
                tm["placeholder_text"],
                tm.get("context_before", ""),
                tm.get("context_after", ""),
            )
            entry = {
                "_id": str(uuid.uuid4()),
                "session_id": session_id,
                "placeholder_id": tm["placeholder_id"],
                "placeholder_text": tm["placeholder_text"],
                **sem,
            }
            semantic_map[tm["placeholder_id"]] = entry
            await db.semantic_placeholder_index.insert_one(entry)

        # Stage 3: Source document analysis
        await set_stage(session_id, "source_analysis", 38, "Analyzing source document...")
        analyzer = SourceAnalyzer()
        chunks = analyzer.extract_and_chunk(src_path, src_ext)

        # Stage 4: Generate embeddings
        await set_stage(session_id, "embedding", 52, f"Generating embeddings for {len(chunks)} text chunks...")
        chunk_docs = []
        for i, chunk in enumerate(chunks):
            emb = await agent.get_embedding(chunk["text"])
            chunk_docs.append(
                {
                    "_id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "chunk_id": f"chunk_{i}",
                    "text": chunk["text"],
                    "page_number": chunk.get("page_number", 1),
                    "chunk_index": i,
                    "embedding_vector": emb or [],
                }
            )

        if chunk_docs:
            await db.source_chunks.insert_many(chunk_docs)

        session_dir = str(UPLOAD_DIR / session_id)
        analyzer.build_faiss_index(chunk_docs, session_dir)

        # Stage 5: Extract values
        await set_stage(session_id, "extracting", 68, f"Extracting values for {len(template_maps)} placeholders...")
        engine = ExtractionEngine(db, agent, session_dir)

        for order_idx, tm in enumerate(template_maps):
            sem = semantic_map.get(tm["placeholder_id"])
            result = await engine.extract_value(session_id, tm, sem)
            result["order_index"] = order_idx
            await db.extraction_results.insert_one(result)

        resolved = len(
            await db.extraction_results.find(
                {"session_id": session_id, "confidence_score": {"$gte": 0.5}}, {"_id": 1}
            ).to_list(1000)
        )

        await db.sessions.update_one(
            {"_id": session_id},
            {
                "$set": {
                    "status": "approval_pending",
                    "stage": "complete",
                    "stage_progress": 100,
                    "placeholder_count": len(template_maps),
                    "resolved_count": resolved,
                    "updated_at": now(),
                }
            },
        )

    except Exception as exc:
        logger.error(f"Pipeline error [{session_id}]: {exc}", exc_info=True)
        await db.sessions.update_one(
            {"_id": session_id},
            {"$set": {"status": "failed", "error_message": str(exc), "updated_at": now()}},
        )


async def run_render(session_id: str):
    try:
        session = await db.sessions.find_one({"_id": session_id})
        tmpl_path = session["template_path"]

        results = (
            await db.extraction_results.find({"session_id": session_id}, {"_id": 0}).to_list(1000)
        )

        replacements = {}
        for r in results:
            val = r["final_value"] if r.get("final_value") is not None else r.get("suggested_value", "")
            replacements[r["placeholder_text"]] = str(val)

        out_dir = UPLOAD_DIR / session_id / "outputs"
        out_docx = out_dir / "output.docx"

        renderer = DocxRenderer()
        renderer.render(tmpl_path, replacements, str(out_docx))

        try:
            converter = PdfConverter()
            converter.convert(str(out_docx), str(out_dir))
        except Exception as e:
            logger.warning(f"PDF conversion failed (DOCX still available): {e}")

        logs = []
        for r in results:
            val = r["final_value"] if r.get("final_value") is not None else r.get("suggested_value", "")
            logs.append(
                {
                    "_id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "placeholder_id": r.get("placeholder_id", ""),
                    "placeholder_name": r["placeholder_text"],
                    "value_inserted": str(val)[:300],
                    "source_chunk_text": r.get("source_chunk_text", "")[:200],
                    "generation_method": r.get("generation_method", "unknown"),
                    "confidence_score": r.get("confidence_score", 0),
                    "timestamp": now(),
                }
            )
        if logs:
            await db.generation_logs.insert_many(logs)

        await db.sessions.update_one(
            {"_id": session_id},
            {"$set": {"status": "completed", "stage": "completed", "stage_progress": 100, "updated_at": now()}},
        )

    except Exception as exc:
        logger.error(f"Render error [{session_id}]: {exc}", exc_info=True)
        await db.sessions.update_one(
            {"_id": session_id},
            {"$set": {"status": "failed", "error_message": f"Render error: {exc}", "updated_at": now()}},
        )


# ────────────────────────────── APP ──────────────────────────────

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    db_client.close()
