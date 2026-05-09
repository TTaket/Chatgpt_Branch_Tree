export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function previewText(value: string, length = 96): string {
  const normalized = normalizeText(value);
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, length - 3)}...`;
}

export function fingerprintText(value: string): string {
  const normalized = normalizeText(value).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableId(parts: Array<string | number | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== undefined && part !== "")
    .map((part) =>
      String(part)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .join(":");
}
