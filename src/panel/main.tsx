import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Crosshair,
  Download,
  Edit3,
  FolderTree,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Star,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type {
  AppSettings,
  BranchStyle,
  BackgroundRequest,
  BackgroundResponse,
  LayoutScale,
  PageStatus,
  ProjectPersistedState,
  ProjectScan,
  NodeComment,
  NodeLabel,
  NodeMemo,
  QuestionNode
} from "../shared/types";
import { sampleScan } from "./sampleData";
import { TreeView, type TreeViewHandle } from "./treeView";
import "./styles.css";

const DEFAULT_SETTINGS: AppSettings = {
  themeColor: "#10a37f",
  fontScale: "normal",
  layoutScale: "normal",
  autoRefreshEnabled: true,
  autoRefreshSeconds: 8
};

const BRANCH_COLORS = [
  "#10a37f",
  "#0f766e",
  "#14b8a6",
  "#2563eb",
  "#1d4ed8",
  "#38bdf8",
  "#7c3aed",
  "#a855f7",
  "#db2777",
  "#f43f5e",
  "#dc2626",
  "#ef4444",
  "#d97706",
  "#f59e0b",
  "#facc15",
  "#65a30d",
  "#22c55e",
  "#15803d",
  "#0891b2",
  "#0e7490",
  "#475569",
  "#111827",
  "#92400e",
  "#be123c"
];

interface BranchGroup {
  id: string;
  rootNode: QuestionNode;
  focusNode: QuestionNode;
  nodes: QuestionNode[];
  nodeIds: Set<string>;
  fallbackName: string;
  color: string;
  style?: BranchStyle;
}

