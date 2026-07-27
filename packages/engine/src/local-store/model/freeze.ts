/** Deeply freeze a structured snapshot while tolerating repeated references. */
export function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) deepFreeze(child, visited);
  return Object.freeze(value);
}
