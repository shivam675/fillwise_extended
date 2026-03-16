import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  CheckCircle, Edit3, AlertTriangle, Info, ChevronDown, ChevronUp,
  Loader2, Sparkles, Wand2
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function confidenceInfo(score, method) {
  if (method === "instruction_llm") return { label: "Generated", cls: "badge-gen", color: "text-blue-700" };
  if (score >= 0.8)  return { label: "High",   cls: "badge-high",   color: "text-emerald-700" };
  if (score >= 0.5)  return { label: "Medium", cls: "badge-medium", color: "text-amber-700" };
  return              { label: "Low",    cls: "badge-low",    color: "text-red-700" };
}

function methodLabel(method) {
  if (!method || method === "none") return "Unresolved";
  if (method.startsWith("regex")) return `Rule (${method.replace("regex_", "")})`;
  if (method === "llm") return "LLM Extraction";
  if (method === "instruction_llm") return "LLM Generation";
  return method;
}

function PlaceholderCard({ result, value, onChange, idx }) {
  const [expanded, setExpanded] = useState(false);
  const ci = confidenceInfo(result.confidence_score, result.generation_method);

  return (
    <div
      data-testid={`placeholder-card-${idx}`}
      className={`bg-white rounded-xl border transition-all ${
        result.confidence_score < 0.5 && result.generation_method !== "instruction_llm"
          ? "border-amber-200"
          : "border-zinc-200"
      } mb-3 overflow-hidden`}
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Type badge */}
          <div className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${
            result.placeholder_type === "instruction"
              ? "bg-purple-100 text-purple-700"
              : "bg-zinc-100 text-zinc-600"
          }`}>
            {result.placeholder_type === "instruction" ? "INSTR" : "SIMPLE"}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm font-mono font-semibold text-zinc-800 break-all">
                {result.placeholder_text}
              </code>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ci.cls}`}>
                {ci.label}
              </span>
              <span className="text-xs text-zinc-400">
                {methodLabel(result.generation_method)}
              </span>
            </div>

            {/* Context */}
            {(result.context_before || result.context_after) && (
              <p className="text-xs text-zinc-400 mt-1 truncate">
                ...{result.context_before} <span className="text-zinc-600 font-medium">{result.placeholder_text}</span> {result.context_after}...
              </p>
            )}
          </div>

          {/* Expand toggle */}
          <button
            data-testid={`expand-card-${idx}`}
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Value input */}
        <div className="mt-3">
          {result.placeholder_type === "instruction" ? (
            <Textarea
              data-testid={`value-input-${idx}`}
              value={value}
              onChange={(e) => onChange(result.placeholder_id, e.target.value)}
              rows={4}
              placeholder="Generated content will appear here..."
              className="text-sm font-mono resize-y"
            />
          ) : (
            <input
              data-testid={`value-input-${idx}`}
              type="text"
              value={value}
              onChange={(e) => onChange(result.placeholder_id, e.target.value)}
              placeholder="Enter value..."
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
            />
          )}
        </div>
      </div>

      {/* Expanded source context */}
      {expanded && result.source_chunk_text && (
        <div className="px-4 pb-4 border-t border-zinc-100 pt-3">
          <p className="text-xs font-semibold text-zinc-500 mb-1.5 flex items-center gap-1">
            <Info className="w-3 h-3" /> Source Evidence
          </p>
          <div className="bg-zinc-50 rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-xs text-zinc-600 font-mono whitespace-pre-wrap leading-relaxed">
              {result.source_chunk_text}
            </p>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-zinc-400">
            <span>Confidence: <strong className={ci.color}>{(result.confidence_score * 100).toFixed(0)}%</strong></span>
            <span>Method: <strong>{methodLabel(result.generation_method)}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApprovalPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState([]);
  const [approvedValues, setApprovedValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState(null);
  const [filter, setFilter] = useState("all"); // all | review | high

  useEffect(() => {
    const load = async () => {
      try {
        const [resData, sessData] = await Promise.all([
          axios.get(`${API}/sessions/${sessionId}/results`),
          axios.get(`${API}/sessions/${sessionId}/status`),
        ]);
        const r = resData.data.results || [];
        setResults(r);
        setSession(sessData.data);
        const init = {};
        r.forEach((item) => { init[item.placeholder_id] = item.suggested_value || ""; });
        setApprovedValues(init);
      } catch {
        toast.error("Failed to load extraction results");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId]);

  const handleChange = (phId, val) => {
    setApprovedValues((prev) => ({ ...prev, [phId]: val }));
  };

  const acceptAll = () => {
    const all = {};
    results.forEach((r) => { all[r.placeholder_id] = r.suggested_value || ""; });
    setApprovedValues(all);
    toast.success("All suggested values accepted");
  };

  const handleGenerate = async () => {
    setSubmitting(true);
    try {
      await axios.post(`${API}/sessions/${sessionId}/finalize`, {
        approved_values: approvedValues,
      });
      navigate(`/success/${sessionId}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Generation failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Filter results
  const filtered = results.filter((r) => {
    if (filter === "review") return r.confidence_score < 0.5 && r.generation_method !== "instruction_llm";
    if (filter === "high") return r.confidence_score >= 0.8 || r.generation_method === "instruction_llm";
    return true;
  });

  const highConf = results.filter((r) => r.confidence_score >= 0.8 || r.generation_method === "instruction_llm").length;
  const needReview = results.filter((r) => r.confidence_score < 0.5 && r.generation_method !== "instruction_llm").length;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6 fade-up">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900" style={{ fontFamily: "Outfit" }}>
          Review Extracted Values
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Verify the AI-extracted values before generating the final document.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6 fade-up-1">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 text-center">
          <p className="text-2xl font-bold text-zinc-900" style={{ fontFamily: "Outfit" }}>{results.length}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Total Placeholders</p>
        </div>
        <div className="bg-white rounded-xl border border-emerald-100 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600" style={{ fontFamily: "Outfit" }}>{highConf}</p>
          <p className="text-xs text-zinc-500 mt-0.5">High Confidence</p>
        </div>
        <div className={`bg-white rounded-xl border p-4 text-center ${needReview > 0 ? "border-amber-200" : "border-zinc-200"}`}>
          <p className={`text-2xl font-bold ${needReview > 0 ? "text-amber-600" : "text-zinc-400"}`} style={{ fontFamily: "Outfit" }}>
            {needReview}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">Need Review</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 fade-up-2">
        <div className="flex gap-1">
          {[
            { key: "all", label: "All" },
            { key: "review", label: `Review (${needReview})` },
            { key: "high", label: "High Confidence" },
          ].map((f) => (
            <button
              key={f.key}
              data-testid={`filter-${f.key}`}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === f.key
                  ? "bg-zinc-900 text-white"
                  : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          data-testid="accept-all-btn"
          onClick={acceptAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
        >
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          Accept All Suggestions
        </button>
      </div>

      {/* Placeholder cards */}
      <div className="fade-up-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">No placeholders in this filter</p>
          </div>
        ) : (
          filtered.map((result, idx) => (
            <PlaceholderCard
              key={result.placeholder_id}
              result={result}
              value={approvedValues[result.placeholder_id] ?? ""}
              onChange={handleChange}
              idx={idx}
            />
          ))
        )}
      </div>

      {/* Generate button */}
      <div className="sticky bottom-0 bg-gradient-to-t from-[#F9FAFB] to-transparent pt-4 pb-6 mt-4 fade-up-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-sm font-semibold text-zinc-800">Ready to generate?</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {results.length} values will be inserted into the template
            </p>
          </div>
          <button
            data-testid="generate-document-btn"
            onClick={handleGenerate}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
            ) : (
              <><Wand2 className="w-4 h-4" /> Generate Document</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
