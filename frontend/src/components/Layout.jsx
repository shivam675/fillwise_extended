import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { FileText, Plus } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur-md">
        <div className="container mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-white stroke-2" />
            </div>
            <span
              className="text-base font-semibold tracking-tight text-zinc-900"
              style={{ fontFamily: "Outfit, sans-serif" }}
            >
              DocuGen AI
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {!isHome && (
              <button
                data-testid="new-session-btn"
                onClick={() => navigate("/")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Session
              </button>
            )}
            <span className="text-xs text-zinc-400 font-mono hidden sm:block">
              Powered by Ollama
            </span>
          </div>
        </div>
      </header>

      {/* Steps indicator */}
      <StepsBar location={location} />

      {/* Page content */}
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-8">
        {children}
      </main>

      <Toaster richColors position="top-right" />
    </div>
  );
}

const STEPS = [
  { label: "Upload", paths: ["/"] },
  { label: "Processing", paths: ["/processing"] },
  { label: "Review", paths: ["/approval"] },
  { label: "Download", paths: ["/success"] },
];

function StepsBar({ location }) {
  const activeIdx = STEPS.findIndex((s) =>
    s.paths.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"))
  );
  if (activeIdx < 0) return null;

  return (
    <div className="border-b border-zinc-100 bg-white">
      <div className="container mx-auto px-6 lg:px-8">
        <div className="flex items-center gap-0 py-2">
          {STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              <div className="flex items-center gap-1.5 px-1">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    i < activeIdx
                      ? "bg-emerald-500 text-white"
                      : i === activeIdx
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  {i < activeIdx ? "✓" : i + 1}
                </div>
                <span
                  className={`text-xs font-medium transition-colors ${
                    i === activeIdx ? "text-zinc-900" : i < activeIdx ? "text-emerald-600" : "text-zinc-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mx-1 transition-colors ${i < activeIdx ? "bg-emerald-300" : "bg-zinc-200"}`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
