export type TriBool = boolean | null;

export interface ModelCapability {
  id: string;
  label: string;
  glyph: string;
  important: boolean;
  input?: boolean;
  output?: boolean;
}

export interface MappedProviderModel {
  id: string;
  modelId: string;
  label: string;
  supportsTools: TriBool;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportsFileInput: boolean;
  isFree: boolean;
  isChat: boolean;
  /** True when the model can run CelmBot agent loops (chat + tools). */
  agentCompatible: boolean;
  contextLength?: number;
  pricing?: { prompt: number | null; completion: number | null };
  capabilities: ModelCapability[];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).toLowerCase());
}

function normalizeModalityList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  if (typeof value === "string") {
    return value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }
  return [];
}

function collectModalities(model: Record<string, unknown>): { inputs: string[]; outputs: string[] } {
  const architecture = (model.architecture || {}) as Record<string, unknown>;
  const modalities = (model.modalities || {}) as Record<string, unknown>;
  const inputs = normalizeModalityList(architecture.input_modalities ?? modalities.input);
  const outputs = normalizeModalityList(architecture.output_modalities ?? modalities.output);

  const modality = String(architecture.modality ?? "").toLowerCase();
  if (modality.includes("->")) {
    const [inPart = "", outPart = ""] = modality.split("->");
    for (const token of inPart.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (!inputs.includes(token)) inputs.push(token);
    }
    for (const token of outPart.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (!outputs.includes(token)) outputs.push(token);
    }
  }
  return { inputs, outputs };
}

function hasModalityToken(list: string[], kind: string): boolean {
  return list.some((m) => m.includes(kind) || (kind === "image" && m.includes("vision")));
}

/** Detect tool/function calling from provider catalog metadata. null = unknown. */
export function detectToolSupport(model: Record<string, unknown>): TriBool {
  const params = asStringList(model.supported_parameters);
  if (params.some((p) => p.includes("tools") || p.includes("tool_choice") || p.includes("function"))) {
    return true;
  }
  const features = asStringList(model.supported_features);
  if (features.some((f) => f.includes("tools") || f.includes("function") || f.includes("tool_use"))) {
    return true;
  }
  const tags = asStringList(model.tags);
  if (tags.some((t) => t.includes("tool-use") || t.includes("tools") || t.includes("function"))) {
    return true;
  }
  // Vercel AI Gateway marks tool-capable chat models with tool-use / function-calling style tags.
  const capabilities = asStringList(
    (model as { capabilities?: unknown }).capabilities ??
      (model as { capability?: unknown }).capability
  );
  if (capabilities.some((c) => c.includes("tool") || c.includes("function"))) {
    return true;
  }
  // OpenRouter / gateway catalogs usually expose supported_parameters; absence → unknown, not false.
  if (
    model.supported_parameters != null ||
    model.supported_features != null ||
    (Array.isArray(model.tags) && model.tags.length > 0)
  ) {
    return false;
  }
  return null;
}

export function detectEmbeddingSupport(model: Record<string, unknown>): boolean {
  if (String(model.type ?? "").toLowerCase() === "embedding") return true;
  const { outputs } = collectModalities(model);
  if (outputs.some((m) => m.includes("embedding"))) return true;
  const id = String(model.id ?? "").toLowerCase();
  const name = String(model.name ?? model.id ?? "").toLowerCase();
  return id.includes("embed") || name.includes("embed");
}

export function detectVisionSupport(model: Record<string, unknown>): boolean {
  const { inputs, outputs } = collectModalities(model);
  if (hasModalityToken(inputs, "image") || hasModalityToken(outputs, "image")) return true;
  const tags = asStringList(model.tags);
  return tags.some((t) => t.includes("vision") || t.includes("multimodal"));
}

export function detectFileInput(model: Record<string, unknown>): boolean {
  const { inputs } = collectModalities(model);
  return (
    hasModalityToken(inputs, "file") ||
    hasModalityToken(inputs, "pdf") ||
    hasModalityToken(inputs, "document") ||
    asStringList(model.tags).some((t) => t.includes("file"))
  );
}

export function detectIsFree(model: Record<string, unknown>): boolean {
  const pricing = (model.pricing || {}) as Record<string, unknown>;
  const prompt = Number(pricing.prompt ?? pricing.input);
  const completion = Number(pricing.completion ?? pricing.output);
  if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0) {
    return true;
  }
  const id = String(model.id ?? "").toLowerCase();
  const name = String(model.name ?? "").toLowerCase();
  return id.includes(":free") || id.endsWith("/free") || name.includes("free");
}

