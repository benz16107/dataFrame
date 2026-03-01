import { useNavigate } from "react-router-dom";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  loadCanvasPreviews,
  loadCanvases,
  removeCanvas,
  saveCanvasBackground,
  savePendingCanvasImport,
  upsertCanvas,
  type CanvasMeta,
} from "@/lib/canvasStore";
import { fetchProfile, getApiBaseUrl, getLoginUrl, getLogoutUrl, logoutSession } from "@/lib/auth";
import { parseCanvasImportPayload, type ParsedCanvasImport } from "@/lib/canvasTransfer";

type SortOption = "lastOpened" | "lastModified" | "dateCreated";

const statusStyles = [
  "bg-amber-200/70 text-amber-900 border-amber-400/50",
  "bg-cyan-200/70 text-cyan-900 border-cyan-400/50",
  "bg-emerald-200/70 text-emerald-900 border-emerald-400/50",
];

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "lastOpened", label: "Last opened" },
  { value: "lastModified", label: "Last modified" },
  { value: "dateCreated", label: "Date created" },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("lastOpened");
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createNameInput, setCreateNameInput] = useState("");
  const [createNameError, setCreateNameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CanvasMeta | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [canvasPreviews, setCanvasPreviews] = useState<Record<string, string | null>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [isImportDragOver, setIsImportDragOver] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<ParsedCanvasImport | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const apiBase = getApiBaseUrl();

  const toTime = (value?: string) => {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const sortCanvases = (list: CanvasMeta[], criterion: SortOption) => {
    return [...list].sort((a, b) => {
      if (criterion === "lastOpened") {
        return toTime(b.lastOpenedAt) - toTime(a.lastOpenedAt);
      }

      if (criterion === "dateCreated") {
        return toTime(b.createdAt ?? b.updatedAt) - toTime(a.createdAt ?? a.updatedAt);
      }

      return toTime(b.updatedAt) - toTime(a.updatedAt);
    });
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
        createdAt: local?.createdAt ?? local?.updatedAt ?? now,
        lastOpenedAt: local?.lastOpenedAt,
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
    const merged = mergeServerCanvasesWithLocalMeta(data);

    merged.forEach((canvas) => upsertCanvas(canvas));
    setAllCanvases(merged);

    const savedPreviews = loadCanvasPreviews();
    const nextPreviews: Record<string, string | null> = {};
    merged.forEach((canvas) => {
      nextPreviews[canvas.id] = savedPreviews[canvas.id] ?? null;
    });
    setCanvasPreviews(nextPreviews);
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

  useEffect(() => {
    if (!isSortMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".dash-sort-dropdown")) return;
      setIsSortMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isSortMenuOpen]);

  const normalizeName = (value: string) => value.trim().toLowerCase();

  const canvases = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = !normalizedQuery
      ? allCanvases
      : allCanvases.filter((canvas) => canvas.name.toLowerCase().includes(normalizedQuery));
    return sortCanvases(filtered, sortBy);
  }, [allCanvases, searchQuery, sortBy]);

  const openCanvas = (canvas: CanvasMeta) => {
    const now = new Date().toISOString();
    const updated: CanvasMeta = {
      ...canvas,
      lastOpenedAt: now,
      createdAt: canvas.createdAt ?? canvas.updatedAt ?? now,
    };
    upsertCanvas(updated);
    setAllCanvases((prev) =>
      prev.map((existingCanvas) =>
        existingCanvas.id === canvas.id ? { ...existingCanvas, lastOpenedAt: now } : existingCanvas
      )
    );
    navigate(`/canvas?id=${canvas.id}`);
  };

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

  const createImportedCanvasName = (fileName: string) => {
    const stripped = fileName.replace(/\.json$/i, "").trim();
    if (!stripped) return "Imported Canvas";
    return stripped.length > 80 ? `${stripped.slice(0, 80)}…` : stripped;
  };

  const stageImportFile = async (file: File) => {
    setCreateError(null);
    setCreateNameError(null);
    setIsImporting(true);

    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const parsed = parseCanvasImportPayload(payload);

      if (parsed.shapesForApi.length === 0) {
        throw new Error("No canvas content found in import file.");
      }

      setPendingImportData(parsed);
      setCreateNameInput(createImportedCanvasName(file.name));
      setIsCreateModalOpen(true);
    } catch (error) {
      console.error("Error importing canvas:", error);
      setCreateError("Could not import this file. Please use a valid canvas JSON export.");
      setPendingImportData(null);
    } finally {
      setIsImporting(false);
    }
  };

  const importCanvasFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await stageImportFile(file);
    event.target.value = "";
  };

  const handleCreate = async (canvasName: string, importData: ParsedCanvasImport | null = null) => {
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
        const now = new Date().toISOString();
        const newCanvas: CanvasMeta = {
          id: data.id,
          name: data.name ?? canvasName,
          updatedAt: now,
          createdAt: now,
          lastOpenedAt: now,
        };

        if (importData) {
          savePendingCanvasImport(data.id, importData.snapshot);
          if (importData.backgroundPreset) {
            saveCanvasBackground(data.id, importData.backgroundPreset);
          }
        }

        upsertCanvas(newCanvas);
        setCanvasPreviews((prev) => ({ ...prev, [newCanvas.id]: null }));
        setAllCanvases((prev) => [newCanvas, ...prev.filter((canvas) => canvas.id !== newCanvas.id)]);
        navigate(`/canvas?id=${data.id}`);
        return true;
      }

      setCreateError("Canvas creation returned an unexpected response.");
      return false;
    } catch (error) {
      console.error("Error creating canvas:", error);
      setCreateError("Could not create canvas. Please try again.");
      return false;
    } finally {
      setIsCreating(false);
    }
  };

  const openCreateModal = () => {
    setPendingImportData(null);
    setCreateNameInput("");
    setCreateNameError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isCreating) return;
    setIsCreateModalOpen(false);
    setPendingImportData(null);
    setCreateNameError(null);
  };

  const submitCreateCanvas = async () => {
    const trimmed = createNameInput.trim();
    const finalName = trimmed || "Untitled Canvas";

    const duplicate = allCanvases.some((canvas) => normalizeName(canvas.name) === normalizeName(finalName));
    if (duplicate) {
      setCreateNameError("That name already exists. Please choose a unique name.");
      return;
    }

    const created = await handleCreate(finalName, pendingImportData);
    if (!created) return;

    setIsCreateModalOpen(false);
    setCreateNameInput("");
    setCreateNameError(null);
    setPendingImportData(null);
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
    const duplicate = allCanvases.some(
      (c) => c.id !== canvas.id && normalizeName(c.name) === normalizeName(trimmed)
    );
    if (duplicate) {
      setNameError("That name already exists. Please choose a unique name.");
      return;
    }
    const now = new Date().toISOString();
    upsertCanvas({
      id: canvas.id,
      name: trimmed,
      updatedAt: now,
      createdAt: canvas.createdAt ?? canvas.updatedAt ?? now,
      lastOpenedAt: canvas.lastOpenedAt,
    });
    setAllCanvases((prev) =>
      prev.map((existingCanvas) =>
        existingCanvas.id === canvas.id
          ? {
              ...existingCanvas,
              name: trimmed,
              updatedAt: now,
            }
          : existingCanvas
      )
    );
    cancelEdit();
  };

  const openDeleteModal = (canvas: CanvasMeta) => {
    setOpenActionsId(null);
    setDeleteTarget(canvas);
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      const response = await fetch(`${apiBase}/canvas/${deleteTarget.id}`, {
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

      removeCanvas(deleteTarget.id);
      setCanvasPreviews((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setAllCanvases((prev) => prev.filter((existingCanvas) => existingCanvas.id !== deleteTarget.id));

      if (editingId === deleteTarget.id) {
        cancelEdit();
      }

      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting canvas:", error);
      setCreateError("Could not delete canvas. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleImportDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isImporting) return;
    setIsImportDragOver(true);
  };

  const handleImportDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setIsImportDragOver(false);
  };

  const handleImportDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsImportDragOver(false);
    if (isImporting) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void stageImportFile(file);
  };

  return (
    <div className="min-h-screen dash-bg">
      <div className="dash-glow" />
      <header className="dash-header">
        <div className="dash-brand">
          <div className="dash-mark">DF</div>
          <div>
            <h1 className="dash-title">Dataframe</h1>
          </div>
        </div>
        <div className="dash-actions">
          <input
            ref={importFileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importCanvasFile(event)}
            style={{ display: "none" }}
          />
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
        </div>
      </header>

      <section className="dash-hero">
        <div>
          <h2 className="dash-hero-title">
            Build and run visual data workflows for real-time analysis.
          </h2>
          <p className="dash-hero-sub">
            Reopen saved canvases, refine node pipelines, and spin up new
            workflows for seismic and geospatial analysis in seconds.
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
          <div
            className={`dash-import-dropzone ${isImportDragOver ? "is-drag-over" : ""} ${isImporting ? "is-disabled" : ""}`}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            onDrop={handleImportDrop}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isImporting) return;
              importFileInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (isImporting) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                importFileInputRef.current?.click();
              }
            }}
            aria-label="Import canvas file"
          >
            <div className="dash-import-dropzone-icon" aria-hidden="true">⬆</div>
            <p className="dash-import-dropzone-title">Drop JSON</p>
            <p className="dash-import-dropzone-subtitle">
              {isImporting ? "Importing..." : "or click to import"}
            </p>
          </div>
        </div>
      </section>

      {createError && (
        <div className="px-6 pb-4 text-sm text-rose-600">{createError}</div>
      )}

      <section className="dash-section">
        <div className="dash-section-header">
          <h3>Canvases</h3>
          <div className="dash-section-controls">
            <div className="dash-dropdown dash-sort-dropdown">
              <button
                className="dash-sort dash-btn-dropdown"
                onClick={() => setIsSortMenuOpen((prev) => !prev)}
                aria-expanded={isSortMenuOpen}
                aria-haspopup="menu"
                aria-label="Sort canvases"
                type="button"
              >
                {sortOptions.find((option) => option.value === sortBy)?.label ?? "Last opened"}
              </button>
              {isSortMenuOpen ? (
                <div className="dash-dropdown-menu" role="menu">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`dash-dropdown-item ${sortBy === option.value ? "is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={sortBy === option.value}
                      onClick={() => {
                        setSortBy(option.value);
                        setIsSortMenuOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <input
              className="dash-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search canvases"
              aria-label="Search canvases"
            />
          </div>
        </div>

        <div className="dash-grid">
          {canvases.length === 0 ? (
            <article className="dash-card">
              <div className="dash-card-top">
                <span className={`dash-status ${statusStyles[0]}`}>empty</span>
                <span className="dash-muted">{allCanvases.length === 0 ? "no canvases yet" : "no matches"}</span>
              </div>
              <h4 className="dash-card-name">{allCanvases.length === 0 ? "Start your first canvas" : "No canvases found"}</h4>
              <p className="dash-card-sub">
                {allCanvases.length === 0
                  ? "Create a new canvas to see it appear here for quick access."
                  : "Try a different search term to find your canvas."}
              </p>
              <div className="dash-card-actions">
                {allCanvases.length === 0 ? (
                  <button onClick={openCreateModal} className="dash-btn dash-btn-outline" disabled={isCreating}>
                    Create Canvas
                  </button>
                ) : null}
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
                  openCanvas(canvas);
                }}
                onKeyDown={(event) => {
                  if (editingId === canvas.id) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCanvas(canvas);
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
                <div className="dash-card-preview">
                  {canvasPreviews[canvas.id] ? (
                    <img src={canvasPreviews[canvas.id] as string} alt={`${canvas.name} preview`} className="dash-card-preview-image" />
                  ) : (
                    <div className="dash-card-preview-empty">No preview yet</div>
                  )}
                </div>
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
                          <button className="dash-dropdown-item is-danger" role="menuitem" onClick={() => openDeleteModal(canvas)}>
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
            <p className="dash-modal-subtitle">
              {pendingImportData
                ? "Choose a name for the imported canvas."
                : "Choose a name for your new canvas."}
            </p>
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
                {isCreating ? "Creating..." : pendingImportData ? "Create from Import" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="dash-modal-backdrop" onClick={closeDeleteModal}>
          <div className="dash-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="dash-modal-title">Delete Canvas</h3>
            <p className="dash-modal-subtitle">
              Are you sure you want to delete "{deleteTarget.name}"? This cannot be undone.
            </p>
            <div className="dash-modal-actions">
              <button className="dash-btn dash-btn-ghost" onClick={closeDeleteModal} disabled={isDeleting}>
                Cancel
              </button>
              <button className="dash-btn dash-btn-primary" onClick={() => void confirmDelete()} disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
