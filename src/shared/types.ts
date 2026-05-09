export type SourceMode = "internal" | "dom" | "mixed" | "none";

export type EdgeKind = "observed" | "inferred";

export interface QuestionNode {
  id: string;
  conversationId: string;
  conversationTitle: string;
  messageId?: string;
  parentId?: string;
  prompt: string;
  promptPreview: string;
  response?: string;
  responsePreview?: string;
  fingerprint: string;
  url: string;
  source: SourceMode;
  index: number;
  createdAt?: string;
}

export interface BranchEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface ProjectConversation {
  id: string;
  title: string;
  url: string;
  nodes: QuestionNode[];
}

export interface ProjectScan {
  projectId: string;
  projectName: string;
  isProject: boolean;
  sourceMode: SourceMode;
  conversations: ProjectConversation[];
  nodes: QuestionNode[];
  edges: BranchEdge[];
  warnings: string[];
  scannedUrl: string;
  lastScanAt: string;
}

export interface InternalMessage {
  id: string;
  authorRole: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  parentId?: string;
  childrenIds: string[];
  createdAt?: string;
  isUserSystemMessage?: boolean;
}

export interface InternalConversation {
  id: string;
  title: string;
  url?: string;
  createdAt?: string;
  currentNodeId?: string;
  mapping?: Record<string, InternalMessage>;
}

export interface InternalProjectSnapshot {
  projectId?: string;
  projectName?: string;
  conversations: InternalConversation[];
  capturedAt: string;
  warnings: string[];
}

export interface DomConversationSnapshot {
  projectId: string;
  projectName: string;
  conversationId: string;
  conversationTitle: string;
  conversationUrl: string;
  userMessages: Array<{
    messageId?: string;
    parentMessageId?: string;
    conversationId?: string;
    conversationTitle?: string;
    url?: string;
    text: string;
    createdAt?: string;
  }>;
  warnings: string[];
}

export interface StoredState {
  currentScan?: ProjectScan;
  selectedNodeId?: string;
  collapsedAssistantReplies?: boolean;
  projectNotes?: Record<string, ProjectPersistedState>;
  appSettings?: AppSettings;
}

export interface ProjectPersistedState {
  layoutOffsets: Record<string, { x: number; y: number }>;
  nodeNotes: Record<string, NodeComment[]>;
  nodeMemos: Record<string, NodeMemo>;
  nodeLabels: Record<string, NodeLabel>;
  branchStyles: Record<string, BranchStyle>;
  starredNodeIds: string[];
}

export type FontScale = "small" | "normal" | "large";

export type LayoutScale = "compact" | "normal" | "spacious";

export interface AppSettings {
  themeColor: string;
  fontScale: FontScale;
  layoutScale: LayoutScale;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
}

export interface NodeComment {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NodeMemo {
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeLabel {
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchStyle {
  color: string;
  label?: string;
  note?: string;
  updatedAt?: string;
}

export type ContentRequest =
  | { type: "GPTBT_SCAN_PROJECT"; force?: boolean; project?: ProjectOption }
  | { type: "GPTBT_HIGHLIGHT_NODE"; node: QuestionNode }
  | { type: "GPTBT_COLLAPSE_ASSISTANT"; mode: "collapse" | "expand" | "toggle" }
  | { type: "GPTBT_GET_PAGE_STATUS" };

export type ContentResponse =
  | { ok: true; scan: ProjectScan }
  | { ok: true; status: PageStatus }
  | { ok: true; collapsed: boolean; affected: number }
  | { ok: true; highlighted: boolean }
  | { ok: false; error: string };

export interface PageStatus {
  isChatGpt: boolean;
  isProject: boolean;
  projectId: string;
  projectName: string;
  projects: ProjectOption[];
  url: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  url: string;
}

export type BackgroundRequest =
  | { type: "PANEL_SCAN_PROJECT"; force?: boolean; project?: ProjectOption }
  | { type: "PANEL_GET_STATE" }
  | { type: "PANEL_NAVIGATE_NODE"; node: QuestionNode }
  | { type: "PANEL_COLLAPSE_ASSISTANT"; mode: "collapse" | "expand" | "toggle" }
  | { type: "PANEL_SAVE_APP_SETTINGS"; settings: AppSettings }
  | { type: "PANEL_IMPORT_STATE"; state: StoredState }
  | { type: "PANEL_CLEAR_STATE" }
  | {
      type: "PANEL_SAVE_PROJECT_STATE";
      projectId: string;
      patch: Partial<ProjectPersistedState>;
    };

export type BackgroundResponse =
  | { ok: true; scan: ProjectScan }
  | { ok: true; state: StoredState; status?: PageStatus }
  | { ok: true; collapsed: boolean; affected: number }
  | { ok: true; navigated: boolean }
  | { ok: true; saved: boolean; state: StoredState }
  | { ok: true; imported: boolean; state: StoredState }
  | { ok: true; cleared: boolean; state: StoredState }
  | { ok: false; error: string };
