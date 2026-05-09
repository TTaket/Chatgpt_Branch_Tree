export function conversationIdFromUrl(urlValue = location.href): string {
  const url = new URL(urlValue);
  const conversationMatch = url.pathname.match(/\/c\/([^/?#]+)/);
  if (conversationMatch?.[1]) return conversationMatch[1];
  const gMatch = url.pathname.match(/\/g\/[^/]+\/c\/([^/?#]+)/);
  if (gMatch?.[1]) return gMatch[1];
  return "current";
}

export function projectIdFromUrl(urlValue = location.href): string | undefined {
  const url = new URL(urlValue);
  const projectMatch = url.pathname.match(/\/project(?:s)?\/([^/?#]+)/);
  if (projectMatch?.[1]) return canonicalProjectId(projectMatch[1]) ?? projectMatch[1];
  const gProjectMatch = url.pathname.match(/\/g\/([^/?#]+)\/project(?:\/|$)/);
  if (gProjectMatch?.[1]) return canonicalProjectId(gProjectMatch[1]) ?? gProjectMatch[1];
  const queryProject = url.searchParams.get("project") ?? url.searchParams.get("projectId");
  return queryProject ? canonicalProjectId(queryProject) ?? queryProject : undefined;
}

export function chatUrlForConversation(conversationId: string, baseUrl = location.origin): string {
  if (!conversationId || conversationId === "current") return `${baseUrl}/`;
  return `${baseUrl}/c/${conversationId}`;
}

export function canonicalProjectId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const exact = value.match(/g-p-[a-fA-F0-9]{32}/);
  if (exact) return exact[0];
  return value.startsWith("g-p-") ? value : undefined;
}
