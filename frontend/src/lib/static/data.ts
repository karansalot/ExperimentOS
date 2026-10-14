/** Loads the static export written by `python -m experimentos.export_static` (cached per page load). */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const json = new Map<string, Promise<any>>();
const bins = new Map<string, Promise<ArrayBuffer>>();

export function loadJson<T = any>(path: string): Promise<T> {
  if (!json.has(path)) {
    json.set(
      path,
      fetch(`${BASE}/data/${path}`).then((r) => {
        if (!r.ok) throw new Error(`Static data file ${path} is missing (${r.status}).`);
        return r.json();
      }),
    );
  }
  return json.get(path)!;
}

/** Bootstrap gain curves: returns, per model, an array of grid columns each sorted ascending. */
export async function loadBootstrap(scope: string, outcome: string, split: "test" | "valid", basis: string) {
  const index = await loadJson<Record<string, { file: string; models: string[]; shape: number[] }>>(`${scope}/boot-index.json`);
  const entry = index[`${outcome}.${split}.${basis}`];
  if (!entry) return null;
  const key = `${scope}/${entry.file}`;
  if (!bins.has(key)) {
    bins.set(key, fetch(`${BASE}/data/${key}`).then((r) => {
      if (!r.ok) throw new Error(`Static data file ${key} is missing (${r.status}).`);
      return r.arrayBuffer();
    }));
  }
  const buf = await bins.get(key)!;
  const arr = new Float32Array(buf);
  const [nModels, nBoot, nGrid] = entry.shape;
  const out: Record<string, Float64Array[]> = {};
  entry.models.forEach((m, mi) => {
    const cols: Float64Array[] = [];
    for (let k = 0; k < nGrid; k++) {
      const col = new Float64Array(nBoot);
      for (let b = 0; b < nBoot; b++) col[b] = arr[(mi * nBoot + b) * nGrid + k];
      col.sort();
      cols.push(col);
    }
    out[m] = cols;
  });
  void nModels;
  return out;
}
