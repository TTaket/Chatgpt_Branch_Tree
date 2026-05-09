import type {
  AppSettings,
  BackgroundRequest,
  BackgroundResponse,
  ContentRequest,
  ContentResponse,
  ProjectPersistedState,
  StoredState
} from "../shared/types";

const STORAGE_KEY = "gptbt_state";
const DEFAULT_APP_SETTINGS: AppSettings = {
  themeColor: "#10a37f",
  fontScale: "normal",
  layoutScale: "normal",
  autoRefreshEnabled: true,
  autoRefreshSeconds: 8
};

const DEFAULT_PROJECT_STATE: ProjectPersistedState = {
  layoutOffsets: {},
  nodeNotes: {},
  nodeMemos: {},
  nodeLabels: {},
  branchStyles: {},
  starredNodeIds: []
};

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener(
  (request: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    void handlePanelRequest(request).then(sendResponse);
    return true;
  }
);

async function handlePanelRequest(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    if (request.type === "PANEL_GET_STATE") {
      const [state, statusResponse] = await Promise.all([
        getStoredState(),
        sendToActiveContent({ type: "GPTBT_GET_PAGE_STATUS" }).catch(() => undefined)
      ]);
      return {
        ok: true,
        state,
        status: statusResponse?.ok && "status" in statusResponse ? statusResponse.status : undefined
      };
    }

    if (request.type === "PANEL_SCAN_PROJECT") {
      const response = await sendToActiveContent({
        type: "GPTBT_SCAN_PROJECT",
        force: request.force,
        project: request.project
      });
      if (!response.ok) return response;
      if (!("scan" in response)) return { ok: false, error: "ChatGPT tab returned an unexpected scan response." };
      await setStoredState({ currentScan: response.scan });
      return { ok: true, scan: response.scan };
    }

    if (request.type === "PANEL_COLLAPSE_ASSISTANT") {
      const response = await sendToActiveContent({
        type: "GPTBT_COLLAPSE_ASSISTANT",
        mode: request.mode
      });
      if (!response.ok) return response;
      if (!("collapsed" in response)) return { ok: false, error: "ChatGPT tab returned an unexpected collapse response." };
      await setStoredState({ collapsedAssistantReplies: response.collapsed });
      return response;
    }

    if (request.type === "PANEL_SAVE_PROJECT_STATE") {
      const current = await getStoredState();
      const existingProjectState = current.projectNotes?.[request.projectId] ?? DEFAULT_PROJECT_STATE;
      const nextProjectState = {
        ...existingProjectState,
        ...request.patch,
        layoutOffsets: request.patch.layoutOffsets ?? existingProjectState.layoutOffsets,
        nodeNotes: request.patch.nodeNotes ?? existingProjectState.nodeNotes,
        nodeMemos: request.patch.nodeMemos ?? existingProjectState.nodeMemos,
        nodeLabels: request.patch.nodeLabels ?? existingProjectState.nodeLabels,
        branchStyles: request.patch.branchStyles ?? existingProjectState.branchStyles,
        starredNodeIds: request.patch.starredNodeIds ?? existingProjectState.starredNodeIds
      };
      const nextState: StoredState = {
        ...current,
        projectNotes: {
          ...(current.projectNotes ?? {}),
          [request.projectId]: nextProjectState
        }
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
      return { ok: true, saved: true, state: nextState };
    }

    if (request.type === "PANEL_SAVE_APP_SETTINGS") {
      const current = await getStoredState();
      const nextState: StoredState = {
        ...current,
        appSettings: normalizeSettings(request.settings)
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
      return { ok: true, saved: true, state: nextState };
    }

    if (request.type === "PANEL_IMPORT_STATE") {
      const nextState = normalizeStoredState(request.state);
      await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
      return { ok: true, imported: true, state: nextState };
    }

    if (request.type === "PANEL_CLEAR_STATE") {
      await chrome.storage.local.remove(STORAGE_KEY);
      const state = normalizeStoredState({});
      return { ok: true, cleared: true, state };
    }

    if (request.type === "PANEL_NAVIGATE_NODE") {
      const tab = await getActiveTab();
      if (!tab?.id) return { ok: false, error: "No active ChatGPT tab found." };
      await setStoredState({ selectedNodeId: request.node.id });
      if (request.node.url && tab.url !== request.node.url) {
        await chrome.tabs.update(tab.id, { url: request.node.url });
        await waitForTabComplete(tab.id);
      }
      const highlight = await sendToTab(tab.id, {
        type: "GPTBT_HIGHLIGHT_NODE",
        node: request.node
      });
      if (!highlight.ok) return highlight;
      return { ok: true, navigated: "highlighted" in highlight ? highlight.highlighted : true };
    }

    return { ok: false, error: "Unsupported request." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendToActiveContent(request: ContentRequest): Promise<ContentResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("Open a ChatGPT tab before using the side panel.");
  return sendToTab(tab.id, request);
}

async function sendToTab(tabId: number, request: ContentRequest): Promise<ContentResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, request);
    } catch (error) {
      lastError = error;
      if (isTransientMessageError(error) && attempt < 2) {
        await delay(500);
        continue;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"]
        });
        return await chrome.tabs.sendMessage(tabId, request);
      } catch (secondError) {
        lastError = secondError;
        if (isTransientMessageError(secondError) && attempt < 2) {
          await delay(500);
          continue;
        }
        break;
      }
    }
  }
  if (isTransientMessageError(lastError)) {
    return {
      ok: false,
      error: "ChatGPT 页面正在浏览器前进/后退缓存中，消息通道已关闭。请刷新 ChatGPT 标签页后重试。"
    };
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find((tab) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url ?? ""));
}

async function waitForTabComplete(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 8000);

    function listener(updatedTabId: number, changeInfo: { status?: string }): void {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      globalThis.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getStoredState(): Promise<StoredState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeStoredState((result[STORAGE_KEY] as StoredState | undefined) ?? {});
}

async function setStoredState(patch: StoredState): Promise<void> {
  const current = await getStoredState();
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeStoredState({ ...current, ...patch }) });
}

function normalizeStoredState(state: StoredState): StoredState {
  const projectNotes = Object.fromEntries(
    Object.entries(state.projectNotes ?? {}).map(([projectId, projectState]) => [
      projectId,
      normalizeProjectState(projectState)
    ])
  );
  return {
    ...state,
    appSettings: normalizeSettings(state.appSettings),
    projectNotes
  };
}

function normalizeProjectState(state: Partial<ProjectPersistedState> | undefined): ProjectPersistedState {
  return {
    layoutOffsets: state?.layoutOffsets ?? {},
    nodeNotes: state?.nodeNotes ?? {},
    nodeMemos: state?.nodeMemos ?? {},
    nodeLabels: state?.nodeLabels ?? {},
    branchStyles: state?.branchStyles ?? {},
    starredNodeIds: state?.starredNodeIds ?? []
  };
}

function normalizeSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
    themeColor: /^#[0-9a-fA-F]{6}$/.test(settings?.themeColor ?? "")
      ? settings!.themeColor!
      : DEFAULT_APP_SETTINGS.themeColor,
    autoRefreshSeconds: clampNumber(settings?.autoRefreshSeconds, 5, 120, DEFAULT_APP_SETTINGS.autoRefreshSeconds)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function isTransientMessageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /back\/forward cache|message channel is closed|Receiving end does not exist|Extension context invalidated/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
