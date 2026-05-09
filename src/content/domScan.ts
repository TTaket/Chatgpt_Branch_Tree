import type { DomConversationSnapshot, PageStatus, ProjectOption } from "../shared/types";
import { canonicalProjectId, conversationIdFromUrl, projectIdFromUrl } from "../shared/url";
import { normalizeText } from "../shared/text";

const USER_MESSAGE_SELECTORS = [
  '[data-message-author-role="user"]',
  '[data-testid*="user-message"]',
  '[data-testid^="conversation-turn-"] [data-message-author-role="user"]'
];

export let cachedApiProjects: ProjectOption[] = [];
export function setCachedApiProjects(projects: ProjectOption[]) {
  cachedApiProjects = dedupeProjects(projects.map(normalizeProjectOption));
}

export function getPageStatus(): PageStatus {
  const url = location.href;
  const isChatGpt = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
  const projectId = projectIdFromUrl(url) ?? inferProjectIdFromSidebar() ?? "";
  const projectName = inferProjectName();
  
  const domProjects = collectProjectOptions();
  const allProjects = [...domProjects];
  for (const apiProj of cachedApiProjects) {
     if (!allProjects.find(p => sameProject(p, apiProj))) {
        allProjects.push(apiProj);
     }
  }
  const projects = dedupeProjects(allProjects);

  return {
    isChatGpt,
    isProject: isChatGpt && Boolean(projectId),
    projectId,
    projectName,
    projects,
    url
  };
}

export function scanDomConversation(project?: ProjectOption): DomConversationSnapshot {
  const status = getPageStatus();
  const conversationId = conversationIdFromUrl(location.href);
  const conversationTitle = inferConversationTitle();
  
  const userMessages = collectUserMessages();
  
  return {
    projectId: project?.id || status.projectId || "unknown-project",
    projectName: project?.name || status.projectName || "ChatGPT Project",
    conversationId,
    conversationTitle,
    conversationUrl: project?.url || location.href,
    userMessages,
    warnings: status.isProject ? [] : ["Current ChatGPT page does not appear to be inside a project."]
  };
}

function collectUserMessages(): DomConversationSnapshot["userMessages"] {
  const root = findMainContentRoot() ?? document.body;
  const elements = uniqueElements(
    USER_MESSAGE_SELECTORS.flatMap((selector) => [...root.querySelectorAll(selector)])
  );
  
  if (elements.length === 0) {
    return collectProjectConversationRows();
  }
  
  return collectMessagesWithBranchMarkers(root, elements);
}

function collectMessagesWithBranchMarkers(
  root: Element,
  userElements: Element[]
): DomConversationSnapshot["userMessages"] {
  const userElementSet = new Set(userElements);
  const markerElements = [...root.querySelectorAll<HTMLElement>("div, span, p")]
    .filter(isBranchMarkerElement)
    .filter((element) => ![...element.children].some((child) => isBranchMarkerElement(child as HTMLElement)));
  const ordered = [...userElements, ...markerElements].sort(compareDocumentOrder);
  const messages: DomConversationSnapshot["userMessages"] = [];
  let pendingBranchParentId: string | undefined;

  for (const element of ordered) {
    if (!userElementSet.has(element)) {
      // It's a branch marker. We need to find the parent message it refers to.
      // But in ChatGPT DOM, branch markers just say "branched from X".
      // They don't have a reliable data-id. 
      // So if we see a branch marker, we assume the next user message is a child of the last message 
      // in the chain that it branched from. 
      // Actually, since ChatGPT loads the *entire* path to the current node, 
      // the branch marker appears right BEFORE the new branch's first message.
      // And the parent is the last user message BEFORE this marker.
      pendingBranchParentId = messages.length > 0 ? messages[messages.length - 1].messageId : undefined;
      continue;
    }
    
    const text = normalizeText((element as HTMLElement).innerText || element.textContent || "");
    if (!text) continue;
    
    const messageId =
      element.getAttribute("data-message-id") ??
      element.closest("[data-message-id]")?.getAttribute("data-message-id") ??
      `dom-${messages.length}`;
      
    messages.push({
      messageId,
      ...(pendingBranchParentId ? { parentMessageId: pendingBranchParentId } : {}),
      text
    });
    
    // Reset pending branch parent since we consumed it
    pendingBranchParentId = undefined;
  }

  return messages;
}

