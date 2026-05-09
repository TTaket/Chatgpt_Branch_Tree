import type { InternalConversation, InternalMessage, ProjectOption } from "../shared/types";

type UnknownRecord = Record<string, unknown>;

interface ConversationListItem {
  id: string;
  title: string;
  createdAt?: string;
  url: string;
}

const PROJECT_PAGE_SIZE = 50;
const SIDEBAR_ENDPOINT =
  `/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5&limit=${PROJECT_PAGE_SIZE}`;
const CAPTURED_HEADER_NAMES = [
  "authorization",
  "oai-client-build-number",
  "oai-client-version",
  "oai-device-id",
  "oai-language",
  "oai-session-id",
  "x-oai-is"
];

const globalState = window as Window & { __gptbtBridgeLoaded?: boolean };

let originalFetch: typeof fetch | undefined;
let authHeaders: Record<string, string> = {};

if (!globalState.__gptbtBridgeLoaded) {
  globalState.__gptbtBridgeLoaded = true;
  installFetchObserver();

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === "GPTBT_DO_ACTIVE_SCAN") {
      try {
        const data = await doActiveScan(event.data.projectId);
        window.postMessage({ type: "GPTBT_ACTIVE_SCAN_RESULT", requestId: event.data.requestId, data }, "*");
      } catch (error) {
        window.postMessage({
          type: "GPTBT_ACTIVE_SCAN_ERROR",
          requestId: event.data.requestId,
          error: error instanceof Error ? error.message : String(error)
        }, "*");
      }
    }
    if (event.data && event.data.type === "GPTBT_FETCH_PROJECTS") {
      try {
        const data = await fetchProjectsOnly();
        window.postMessage({ type: "GPTBT_FETCH_PROJECTS_RESULT", requestId: event.data.requestId, data }, "*");
      } catch (error) {
        window.postMessage({
          type: "GPTBT_FETCH_PROJECTS_ERROR",
          requestId: event.data.requestId,
          error: error instanceof Error ? error.message : String(error)
        }, "*");
      }
    }
  });
}

function installFetchObserver(): void {
  const nativeFetch = window.fetch;
  originalFetch = nativeFetch;

  const wrapped = function (this: unknown, ...args: Parameters<typeof fetch>) {
    queueMicrotask(() => captureRequestHeaders(args[0], args[1]));
    return nativeFetch.apply(this, args);
  };

  try {
    const nativeToString = Function.prototype.toString.call(nativeFetch);
    Object.defineProperty(wrapped, "toString", {
      value: () => nativeToString,
      configurable: true,
      writable: false
    });
    Object.defineProperty(wrapped, "name", { value: "fetch", configurable: true });
  } catch {
    // Best effort only.
  }

  try {
    window.fetch = wrapped as typeof fetch;
  } catch {
    // If the host page locks fetch, the bridge can still use nativeFetch.
  }
}

function captureRequestHeaders(input: RequestInfo | URL, init?: RequestInit): void {
  try {
    const sourceHeaders =
      init?.headers ??
      (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined);
    if (!sourceHeaders) return;
    const headers = new Headers(sourceHeaders);
    for (const key of CAPTURED_HEADER_NAMES) {
      const value = headers.get(key);
      if (value) authHeaders[key] = value;
    }
  } catch {
    // Header capture must never affect ChatGPT's own fetch calls.
  }
}

