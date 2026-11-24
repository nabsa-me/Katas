export type FeatureId = string | number;

export interface SelectionChange {
  /** Id whose `selected` state must be cleared, if any. */
  clear: FeatureId | null;
  /** Id whose `selected` state must be set, if any. */
  set: FeatureId | null;
}

/**
 * Computes what to change in the feature-state when going from one selection to another.
 * Selecting the same feature again changes nothing.
 */
export function selectionChange(previous: FeatureId | null, next: FeatureId | null): SelectionChange {
  if (previous === next) return { clear: null, set: null };
  return { clear: previous, set: next };
}
