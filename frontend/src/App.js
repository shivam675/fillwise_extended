import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import {
  FileText, Settings, Zap, Download, CheckCircle2, AlertCircle,
  RefreshCw, ChevronRight, ChevronLeft, Upload, X, Cpu, FileOutput,
  Clock, Hash, List, Info
} from "lucide-react";
import "./App.css";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─── Step Indicator ─────────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = ["Configure", "Upload", "Process"];
  return (
    <div className="step-indicator" data-testid="step-indicator">
      {steps.map((label, i) => {
        const idx = i + 1;
        const isActive = idx === current;
        const isDone = idx < current;
        return (
          <React.Fragment key={idx}>
            <div className={`step-item ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
              <div className="step-circle">
                {isDone ? <CheckCircle2 size={14} /> : <span>{idx}</span>}
              </div>
              <span className="step-label">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-line ${isDone ? "done" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Ollama Status Badge ─────────────────────────────────────────────────────

function OllamaStatusBadge({ connected, checking }) {
  return (
    <div
      className={`ollama-badge ${connected ? "connected" : "disconnected"}`}
      data-testid="ollama-status-badge"
    >
      <span className={`badge-dot ${checking ? "pulsing" : ""}`} />
      <span>{checking ? "Checking..." : connected ? "Ollama Connected" : "Ollama Offline"}</span>
    </div>
  );
}

// ─── File Dropzone ───────────────────────────────────────────────────────────

function FileDropzone({ label, accept, file, onFile, icon: Icon, hint, testId }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  return (
    <div
      className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !file && inputRef.current?.click()}
      data-testid={testId}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
        data-testid={`${testId}-input`}
      />
      {file ? (
        <div className="dropzone-file">
          <Icon size={20} className="dropzone-icon-done" />
          <div className="dropzone-file-info">
            <span className="dropzone-filename">{file.name}</span>
            <span className="dropzone-filesize">{formatBytes(file.size)}</span>
          </div>
          <button
            className="dropzone-remove"
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
            data-testid={`${testId}-remove`}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="dropzone-empty">
          <div className="dropzone-icon-wrap">
            <Icon size={24} />
          </div>
          <div>
            <p className="dropzone-title">{label}</p>
            <p className="dropzone-hint">{hint}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Marker Preview ──────────────────────────────────────────────────────────

function MarkerPreview({ markers }) {
  if (!markers || markers.length === 0) return null;
  const placeholders = markers.filter(m => m.type === "placeholder");
  const rules = markers.filter(m => m.type === "rule");

  return (
    <div className="marker-preview" data-testid="marker-preview">
      <div className="marker-preview-header">
        <Hash size={15} />
        <span>{markers.length} marker{markers.length !== 1 ? "s" : ""} detected</span>
      </div>
      <div className="marker-grid">
        {placeholders.map((m, i) => (
          <div key={i} className="marker-pill placeholder-pill" data-testid={`marker-placeholder-${i}`}>
            <span className="marker-type">Placeholder</span>
            <code className="marker-code">{m.marker}</code>
          </div>
        ))}
        {rules.map((m, i) => (
          <div key={i} className="marker-pill rule-pill" data-testid={`marker-rule-${i}`}>
            <span className="marker-type">Rule</span>
            <code className="marker-code">{m.instruction?.slice(0, 60)}{m.instruction?.length > 60 ? "…" : ""}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Processing Log ───────────────────────────────────────────────────────────

function ProcessingLog({ messages }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="processing-log" data-testid="processing-log">
      {messages.map((msg, i) => (
        <div key={i} className="log-line">
          <span className="log-dot" />
          <span>{msg}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(1);

  // Step 1: Ollama config
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  // Step 2: Files
  const [sourceFile, setSourceFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [markers, setMarkers] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Step 3: Processing
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [logMessages, setLogMessages] = useState([]);
  const pollRef = useRef(null);

  // Check Ollama on URL change
  const checkOllama = useCallback(async (url) => {
    setOllamaChecking(true);
    setOllamaConnected(false);
    setModels([]);
    setSelectedModel("");
    try {
      const res = await axios.get(`${API}/check-ollama`, { params: { ollama_url: url }, timeout: 6000 });
      if (res.data.connected) {
        setOllamaConnected(true);
        fetchModels(url);
      }
    } catch {
      setOllamaConnected(false);
    }
    setOllamaChecking(false);
  }, []);

  const fetchModels = async (url) => {
    setModelsLoading(true);
    try {
      const res = await axios.get(`${API}/models`, { params: { ollama_url: url }, timeout: 10000 });
      setModels(res.data.models || []);
      if (res.data.models?.length > 0) setSelectedModel(res.data.models[0].name);
    } catch {
      setModels([]);
    }
    setModelsLoading(false);
  };

  useEffect(() => {
    checkOllama(ollamaUrl);
  }, []);

  // Analyze template when uploaded
  useEffect(() => {
    if (!templateFile) { setMarkers(null); return; }
    const analyze = async () => {
      setAnalyzing(true);
      setMarkers(null);
      try {
        const formData = new FormData();
        formData.append("template", templateFile);
        const res = await axios.post(`${API}/analyze-template`, formData);
        const allMarkers = [
          ...(res.data.placeholders || []),
          ...(res.data.rules || [])
        ];
        setMarkers(allMarkers);
      } catch {
        setMarkers([]);
      }
      setAnalyzing(false);
    };
    analyze();
  }, [templateFile]);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API}/jobs/${jobId}`);
        const job = res.data;
        setJobStatus(job);
        if (job.message) {
          setLogMessages(prev => {
            const last = prev[prev.length - 1];
            return last === job.message ? prev : [...prev, job.message];
          });
        }
        if (job.status === 'done' || job.status === 'error') {
          clearInterval(pollRef.current);
          setProcessing(false);
        }
      } catch { /* retry */ }
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleProcess = async () => {
    if (!sourceFile || !templateFile || !selectedModel) return;
    setProcessing(true);
    setJobId(null);
    setJobStatus(null);
    setLogMessages(["Starting document processing..."]);

    const formData = new FormData();
    formData.append("source", sourceFile);
    formData.append("template", templateFile);
    formData.append("ollama_url", ollamaUrl);
    formData.append("model", selectedModel);

    try {
      const res = await axios.post(`${API}/process`, formData, { timeout: 30000 });
      setJobId(res.data.job_id);
    } catch (e) {
      setProcessing(false);
      setLogMessages(prev => [...prev, `Error: ${e.response?.data?.detail || e.message}`]);
    }
  };

  const downloadFile = (fmt) => {
    window.open(`${API}/download/${jobId}/${fmt}`, "_blank");
  };

  const reset = () => {
    setStep(1);
    setSourceFile(null);
    setTemplateFile(null);
    setMarkers(null);
    setJobId(null);
    setJobStatus(null);
    setProcessing(false);
    setLogMessages([]);
  };

  const canGoToStep2 = ollamaConnected && selectedModel;
  const canGoToStep3 = sourceFile && templateFile && markers !== null;
  const isDone = jobStatus?.status === 'done';
  const isError = jobStatus?.status === 'error';

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-icon"><FileText size={20} /></div>
          <div>
            <h1 className="brand-name">DocFiller AI</h1>
            <p className="brand-sub">Intelligent Template Population</p>
          </div>
        </div>
        <OllamaStatusBadge connected={ollamaConnected} checking={ollamaChecking} />
      </header>

      <main className="app-main">
        <StepIndicator current={step} />

        {/* ─── Step 1: Configure ──────────────────────────────────────── */}
        {step === 1 && (
          <div className="step-card" data-testid="step-1">
            <div className="step-card-header">
              <Settings size={18} />
              <h2>Configure Ollama</h2>
            </div>
            <p className="step-desc">
              Connect to your local Ollama instance and select the AI model to use for document filling.
            </p>

            <div className="form-group">
              <label className="form-label">Ollama Server URL</label>
              <div className="input-row">
                <input
                  className="text-input"
                  value={ollamaUrl}
                  onChange={e => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  data-testid="ollama-url-input"
                />
                <button
                  className="btn-secondary"
                  onClick={() => checkOllama(ollamaUrl)}
                  disabled={ollamaChecking}
                  data-testid="test-connection-btn"
                >
                  <RefreshCw size={14} className={ollamaChecking ? "spinning" : ""} />
                  {ollamaChecking ? "Checking..." : "Test"}
                </button>
              </div>
            </div>

            {!ollamaConnected && !ollamaChecking && (
              <div className="info-box warning" data-testid="ollama-warning">
                <AlertCircle size={15} />
                <span>Cannot connect to Ollama. Make sure Ollama is running and the URL is correct.</span>
              </div>
            )}

            {ollamaConnected && (
              <div className="form-group">
                <label className="form-label">
                  <Cpu size={14} /> Select AI Model
                </label>
                {modelsLoading ? (
                  <div className="loading-text">Loading models...</div>
                ) : models.length === 0 ? (
                  <div className="info-box warning" data-testid="no-models-warning">
                    <Info size={15} />
                    <span>No models found. Pull a model first: <code>ollama pull llama3.2</code></span>
                  </div>
                ) : (
                  <div className="model-list" data-testid="model-list">
                    {models.map(m => (
                      <button
                        key={m.name}
                        className={`model-item ${selectedModel === m.name ? "selected" : ""}`}
                        onClick={() => setSelectedModel(m.name)}
                        data-testid={`model-${m.name}`}
                      >
                        <div className="model-info">
                          <span className="model-name">{m.name}</span>
                          <span className="model-meta">
                            {m.parameter_size && <span>{m.parameter_size}</span>}
                            {m.quantization && <span>{m.quantization}</span>}
                          </span>
                        </div>
                        {selectedModel === m.name && <CheckCircle2 size={16} className="check-icon" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="step-nav">
              <div />
              <button
                className="btn-primary"
                onClick={() => setStep(2)}
                disabled={!canGoToStep2}
                data-testid="step1-next-btn"
              >
                Next: Upload Documents <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Upload ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="step-card" data-testid="step-2">
            <div className="step-card-header">
              <Upload size={18} />
              <h2>Upload Documents</h2>
            </div>
            <p className="step-desc">
              Upload your source document (the content) and your template document (the structure with markers).
            </p>

            <div className="upload-grid">
              <div>
                <label className="form-label">Source Document</label>
                <FileDropzone
                  label="Drop source document here"
                  accept=".pdf,.doc,.docx"
                  file={sourceFile}
                  onFile={setSourceFile}
                  icon={FileText}
                  hint="PDF, DOC, or DOCX — the document with all the information"
                  testId="source-dropzone"
                />
              </div>
              <div>
                <label className="form-label">Template Document</label>
                <FileDropzone
                  label="Drop template here"
                  accept=".docx"
                  file={templateFile}
                  onFile={setTemplateFile}
                  icon={FileOutput}
                  hint="DOCX only — contains {$placeholder} and [$rule] markers"
                  testId="template-dropzone"
                />
              </div>
            </div>

            {analyzing && (
              <div className="info-box info" data-testid="analyzing-status">
                <RefreshCw size={14} className="spinning" />
                <span>Scanning template for markers...</span>
              </div>
            )}

            {templateFile && markers && !analyzing && (
              <MarkerPreview markers={markers} />
            )}

            {templateFile && markers?.length === 0 && !analyzing && (
              <div className="info-box warning" data-testid="no-markers-warning">
                <AlertCircle size={15} />
                <span>No markers found in template. Ensure you have <code>{"{$placeholder}"}</code> or <code>{"[$rule]"}</code> markers.</span>
              </div>
            )}

            <div className="step-nav">
              <button className="btn-ghost" onClick={() => setStep(1)} data-testid="step2-back-btn">
                <ChevronLeft size={16} /> Back
              </button>
              <button
                className="btn-primary"
                onClick={() => setStep(3)}
                disabled={!canGoToStep3}
                data-testid="step2-next-btn"
              >
                Next: Process <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Process & Download ─────────────────────────────── */}
        {step === 3 && (
          <div className="step-card" data-testid="step-3">
            <div className="step-card-header">
              <Zap size={18} />
              <h2>Process &amp; Download</h2>
            </div>

            {/* Summary */}
            <div className="summary-grid">
              <div className="summary-item" data-testid="summary-model">
                <Cpu size={14} />
                <span className="summary-label">Model</span>
                <span className="summary-value">{selectedModel}</span>
              </div>
              <div className="summary-item" data-testid="summary-source">
                <FileText size={14} />
                <span className="summary-label">Source</span>
                <span className="summary-value">{sourceFile?.name}</span>
              </div>
              <div className="summary-item" data-testid="summary-template">
                <FileOutput size={14} />
                <span className="summary-label">Template</span>
                <span className="summary-value">{templateFile?.name}</span>
              </div>
              <div className="summary-item" data-testid="summary-markers">
                <Hash size={14} />
                <span className="summary-label">Markers</span>
                <span className="summary-value">{markers?.length || 0} found</span>
              </div>
            </div>

            {/* Progress */}
            {jobStatus && (
              <div className="progress-section" data-testid="progress-section">
                <div className="progress-header">
                  <span className="progress-label">{jobStatus.message}</span>
                  <span className="progress-pct">{jobStatus.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${isDone ? "done" : isError ? "error" : ""}`}
                    style={{ width: `${jobStatus.progress}%` }}
                  />
                </div>
                {jobStatus.markers_found > 0 && (
                  <div className="progress-stats">
                    <span data-testid="markers-found-stat">
                      <List size={12} /> {jobStatus.markers_found} markers found
                    </span>
                    <span data-testid="markers-filled-stat">
                      <CheckCircle2 size={12} /> {jobStatus.markers_filled} filled
                    </span>
                    {jobStatus.processing_time && (
                      <span data-testid="processing-time-stat">
                        <Clock size={12} /> {jobStatus.processing_time}s
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Log */}
            {logMessages.length > 0 && <ProcessingLog messages={logMessages} />}

            {/* Error */}
            {isError && (
              <div className="info-box error" data-testid="process-error">
                <AlertCircle size={15} />
                <span>{jobStatus.error || "Processing failed. Please try again."}</span>
              </div>
            )}

            {/* Download buttons */}
            {isDone && (
              <div className="download-section" data-testid="download-section">
                <div className="download-header">
                  <CheckCircle2 size={18} className="success-icon" />
                  <span>Document filled successfully!</span>
                </div>
                <div className="download-buttons">
                  <button
                    className="btn-download"
                    onClick={() => downloadFile("docx")}
                    data-testid="download-docx-btn"
                  >
                    <Download size={16} />
                    Download DOCX
                  </button>
                  {jobStatus?.has_pdf && (
                    <button
                      className="btn-download btn-download-pdf"
                      onClick={() => downloadFile("pdf")}
                      data-testid="download-pdf-btn"
                    >
                      <Download size={16} />
                      Download PDF
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="step-nav">
              <button
                className="btn-ghost"
                onClick={() => { setStep(2); setJobId(null); setJobStatus(null); setProcessing(false); setLogMessages([]); }}
                disabled={processing}
                data-testid="step3-back-btn"
              >
                <ChevronLeft size={16} /> Back
              </button>
              <div className="step-nav-right">
                {(isDone || isError) && (
                  <button className="btn-ghost" onClick={reset} data-testid="start-over-btn">
                    Start Over
                  </button>
                )}
                {!jobId && (
                  <button
                    className="btn-primary btn-process"
                    onClick={handleProcess}
                    disabled={processing}
                    data-testid="process-btn"
                  >
                    <Zap size={16} />
                    Fill Document
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Powered by Ollama local AI &mdash; your documents stay on your machine</p>
      </footer>
    </div>
  );
}
