/** Feature flags for v0.1 work — stubs only until implemented. */
export const V01 = {
  arena: false,
  swarm: false,
  interrogate: false,
  autoReview: false,
  embeddingsSearch: false,
  osJail: false,
  darkTheme: false,
} as const;

export function v01Enabled(name: keyof typeof V01): boolean {
  return Boolean(V01[name]);
}