function App(): React.ReactElement {
  const [scan, setScan] = useState<ProjectScan | undefined>(undefined);
  const [status, setStatus] = useState<PageStatus | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsIntervalDraft, setSettingsIntervalDraft] = useState(String(DEFAULT_SETTINGS.autoRefreshSeconds));
  const [persistedByProject, setPersistedByProject] = useState<Record<string, ProjectPersistedState>>({});
  const [layoutOffsets, setLayoutOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [undoLayoutStack, setUndoLayoutStack] = useState<Array<Record<string, { x: number; y: number }>>>([]);
  const [redoLayoutStack, setRedoLayoutStack] = useState<Array<Record<string, { x: number; y: number }>>>([]);
  const [nodeNotes, setNodeNotes] = useState<Record<string, NodeComment[]>>({});
  const [nodeMemos, setNodeMemos] = useState<Record<string, NodeMemo>>({});
  const [nodeLabels, setNodeLabels] = useState<Record<string, NodeLabel>>({});
  const [editingNodeLabel, setEditingNodeLabel] = useState(false);
  const [nodeLabelDraft, setNodeLabelDraft] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoCollapsed, setMemoCollapsed] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | undefined>(undefined);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [branchStyles, setBranchStyles] = useState<Record<string, BranchStyle>>({});
  const [activeBranchId, setActiveBranchId] = useState<string | undefined>(undefined);
  const [colorPickerBranchId, setColorPickerBranchId] = useState<string | undefined>(undefined);
  const [previewBranchColor, setPreviewBranchColor] = useState<{ branchId: string; color: string } | undefined>(undefined);
  const [editingBranchNameId, setEditingBranchNameId] = useState<string | undefined>(undefined);
  const [editingBranchNoteId, setEditingBranchNoteId] = useState<string | undefined>(undefined);
  const [starredNodeIds, setStarredNodeIds] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [initializing, setInitializing] = useState(true);
  const [initMessage, setInitMessage] = useState<string>("正在加载项目列表...");
  const treeHandleRef = useRef<TreeViewHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const liveUpdateRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const canUseExtension = hasChromeRuntime();
  const version = canUseExtension ? chrome.runtime.getManifest().version : "1.0.4";

  function showToast(message: string): void {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(undefined);
      toastTimerRef.current = null;
    }, 3000);
  }

  useEffect(() => {
    void loadInitialState();
  }, []);

  const filteredNodes = useMemo(() => {
    if (!scan) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return scan.nodes;
    return scan.nodes.filter((node) =>
      [nodeLabels[node.id]?.text, node.prompt, node.conversationTitle].some((value) =>
        (value ?? "").toLowerCase().includes(normalized)
      )
    );
  }, [nodeLabels, query, scan]);

  const selectedNode = scan?.nodes.find((node) => node.id === selectedNodeId);
  const projectOptions = status?.projects ?? [];
  const filteredProjects = useMemo(() => {
    const normalized = projectQuery.trim().toLowerCase();
    if (!normalized) return projectOptions;
    return projectOptions.filter((project) => project.name.toLowerCase().includes(normalized));
  }, [projectOptions, projectQuery]);
  const selectedProject =
    projectOptions.find((project) => project.id === selectedProjectId) ??
    projectOptions.find((project) => project.id === status?.projectId);
  const selectedProjectName = selectedProject?.name ?? "";
  const branchGroups = useMemo(
    () => (scan ? buildBranchGroups(scan, branchStyles) : []),
    [branchStyles, scan]
  );
  const activeBranch = branchGroups.find((branch) => branch.id === activeBranchId);
  const colorPickerBranch = colorPickerBranchId
    ? branchGroups.find((branch) => branch.id === colorPickerBranchId)
    : undefined;
  const selectedNodeBranch = selectedNode
    ? branchGroups.find((branch) => branch.nodeIds.has(selectedNode.id))
    : undefined;
  const selectedBranchLabel =
    selectedNodeBranch?.style?.label?.trim() ||
    selectedNodeBranch?.fallbackName ||
    selectedNode?.conversationTitle ||
    "";
  const nodeLabelTextById = useMemo(
    () => Object.fromEntries(Object.entries(nodeLabels).map(([nodeId, label]) => [nodeId, label.text])),
    [nodeLabels]
  );
  const selectedNodeDisplayName =
    selectedNode
      ? nodeLabels[selectedNode.id]?.text.trim() || selectedNode.promptPreview
      : "";
  const activeBranchNodeIds = activeBranch?.nodeIds;
  const branchColorByNodeId = useMemo(() => {
    const colors: Record<string, string> = {};
    const orderedBranches = [
      ...branchGroups.filter((branch) => branch.id !== activeBranchId),
      ...branchGroups.filter((branch) => branch.id === activeBranchId)
    ];
    for (const branch of orderedBranches) {
      const color = previewBranchColor?.branchId === branch.id ? previewBranchColor.color : branch.color;
      for (const nodeId of branch.nodeIds) colors[nodeId] = color;
    }
    return colors;
  }, [activeBranchId, branchGroups, previewBranchColor]);

  useEffect(() => {
    if (!branchGroups.length) return;
    const existingActiveBranch = activeBranchId
      ? branchGroups.find((branch) => branch.id === activeBranchId)
      : undefined;
    if (existingActiveBranch && (!selectedNodeId || existingActiveBranch.nodeIds.has(selectedNodeId))) return;
    const branchForNode = selectedNodeId
      ? branchGroups.find((branch) => branch.nodeIds.has(selectedNodeId))
      : undefined;
    setActiveBranchId((branchForNode ?? branchGroups[0])?.id);
  }, [activeBranchId, branchGroups, selectedNodeId]);

  useEffect(() => {
    if (!canUseExtension) return;
    if (!selectedProjectId) return;
    if (!appSettings.autoRefreshEnabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshScanSilently();
    }, appSettings.autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [appSettings.autoRefreshEnabled, appSettings.autoRefreshSeconds, canUseExtension, selectedProjectId, selectedProject?.id, busy, scan]);

  async function loadInitialState(): Promise<void> {
    if (!canUseExtension) {
      setAppSettings(DEFAULT_SETTINGS);
      setSettingsDraft(DEFAULT_SETTINGS);
      setScan(sampleScan);
      setStatus({
        isChatGpt: true,
        isProject: true,
        projectId: sampleScan.projectId,
        projectName: sampleScan.projectName,
        projects: [{ id: sampleScan.projectId, name: sampleScan.projectName, url: sampleScan.scannedUrl }],
        url: sampleScan.scannedUrl
      });
      setSelectedProjectId(sampleScan.projectId);
      setSelectedNodeId(sampleScan.nodes[0]?.id);
      applyPersistedState(undefined);
      setInitializing(false);
      return;
    }

    // Block UI until projects list is populated (or we decide to give up).
    setInitializing(true);
    setInitMessage("正在获取项目列表...");

    // Retry a few times – the content script needs fetch headers captured first.
    let finalStatus: PageStatus | undefined;
    let finalState: any;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      setInitMessage(`正在获取项目列表... (${attempt}/${maxAttempts})`);
      const response = await sendMessage({ type: "PANEL_GET_STATE" });
      if (response.ok && "state" in response && "status" in response) {
        finalState = response.state;
        finalStatus = response.status;
        // If we have at least one project, accept it and stop polling.
        if ((response.status?.projects?.length ?? 0) >= 1) {
          break;
        }
      } else if (!response.ok) {
        setError(response.error);
      }
      await new Promise((r) => window.setTimeout(r, 1500));
    }

    if (finalState && finalStatus) {
      const nextSettings = normalizeSettings(finalState.appSettings);
      setAppSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setScan(finalState.currentScan);
      setSelectedNodeId(finalState.selectedNodeId ?? finalState.currentScan?.nodes[0]?.id);
      setStatus(finalStatus);
      setPersistedByProject(finalState.projectNotes ?? {});
      setSelectedProjectId(finalStatus?.projectId || finalStatus?.projects[0]?.id);
      const projectId = finalState.currentScan?.projectId ?? finalStatus?.projectId;
      applyPersistedState(projectId ? finalState.projectNotes?.[projectId] : undefined);
    }

    setInitializing(false);
  }

  async function refreshScanSilently(): Promise<void> {
    if (!canUseExtension || !selectedProject || busy || liveUpdateRef.current) return;
    liveUpdateRef.current = true;
    const previousScan = scan;
    try {
      const response = await sendMessage({ type: "PANEL_SCAN_PROJECT", force: false, project: selectedProject });
      if (response.ok && "scan" in response && hasScanChanged(previousScan, response.scan)) {
        setScan(response.scan);
        setSelectedNodeId((current) =>
          current && response.scan.nodes.some((node) => node.id === current)
            ? current
            : response.scan.nodes[0]?.id
        );
        showToast("检测到新消息，分支树已更新");
      }
    } catch {
      // Realtime refresh is best effort; manual scan still surfaces errors.
    } finally {
      liveUpdateRef.current = false;
    }
  }

  async function scanProject(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setToastMessage("正在扫描项目...");
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    const response = canUseExtension
      ? await sendMessage({ type: "PANEL_SCAN_PROJECT", force: true, project: selectedProject })
      : ({ ok: true, scan: sampleScan } as BackgroundResponse);
    setBusy(false);
    if (response.ok && "scan" in response) {
      setScan(response.scan);
      setSelectedNodeId(response.scan.nodes[0]?.id);
      applyPersistedState(persistedByProject[response.scan.projectId]);
      if (response.scan.warnings && response.scan.warnings.length > 0) {
        response.scan.warnings.forEach((warn: string) => showToast(warn));
      } else {
        showToast(`扫描完成，共找到 ${response.scan.nodes.length} 个节点`);
      }
    } else if (!response.ok) {
      setToastMessage(undefined);
      setError(`扫描失败：${response.error || "未知错误"}`);
    }
  }

  async function refreshProjects(): Promise<void> {
    if (!canUseExtension) return;
    const response = await sendMessage({ type: "PANEL_GET_STATE" });
    if (response.ok && "state" in response && "status" in response) {
      setStatus(response.status);
      setPersistedByProject(response.state.projectNotes ?? {});
      showToast("项目列表已刷新");
    } else if (!response.ok) {
      setError(response.error);
    }
  }

  async function navigateToNode(node: QuestionNode): Promise<void> {
    setSelectedNodeId(node.id);
    if (!canUseExtension) return;
    const response = await sendMessage({ type: "PANEL_NAVIGATE_NODE", node });
    if (!response.ok) setError(response.error);
  }

  async function collapseAssistant(mode: "collapse" | "expand" | "toggle"): Promise<void> {
    setError(undefined);
    if (!canUseExtension) return;
    const response = await sendMessage({ type: "PANEL_COLLAPSE_ASSISTANT", mode });
    if (!response.ok) setError(response.error);
  }

  async function saveCurrentProjectState(quiet = false): Promise<void> {
    if (!scan) return;
    const projectState: ProjectPersistedState = {
      layoutOffsets,
      nodeNotes,
      nodeMemos,
      nodeLabels,
      branchStyles,
      starredNodeIds
    };
    if (!canUseExtension) {
      applyPersistedState(projectState);
      if (!quiet) showToast("已保存到当前演示会话");
      return;
    }
    const response = await sendMessage({
      type: "PANEL_SAVE_PROJECT_STATE",
      projectId: scan.projectId,
      patch: projectState
    });
    if (response.ok && "state" in response) {
      setPersistedByProject(response.state.projectNotes ?? {});
      if (!quiet) showToast("布局、说明、笔记和分支样式已保存");
    } else if (!response.ok) {
      setError(response.error);
    }
  }

  function applyPersistedState(projectState: ProjectPersistedState | undefined): void {
    setLayoutOffsets(projectState?.layoutOffsets ?? {});
    setUndoLayoutStack([]);
    setRedoLayoutStack([]);
    setNodeNotes(projectState?.nodeNotes ?? {});
    setNodeMemos(projectState?.nodeMemos ?? {});
    setNodeLabels(projectState?.nodeLabels ?? {});
    setEditingNodeLabel(false);
    setNodeLabelDraft("");
    setBranchStyles(projectState?.branchStyles ?? {});
    setMemoDraft("");
    setMemoEditing(false);
    setMemoCollapsed(false);
    setNotesCollapsed(false);
    setActiveBranchId(undefined);
    setColorPickerBranchId(undefined);
    setPreviewBranchColor(undefined);
    setEditingBranchNameId(undefined);
    setEditingBranchNoteId(undefined);
    setStarredNodeIds(projectState?.starredNodeIds ?? []);
    setDraftComment("");
    setEditingCommentId(undefined);
    setEditingCommentText("");
  }

  function toggleSelectedNodeStar(): void {
    if (!selectedNode) return;
    setStarredNodeIds((current) =>
      current.includes(selectedNode.id)
        ? current.filter((id) => id !== selectedNode.id)
        : [...current, selectedNode.id]
    );
  }

  useEffect(() => {
    const memo = selectedNode ? nodeMemos[selectedNode.id] : undefined;
    setMemoDraft(memo?.text ?? "");
    setMemoEditing(false);
  }, [selectedNodeId, nodeMemos]);

  useEffect(() => {
    const label = selectedNode ? nodeLabels[selectedNode.id] : undefined;
    setNodeLabelDraft(label?.text ?? "");
    setEditingNodeLabel(false);
  }, [selectedNodeId, nodeLabels]);

  function commitLayoutOffsets(nextOffsets: Record<string, { x: number; y: number }>): void {
    if (JSON.stringify(layoutOffsets) === JSON.stringify(nextOffsets)) return;
    setUndoLayoutStack((current) => [...current.slice(-29), layoutOffsets]);
    setRedoLayoutStack([]);
    setLayoutOffsets(nextOffsets);
  }

  function undoLayoutMove(): void {
    setUndoLayoutStack((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setRedoLayoutStack((redo) => [...redo.slice(-29), layoutOffsets]);
      setLayoutOffsets(previous);
      return current.slice(0, -1);
    });
  }

  function redoLayoutMove(): void {
    setRedoLayoutStack((current) => {
      const next = current.at(-1);
      if (!next) return current;
      setUndoLayoutStack((undo) => [...undo.slice(-29), layoutOffsets]);
      setLayoutOffsets(next);
      return current.slice(0, -1);
    });
  }

  function saveNodeMemo(): void {
    if (!selectedNode) return;
    const text = memoDraft.trim();
    setNodeMemos((current) => {
      const previous = current[selectedNode.id];
      if (!text) {
        const next = { ...current };
        delete next[selectedNode.id];
        return next;
      }
      const now = new Date().toISOString();
      return {
        ...current,
        [selectedNode.id]: {
          text,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now
        }
      };
    });
    setMemoEditing(false);
    showToast("节点说明已更新");
  }

  function deleteNodeMemo(): void {
    if (!selectedNode) return;
    setNodeMemos((current) => {
      const next = { ...current };
      delete next[selectedNode.id];
      return next;
    });
    setMemoDraft("");
    setMemoEditing(true);
    showToast("节点说明已删除");
  }

  function saveNodeLabel(): void {
    if (!selectedNode) return;
    const text = nodeLabelDraft.trim();
    setNodeLabels((current) => {
      const previous = current[selectedNode.id];
      if (!text || text === selectedNode.promptPreview) {
        const next = { ...current };
        delete next[selectedNode.id];
        return next;
      }
      const now = new Date().toISOString();
      return {
        ...current,
        [selectedNode.id]: {
          text,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now
        }
      };
    });
    setEditingNodeLabel(false);
    showToast("节点名已更新");
  }

  async function saveAppSettings(): Promise<void> {
    const normalized = normalizeSettings({
      ...settingsDraft,
      autoRefreshSeconds: normalizeIntervalDraft(settingsIntervalDraft, appSettings.autoRefreshSeconds)
    });
    setAppSettings(normalized);
    setSettingsDraft(normalized);
    setSettingsIntervalDraft(String(normalized.autoRefreshSeconds));
    if (!canUseExtension) {
      setSettingsOpen(false);
      showToast("设置已应用到演示会话");
      return;
    }
    const response = await sendMessage({ type: "PANEL_SAVE_APP_SETTINGS", settings: normalized });
    if (response.ok && "state" in response) {
      setSettingsOpen(false);
      showToast("设置已保存");
    } else if (!response.ok) {
      setError(response.error);
    }
  }

  function exportArchive(): void {
    const projectNotes = scan
      ? {
          ...persistedByProject,
          [scan.projectId]: {
            layoutOffsets,
            nodeNotes,
            nodeMemos,
            nodeLabels,
            branchStyles,
            starredNodeIds
          }
        }
      : persistedByProject;
    const archive = {
      schemaVersion: 1,
      app: "chatgpt-project-branch-tree",
      exportedAt: new Date().toISOString(),
      state: {
        currentScan: scan,
        selectedNodeId,
        projectNotes,
        appSettings
      }
    };
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chatgpt-branch-tree-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importArchive(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const importedState = parsed.state ?? parsed;
      if (!canUseExtension) {
        setPersistedByProject(importedState.projectNotes ?? {});
        setAppSettings(normalizeSettings(importedState.appSettings));
        setSettingsDraft(normalizeSettings(importedState.appSettings));
        showToast("JSON 存档已导入到演示会话");
        return;
      }
      const response = await sendMessage({ type: "PANEL_IMPORT_STATE", state: importedState });
      if (response.ok && "state" in response) {
        setPersistedByProject(response.state.projectNotes ?? {});
        setAppSettings(normalizeSettings(response.state.appSettings));
        setSettingsDraft(normalizeSettings(response.state.appSettings));
        setScan(response.state.currentScan);
        setSelectedNodeId(response.state.selectedNodeId ?? response.state.currentScan?.nodes[0]?.id);
        const projectId = response.state.currentScan?.projectId;
        applyPersistedState(projectId ? response.state.projectNotes?.[projectId] : undefined);
        showToast("JSON 存档已导入");
      } else if (!response.ok) {
        setError(response.error);
      }
    } catch (error) {
      setError(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function clearLocalArchive(): Promise<void> {
    if (!window.confirm("确定清空本地 JSON 存档和所有项目标注吗？")) return;
    if (!canUseExtension) return;
    const response = await sendMessage({ type: "PANEL_CLEAR_STATE" });
    if (response.ok && "state" in response) {
      setPersistedByProject({});
      setAppSettings(normalizeSettings(response.state.appSettings));
      setSettingsDraft(normalizeSettings(response.state.appSettings));
      applyPersistedState(undefined);
      showToast("本地存档已清空");
    } else if (!response.ok) {
      setError(response.error);
    }
  }

  function updateBranchStyle(branchId: string, patch: Partial<BranchStyle>): void {
    setBranchStyles((current) => {
      const previous = current[branchId];
      const nextStyle: BranchStyle = {
        ...previous,
        ...patch,
        color: patch.color ?? previous?.color ?? branchGroups.find((branch) => branch.id === branchId)?.color ?? BRANCH_COLORS[0],
        updatedAt: new Date().toISOString()
      };
      return { ...current, [branchId]: nextStyle };
    });
  }

  function selectBranch(branch: BranchGroup): void {
    setActiveBranchId(branch.id);
    setColorPickerBranchId(undefined);
    setPreviewBranchColor(undefined);
    setSelectedNodeId(branch.focusNode.id);
    treeHandleRef.current?.focus();
  }

  function addSelectedNodeComment(): void {
    if (!selectedNode) return;
    const text = draftComment.trim();
    if (!text) return;
    const comment: NodeComment = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString()
    };
    setNodeNotes((current) => ({
      ...current,
      [selectedNode.id]: [...(current[selectedNode.id] ?? []), comment]
    }));
    setDraftComment("");
  }

  function deleteSelectedNodeComment(commentId: string): void {
    if (!selectedNode) return;
    setNodeNotes((current) => ({
      ...current,
      [selectedNode.id]: (current[selectedNode.id] ?? []).filter((comment) => comment.id !== commentId)
    }));
  }

  function startEditComment(comment: NodeComment): void {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.text);
  }

  function saveEditedComment(): void {
    if (!selectedNode || !editingCommentId) return;
    const text = editingCommentText.trim();
    if (!text) return;
    setNodeNotes((current) => ({
      ...current,
      [selectedNode.id]: (current[selectedNode.id] ?? []).map((comment) =>
        comment.id === editingCommentId ? { ...comment, text, updatedAt: new Date().toISOString() } : comment
      )
    }));
    setEditingCommentId(undefined);
    setEditingCommentText("");
  }

  function cancelEditComment(): void {
    setEditingCommentId(undefined);
    setEditingCommentText("");
  }

  return (
    <main
      className={`app-shell font-${appSettings.fontScale} layout-${appSettings.layoutScale}`}
      style={{ "--theme-color": appSettings.themeColor } as React.CSSProperties}
    >
      <header className="panel-header">
        <div className="brand">
          <div className="brand-mark">
            <FolderTree size={18} strokeWidth={2.25} />
          </div>
          <div>
            <h1>分支树 <span className="version-tag">v{version}</span></h1>
            <p>{scan?.projectName ?? status?.projectName ?? "ChatGPT 项目"}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" title="扫描项目" onClick={scanProject} disabled={busy}>
            {busy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
          <button
            className="icon-button"
            type="button"
            title="设置"
            onClick={() => {
              setSettingsDraft(appSettings);
              setSettingsIntervalDraft(String(appSettings.autoRefreshSeconds));
              setSettingsOpen(true);
            }}
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {error ? (
        <section className="error-banner" role="alert">
          <strong>出错了：</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)}>关闭</button>
        </section>
      ) : null}

      {initializing ? (
        <section className="empty-state">
          <Loader2 className="spin" size={26} />
          <h2>加载中</h2>
          <p>{initMessage}</p>
        </section>
      ) : !status?.isChatGpt && canUseExtension ? (
        <section className="empty-state">
          <FolderTree size={26} />
          <h2>打开 ChatGPT</h2>
          <p>请先打开 ChatGPT 页面，然后在这里选择项目。</p>
        </section>
      ) : (
        <>
          {projectOptions.length > 0 ? (
            <section className="project-picker">
              <label className="project-combobox">
                <span>项目</span>
                <input
                  value={projectDropdownOpen ? projectQuery : selectedProjectName}
                  onChange={(event) => {
                    setProjectQuery(event.currentTarget.value);
                    setProjectDropdownOpen(true);
                  }}
                  onFocus={() => {
                    setProjectQuery("");
                    setProjectDropdownOpen(true);
                  }}
                  onBlur={() => window.setTimeout(() => setProjectDropdownOpen(false), 120)}
                  placeholder="搜索并选择项目"
                />
                {projectDropdownOpen ? (
                  <div className="project-dropdown" role="listbox">
                    {filteredProjects.length > 0 ? (
                      filteredProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          role="option"
                          aria-selected={project.id === selectedProject?.id}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setSelectedProjectId(project.id);
                            setProjectQuery("");
                            setProjectDropdownOpen(false);
                          }}
                        >
                          {project.name}
                        </button>
                      ))
                    ) : (
                      <p>没有匹配项目</p>
                    )}
                  </div>
                ) : null}
              </label>
              <button type="button" title="刷新项目列表" onClick={refreshProjects}>
                <RefreshCw size={14} />
              </button>
            </section>
          ) : (
            <section className="warnings">
              <p>没有在当前 ChatGPT 页面发现项目列表。请展开左侧项目列表后刷新侧边栏。</p>
            </section>
          )}

          <section className="toolbar">
            <label className="search-box">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索提问"
              />
            </label>
            <div className="tool-row">
              <button type="button" title="放大" onClick={() => treeHandleRef.current?.zoomBy(1.18)}>
                <ZoomIn size={15} />
              </button>
              <button type="button" title="缩小" onClick={() => treeHandleRef.current?.zoomBy(0.84)}>
                <ZoomOut size={15} />
              </button>
              <button type="button" title="重置视图" onClick={() => treeHandleRef.current?.reset()}>
                <Crosshair size={15} />
              </button>
            </div>
          </section>

          <section className="workspace-grid">
            {scan ? (
              <aside className="branch-sidebar" aria-label="分支列表">
                <div className="branch-sidebar-head">
                  <span>分支</span>
                  <small>{branchGroups.length} 条</small>
                </div>
                <div className={`branch-list ${colorPickerBranchId ? "picking-color" : ""}`}>
                  {branchGroups.map((branch) => {
                    const active = branch.id === activeBranchId;
                    const branchLabel = branch.style?.label?.trim() || branch.fallbackName;
                    const branchNote = branch.style?.note?.trim();
                    const pickingThisBranch = colorPickerBranchId === branch.id;
                    const displayColor = previewBranchColor?.branchId === branch.id ? previewBranchColor.color : branch.color;
                    return (
                      <article
                        key={branch.id}
                        className={`branch-item ${active ? "active" : ""} ${pickingThisBranch ? "color-target" : ""}`}
                        style={{ "--branch-color": displayColor } as React.CSSProperties}
                      >
                        <div className="branch-row">
                          <button
                            type="button"
                            className="branch-ring-button"
                            title="设置分支颜色"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveBranchId(branch.id);
                              setColorPickerBranchId(branch.id);
                              setPreviewBranchColor(undefined);
                            }}
                          >
                            <span className="branch-ring" />
                            <Palette size={11} />
                          </button>
                          <div
                            className="branch-select"
                            role="button"
                            tabIndex={0}
                            onClick={() => selectBranch(branch)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                selectBranch(branch);
                              }
                            }}
                          >
                            <span className="branch-copy">
                              {editingBranchNameId === branch.id ? (
                                <input
                                  className="branch-inline-input"
                                  value={branch.style?.label ?? ""}
                                  autoFocus
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => updateBranchStyle(branch.id, { label: event.currentTarget.value })}
                                  onBlur={() => setEditingBranchNameId(undefined)}
                                  onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === "Enter") setEditingBranchNameId(undefined);
                                    if (event.key === "Escape") setEditingBranchNameId(undefined);
                                  }}
                                  placeholder={branch.fallbackName}
                                  aria-label="分支名"
                                />
                              ) : (
                                <strong
                                  title="双击编辑分支名"
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    setEditingBranchNameId(branch.id);
                                  }}
                                >
                                  {branchLabel}
                                </strong>
                              )}
                              {editingBranchNoteId === branch.id ? (
                                <textarea
                                  className="branch-inline-note"
                                  value={branch.style?.note ?? ""}
                                  autoFocus
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => updateBranchStyle(branch.id, { note: event.currentTarget.value })}
                                  onBlur={() => setEditingBranchNoteId(undefined)}
                                  onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === "Escape") setEditingBranchNoteId(undefined);
                                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                      setEditingBranchNoteId(undefined);
                                    }
                                  }}
                                  placeholder="给这条分支添加小备注..."
                                  aria-label="分支说明"
                                />
                              ) : (
                                <small
                                  title="双击编辑分支说明"
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    setEditingBranchNoteId(branch.id);
                                  }}
                                >
                                  {branchNote || "双击添加分支说明"}
                                </small>
                              )}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </aside>
            ) : null}

            <section className="tree-card" aria-label="提问树">
              {scan ? (
                <TreeView
                  ref={treeHandleRef}
                  scan={scan}
                  visibleNodeIds={new Set(filteredNodes.map((node) => node.id))}
                  selectedNodeId={selectedNodeId}
                  starredNodeIds={starredNodeIds}
                  activeBranchNodeIds={activeBranchNodeIds}
                  branchColorByNodeId={branchColorByNodeId}
                  nodeLabels={nodeLabelTextById}
                  layoutScale={appSettings.layoutScale}
                  layoutOffsets={layoutOffsets}
                  onLayoutChange={commitLayoutOffsets}
                  onUndoLayout={undoLayoutMove}
                  onRedoLayout={redoLayoutMove}
                  onSelect={navigateToNode}
                  onPreviewSelect={(node) => setSelectedNodeId(node.id)}
                />
              ) : (
                <div className="empty-inline">扫描项目后会生成提问树。</div>
              )}
            </section>
          </section>

          <section className="action-strip">
            <button type="button" title="保存布局和标注" onClick={() => void saveCurrentProjectState()}>
              <Save size={15} />
            </button>
            <button type="button" title="折叠回复" onClick={() => collapseAssistant("collapse")}>
              <Minimize2 size={15} />
            </button>
            <button type="button" title="展开回复" onClick={() => collapseAssistant("expand")}>
              <Maximize2 size={15} />
            </button>
          </section>

          {selectedNode ? (
            <section className="details">
              <div className="details-head node-details-head">
                <div className="node-title-row">
                  {editingNodeLabel ? (
                    <input
                      className="node-title-input"
                      value={nodeLabelDraft}
                      autoFocus
                      onChange={(event) => setNodeLabelDraft(event.currentTarget.value)}
                      onBlur={saveNodeLabel}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveNodeLabel();
                        if (event.key === "Escape") {
                          setNodeLabelDraft(nodeLabels[selectedNode.id]?.text ?? "");
                          setEditingNodeLabel(false);
                        }
                      }}
                      placeholder={selectedNode.promptPreview}
                      aria-label="节点名"
                    />
                  ) : (
                    <h2 title="双击编辑节点名" onDoubleClick={() => setEditingNodeLabel(true)}>
                      {selectedNodeDisplayName}
                    </h2>
                  )}
                  <button
                    className={`star-chip ${starredNodeIds.includes(selectedNode.id) ? "starred" : ""}`}
                    type="button"
                    title={starredNodeIds.includes(selectedNode.id) ? "取消收藏" : "收藏节点"}
                    onClick={toggleSelectedNodeStar}
                  >
                    <Star size={13} />
                    {starredNodeIds.includes(selectedNode.id) ? "已收藏" : "收藏"}
                  </button>
                </div>
                <small className="branch-name-chip">{selectedBranchLabel}</small>
              </div>
              <div className="node-meta">
                <span>提问时间：{formatTimestamp(selectedNode.createdAt)}</span>
                <span>消息 ID：{selectedNode.messageId ?? "无"}</span>
              </div>
              <section className={`memo-line ${memoEditing ? "memo-editing" : ""}`}>
                {!memoEditing ? (
                  <div className="memo-inline-display" title="双击编辑节点说明" onDoubleClick={() => setMemoEditing(true)}>
                    <strong>节点说明：</strong>
                    {nodeMemos[selectedNode.id] ? (
                      <div
                        className="memo-inline-markdown"
                        dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(nodeMemos[selectedNode.id].text) }}
                      />
                    ) : (
                      <span className="empty-inline-note">双击添加节点说明</span>
                    )}
                  </div>
                ) : (
                  <div className="memo-inline-editor">
                    <span>节点说明：</span>
                    <textarea
                      value={memoDraft}
                      onChange={(event) => setMemoDraft(event.currentTarget.value)}
                      placeholder="给这个节点写一段长期说明..."
                    />
                    <div className="memo-editor-actions">
                      <button type="button" onClick={saveNodeMemo}>
                        保存说明
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          setMemoDraft(nodeMemos[selectedNode.id]?.text ?? "");
                          setMemoEditing(false);
                        }}
                      >
                        取消
                      </button>
                      {nodeMemos[selectedNode.id] ? (
                        <button className="secondary" type="button" onClick={deleteNodeMemo}>
                          清空
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
              <div className="details-content">
                <section className="message-section">
                  <div className="message-section-head">
                    <h3>请求</h3>
                  </div>
                  <div className="message-full">{selectedNode.prompt}</div>
                </section>
                <section className="message-section response-section">
                  <h3>回复</h3>
                  <div className="message-full muted-message">
                    {selectedNode.response ?? "当前接口没有返回这个提问对应的助手回复。"}
                  </div>
                </section>
              </div>
              <section className={`comment-panel ${notesCollapsed ? "notes-collapsed" : ""} ${(nodeNotes[selectedNode.id] ?? []).length > 0 ? "comment-has-items" : "comment-empty"}`}>
                <div className="section-head">
                  <div>
                    <h3>笔记</h3>
                    <small>{(nodeNotes[selectedNode.id] ?? []).length} 条</small>
                  </div>
                  <button
                    className="section-toggle"
                    type="button"
                    title={notesCollapsed ? "展开笔记" : "折叠笔记"}
                    onClick={() => setNotesCollapsed((value) => !value)}
                  >
                    {notesCollapsed ? <Plus size={13} /> : <Minus size={13} />}
                  </button>
                </div>
                {!notesCollapsed ? (
                  <>
                    <div className="comment-list">
                      {(nodeNotes[selectedNode.id] ?? []).length === 0 ? (
                        <div className="comment-empty-state">还没有笔记，下面可以添加一条新的笔记。</div>
                      ) : null}
                      {(nodeNotes[selectedNode.id] ?? []).map((comment) => (
                        <article key={comment.id} className="comment-item">
                          <time>{formatTimestamp(comment.updatedAt ?? comment.createdAt)}</time>
                          <div className="comment-actions">
                            {editingCommentId === comment.id ? (
                              <>
                                <button type="button" title="保存" onClick={saveEditedComment}>
                                  <Check size={12} />
                                </button>
                                <button type="button" title="取消" onClick={cancelEditComment}>
                                  <X size={12} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" title="编辑" onClick={() => startEditComment(comment)}>
                                  <Edit3 size={12} />
                                </button>
                                <button type="button" title="删除" onClick={() => deleteSelectedNodeComment(comment.id)}>
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                          {editingCommentId === comment.id ? (
                            <textarea
                              className="comment-edit-textarea"
                              value={editingCommentText}
                              onChange={(event) => setEditingCommentText(event.currentTarget.value)}
                            />
                          ) : (
                            <div
                              className="comment-markdown"
                              dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(comment.text) }}
                            />
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="comment-editor">
                      <textarea
                        value={draftComment}
                        onChange={(event) => setDraftComment(event.currentTarget.value)}
                        placeholder="添加一条笔记、结论或待办..."
                      />
                      <button type="button" onClick={addSelectedNodeComment}>
                        添加笔记
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
              <button type="button" onClick={() => navigateToNode(selectedNode)}>
                打开并高亮
              </button>
            </section>
          ) : null}

          {scan?.warnings.length ? (
            <section className="warnings">
              {scan.warnings.slice(0, 3).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          ) : null}
        </>
      )}

      {colorPickerBranch ? (
        <div
          className="color-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="设置分支颜色"
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              setPreviewBranchColor(undefined);
              setColorPickerBranchId(undefined);
            }
          }}
        >
          <section
            className="color-modal"
            style={{
              "--branch-color": previewBranchColor?.branchId === colorPickerBranch.id
                ? previewBranchColor.color
                : colorPickerBranch.color
            } as React.CSSProperties}
            onMouseLeave={() => setPreviewBranchColor(undefined)}
          >
            <div className="color-modal-head">
              <div>
                <h2>分支颜色</h2>
                <p>{colorPickerBranch.style?.label?.trim() || colorPickerBranch.fallbackName}</p>
              </div>
              <button
                type="button"
                title="关闭颜色设置"
                onClick={() => {
                  setPreviewBranchColor(undefined);
                  setColorPickerBranchId(undefined);
                }}
              >
                <X size={15} />
              </button>
            </div>
            <div className="color-preview-band">
              <span />
              <strong>{previewBranchColor?.color ?? colorPickerBranch.color}</strong>
            </div>
            <div className="color-palette-grid" aria-label="选择分支颜色">
              {BRANCH_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === colorPickerBranch.color ? "selected" : ""}
                  style={{ "--branch-color": color } as React.CSSProperties}
                  title={color}
                  onMouseEnter={() => setPreviewBranchColor({ branchId: colorPickerBranch.id, color })}
                  onClick={() => {
                    updateBranchStyle(colorPickerBranch.id, { color });
                    setPreviewBranchColor(undefined);
                    setColorPickerBranchId(undefined);
                  }}
                >
                  <span />
                </button>
              ))}
            </div>
            <label className="custom-color-row">
              <span>自定义颜色</span>
              <input
                type="color"
                value={colorPickerBranch.color}
                onChange={(event) => {
                  const color = event.currentTarget.value;
                  setPreviewBranchColor({ branchId: colorPickerBranch.id, color });
                  updateBranchStyle(colorPickerBranch.id, { color });
                }}
              />
            </label>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
          <section className="settings-panel">
            <div className="settings-head">
              <div>
                <h2>设置</h2>
                <p>外观、自动更新和本地 JSON 存档</p>
              </div>
              <button type="button" title="关闭设置" onClick={() => setSettingsOpen(false)}>
                <X size={15} />
              </button>
            </div>

            <div className="settings-body">
              <label className="settings-row">
                <span>主题颜色</span>
                <div className="theme-row">
                  {BRANCH_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={settingsDraft.themeColor === color ? "selected" : ""}
                      style={{ "--branch-color": color } as React.CSSProperties}
                      onClick={() => setSettingsDraft((current) => ({ ...current, themeColor: color }))}
                      title={color}
                    />
                  ))}
                  <input
                    type="color"
                    value={settingsDraft.themeColor}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, themeColor: event.currentTarget.value }))
                    }
                  />
                </div>
              </label>

              <label className="settings-row">
                <span>字体大小</span>
                <div className="segmented-control">
                  {(["small", "normal", "large"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={settingsDraft.fontScale === value ? "active" : ""}
                      onClick={() => setSettingsDraft((current) => ({ ...current, fontScale: value }))}
                    >
                      {value === "small" ? "小" : value === "large" ? "大" : "默认"}
                    </button>
                  ))}
                </div>
              </label>

              <label className="settings-row">
                <span>布局密度</span>
                <div className="segmented-control">
                  {(["compact", "normal", "spacious"] as const).map((value: LayoutScale) => (
                    <button
                      key={value}
                      type="button"
                      className={settingsDraft.layoutScale === value ? "active" : ""}
                      onClick={() => setSettingsDraft((current) => ({ ...current, layoutScale: value }))}
                    >
                      {value === "compact" ? "紧凑" : value === "spacious" ? "宽松" : "默认"}
                    </button>
                  ))}
                </div>
              </label>

              <div className="settings-row two-cols">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoRefreshEnabled}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        autoRefreshEnabled: event.currentTarget.checked
                      }))
                    }
                  />
                  <span>自动更新分支/对话</span>
                </label>
                <label className="number-row">
                  <span>间隔秒数</span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={settingsIntervalDraft}
                    onChange={(event) => setSettingsIntervalDraft(event.currentTarget.value)}
                    onBlur={() => {
                      const seconds = normalizeIntervalDraft(settingsIntervalDraft, settingsDraft.autoRefreshSeconds);
                      setSettingsDraft((current) => ({ ...current, autoRefreshSeconds: seconds }));
                      setSettingsIntervalDraft(String(seconds));
                    }}
                  />
                </label>
              </div>

              <section className="archive-panel">
                <div>
                  <h3>本地 JSON 存档</h3>
                  <p>布局、收藏、节点说明、笔记、分支颜色和分支备注都保存在 Chrome 本地存储，可导出为 JSON。</p>
                </div>
                <div className="archive-actions">
                  <button type="button" onClick={exportArchive}>
                    <Download size={14} />
                    导出
                  </button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>
                    <Upload size={14} />
                    导入
                  </button>
                  <button type="button" className="danger" onClick={clearLocalArchive}>
                    <Trash2 size={14} />
                    清空
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => void importArchive(event.currentTarget.files?.[0])}
                  />
                </div>
              </section>
            </div>

            <div className="settings-footer">
              <button type="button" className="secondary" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button type="button" onClick={() => void saveAppSettings()}>
                保存设置
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <div className="toast">{error}</div> : null}
      {toastMessage ? <div className="toast success">{toastMessage}</div> : null}
    </main>
  );
}

function normalizeSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const fontScale = settings?.fontScale === "small" || settings?.fontScale === "large"
    ? settings.fontScale
    : "normal";
  const layoutScale = settings?.layoutScale === "compact" || settings?.layoutScale === "spacious"
    ? settings.layoutScale
    : "normal";
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    themeColor: /^#[0-9a-fA-F]{6}$/.test(settings?.themeColor ?? "")
      ? settings!.themeColor!
      : DEFAULT_SETTINGS.themeColor,
    fontScale,
    layoutScale,
    autoRefreshEnabled: settings?.autoRefreshEnabled ?? DEFAULT_SETTINGS.autoRefreshEnabled,
    autoRefreshSeconds: clampNumber(settings?.autoRefreshSeconds, 5, 120, DEFAULT_SETTINGS.autoRefreshSeconds)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function normalizeIntervalDraft(value: string, fallback: number): number {
  const parsed = Number(value.trim());
  return clampNumber(parsed, 5, 120, fallback);
}

function buildBranchGroups(
  scan: ProjectScan,
  branchStyles: Record<string, BranchStyle>
): BranchGroup[] {
  const groups: BranchGroup[] = [];
  const seenConversationIds = new Set<string>();

  for (const conversation of scan.conversations) {
    if (seenConversationIds.has(conversation.id) || conversation.nodes.length === 0) continue;
    seenConversationIds.add(conversation.id);
    const style = branchStyles[conversation.id];
    const nodes = conversation.nodes;
    groups.push({
      id: conversation.id,
      rootNode: nodes[0],
      focusNode: nodes[nodes.length - 1],
      nodes,
      nodeIds: new Set(nodes.map((node) => node.id)),
      fallbackName: conversation.title || nodes[0].promptPreview,
      color: style?.color ?? BRANCH_COLORS[groups.length % BRANCH_COLORS.length],
      style
    });
  }

  if (groups.length > 0) return groups;

  const byId = new Map(scan.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of scan.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    childrenByParent.set(edge.from, [...(childrenByParent.get(edge.from) ?? []), edge.to]);
    incoming.add(edge.to);
  }

  const roots = scan.nodes.filter((node) => !incoming.has(node.id));
  const visited = new Set<string>();

  function collect(nodeId: string, output: Set<string>): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    output.add(nodeId);
    for (const childId of childrenByParent.get(nodeId) ?? []) collect(childId, output);
  }

  for (const root of roots.length > 0 ? roots : scan.nodes) {
    if (visited.has(root.id)) continue;
    const nodeIds = new Set<string>();
    collect(root.id, nodeIds);
    const nodes = scan.nodes.filter((node) => nodeIds.has(node.id));
    const style = branchStyles[root.id];
    groups.push({
      id: root.id,
      rootNode: root,
      focusNode: nodes[nodes.length - 1] ?? root,
      nodes,
      nodeIds,
      fallbackName: root.conversationTitle || root.promptPreview,
      color: style?.color ?? BRANCH_COLORS[groups.length % BRANCH_COLORS.length],
      style
    });
  }

  return groups;
}