async function apiFetch(
  endpoint: string,
  options: { projectHeaderId?: string; label?: string } = {}
): Promise<unknown> {
  if (!originalFetch) {
    throw new Error("页面桥还没有准备好，请刷新 ChatGPT 标签页后重试。");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${location.origin}${endpoint}`;
  const headers: Record<string, string> = {
    accept: "*/*",
    "cache-control": "no-cache",
    pragma: "no-cache",
    ...authHeaders
  };
  if (options.projectHeaderId) headers["chatgpt-project-id"] = options.projectHeaderId;
  applyTargetHeaders(headers, url);

  const response = await originalFetch(url, {
    method: "GET",
    headers,
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    const authHint = authHeaders.authorization
      ? ""
      : "。还没有捕获到 ChatGPT 的授权请求头，请刷新 ChatGPT 页面，等页面加载完成后再试";
    const bodyText = await response.text().catch(() => "");
    const bodyHint = bodyText ? `，${bodyText.slice(0, 180)}` : "";
    const label = options.label ? `${options.label} ` : "";
    throw new Error(`${label}ChatGPT 接口 ${response.status}：${response.statusText}${bodyHint}${authHint}`);
  }

  return response.json();
}

function applyTargetHeaders(headers: Record<string, string>, urlValue: string): void {
  const url = new URL(urlValue, location.origin);
  const path = url.pathname;
  headers["x-openai-target-path"] = path;
  if (path === "/backend-api/gizmos/snorlax/sidebar") {
    headers["x-openai-target-route"] = "/backend-api/gizmos/snorlax/sidebar";
    return;
  }
  if (/^\/backend-api\/gizmos\/[^/]+\/conversations$/.test(path)) {
    headers["x-openai-target-route"] = "/backend-api/gizmos/{gizmo_id}/conversations";
    return;
  }
  if (/^\/backend-api\/conversation\/[^/]+$/.test(path)) {
    headers["x-openai-target-route"] = "/backend-api/conversation/{conversation_id}";
  }
}

async function fetchProjectsOnly(): Promise<{ projects: ProjectOption[] }> {
  return JSON.parse(JSON.stringify({ projects: await fetchAllProjects() }));
}

async function doActiveScan(targetProjectId?: string): Promise<{
  projectId: string;
  projectName: string;
  projects: ProjectOption[];
  conversations: InternalConversation[];
  capturedAt: string;
  warnings: string[];
}> {
  const projects = await fetchAllProjects();
  const currentProjectId =
    cleanProjectId(targetProjectId) ??
    cleanProjectId(inferProjectFromLocation().projectId) ??
    projects[0]?.id;

  if (!currentProjectId) {
    throw new Error("没有获取到项目列表，请确认当前 ChatGPT 账号支持项目功能。");
  }

  const selectedProject = projects.find((project) => project.id === currentProjectId) ?? {
    id: currentProjectId,
    name: currentProjectId,
    url: projectUrl(currentProjectId)
  };
  const conversationItems = await fetchProjectConversationItems(currentProjectId);
  const conversations: InternalConversation[] = [];
  const warnings: string[] = [];

  for (const item of conversationItems) {
    try {
      const detail = await apiFetch(`/backend-api/conversation/${encodeURIComponent(item.id)}`, {
        projectHeaderId: currentProjectId,
        label: `读取对话「${item.title}」`
      });
      const parsed = conversationFromRecord(detail, item);
      if (parsed) conversations.push(parsed);
    } catch (error) {
      warnings.push(`对话「${item.title}」读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (conversationItems.length === 0) {
    warnings.push("这个项目接口返回的对话列表为空。");
  }

  return JSON.parse(JSON.stringify({
    projectId: currentProjectId,
    projectName: selectedProject.name,
    projects,
    conversations,
    capturedAt: new Date().toISOString(),
    warnings
  }));
}

async function fetchAllProjects(): Promise<ProjectOption[]> {
  const projectsById = new Map<string, ProjectOption>();

  const sidebarData = await apiFetch(SIDEBAR_ENDPOINT, { label: "读取项目列表" });
  for (const project of extractProjectsFrom(sidebarData)) {
    if (!projectsById.has(project.id)) projectsById.set(project.id, project);
  }

  return dedupeProjects([...projectsById.values()]);
}

async function fetchProjectConversationItems(projectId: string): Promise<ConversationListItem[]> {
  const itemsById = new Map<string, ConversationListItem>();

  const endpoint = `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=0`;
  const data = await apiFetch(endpoint, { label: "读取项目会话列表" }).catch((error) => {
    if (!String(error instanceof Error ? error.message : error).includes("422")) throw error;
    return apiFetch(`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations`, {
      label: "读取项目会话列表"
    });
  });
  for (const item of extractConversationItems(data)) {
    if (!itemsById.has(item.id)) itemsById.set(item.id, item);
  }

  return [...itemsById.values()];
}

function extractProjectsFrom(sidebarData: unknown): ProjectOption[] {
  const candidates = Array.isArray(sidebarData)
    ? sidebarData
    : isRecord(sidebarData) && Array.isArray(sidebarData.items)
      ? sidebarData.items
      : isRecord(sidebarData) && Array.isArray(sidebarData.gizmos)
        ? sidebarData.gizmos
        : [];
  const projects = new Map<string, ProjectOption>();

  for (const item of candidates) {
    const project = projectFromSidebarItem(item);
    if (project && !projects.has(project.id)) projects.set(project.id, project);
  }

  visitRecords(sidebarData, (record, parent) => {
    const id = cleanProjectId(stringValue(record.id) ?? stringValue(record.gizmo_id));
    if (!id?.startsWith("g-p-") || projects.has(id)) return;
    const name = projectNameFromRecord(record) ?? projectNameFromRecord(parent) ?? id;
    projects.set(id, { id, name, url: projectUrl(id) });
  });

  return dedupeProjects([...projects.values()]);
}

function projectFromSidebarItem(item: unknown): ProjectOption | undefined {
  if (!isRecord(item)) return undefined;
  const outerGizmo = isRecord(item.gizmo) ? item.gizmo : item;
  const innerGizmo = isRecord(outerGizmo.gizmo) ? outerGizmo.gizmo : outerGizmo;
  const id = cleanProjectId(
    stringValue(innerGizmo.id) ??
    stringValue(innerGizmo.gizmo_id) ??
    stringValue(outerGizmo.id) ??
    stringValue(item.id)
  );
  if (!id?.startsWith("g-p-")) return undefined;
  const name =
    projectNameFromRecord(innerGizmo) ??
    projectNameFromRecord(outerGizmo) ??
    projectNameFromRecord(item) ??
    id;
  return { id, name, url: projectUrl(id) };
}

function projectNameFromRecord(record: unknown): string | undefined {
  if (!isRecord(record)) return undefined;
  const display = isRecord(record.display) ? record.display : undefined;
  return (
    stringValue(display?.name) ??
    stringValue(display?.title) ??
    stringValue(display?.display_name) ??
    stringValue(record.display_name) ??
    stringValue(record.title) ??
    stringValue(record.name)
  )?.trim();
}

function extractConversationItems(data: unknown): ConversationListItem[] {
  const rawItems = isRecord(data) && Array.isArray(data.items)
    ? data.items
    : isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations
      : [];
  const items: ConversationListItem[] = [];

  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const conversation = isRecord(raw.conversation) ? raw.conversation : raw;
    const id =
      stringValue(conversation.id) ??
      stringValue(conversation.conversation_id) ??
      stringValue(raw.id) ??
      stringValue(raw.conversation_id);
    if (!id) continue;
    const title =
      stringValue(conversation.title) ??
      stringValue(conversation.name) ??
      stringValue(raw.title) ??
      "未命名对话";
    items.push({
      id,
      title,
      createdAt: timeFromRecord(conversation) ?? timeFromRecord(raw),
      url: conversationUrl(id)
    });
  }

  return items;
}

