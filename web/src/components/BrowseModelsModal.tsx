import { useEffect, useMemo, useState } from "react";
import type { Credential, DiscoveredModel, Key } from "@shared/types";
import { api } from "../api";
import styles from "./BrowseModelsModal.module.scss";

type BrowseFilters = {
  tools: boolean;
  free: boolean;
  vision: boolean;
  file: boolean;
  embedding: boolean;
};

const defaultFilters: BrowseFilters = {
  tools: true,
  free: true,
  vision: false,
  file: false,
  embedding: false,
};

type SortKey = "label" | "prompt" | "completion";
type SortDir = "asc" | "desc";

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "free";
  if (value < 0.01) return `$${(value * 1_000_000).toFixed(2)}/M`;
  return `$${value}`;
}

function matchesFilters(model: DiscoveredModel, filters: BrowseFilters): boolean {
  if (filters.tools && model.supportsTools === false) return false;
  if (filters.free && !model.isFree) return false;
  if (filters.vision && !model.supportsVision) return false;
  if (filters.file && !model.supportsFileInput) return false;
  if (filters.embedding && !model.supportsEmbeddings) return false;
  return true;
}

function matchesSearch(model: DiscoveredModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${model.label} ${model.modelId}`.toLowerCase().includes(q);
}

function compareModels(
  a: DiscoveredModel,
  b: DiscoveredModel,
  sort: SortKey,
  dir: SortDir,
  imported: Set<string>
) {
  const aImp = imported.has(a.modelId) ? 0 : 1;
  const bImp = imported.has(b.modelId) ? 0 : 1;
  if (aImp !== bImp) return aImp - bImp;
  const cmp =
    sort === "label"
      ? a.label.localeCompare(b.label)
      : sort === "prompt"
        ? (a.pricing?.prompt ?? 99) - (b.pricing?.prompt ?? 99)
        : (a.pricing?.completion ?? 99) - (b.pricing?.completion ?? 99);
  return dir === "asc" ? cmp : -cmp;
}

export interface BrowseModelsModalProps {
  open: boolean;
  credential: Credential;
  existingKeys: Key[];
  onClose: () => void;
  onImported: () => void;
}

export function BrowseModelsModal({
  open,
  credential,
  existingKeys,
  onClose,
  onImported,
}: BrowseModelsModalProps) {
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [meta, setMeta] = useState<{
    cached?: boolean;
    fetchedAt?: number;
    expiresAt?: number;
    totalRaw?: number;
    filteredOut?: number;
    error?: string;
  }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<BrowseFilters>(defaultFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "label", dir: "asc" });
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const importedIds = useMemo(() => {
    return new Set(
      existingKeys
        .filter(
          (k) =>
            k.credentialId === credential.id ||
            k.providerId === credential.providerId ||
            k.baseUrl.replace(/\/$/, "") === credential.baseUrl.replace(/\/$/, "")
        )
        .map((k) => k.model)
    );
  }, [existingKeys, credential]);

  const unavailableImported = useMemo(() => {
    if (!models.length) return [] as string[];
    const remote = new Set(models.map((m) => m.modelId));
    return [...importedIds].filter((id) => !remote.has(id));
  }, [models, importedIds]);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await api.browseModels({
        credentialId: credential.id,
        providerId: credential.providerId,
        refresh,
        compatibleOnly: !showAll,
      });
      setModels(result.models ?? []);
      setMeta({
        cached: result.cached,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
        totalRaw: result.totalRaw,
        filteredOut: result.filteredOut,
        error: result.error,
      });
      if (result.error && (result.models?.length ?? 0) > 0) {
        setStatus(`Using cached list (${result.error})`);
      }
    } catch (e) {
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSearch("");
    setFilters(defaultFilters);
    void load(false);
  }, [open, credential.id, showAll]);

  const visible = useMemo(() => {
    const list = models.filter((m) => matchesFilters(m, filters) && matchesSearch(m, search));
    list.sort((a, b) => compareModels(a, b, sort.key, sort.dir, importedIds));
    return list;
  }, [models, filters, search, sort, importedIds]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  };

  const toggleSelect = (modelId: string) => {
    if (importedIds.has(modelId)) return;
    if (credential.modelLock && credential.modelLock !== modelId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const importSelected = async () => {
    if (!selected.size) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const selectedIds = [...selected];
      const hints: Record<string, { supportsTools?: boolean | null }> = {};
      for (const id of selectedIds) {
        const row = models.find((m) => m.modelId === id);
        if (row) hints[id] = { supportsTools: row.supportsTools };
      }
      const result = await api.addKeysBatch({
        credentialId: credential.id,
        providerId: credential.providerId,
        label: credential.label,
        models: selectedIds,
        hints,
        probe: true,
      });
      const skippedN = result.skipped?.length ?? 0;
      const skipPreview = (result.skipped ?? [])
        .slice(0, 4)
        .map((s) => `${s.model}: ${s.reason}`)
        .join(" · ");
      setStatus(
        `Imported ${result.count}/${selectedIds.length}` +
          (skippedN
            ? ` · skipped ${skippedN}${skipPreview ? ` — ${skipPreview}` : ""}`
            : "")
      );
      setSelected(new Set());
      onImported();
      if (!result.skipped?.length && result.count > 0) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const hasActiveFilters =
    Boolean(search.trim()) ||
    filters.free !== defaultFilters.free ||
    filters.vision !== defaultFilters.vision ||
    filters.file !== defaultFilters.file ||
    filters.embedding !== defaultFilters.embedding ||
    filters.tools !== defaultFilters.tools;

  const lockNote = credential.modelLock
    ? `This key is locked to ${credential.modelLock}.`
    : "This key is unlocked — any imported model for the provider may use it.";

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Browse models"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2>Browse Models</h2>
            <p>
              Using provider key <strong>{credential.label}</strong> ({credential.providerId}). {lockNote}{" "}
              Secret is reused — no re-paste. Non-tool models are filtered.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load(true)}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button type="button" className={styles.secondary} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {error ? <div className={`${styles.banner} ${styles.bannerWarn}`}>{error}</div> : null}
          {status ? <div className={styles.banner}>{status}</div> : null}
          {meta.error && !error ? (
            <div className={`${styles.banner} ${styles.bannerWarn}`}>{meta.error}</div>
          ) : null}

          {unavailableImported.length > 0 ? (
            <div className={`${styles.banner} ${styles.bannerWarn}`}>
              {unavailableImported.length} imported model
              {unavailableImported.length === 1 ? "" : "s"} no longer in provider catalog:{" "}
              <span className={styles.modelMeta}>{unavailableImported.slice(0, 6).join(", ")}</span>
              {unavailableImported.length > 6 ? ` (+${unavailableImported.length - 6})` : ""}
            </div>
          ) : null}

          <div className={styles.toolbar}>
            <input
              type="search"
              placeholder="Name or id (e.g. llama, free)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className={styles.filters} style={{ flex: "0 0 auto" }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowAll(on);
                  if (on) setFilters((f) => ({ ...f, tools: false }));
                  else setFilters((f) => ({ ...f, tools: true }));
                }}
              />
              Show incompatible
            </label>
          </div>

          <div className={styles.filters}>
            {(
              [
                ["tools", "Tools"],
                ["free", "Free"],
                ["vision", "Vision"],
                ["file", "File"],
                ["embedding", "Embedding"],
              ] as const
            ).map(([key, labelText]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
                />
                {labelText}
              </label>
            ))}
            {hasActiveFilters ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setSearch("");
                  setFilters(defaultFilters);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <div className={styles.meta}>
            Showing {visible.length}
            {models.length !== visible.length ? ` of ${models.length}` : ""} models
            {meta.filteredOut ? ` · ${meta.filteredOut} incompatible hidden` : ""}
            {meta.cached ? " · cached" : meta.fetchedAt ? " · live" : ""}
            {meta.expiresAt ? ` · cache until ${new Date(meta.expiresAt).toLocaleTimeString()}` : ""}
          </div>

          <div className={styles.tableWrap}>
            {loading && !models.length ? (
              <div className={styles.empty}>Loading {credential.label} catalog…</div>
            ) : !visible.length ? (
              <div className={styles.empty}>
                No models match. Try Refresh or enable “Show incompatible”.
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th className={styles.sortable} onClick={() => toggleSort("label")}>
                      Model {sort.key === "label" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                    </th>
                    <th className={styles.sortable} onClick={() => toggleSort("prompt")}>
                      Input {sort.key === "prompt" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                    </th>
                    <th className={styles.sortable} onClick={() => toggleSort("completion")}>
                      Output {sort.key === "completion" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                    </th>
                    <th>Capabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    const imported = importedIds.has(m.modelId);
                    const lockedOut = Boolean(credential.modelLock && credential.modelLock !== m.modelId);
                    const checked = selected.has(m.modelId);
                    return (
                      <tr key={m.modelId} className={imported || lockedOut ? styles.rowImported : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={imported || lockedOut || saving}
                            checked={imported || checked}
                            onChange={() => toggleSelect(m.modelId)}
                            aria-label={`Select ${m.modelId}`}
                          />
                        </td>
                        <td className={styles.modelCell}>
                          <strong>
                            {m.label}
                            {imported ? (
                              <span className={`${styles.badge} ${styles.badgeImported}`}>Imported</span>
                            ) : null}
                            {lockedOut ? (
                              <span className={`${styles.badge} ${styles.badgeWarn}`}>Locked out</span>
                            ) : null}
                            {m.isFree ? (
                              <span className={`${styles.badge} ${styles.badgeFree}`}>Free</span>
                            ) : null}
                            {!m.agentCompatible && showAll ? (
                              <span className={`${styles.badge} ${styles.badgeWarn}`}>Incompatible</span>
                            ) : null}
                          </strong>
                          <div className={styles.modelMeta}>{m.modelId}</div>
                        </td>
                        <td className={styles.price}>{formatPrice(m.pricing?.prompt)}</td>
                        <td className={styles.price}>{formatPrice(m.pricing?.completion)}</td>
                        <td>
                          <div className={styles.caps}>
                            {(m.capabilities.length
                              ? m.capabilities
                              : m.supportsTools === true
                                ? [{ id: "tools", label: "Tools", glyph: "T", important: true }]
                                : []
                            ).map((c) => (
                              <span
                                key={c.id}
                                className={`${styles.cap} ${c.important ? styles.capImportant : ""}`}
                                title={c.label}
                              >
                                {c.label}
                                {c.input || c.output
                                  ? ` (${c.input ? "I" : ""}${c.output ? "O" : ""})`
                                  : ""}
                              </span>
                            ))}
                            {m.supportsTools === null ? (
                              <span className={styles.cap} title="Tool support unknown — will probe on import">
                                Tools?
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.meta}>
            {selected.size} selected
            {saving
              ? " · importing (sequential probe)…"
              : " · catalog tools → chat check; others get a forced tools probe"}
          </div>
          <div className={styles.footerActions}>
            <button type="button" className={styles.secondary} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={!selected.size || saving || loading}
              onClick={() => void importSelected()}
            >
              {saving ? "Importing…" : `Add (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
