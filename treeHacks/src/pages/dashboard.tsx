import { Link, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { loadCanvases, upsertCanvas } from "@/lib/canvasStore";

type CanvasMeta = {
  id: string;
  name: string;
  updatedAt: string;
};

const statusStyles = [
  "bg-amber-200/70 text-amber-900 border-amber-400/50",
  "bg-cyan-200/70 text-cyan-900 border-cyan-400/50",
  "bg-emerald-200/70 text-emerald-900 border-emerald-400/50",
];

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString();
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<"all" | "recent">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const navigate = useNavigate();
  const canvases = useMemo(() => {
    const list = loadCanvases();
    const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (filter === "recent") return sorted.slice(0, 3);
    return sorted;
  }, [filter]);

  const normalizeName = (value: string) => value.trim().toLowerCase();

  const handleCreate = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/canvas/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Canvas" }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || "unknown error"}`);
      }
      const data = await response.json();
      if (data?.id) {
        upsertCanvas({
          id: data.id,
          name: data.name ?? "Untitled Canvas",
          updatedAt: new Date().toISOString(),
        });
        navigate(`/canvas?id=${data.id}`);
      }
    } catch (error) {
      console.error("Error creating canvas:", error);
    }
  };

  const startEdit = (canvas: CanvasMeta) => {
    setEditingId(canvas.id);
    setNameInput(canvas.name);
    setNameError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNameInput("");
    setNameError(null);
  };

  const saveName = (canvas: CanvasMeta) => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty.");
      return;
    }
    const duplicate = canvases.some(
      (c) => c.id !== canvas.id && normalizeName(c.name) === normalizeName(trimmed)
    );
    if (duplicate) {
      setNameError("That name already exists. Please choose a unique name.");
      return;
    }
    upsertCanvas({
      id: canvas.id,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    });
    cancelEdit();
  };

  return (
    <div className="min-h-screen dash-bg">
      <div className="dash-glow" />
      <header className="dash-header">
        <div className="dash-brand">
          <div className="dash-mark">TH</div>
          <div>
            <p className="dash-kicker">TreeHacks Workspace</p>
            <h1 className="dash-title">Canvas Hub</h1>
          </div>
        </div>
        <div className="dash-actions">
          <button onClick={handleCreate} className="dash-btn dash-btn-primary">
            New Canvas
          </button>
          <button className="dash-btn dash-btn-ghost">Import</button>
        </div>
      </header>

      <section className="dash-hero">
        <div>
          <h2 className="dash-hero-title">
            Build, revisit, and share the canvases that shape your project.
          </h2>
          <p className="dash-hero-sub">
            Everything tied to your account lives here. Jump back into a
            previous canvas or start a fresh one in seconds.
          </p>
          <div className="dash-hero-cta">
            <button onClick={handleCreate} className="dash-btn dash-btn-primary">
              Create Canvas
            </button>
            <button
              onClick={() => {
                const latest = canvases[0];
                if (latest?.id) {
                  navigate(`/canvas?id=${latest.id}`);
                }
              }}
              className="dash-btn dash-btn-outline"
              disabled={canvases.length === 0}
            >
              Open Latest
            </button>
          </div>
        </div>
        <div className="dash-hero-card">
          <div className="dash-card-header">
            <p className="dash-card-kicker">Account</p>
            <span className="dash-chip">Active</span>
          </div>
          <h3 className="dash-card-title">Workspace</h3>
          <p className="dash-card-sub">{canvases.length} canvases</p>
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-section-header">
          <h3>Recent Canvases</h3>
          <div className="dash-filters">
            <button
              className={`dash-pill ${filter === "all" ? "is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              className={`dash-pill ${filter === "recent" ? "is-active" : ""}`}
              onClick={() => setFilter("recent")}
            >
              Recent
            </button>
          </div>
        </div>

        <div className="dash-grid">
          {canvases.length === 0 ? (
            <article className="dash-card">
              <div className="dash-card-top">
                <span className={`dash-status ${statusStyles[0]}`}>empty</span>
                <span className="dash-muted">no canvases yet</span>
              </div>
              <h4 className="dash-card-name">Start your first canvas</h4>
              <p className="dash-card-sub">
                Create a new canvas to see it appear here for quick access.
              </p>
              <div className="dash-card-actions">
                <button onClick={handleCreate} className="dash-btn dash-btn-outline">
                  Create Canvas
                </button>
              </div>
            </article>
          ) : (
            canvases.map((canvas, index) => (
              <article key={canvas.id} className="dash-card">
                <div className="dash-card-top">
                  <span className={`dash-status ${statusStyles[index % statusStyles.length]}`}>
                    saved
                  </span>
                  <span className="dash-muted">{formatUpdatedAt(canvas.updatedAt)}</span>
                </div>
                {editingId === canvas.id ? (
                  <div>
                    <label className="dash-card-sub">Canvas name</label>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      value={nameInput}
                      onChange={(event) => {
                        setNameInput(event.target.value);
                        setNameError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveName(canvas);
                        if (event.key === "Escape") cancelEdit();
                      }}
                    />
                    {nameError ? (
                      <p className="mt-2 text-sm text-rose-600">{nameError}</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Names must be unique across your canvases.
                      </p>
                    )}
                  </div>
                ) : (
                  <h4 className="dash-card-name">{canvas.name}</h4>
                )}
                <div className="dash-card-actions">
                  <Link to={`/canvas?id=${canvas.id}`} className="dash-btn dash-btn-outline">
                    Resume
                  </Link>
                  {editingId === canvas.id ? (
                    <>
                      <button className="dash-btn dash-btn-primary" onClick={() => saveName(canvas)}>
                        Save
                      </button>
                      <button className="dash-btn dash-btn-ghost" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="dash-btn dash-btn-ghost" onClick={() => startEdit(canvas)}>
                      Rename
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
