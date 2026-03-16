import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  FileType2,
  X,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function DropZone({ label, accept, file, setFile, icon: Icon, hint, testId }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) setFile(f);
    },
    [setFile]
  );

  return (
    <div
      data-testid={testId}
      className={`drop-zone relative flex flex-col items-center justify-center p-8 min-h-[220px] text-center ${
        dragging ? "active" : ""
      } ${file ? "has-file" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files[0] && setFile(e.target.files[0])}
      />

      {file ? (
        <>
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-3">
            <Icon className="w-6 h-6 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-emerald-800 break-all px-2">{file.name}</p>
          <p className="text-xs text-emerald-600 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
          <button
            data-testid={`${testId}-remove`}
            onClick={(e) => { e.stopPropagation(); setFile(null); }}
            className="absolute top-3 right-3 w-6 h-6 bg-white rounded-full border border-zinc-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors"
          >
            <X className="w-3 h-3 text-zinc-500" />
          </button>
        </>
      ) : (
        <>
          <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center mb-3">
            <Icon className="w-6 h-6 text-zinc-500" />
          </div>
          <p className="text-sm font-semibold text-zinc-700">{label}</p>
          <p className="text-xs text-zinc-400 mt-1">{hint}</p>
          <p className="text-xs text-zinc-400 mt-0.5">or click to browse</p>
        </>
      )}
    </div>
  );
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [templateFile, setTemplateFile] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ollamaError, setOllamaError] = useState(false);

  const fetchModels = async () => {
    setLoadingModels(true);
    setOllamaError(false);
    try {
      const { data } = await axios.get(`${API}/ollama/models`);
      setModels(data.models || []);
      if (data.models?.length > 0) setSelectedModel(data.models[0]);
      else setOllamaError(true);
    } catch {
      setOllamaError(true);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => { fetchModels(); }, []);

  const handleSubmit = async () => {
    if (!templateFile || !sourceFile || !selectedModel) {
      toast.error("Please upload both files and select a model");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("template_file", templateFile);
      form.append("source_file", sourceFile);
      form.append("model", selectedModel);

      const { data } = await axios.post(`${API}/sessions`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Start processing immediately
      await axios.post(`${API}/sessions/${data.session_id}/process`);
      navigate(`/processing/${data.session_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed. Check file formats.");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = templateFile && sourceFile && selectedModel && !submitting;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 fade-up">
        <h1
          className="text-4xl font-semibold tracking-tight text-zinc-900"
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          Document Generation
        </h1>
        <p className="mt-2 text-base text-zinc-500">
          Upload a DOCX template and source document. The AI extracts and fills all placeholders.
        </p>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8 fade-up-1">
        {[
          { icon: "①", label: "Simple placeholders", desc: "[COMPANY_NAME], [DATE]" },
          { icon: "②", label: "Instruction blocks", desc: "[Write the intro section...]" },
          { icon: "③", label: "Semantic matching", desc: "Finds info by meaning, not just keywords" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-zinc-100 p-4 flex gap-3">
            <span className="text-lg leading-none mt-0.5">{c.icon}</span>
            <div>
              <p className="text-sm font-semibold text-zinc-800">{c.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5 font-mono">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Upload zones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 fade-up-2">
        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">
            Template Document <span className="text-red-500">*</span>
          </label>
          <DropZone
            label="Drop template DOCX here"
            accept=".docx"
            file={templateFile}
            setFile={setTemplateFile}
            icon={FileText}
            hint="DOCX with [PLACEHOLDER] tags"
            testId="template-dropzone"
          />
          <p className="text-xs text-zinc-400 mt-1.5">Format: .docx only</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">
            Source Document <span className="text-red-500">*</span>
          </label>
          <DropZone
            label="Drop source document here"
            accept=".docx,.pdf"
            file={sourceFile}
            setFile={setSourceFile}
            icon={FileType2}
            hint="DOCX or PDF with data to extract"
            testId="source-dropzone"
          />
          <p className="text-xs text-zinc-400 mt-1.5">Format: .docx or .pdf</p>
        </div>
      </div>

      {/* Model selector */}
      <div className="bg-white rounded-xl border border-zinc-200 p-6 mb-6 fade-up-3">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold text-zinc-700">
            Ollama Model <span className="text-red-500">*</span>
          </label>
          <button
            data-testid="refresh-models-btn"
            onClick={fetchModels}
            disabled={loadingModels}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loadingModels ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {ollamaError ? (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Ollama not reachable</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Make sure Ollama is running: <code className="font-mono">ollama serve</code>
              </p>
            </div>
          </div>
        ) : (
          <Select
            value={selectedModel}
            onValueChange={setSelectedModel}
            disabled={loadingModels || models.length === 0}
          >
            <SelectTrigger data-testid="model-select" className="w-full">
              <SelectValue
                placeholder={loadingModels ? "Loading models..." : "Select a model"}
              />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m} data-testid={`model-option-${m}`}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {selectedModel && (
          <p className="text-xs text-zinc-500 mt-2">
            Selected: <span className="font-mono font-semibold text-zinc-700">{selectedModel}</span>
            &nbsp;— used for extraction, generation, and embeddings
          </p>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end fade-up-3">
        <button
          data-testid="analyze-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm transition-all ${
            canSubmit
              ? "bg-zinc-900 text-white hover:bg-zinc-700 shadow-sm hover:shadow"
              : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
          }`}
        >
          {submitting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              Analyze Documents
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
