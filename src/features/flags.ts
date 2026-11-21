/**
 * Feature flags. `swarm` is on for v0.1 (sequential + bounded-parallel admission).
 * Remaining keys are an explicit v0.2 backlog — not marketed as half-features.
 */
export const V01 = {
  swarm: true,
  arena: false,
  interrogate: false,
  autoReview: false,
  embeddingsSearch: false,
  osJail: false,
  darkTheme: false,
} as const;

export type FeatureFlag = keyof typeof V01;

export function featureEnabled(name: FeatureFlag): boolean {
  return Boolean(V01[name]);
}

/** @deprecated use featureEnabled */
export function v01Enabled(name: FeatureFlag): boolean {
  return featureEnabled(name);
}
