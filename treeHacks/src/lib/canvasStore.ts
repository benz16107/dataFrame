export type CanvasMeta = {
  id: string;
  name: string;
  updatedAt: string;
};

const STORAGE_KEY = "treehacks_canvases";

function safeParse(value: string | null): CanvasMeta[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as CanvasMeta[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string");
  } catch {
    return [];
  }
}

export function loadCanvases(): CanvasMeta[] {
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function upsertCanvas(meta: CanvasMeta) {
  const list = loadCanvases();
  const next = [meta, ...list.filter((c) => c.id !== meta.id)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function touchCanvas(id: string, name = "Untitled Canvas") {
  upsertCanvas({
    id,
    name,
    updatedAt: new Date().toISOString(),
  });
}