export function detectIsChat(model: Record<string, unknown>): boolean {
  if (detectEmbeddingSupport(model)) return false;
  const { outputs } = collectModalities(model);
  if (outputs.length === 0) return true;
  const hasText = outputs.some((m) => m.includes("text"));
  const imageOnly = outputs.every((m) => m.includes("image") || m.includes("embedding"));
  if (imageOnly && !hasText) return false;
  return hasText || outputs.some((m) => !m.includes("embedding"));
}

function parsePricing(model: Record<string, unknown>): { prompt: number | null; completion: number | null } {
  const pricing = (model.pricing || {}) as Record<string, unknown>;
  const prompt = Number(pricing.prompt ?? pricing.input);
  const completion = Number(pricing.completion ?? pricing.output);
  return {
    prompt: Number.isFinite(prompt) ? prompt : null,
    completion: Number.isFinite(completion) ? completion : null,
  };
}

function buildCapabilities(
  model: Record<string, unknown>,
  opts: {
    supportsTools: TriBool;
    supportsEmbeddings: boolean;
    supportsVision: boolean;
    supportsFileInput: boolean;
  }
): ModelCapability[] {
  const { inputs, outputs } = collectModalities(model);
  const caps: ModelCapability[] = [];
  const push = (cap: ModelCapability) => {
    if (!caps.some((c) => c.id === cap.id)) caps.push(cap);
  };

  if (opts.supportsTools === true) {
    push({ id: "tools", label: "Tools", glyph: "T", important: true });
  }
  if (opts.supportsEmbeddings) {
    push({ id: "embedding", label: "Embedding", glyph: "E", important: true });
  }
  if (opts.supportsVision || hasModalityToken(inputs, "image") || hasModalityToken(outputs, "image")) {
    push({
      id: "image",
      label: "Image",
      glyph: "I",
      important: true,
      input: hasModalityToken(inputs, "image"),
      output: hasModalityToken(outputs, "image"),
    });
  }
  if (opts.supportsFileInput) {
    push({ id: "file", label: "File", glyph: "F", important: true, input: true });
  }
  if (asStringList(model.tags).some((t) => t.includes("reasoning"))) {
    push({ id: "reasoning", label: "Reasoning", glyph: "R", important: false });
  }
  return caps;
}

/**
 * Map a raw OpenAI-compatible / provider catalog model row into CelmBot browse shape.
 * `toolsKnown` providers (OpenRouter etc.) that omit tool params are treated as non-tool.
 */
export function mapProviderModel(model: Record<string, unknown>): MappedProviderModel {
  const modelId = String(model.id ?? "");
  const label = String(model.name ?? modelId);
  const supportsTools = detectToolSupport(model);
  const supportsEmbeddings = detectEmbeddingSupport(model);
  const supportsVision = detectVisionSupport(model);
  const supportsFileInput = detectFileInput(model);
  const isFree = detectIsFree(model);
  const isChat = detectIsChat(model);
  const agentCompatible =
    isChat && supportsTools === true && !supportsEmbeddings;

  const contextLength = Number(
    model.context_length ?? model.max_model_len ?? (model as { context_window?: number }).context_window
  );

  return {
    id: modelId,
    modelId,
    label,
    supportsTools,
    supportsEmbeddings,
    supportsVision,
    supportsFileInput,
    isFree,
    isChat,
    agentCompatible,
    contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
    pricing: parsePricing(model),
    capabilities: buildCapabilities(model, {
      supportsTools,
      supportsEmbeddings,
      supportsVision,
      supportsFileInput,
    }),
  };
}

/** Keep models CelmBot can actually run as agents (chat + tools). Unknown tools kept only when allowUnknownTools. */
export function filterAgentCompatible(
  models: MappedProviderModel[],
  opts?: { allowUnknownTools?: boolean }
): MappedProviderModel[] {
  const allowUnknown = opts?.allowUnknownTools ?? false;
  return models.filter((m) => {
    if (!m.isChat || m.supportsEmbeddings) return false;
    if (m.supportsTools === true) return true;
    if (m.supportsTools === null && allowUnknown) return true;
    return false;
  });
}

export function formatCapabilitySummary(model: MappedProviderModel): string {
  const parts: string[] = [];
  if (model.supportsTools === true) parts.push("Tools");
  else if (model.supportsTools === null) parts.push("Tools?");
  if (model.supportsEmbeddings) parts.push("Embed");
  if (model.supportsVision) parts.push("Vision");
  if (model.supportsFileInput) parts.push("File");
  if (model.isFree) parts.push("Free");
  return parts.join(" · ");
}