async function sendMessage(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    return await chrome.runtime.sendMessage(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/back\/forward cache|message channel is closed|Extension context invalidated/i.test(message)) {
      return {
        ok: false,
        error: "扩展消息通道被浏览器前进/后退缓存关闭了。请刷新 ChatGPT 标签页后重试。"
      };
    }
    return { ok: false, error: message };
  }
}

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function hasScanChanged(left: ProjectScan | undefined, right: ProjectScan): boolean {
  if (!left) return true;
  if (left.projectId !== right.projectId) return true;
  if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return true;
  const leftNodeKey = left.nodes.map((node) => `${node.id}:${node.responsePreview ?? ""}`).join("|");
  const rightNodeKey = right.nodes.map((node) => `${node.id}:${node.responsePreview ?? ""}`).join("|");
  if (leftNodeKey !== rightNodeKey) return true;
  const leftConversationKey = left.conversations
    .map((conversation) => `${conversation.id}:${conversation.title}:${conversation.nodes.map((node) => node.id).join(",")}`)
    .join("|");
  const rightConversationKey = right.conversations
    .map((conversation) => `${conversation.id}:${conversation.title}:${conversation.nodes.map((node) => node.id).join(",")}`)
    .join("|");
  if (leftConversationKey !== rightConversationKey) return true;
  const leftEdgeKey = left.edges.map((edge) => `${edge.from}>${edge.to}`).join("|");
  const rightEdgeKey = right.edges.map((edge) => `${edge.from}>${edge.to}`).join("|");
  return leftEdgeKey !== rightEdgeKey;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function markdownToSafeHtml(value: string): string {
  const escaped = escapeHtml(value.trim());
  const blocks = escaped.split(/\n{2,}/).map((block) => {
    const lines = block.split(/\n/);
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      const items = lines.map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${inlineMarkdown(lines.join("<br />"))}</p>`;
  });
  return blocks.join("");
}

function inlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

createRoot(document.getElementById("root")!).render(<App />);