function nextConversationCursor(data: unknown): string | undefined {
  return nextListCursor(data);
}

function nextSidebarCursor(data: unknown): string | undefined {
  const cursor = nextListCursor(data);
  if (!cursor || /^\d+$/.test(cursor)) return undefined;
  return cursor;
}

function nextListCursor(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  if (data.has_more === false || data.hasMore === false) return undefined;
  return (
    cursorValue(data.next_cursor) ??
    cursorValue(data.nextCursor) ??
    cursorValue(data.next_page_cursor) ??
    cursorValue(data.nextPageCursor) ??
    cursorValue(data.end_cursor) ??
    cursorValue(data.endCursor) ??
    cursorValue(data.after)
  );
}

function conversationFromRecord(recordValue: unknown, fallback: ConversationListItem): InternalConversation | undefined {
  if (!isRecord(recordValue)) return undefined;
  const conversationRecord = isRecord(recordValue.conversation) ? recordValue.conversation : recordValue;
  const mappingValue = isRecord(conversationRecord.mapping) ? conversationRecord.mapping : undefined;
  if (!mappingValue) return undefined;

  const id =
    stringValue(conversationRecord.conversation_id) ??
    stringValue(conversationRecord.id) ??
    fallback.id;
  const mapping: Record<string, InternalMessage> = {};
  for (const [key, rawNode] of Object.entries(mappingValue)) {
    const message = internalMessageFromMappingNode(key, rawNode);
    if (message) mapping[message.id] = message;
  }

  if (Object.keys(mapping).length === 0) return undefined;
  return {
    id,
    title: stringValue(conversationRecord.title) ?? fallback.title,
    url: fallback.url || conversationUrl(id),
    createdAt: timeFromRecord(conversationRecord) ?? fallback.createdAt,
    currentNodeId:
      stringValue(conversationRecord.current_node) ??
      stringValue(conversationRecord.currentNode) ??
      stringValue(conversationRecord.current_message_id) ??
      stringValue(conversationRecord.currentMessageId),
    mapping
  };
}

