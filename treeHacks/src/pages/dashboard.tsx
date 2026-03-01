import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { loadCanvases, removeCanvas, upsertCanvas } from "@/lib/canvasStore";
import { fetchProfile, getApiBaseUrl, getLoginUrl, getLogoutUrl, logoutSession } from "@/lib/auth";

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
  const [userName, setUserName] = useState<string | null>(null);
  const [allCanvases, setAllCanvases] = useState<CanvasMeta[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "recent">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createNameInput, setCreateNameInput] = useState("");
  const [createNameError, setCreateNameError] = useState<string | null>(null);
  const navigate = useNavigate();
  const apiBase = getApiBaseUrl();

  const sortCanvasesByUpdatedAt = (list: CanvasMeta[]) => {
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };

  const mergeServerCanvasesWithLocalMeta = (serverCanvases: Array<{ id: string; name: string }>) => {
    const localById = new Map(loadCanvases().map((canvas) => [canvas.id, canvas]));
    const now = new Date().toISOString();

    return serverCanvases.map((canvas) => {
      const local = localById.get(canvas.id);
      return {
        id: canvas.id,
        name: canvas.name,
        updatedAt: local?.updatedAt ?? now,
      };
    });
  };

  const loadUserCanvases = async () => {
    const response = await fetch(`${apiBase}/canvas/`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: failed to load canvases`);
    }

    const data = (await response.json()) as Array<{ id: string; name: string }>;
    const merged = sortCanvasesByUpdatedAt(mergeServerCanvasesWithLocalMeta(data));

    merged.forEach((canvas) => upsertCanvas(canvas));
    setAllCanvases(merged);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const profile = await fetchProfile();
      if (!isMounted) return;

      const user = profile?.user;
      setUserName(user?.name ?? user?.nickname ?? user?.email ?? null);

      if (user) {
        try {
          await loadUserCanvases();
        } catch (error) {
          console.error("Error loading user canvases:", error);
          setAllCanvases([]);
        }
        return;
      }

      setAllCanvases([]);
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const canvases = useMemo(() => {
    if (filter === "recent") return allCanvases.slice(0, 3);
    return allCanvases;
  }, [allCanvases, filter]);

  const normalizeName = (value: string) => value.trim().toLowerCase();

  const handleLogIn = () => {
    window.location.href = getLoginUrl("/dashboard");
  };

  const handleSignUp = () => {
    window.location.href = getLoginUrl("/dashboard", true);
  };

  const handleSignOut = async () => {
    setUserName(null);
    setAllCanvases([]);
    try {
      await logoutSession();
    } catch (error) {
      console.error("Error signing out:", error);
      window.location.assign(getLogoutUrl("/dashboard"));
      return;
    }

    navigate("/dashboard", { replace: true });
  };

  const handleCreate = async (canvasName: string) => {
    setCreateError(null);
    setIsCreating(true);

    try {
      const profile = await fetchProfile();
      if (!profile?.user) {
        window.location.href = getLoginUrl("/dashboard");
        return;
      }

      const response = await fetch(`${apiBase}/canvas/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: canvasName }),
      });

      if (response.status === 401 || response.status === 403) {
        window.location.href = getLoginUrl("/dashboard");
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}: failed to create canvas`);
      }

      const data = await response.json();
      if (data?.id) {
        const newCanvas: CanvasMeta = {
          id: data.id,
          name: data.name ?? canvasName,
          updatedAt: new Date().toISOString(),
        };
        upsertCanvas(newCanvas);
        setAllCanvases((prev) => sortCanvasesByUpdatedAt([newCanvas, ...prev.filter((canvas) => canvas.id !== newCanvas.id)]));
        navigate(`/canvas?id=${data.id}`);
        return;
      }

      setCreateError("Canvas creation returned an unexpected response.");
    } catch (error) {
      console.error("Error creating canvas:", error);
      setCreateError("Could not create canvas. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const openCreateModal = () => {
    setCreateNameInput("");
    setCreateNameError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isCreating) return;
    setIsCreateModalOpen(false);
    setCreateNameError(null);
  };

  const submitCreateCanvas = async () => {
    const trimmed = createNameInput.trim();
    const finalName = trimmed || "Untitled Canvas";

    const duplicate = canvases.some((canvas) => normalizeName(canvas.name) === normalizeName(finalName));
    if (duplicate) {
      setCreateNameError("That name already exists. Please choose a unique name.");
      return;
    }

    await handleCreate(finalName);
    setIsCreateModalOpen(false);
    setCreateNameInput("");
    setCreateNameError(null);
  };

  const startEdit = (canvas: CanvasMeta) => {
    setEditingId(canvas.id);
    setNameInput(canvas.name);
    setNameError(null);
    setOpenActionsId(null);
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
    setAllCanvases((prev) =>
      sortCanvasesByUpdatedAt(
        prev.map((existingCanvas) =>
          existingCanvas.id === canvas.id
            ? {
                ...existingCanvas,
                name: trimmed,
                updatedAt: new Date().toISOString(),
              }
            : existingCanvas
        )
      )
    );
    cancelEdit();
  };

  const handleDelete = async (canvas: CanvasMeta) => {
    setOpenActionsId(null);
    const shouldDelete = window.confirm(`Delete "${canvas.name}"?`);
    if (!shouldDelete) return;

    try {
      const response = await fetch(`${apiBase}/canvas/${canvas.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        window.location.href = getLoginUrl("/dashboard");
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: failed to delete canvas`);
      }

      removeCanvas(canvas.id);
      setAllCanvases((prev) => prev.filter((existingCanvas) => existingCanvas.id !== canvas.id));

      if (editingId === canvas.id) {
        cancelEdit();
      }
    } catch (error) {
      console.error("Error deleting canvas:", error);
      setCreateError("Could not delete canvas. Please try again.");
    }
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
          {userName ? (
            <>
              <button onClick={handleSignOut} className="dash-btn dash-btn-ghost">
                Sign out
              </button>
            </>
          ) : (
            <>
              <button onClick={handleLogIn} className="dash-btn dash-btn-ghost">
                Log in
              </button>
              <button onClick={handleSignUp} className="dash-btn dash-btn-outline">
                Sign up
              </button>
            </>
          )}
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
            <button onClick={openCreateModal} className="dash-btn dash-btn-primary" disabled={isCreating}>
              Create Canvas
            </button>
          </div>
        </div>
        <div className="dash-hero-card">
          {userName ? (
            <>
              <h3 className="dash-card-title">{`${userName}'s Workspace`}</h3>
              <p className="dash-card-sub">{canvases.length} canvases</p>
            </>
          ) : (
            <>
              <h3 className="dash-card-title">Welcome</h3>
              <p className="dash-card-sub">Sign in to view your canvases</p>
            </>
          )}
        </div>
      </section>

      {createError && (
        <div className="px-6 pb-4 text-sm text-rose-600">{createError}</div>
      )}

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
                <button onClick={openCreateModal} className="dash-btn dash-btn-outline" disabled={isCreating}>
                  Create Canvas
                </button>
              </div>
            </article>
          ) : (
            canvases.map((canvas, index) => (
              <article
                key={canvas.id}
                className={`dash-card ${editingId === canvas.id ? "" : "dash-card-clickable"}`}
                role={editingId === canvas.id ? undefined : "button"}
                tabIndex={editingId === canvas.id ? undefined : 0}
                onClick={() => {
                  if (editingId === canvas.id) return;
                  navigate(`/canvas?id=${canvas.id}`);
                }}
                onKeyDown={(event) => {
                  if (editingId === canvas.id) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/canvas?id=${canvas.id}`);
                  }
                }}
              >
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
                <div className="dash-card-actions" onClick={(event) => event.stopPropagation()}>
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
                    <div className="dash-dropdown">
                      <button
                        className="dash-btn dash-btn-ghost dash-btn-dropdown"
                        onClick={() => {
                          setOpenActionsId((prev) => (prev === canvas.id ? null : canvas.id));
                        }}
                        aria-expanded={openActionsId === canvas.id}
                        aria-haspopup="menu"
                      >
                        Actions
                      </button>
                      {openActionsId === canvas.id ? (
                        <div className="dash-dropdown-menu" role="menu">
                          <button className="dash-dropdown-item" role="menuitem" onClick={() => startEdit(canvas)}>
                            Rename
                          </button>
                          <button className="dash-dropdown-item is-danger" role="menuitem" onClick={() => void handleDelete(canvas)}>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      {isCreateModalOpen ? (
        <div className="dash-modal-backdrop" onClick={closeCreateModal}>
          <div className="dash-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="dash-modal-title">Create Canvas</h3>
            <p className="dash-modal-subtitle">Choose a name for your new canvas.</p>
            <label className="dash-modal-label" htmlFor="create-canvas-name">
              Canvas name
            </label>
            <input
              id="create-canvas-name"
              className="dash-modal-input"
              value={createNameInput}
              onChange={(event) => {
                setCreateNameInput(event.target.value);
                setCreateNameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitCreateCanvas();
                }
                if (event.key === "Escape") {
                  closeCreateModal();
                }
              }}
              placeholder="Untitled Canvas"
              autoFocus
            />
            {createNameError ? <p className="dash-modal-error">{createNameError}</p> : null}
            <div className="dash-modal-actions">
              <button className="dash-btn dash-btn-ghost" onClick={closeCreateModal} disabled={isCreating}>
                Cancel
              </button>
              <button
                className="dash-btn dash-btn-primary"
                onClick={() => void submitCreateCanvas()}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
