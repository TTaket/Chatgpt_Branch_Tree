import { setAssistantCollapsed, ensureCollapseStyles } from "./collapse";
import { getPageStatus, setCachedApiProjects } from "./domScan";
import { highlightNode } from "./highlight";
import { requestActiveScan, requestProjectsOnly } from "./internalBridge";
import type { ContentRequest, ContentResponse, ProjectScan } from "../shared/types";
import { scanFromInternalConversations } from "../shared/tree";

const globalState = window as Window & { __gptbtContentLoaded?: boolean };

if (!globalState.__gptbtContentLoaded) {
  globalState.__gptbtContentLoaded = true;
  ensureCollapseStyles();

  chrome.runtime.onMessage.addListener(
    (request: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      void handleRequest(request).then(sendResponse);
      return true;
    }
  );
}

async function handleRequest(request: ContentRequest): Promise<ContentResponse> {
  try {
    if (request.type === "GPTBT_GET_PAGE_STATUS") {
      // Proactively fetch projects from API to keep dropdown up-to-date.
      try {
        const result = await requestProjectsOnly();
        if (result && !result.error && Array.isArray(result.projects) && result.projects.length > 0) {
          setCachedApiProjects(result.projects.map((p: any) => ({
            id: p.id,
            name: p.name,
            url: p.url || `https://chatgpt.com/g/${p.id}/project`
          })));
        } else if (result?.error) {
          console.warn(`[GPTBT Content] Projects-only fetch error: ${result.error}`);
        }
      } catch (e) {
        console.warn("[GPTBT Content] Failed to proactively fetch projects:", e);
      }
      return { ok: true, status: getPageStatus() };
    }
    if (request.type === "GPTBT_SCAN_PROJECT") {
      return { ok: true, scan: await scanProject(request.project) };
    }
    if (request.type === "GPTBT_COLLAPSE_ASSISTANT") {
      return { ok: true, ...setAssistantCollapsed(request.mode) };
    }
    if (request.type === "GPTBT_HIGHLIGHT_NODE") {
      return { ok: true, highlighted: await highlightNode(request.node) };
    }
    return { ok: false, error: "Unsupported request." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function scanProject(project?: import("../shared/types").ProjectOption): Promise<ProjectScan> {
  const activeResult = await requestActiveScan(project?.id);

  if (activeResult && !activeResult.error) {
    // Cache projects for UI dropdown
    if (activeResult.projects && activeResult.projects.length > 0) {
        setCachedApiProjects(activeResult.projects.map((p: any) => ({
            id: p.id,
            name: p.name,
            url: p.url || `https://chatgpt.com/g/${p.id}/project`
        })));
    }

    const internalScan = scanFromInternalConversations({
        projectId: activeResult.projectId,
        projectName: activeResult.projectName,
        conversations: activeResult.conversations,
        scannedUrl: location.href,
        warnings: activeResult.warnings || []
    });

    return internalScan;
  }

  // Active scan failed – surface the real error to the UI instead of silently falling back.
  const errMsg = activeResult?.error || "Unknown active-scan failure";
  console.error("[GPTBT Content] Active scan failed:", errMsg);
  throw new Error(`主动扫描失败：${errMsg}`);
}