function internalMessageFromMappingNode(key: string, rawNode: unknown): InternalMessage | undefined {
  if (!isRecord(rawNode)) return undefined;
  const rawMessage = isRecord(rawNode.message) ? rawNode.message : rawNode;
  const id = stringValue(rawMessage.id) ?? stringValue(rawNode.id) ?? key;
  const metadata = isRecord(rawMessage.metadata) ? rawMessage.metadata : undefined;
  return {
    id,
    authorRole: roleFromMessage(rawMessage),
    text: textFromMessage(rawMessage),
    parentId: stringValue(rawNode.parent),
    childrenIds: Array.isArray(rawNode.children)
      ? rawNode.children.map((child) => String(child)).filter(Boolean)
      : [],
    createdAt: timeFromRecord(rawMessage),
    isUserSystemMessage: metadata?.is_user_system_message === true
  };
}

function roleFromMessage(rawMessage: UnknownRecord): InternalMessage["authorRole"] {
  const author = isRecord(rawMessage.author) ? rawMessage.author : undefined;
  const role = stringValue(author?.role) ?? stringValue(rawMessage.role);
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "unknown";
}

function textFromMessage(rawMessage: UnknownRecord): string {
  const content = rawMessage.content;
  if (isRecord(content)) {
    const parts = content.parts;
    if (Array.isArray(parts)) {
      return parts.map(textFromUnknown).filter(Boolean).join("\n").trim();
    }
  }
  return textFromUnknown(content) || textFromUnknown(rawMessage.text);
}

function timeFromRecord(record: unknown): string | undefined {
  if (!isRecord(record)) return undefined;
  const value =
    record.create_time ??
    record.created_at ??
    record.update_time ??
    record.updated_at ??
    record.createTime ??
    record.createdAt;
  if (typeof value === "number") {
    return new Date(value > 1e11 ? value : value * 1000).toISOString();
  }
  return stringValue(value);
}

function cleanProjectId(value: string | undefined): string | undefined {
  return canonicalProjectId(value);
}

function canonicalProjectId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const exact = value.match(/g-p-[a-fA-F0-9]{32}/);
  if (exact) return exact[0];
  return value.startsWith("g-p-") ? value : undefined;
}

function inferProjectFromLocation(): { projectId?: string; projectName?: string } {
  const projectMatch =
    location.pathname.match(/\/project(?:s)?\/([^/?#]+)/) ??
    location.pathname.match(/\/g\/([^/?#]+)\/project(?:\/|$)/);
  return {
    projectId: cleanProjectId(projectMatch?.[1]),
    projectName: document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "") || undefined
  };
}

function visitRecords(value: unknown, visitor: (record: UnknownRecord, parent?: UnknownRecord) => void, parent?: UnknownRecord): void {
  if (!isRecord(value)) return;
  visitor(value, parent);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) visitRecords(item, visitor, value);
    } else if (isRecord(child)) {
      visitRecords(child, visitor, value);
    }
  }
}

function projectUrl(id: string): string {
  return `${location.origin}/g/${id}/project`;
}

function conversationUrl(id: string): string {
  return `${location.origin}/c/${id}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function cursorValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n").trim();
  if (!isRecord(value)) return "";
  const direct = stringValue(value.text) ?? stringValue(value.content) ?? stringValue(value.value);
  if (direct) return direct.trim();
  for (const key of ["content", "text", "value", "markdown"]) {
    const nestedValue: unknown = value[key];
    if (nestedValue && nestedValue !== value) {
      const nestedText = textFromUnknown(nestedValue);
      if (nestedText) return nestedText;
    }
  }
  const parts = value.parts ?? value.items ?? value.children;
  if (Array.isArray(parts)) return parts.map(textFromUnknown).filter(Boolean).join("\n").trim();
  return "";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function dedupeProjects(projects: ProjectOption[]): ProjectOption[] {
  const byId = new Map<string, ProjectOption>();
  const seenNames = new Set<string>();
  for (const project of projects) {
    const id = cleanProjectId(project.id) ?? project.id;
    const name = project.name.trim();
    const nameKey = name.toLowerCase();
    if (byId.has(id) || seenNames.has(nameKey)) continue;
    byId.set(id, { ...project, id, name });
    seenNames.add(nameKey);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}