function collectProjectConversationRows(): DomConversationSnapshot["userMessages"] {
  const main = findMainContentRoot();
  const scopedAnchors = main ? [...main.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]')] : [];
  const anchors = uniqueElements(scopedAnchors.filter(isLikelyMainConversationLink)) as HTMLAnchorElement[];

  return anchors
    .map((anchor, index) => {
      const href = anchor.href;
      const rawText = anchor.innerText || anchor.textContent || "";
      const text = normalizeText(rawText);
      if (!href || !text) return undefined;
      const conversationId = conversationIdFromUrl(href);
      const lines = rawText
        .split(/\n+/)
        .map((line) => normalizeText(line))
        .filter(Boolean);
      const title = lines.find((line) => !isDateLike(line)) ?? `对话 ${index + 1}`;
      const prompt = lines.find((line) => line !== title && !isDateLike(line)) ?? title;
      return {
        messageId: `project-row-${conversationId}-${index}`,
        conversationId,
        conversationTitle: title,
        url: href,
        text: prompt
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
}

function isDateLike(value: string): boolean {
  return /^\d{1,2}月\d{1,2}日$/.test(value) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value);
}

function isBranchMarkerElement(element: HTMLElement): boolean {
  const text = normalizeText(element.innerText || element.textContent || "");
  if (!text || text.length > 90) return false;
  return /^从.*建立的分支$/.test(text) || /^branched from.*$/i.test(text);
}

function compareDocumentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  const position = left.compareDocumentPosition(right);
  return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function inferProjectIdFromSidebar(): string | undefined {
  const activeProjectLink =
    document.querySelector<HTMLAnchorElement>('a[aria-current="page"][href*="/project"]') ??
    document.querySelector<HTMLAnchorElement>('a[href*="/project/"][data-discover]') ??
    document.querySelector<HTMLAnchorElement>('a[href*="/projects/"][data-discover]');
  const href = activeProjectLink?.href;
  return href ? projectIdFromUrl(href) : undefined;
}

function collectProjectOptions(): ProjectOption[] {
  const sidebarCandidates = [
    ...document.querySelectorAll<HTMLAnchorElement>('nav a[href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('aside a[href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('[role="menu"] a[href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"][href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('[data-radix-popper-content-wrapper] a[href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('[data-radix-popper-content-wrapper] [href*="/project"]'),
    ...document.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]')
  ];
  const byId = new Map<string, ProjectOption>();
  for (const anchor of sidebarCandidates) {
    const id = projectIdFromUrl(anchor.href);
    const name = normalizeText(anchor.innerText || anchor.textContent || "");
    if (!id || !name || /^新项目$/.test(name)) continue;
    byId.set(id, normalizeProjectOption({ id, name, url: anchor.href }));
  }

  const current = getCurrentProjectOption();
  if (current && !byId.has(current.id)) byId.set(current.id, current);
  return dedupeProjects([...byId.values()]);
}

function getCurrentProjectOption(): ProjectOption | undefined {
  const id = projectIdFromUrl(location.href);
  if (!id) return undefined;
  return {
    id,
    name: inferProjectName(),
    url: location.href.includes("/project") ? location.href : `${location.origin}/g/${id}/project`
  };
}

function inferProjectName(): string {
  const candidates = [
    '[data-testid="project-name"]',
    'a[aria-current="page"][href*="/project"]',
    "header h1",
    "main h1"
  ];
  for (const selector of candidates) {
    const element = document.querySelector<HTMLElement>(selector);
    const text = normalizeText(element?.innerText || element?.textContent || "");
    if (text && !/^chatgpt$/i.test(text)) return text;
  }
  return "ChatGPT Project";
}

function inferConversationTitle(): string {
  const title = document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  if (title && !/^chatgpt$/i.test(title)) return title;
  const headingElement = document.querySelector<HTMLElement>("main h1, header h1");
  const heading = normalizeText(headingElement?.innerText || headingElement?.textContent || "");
  return heading || "Current chat";
}

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  return elements.filter((element) => {
    if (seen.has(element)) return false;
    seen.add(element);
    return true;
  });
}

function findMainContentRoot(): Element | undefined {
  return (
    document.querySelector("main") ??
    document.querySelector('[role="main"]') ??
    [...document.querySelectorAll<HTMLElement>("section, div")]
      .filter((element) => !element.closest("nav, aside"))
      .sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0]
  );
}

function isLikelyMainConversationLink(anchor: HTMLAnchorElement): boolean {
  if (!anchor.href || !anchor.href.includes("/c/")) return false;
  if (anchor.closest("nav, aside, [data-testid='sidebar']")) return false;
  return true;
}

function normalizeProjectOption(project: ProjectOption): ProjectOption {
  return {
    ...project,
    id: canonicalProjectId(project.id) ?? project.id,
    name: normalizeText(project.name)
  };
}

function sameProject(left: ProjectOption, right: ProjectOption): boolean {
  const leftId = canonicalProjectId(left.id) ?? left.id;
  const rightId = canonicalProjectId(right.id) ?? right.id;
  if (leftId === rightId) return true;
  return normalizeText(left.name).toLowerCase() === normalizeText(right.name).toLowerCase();
}

function dedupeProjects(projects: ProjectOption[]): ProjectOption[] {
  const byKey = new Map<string, ProjectOption>();
  for (const project of projects.map(normalizeProjectOption)) {
    const key = `${project.id}::${project.name.toLowerCase()}`;
    const nameKey = `name::${project.name.toLowerCase()}`;
    if (byKey.has(key) || byKey.has(nameKey)) continue;
    byKey.set(key, project);
    byKey.set(nameKey, project);
  }
  return [...new Set(byKey.values())].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}
