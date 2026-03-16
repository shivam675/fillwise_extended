import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { CheckCircle, Circle, AlertCircle, Loader2, FileText } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STAGES = [
  { key: "template_parsing",  label: "Parsing Template Structure",    desc: "Reading DOCX XML and locating placeholders" },
  { key: "semantic_indexing", label: "Building Semantic Placeholder Index", desc: "Generating semantic meanings for smart extraction" },
  { key: "source_analysis",   label: "Analyzing Source Document",     desc: "Extracting and chunking source text" },
  { key: "embedding",         label: "Generating Embeddings",         desc: "Creating vector representations for semantic search" },
  { key: "extracting",        label: "Extracting Information",        desc: "Running regex, rules, and LLM extraction" },
];

function StageIcon({ status }) {
  if (status === "done")    return <CheckCircle className="w-5 h-5 text-emerald-500" />;
  if (status === "active")  return <Loader2 className="w-5 h-5 text-zinc-900 animate-spin" />;
  if (status === "failed")  return <AlertCircle className="w-5 h-5 text-red-500" />;
  return <Circle className="w-5 h-5 text-zinc-300" />;
}

function getStageStatus(stage, currentStage, sessionStatus) {
  if (sessionStatus === "failed") return "failed";
  if (currentStage === "complete" || sessionStatus === "approval_pending") return "done";

  const keys = STAGES.map((s) => s.key);
  const stageIdx = keys.indexOf(stage);
  const currentIdx = keys.indexOf(currentStage);
  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) return "active";
  return "pending";
}

export default function ProcessingPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API}/sessions/${sessionId}/status`);
        setStatus(data);

        if (data.status === "approval_pending") {
          clearInterval(pollRef.current);
          setTimeout(() => navigate(`/approval/${sessionId}`), 800);
        } else if (data.status === "completed") {
          clearInterval(pollRef.current);
          navigate(`/success/${sessionId}`);
        } else if (data.status === "failed") {
          clearInterval(pollRef.current);
          setError(data.error_message || "Processing failed");
        }
      } catch (e) {
        setError("Unable to reach server");
        clearInterval(pollRef.current);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2500);
    return () => clearInterval(pollRef.current);
  }, [sessionId, navigate]);

  const progress = status?.stage_progress || 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 fade-up">
        <h1
          className="text-4xl font-semibold tracking-tight text-zinc-900"
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          Processing Documents
        </h1>
        <p className="mt-2 text-sm text-zinc-500 font-mono">
          Session: {sessionId?.slice(0, 8)}...
        </p>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-xl border border-zinc-200 p-6 mb-6 fade-up-1">
        {/* File info */}
        {status && (
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg mb-6">
            <FileText className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-700 truncate">{status.template_filename}</p>
              <p className="text-xs text-zinc-400 truncate">{status.source_filename}</p>
            </div>
            <span className="ml-auto text-xs font-mono text-zinc-400">{status.selected_model}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
            <span>{status?.stage_message || "Initializing..."}</span>
            <span className="font-mono font-semibold">{progress}%</span>
          </div>
          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
            <div
              data-testid="progress-bar"
              className={`h-full rounded-full transition-all duration-700 ${
                error ? "bg-red-500" : progress === 100 ? "bg-emerald-500" : "progress-shimmer"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Stage list */}
        <div className="space-y-1">
          {STAGES.map((stage) => {
            const st = status
              ? getStageStatus(stage.key, status.stage, status.status)
              : "pending";
            return (
              <div
                key={stage.key}
                data-testid={`stage-${stage.key}`}
                className={`stage-item transition-all ${st === "active" ? "opacity-100" : st === "pending" ? "opacity-50" : "opacity-100"}`}
              >
                <StageIcon status={st} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${st === "done" ? "text-zinc-900" : st === "active" ? "text-zinc-900" : "text-zinc-400"}`}>
                    {stage.label}
                  </p>
                  {st === "active" && (
                    <p className="text-xs text-zinc-500 mt-0.5">{stage.desc}</p>
                  )}
                </div>
                {st === "done" && (
                  <span className="text-xs text-emerald-600 font-medium">Done</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 fade-up">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Processing Failed</p>
              <p className="text-sm text-red-600 mt-1 font-mono break-all">{error}</p>
              <button
                data-testid="retry-btn"
                onClick={() => navigate("/")}
                className="mt-3 text-sm font-medium text-red-700 hover:text-red-900 underline"
              >
                ← Start over with new files
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success redirect note */}
      {status?.status === "approval_pending" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 fade-up text-center">
          <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
          <p className="text-sm font-semibold text-emerald-800">Analysis complete! Redirecting to review...</p>
        </div>
      )}

      {/* Stats */}
      {status?.status === "approval_pending" && (
        <div className="grid grid-cols-2 gap-4 mt-4 fade-up">
          <div className="bg-white rounded-xl border border-zinc-200 p-4 text-center">
            <p className="text-2xl font-bold text-zinc-900" style={{ fontFamily: "Outfit" }}>
              {status.placeholder_count}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Placeholders Found</p>
          </div>
          <div className="bg-white rounded-xl border border-zinc-200 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600" style={{ fontFamily: "Outfit" }}>
              {status.resolved_count}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Auto-Resolved</p>
          </div>
        </div>
      )}
    </div>
  );
}
