import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Download, FileText, FileType2, CheckCircle, Loader2,
  ExternalLink, BarChart3, Clock, Zap
} from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function methodBadge(method) {
  const map = {
    regex_date:   { label: "Regex Date",    bg: "bg-violet-100 text-violet-700" },
    regex_money:  { label: "Regex Money",   bg: "bg-violet-100 text-violet-700" },
    regex_number: { label: "Regex Number",  bg: "bg-violet-100 text-violet-700" },
    regex_company:{ label: "Regex Company", bg: "bg-violet-100 text-violet-700" },
    regex_email:  { label: "Regex Email",   bg: "bg-violet-100 text-violet-700" },
    llm:          { label: "LLM",           bg: "bg-blue-100 text-blue-700" },
    instruction_llm: { label: "LLM Generated", bg: "bg-purple-100 text-purple-700" },
    none:         { label: "Unresolved",    bg: "bg-zinc-100 text-zinc-500" },
  };
  const match = Object.keys(map).find((k) => method?.startsWith(k));
  return match ? map[match] : { label: method || "Unknown", bg: "bg-zinc-100 text-zinc-500" };
}

function ConfidenceDot({ score }) {
  const color = score >= 0.8 ? "bg-emerald-500" : score >= 0.5 ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs font-mono">{(score * 100).toFixed(0)}%</span>
    </span>
  );
}

export default function SuccessPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(true);
  const [downloading, setDownloading] = useState({});

  useEffect(() => {
    let interval;
    const check = async () => {
      try {
        const { data: sess } = await axios.get(`${API}/sessions/${sessionId}/status`);
        setSession(sess);
        if (sess.status === "completed") {
          setPolling(false);
          clearInterval(interval);
          const { data: logData } = await axios.get(`${API}/sessions/${sessionId}/logs`);
          setLogs(logData.logs || []);
          setLoading(false);
        } else if (sess.status === "failed") {
          setPolling(false);
          clearInterval(interval);
          setLoading(false);
        }
      } catch {
        setPolling(false);
        clearInterval(interval);
        setLoading(false);
      }
    };

    check();
    interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const download = async (type) => {
    setDownloading((prev) => ({ ...prev, [type]: true }));
    try {
      const response = await axios.get(`${API}/sessions/${sessionId}/download/${type}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `generated_document.${type}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`${type.toUpperCase()} downloaded`);
    } catch {
      toast.error(`${type.toUpperCase()} not ready yet`);
    } finally {
      setDownloading((prev) => ({ ...prev, [type]: false }));
    }
  };

  if (loading || polling) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-zinc-200 p-12 text-center fade-up">
          <Loader2 className="w-10 h-10 animate-spin text-zinc-400 mx-auto mb-4" />
          <p className="text-base font-semibold text-zinc-700">Generating your document...</p>
          <p className="text-sm text-zinc-400 mt-1">Rendering DOCX and converting to PDF</p>
        </div>
      </div>
    );
  }

  if (session?.status === "failed") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center fade-up">
          <p className="text-lg font-semibold text-red-800">Generation Failed</p>
          <p className="text-sm text-red-600 mt-2 font-mono">{session.error_message}</p>
          <button onClick={() => navigate("/")} className="mt-4 text-sm underline text-red-700">
            Start over
          </button>
        </div>
      </div>
    );
  }

  const ruleCount = logs.filter((l) => l.generation_method?.startsWith("regex")).length;
  const llmCount  = logs.filter((l) => l.generation_method === "llm" || l.generation_method === "instruction_llm").length;
  const avgConf   = logs.length ? (logs.reduce((s, l) => s + (l.confidence_score || 0), 0) / logs.length * 100).toFixed(0) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 fade-up">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900" style={{ fontFamily: "Outfit" }}>
            Document Generated
          </h1>
        </div>
        <p className="text-sm text-zinc-500">
          {logs.length} placeholders filled · Template formatting preserved
        </p>
      </div>

      {/* Download buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 fade-up-1">
        <button
          data-testid="download-docx-btn"
          onClick={() => download("docx")}
          disabled={downloading.docx}
          className="flex items-center gap-3 p-5 bg-zinc-900 text-white rounded-xl hover:bg-zinc-700 transition-all disabled:opacity-70 group"
        >
          <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-white/20 transition-colors">
            <FileText className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm">Download DOCX</p>
            <p className="text-xs text-zinc-400 mt-0.5">Editable Word document</p>
          </div>
          {downloading.docx ? (
            <Loader2 className="w-4 h-4 animate-spin ml-auto" />
          ) : (
            <Download className="w-4 h-4 ml-auto opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </button>

        <button
          data-testid="download-pdf-btn"
          onClick={() => download("pdf")}
          disabled={downloading.pdf}
          className="flex items-center gap-3 p-5 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-all disabled:opacity-70 group"
        >
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
            <FileType2 className="w-5 h-5 text-red-500" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm text-zinc-800">Download PDF</p>
            <p className="text-xs text-zinc-500 mt-0.5">Print-ready PDF version</p>
          </div>
          {downloading.pdf ? (
            <Loader2 className="w-4 h-4 animate-spin ml-auto text-zinc-400" />
          ) : (
            <Download className="w-4 h-4 ml-auto opacity-40 group-hover:opacity-80 transition-opacity" />
          )}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8 fade-up-2">
        {[
          { icon: BarChart3, label: "Total Placeholders", value: logs.length, color: "text-zinc-900" },
          { icon: Zap, label: "Rule-Based", value: ruleCount, color: "text-violet-600" },
          { icon: Zap, label: "LLM Generated", value: llmCount, color: "text-blue-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-zinc-200 p-4">
            <p className={`text-2xl font-bold ${s.color}`} style={{ fontFamily: "Outfit" }}>{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Generation log table */}
      <div className="bg-white rounded-xl border border-zinc-200 fade-up-2">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-zinc-500" />
          <h2 className="text-base font-semibold text-zinc-800" style={{ fontFamily: "Outfit" }}>
            Generation Traceability Log
          </h2>
          <span className="ml-auto text-xs text-zinc-400 font-mono">{logs.length} entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="generation-log-table">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Placeholder</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Value Inserted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Method</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const mb = methodBadge(log.generation_method);
                return (
                  <tr
                    key={i}
                    data-testid={`log-row-${i}`}
                    className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-zinc-700 bg-zinc-100 px-1.5 py-0.5 rounded">
                        {log.placeholder_name}
                      </code>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs text-zinc-700 truncate" title={log.value_inserted}>
                        {log.value_inserted || <span className="text-zinc-400 italic">empty</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${mb.bg}`}>
                        {mb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ConfidenceDot score={log.confidence_score || 0} />
                    </td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-400 text-sm">
                    No log entries available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Start new session */}
      <div className="mt-6 text-center fade-up-3">
        <button
          data-testid="new-session-bottom-btn"
          onClick={() => navigate("/")}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800 underline transition-colors"
        >
          Generate another document →
        </button>
      </div>
    </div>
  );
}
