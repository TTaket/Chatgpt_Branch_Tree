import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { BranchEdge, LayoutScale, ProjectScan, QuestionNode } from "../shared/types";

const INITIAL_TRANSFORM = zoomIdentity.translate(20, 26).scale(0.82);

export interface TreeViewHandle {
  zoomBy: (factor: number) => void;
  reset: () => void;
  focus: () => void;
}

interface TreeDatum {
  id: string;
  label: string;
  node?: QuestionNode;
  children: TreeDatum[];
}

interface TreeViewProps {
  scan: ProjectScan;
  visibleNodeIds: Set<string>;
  selectedNodeId?: string;
  starredNodeIds: string[];
  activeBranchNodeIds?: Set<string>;
  branchColorByNodeId?: Record<string, string>;
  nodeLabels?: Record<string, string>;
  layoutScale: LayoutScale;
  layoutOffsets: Record<string, { x: number; y: number }>;
  onLayoutChange: (offsets: Record<string, { x: number; y: number }>) => void;
  onUndoLayout: () => void;
  onRedoLayout: () => void;
  onSelect: (node: QuestionNode) => void;
  onPreviewSelect: (node: QuestionNode) => void;
}

interface PositionedNode {
  point: HierarchyPointNode<TreeDatum>;
  x: number;
  y: number;
}

interface PositionedLink {
  source: PositionedNode;
  target: PositionedNode;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(
  {
    scan,
    visibleNodeIds,
    selectedNodeId,
    starredNodeIds,
    activeBranchNodeIds,
    branchColorByNodeId = {},
    nodeLabels = {},
    layoutScale,
    layoutOffsets,
    onLayoutChange,
    onUndoLayout,
    onRedoLayout,
    onSelect,
    onPreviewSelect
  },
  ref
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const [transform, setTransform] = useState<ZoomTransform>(INITIAL_TRANSFORM);
  const [hovered, setHovered] = useState<QuestionNode | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [selectBox, setSelectBox] = useState<{ x: number; y: number; width: number; height: number } | undefined>();
  const [dragOffsets, setDragOffsets] = useState<Record<string, { x: number; y: number }>>(layoutOffsets);
  const dragOffsetsRef = useRef(dragOffsets);
  const transformRef = useRef(transform);
  const visualLayoutRef = useRef<ReturnType<typeof applyDragOffsets>>({ nodes: [], links: [] });
  
  useEffect(() => {
    dragOffsetsRef.current = dragOffsets;
  }, [dragOffsets]);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const dragRef = useRef<{
    ids: string[];
    startClientX: number;
    startClientY: number;
    startOffsets: Record<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);

  const boxSelectRef = useRef<{
    startClientX: number;
    startClientY: number;
    additive: boolean;
  } | null>(null);

  const layout = useMemo(() => buildLayout(scan, layoutScale, nodeLabels), [layoutScale, nodeLabels, scan]);
  const activeNodeIds = useMemo(
    () => collectActiveChainNodeIds(scan, hovered?.id ?? selectedNodeId),
    [hovered?.id, scan, selectedNodeId]
  );
  const visualLayout = useMemo(() => applyDragOffsets(layout, dragOffsets), [dragOffsets, layout]);

  useEffect(() => {
    visualLayoutRef.current = visualLayout;
  }, [visualLayout]);

  useEffect(() => {
    setDragOffsets(layoutOffsets);
  }, [layoutOffsets, scan.projectId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    setMultiSelectedIds((current) => {
      if (current.has(selectedNodeId)) return current;
      return new Set([selectedNodeId]);
    });
  }, [selectedNodeId, scan.projectId]);

  useEffect(() => {
    if (!svgRef.current) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 2.4])
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = behavior;
    select(svgRef.current)
      .call(behavior)
      .on("wheel.zoom", null)
      .on("mousedown.zoom", null)
      .on("dblclick.zoom", null)
      .call(behavior.transform, transform);
  }, []);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const treeElement = element;
    function onNativeWheel(event: WheelEvent): void {
      event.preventDefault();
      event.stopPropagation();
      treeElement.focus();
      if (event.metaKey || event.ctrlKey) {
        zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
        return;
      }
      panBy(-event.deltaX, -event.deltaY);
    }
    treeElement.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => treeElement.removeEventListener("wheel", onNativeWheel);
  }, []);

  useImperativeHandle(ref, () => ({
    zoomBy(factor: number) {
      zoomBy(factor);
    },
    reset() {
      applyZoomTransform(INITIAL_TRANSFORM);
    },
    focus() {
      wrapRef.current?.focus();
    }
  }));

  return (
    <div
      ref={wrapRef}
      className={`tree-wrap ${focused ? "focused" : ""}`}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={handleKeyDown}
      onPointerDown={() => wrapRef.current?.focus()}
    >
      <svg
        ref={svgRef}
        className="tree-svg"
        role="img"
        aria-label="ChatGPT 项目提问树"
        onPointerDown={startCanvasSelection}
      >
        <g transform={transform.toString()}>
          {visualLayout.links.map((link, index) => {
            const sourceId = link.source.point.data.id;
            const targetId = link.target.point.data.id;
            const kind = edgeKind(scan.edges, sourceId, targetId);
            const hidden = !isVisibleTreeNode(link.target.point.data, visibleNodeIds);
            const branchActive =
              activeBranchNodeIds?.has(sourceId) === true && activeBranchNodeIds?.has(targetId) === true;
            const active = branchActive || (activeNodeIds.has(sourceId) && activeNodeIds.has(targetId));
            const branchDimmed = Boolean(activeBranchNodeIds?.size) && !branchActive;
            const branchColor = branchColorByNodeId[targetId] ?? branchColorByNodeId[sourceId];
            return (
              <path
                key={`${sourceId}-${targetId}-${index}`}
                className={`tree-link ${kind} ${active ? "active" : "quiet"} ${hidden || branchDimmed ? "muted" : ""}`}
                style={branchColor ? { stroke: branchColor } : undefined}
                d={`M${link.source.x},${link.source.y} C${link.source.x},${(link.source.y + link.target.y) / 2} ${link.target.x},${(link.source.y + link.target.y) / 2} ${link.target.x},${link.target.y}`}
              />
            );
          })}
          {visualLayout.nodes.map((positioned, index) => {
            const datum = positioned.point.data;
            const isRoot = !datum.node;
            const selected = datum.node?.id === selectedNodeId;
            const multiSelected = datum.node ? multiSelectedIds.has(datum.node.id) : false;
            const starred = datum.node ? starredNodeIds.includes(datum.node.id) : false;
            const dimmed = !isRoot && !visibleNodeIds.has(datum.id);
            const branchActive = activeBranchNodeIds?.has(datum.id) === true;
            const branchDimmed = !isRoot && Boolean(activeBranchNodeIds?.size) && !branchActive;
            const active = branchActive || activeNodeIds.has(datum.id);
            const branchColor = branchColorByNodeId[datum.id];
            return (
              <g
                key={datum.id}
                className={`tree-node ${isRoot ? "root" : ""} ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${starred ? "starred-node" : ""} ${active ? "active" : "quiet"} ${dimmed || branchDimmed ? "dimmed" : ""}`}
                transform={`translate(${positioned.x},${positioned.y})`}
                onMouseEnter={() => setHovered(datum.node)}
                onMouseLeave={() => setHovered(undefined)}
                onPointerDown={(event) => startNodeDrag(event, datum.id)}
                onClick={(event) => {
                  if (dragRef.current?.moved) return;
                  if (datum.node) handleNodeClick(event, datum.node);
                }}
              >
                <g
                  className="tree-node-float"
                  style={{ "--float-delay": `${(index % 7) * 0.18}s` } as React.CSSProperties}
                >
                  {multiSelected && !isRoot ? <circle className="selection-ring" r={18} /> : null}
                  {starred && !isRoot ? <circle className="star-halo" r={20} /> : null}
                  <circle r={isRoot ? 13 : 10} style={branchColor ? { stroke: branchColor } : undefined} />
                  <text x={0} y={28}>
                    {datum.label}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {selectBox ? (
        <div
          className="tree-selection-box"
          style={{
            left: selectBox.x,
            top: selectBox.y,
            width: selectBox.width,
            height: selectBox.height
          }}
        />
      ) : null}
      {hovered ? (
        <div className="hover-card">
          <strong>{hovered.conversationTitle}</strong>
          <p>{hovered.promptPreview}</p>
          <span>点击节点可打开并高亮原消息</span>
        </div>
      ) : null}
      {multiSelectedIds.size > 1 ? (
        <div className="tree-selection-status">
          已选 {multiSelectedIds.size} 个节点，拖动任一蓝色节点可整体移动
        </div>
      ) : null}
    </div>
  );

  function handleNodeClick(event: React.MouseEvent<SVGGElement>, node: QuestionNode): void {
    if (event.ctrlKey || event.metaKey) {
      setMultiSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        if (next.size === 0) next.add(node.id);
        return next;
      });
      onPreviewSelect(node);
      return;
    }
    setMultiSelectedIds(new Set([node.id]));
    onSelect(node);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    wrapRef.current?.focus();
    if (event.metaKey || event.ctrlKey) {
      zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
      return;
    }
    panBy(-event.deltaX, -event.deltaY);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedoLayout();
      else onUndoLayout();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.15);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(0.87);
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      selectRelativeNode("parent");
      return;
    }
    if (event.key === "]") {
      event.preventDefault();
      selectRelativeNode("single-child");
    }
  }

  function selectRelativeNode(direction: "parent" | "single-child"): void {
    if (!selectedNodeId) return;
    const edge = direction === "parent"
      ? scan.edges.find((candidate) => candidate.to === selectedNodeId)
      : (() => {
          const children = scan.edges.filter((candidate) => candidate.from === selectedNodeId);
          return children.length === 1 ? children[0] : undefined;
        })();
    const targetId = direction === "parent" ? edge?.from : edge?.to;
    if (!targetId) return;
    const target = scan.nodes.find((node) => node.id === targetId);
    if (!target) return;
    setMultiSelectedIds(new Set([target.id]));
    onPreviewSelect(target);
  }

  function zoomBy(factor: number): void {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.scaleBy, factor);
  }

  function panBy(dx: number, dy: number): void {
    const current = transformRef.current;
    applyZoomTransform(zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k));
  }

  function applyZoomTransform(next: ZoomTransform): void {
    if (!svgRef.current || !zoomRef.current) {
      setTransform(next);
      return;
    }
    select(svgRef.current).call(zoomRef.current.transform, next);
  }

  function startNodeDrag(event: React.PointerEvent<SVGGElement>, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    wrapRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = multiSelectedIds.has(id)
      ? [...multiSelectedIds]
      : [id];
    const startOffsets = Object.fromEntries(
      ids.map((nodeId) => [nodeId, dragOffsets[nodeId] ?? { x: 0, y: 0 }])
    );
    dragRef.current = {
      ids,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsets,
      moved: false
    };
    event.currentTarget.addEventListener("pointermove", onNodePointerMove);
    event.currentTarget.addEventListener("pointerup", onNodePointerEnd, { once: true });
    event.currentTarget.addEventListener("pointercancel", onNodePointerEnd, { once: true });
  }

  function onNodePointerMove(event: PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = transformRef.current.k || 1;
    const dx = (event.clientX - drag.startClientX) / scale;
    const dy = (event.clientY - drag.startClientY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    
    const nextOffsets = { ...dragOffsetsRef.current };
    for (const id of drag.ids) {
      const startOffset = drag.startOffsets[id] ?? { x: 0, y: 0 };
      nextOffsets[id] = {
        x: startOffset.x + dx,
        y: startOffset.y + dy
      };
    }
    dragOffsetsRef.current = nextOffsets;
    setDragOffsets(nextOffsets);
  }

  function onNodePointerEnd(event: PointerEvent): void {
    const target = event.currentTarget as SVGGElement;
    target.removeEventListener("pointermove", onNodePointerMove);
    if (dragRef.current?.moved) {
      onLayoutChange(dragOffsetsRef.current);
    }
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }

  function startCanvasSelection(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return;
    if ((event.target as Element).closest(".tree-node")) return;
    event.preventDefault();
    wrapRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    boxSelectRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      additive: event.ctrlKey || event.metaKey
    };
    updateSelectionBox(event.clientX, event.clientY);
    event.currentTarget.addEventListener("pointermove", onCanvasPointerMove);
    event.currentTarget.addEventListener("pointerup", onCanvasPointerEnd, { once: true });
    event.currentTarget.addEventListener("pointercancel", onCanvasPointerEnd, { once: true });
  }

  function onCanvasPointerMove(event: PointerEvent): void {
    if (!boxSelectRef.current) return;
    updateSelectionBox(event.clientX, event.clientY);
  }

  function onCanvasPointerEnd(event: PointerEvent): void {
    const target = event.currentTarget as SVGSVGElement;
    target.removeEventListener("pointermove", onCanvasPointerMove);
    const box = boxSelectRef.current;
    boxSelectRef.current = null;
    setSelectBox(undefined);
    if (!box || !wrapRef.current || !svgRef.current) return;
    if (Math.abs(event.clientX - box.startClientX) < 4 && Math.abs(event.clientY - box.startClientY) < 4) return;

    const wrapRect = wrapRef.current.getBoundingClientRect();
    const svgRect = svgRef.current.getBoundingClientRect();
    const left = Math.min(box.startClientX, event.clientX) - wrapRect.left;
    const right = Math.max(box.startClientX, event.clientX) - wrapRect.left;
    const top = Math.min(box.startClientY, event.clientY) - wrapRect.top;
    const bottom = Math.max(box.startClientY, event.clientY) - wrapRect.top;
    const selectedIds = new Set<string>();
    for (const positioned of visualLayoutRef.current.nodes) {
      const node = positioned.point.data.node;
      if (!node || !visibleNodeIds.has(node.id)) continue;
      const x = svgRect.left - wrapRect.left + transformRef.current.applyX(positioned.x);
      const y = svgRect.top - wrapRect.top + transformRef.current.applyY(positioned.y);
      if (x >= left && x <= right && y >= top && y <= bottom) {
        selectedIds.add(node.id);
      }
    }
    if (selectedIds.size === 0) return;
    setMultiSelectedIds((current) => {
      const next = box.additive ? new Set(current) : new Set<string>();
      selectedIds.forEach((id) => next.add(id));
      return next;
    });
    const first = scan.nodes.find((node) => selectedIds.has(node.id));
    if (first) onPreviewSelect(first);
  }

  function updateSelectionBox(clientX: number, clientY: number): void {
    if (!boxSelectRef.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const left = Math.min(boxSelectRef.current.startClientX, clientX) - rect.left;
    const top = Math.min(boxSelectRef.current.startClientY, clientY) - rect.top;
    const width = Math.abs(clientX - boxSelectRef.current.startClientX);
    const height = Math.abs(clientY - boxSelectRef.current.startClientY);
    setSelectBox({ x: left, y: top, width, height });
  }
});

function buildLayout(scan: ProjectScan, layoutScale: LayoutScale, nodeLabels: Record<string, string>): {
  nodes: PositionedNode[];
  links: PositionedLink[];
} {
  const root = hierarchy(buildTreeDatum(scan, nodeLabels));
  const scale = layoutScale === "compact" ? 0.82 : layoutScale === "spacious" ? 1.18 : 1;
  const laidOut = tree<TreeDatum>().nodeSize([180 * scale, 96 * scale])(root);
  const visiblePoints = laidOut.descendants();
  if (visiblePoints.length === 0) return { nodes: [], links: [] };
  const minX = Math.min(...visiblePoints.map((point) => point.x));
  const minY = Math.min(...visiblePoints.map((point) => point.y));
  const positionedById = new Map<string, PositionedNode>();
  for (const point of visiblePoints) {
    positionedById.set(point.data.id, {
      point,
      x: point.x - minX + 190,
      y: point.y - minY + 44
    });
  }
  const links = scan.edges
    .map((edge) => ({
      source: positionedById.get(edge.from),
      target: positionedById.get(edge.to)
    }))
    .filter((link): link is PositionedLink => Boolean(link.source && link.target));

  // Add links from project root to the roots of each conversation
  const rootNode = positionedById.get("__project_root__");
  if (rootNode) {
    for (const point of visiblePoints) {
      if (point.parent?.data.id === "__project_root__") {
        const target = positionedById.get(point.data.id);
        if (target) {
          links.push({ source: rootNode, target });
        }
      }
    }
  }

  return {
    nodes: [...positionedById.values()],
    links
  };
}

function buildTreeDatum(scan: ProjectScan, nodeLabels: Record<string, string>): TreeDatum {
  const byId = new Map(scan.nodes.map((node) => [node.id, node]));
  
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of scan.nodes) {
    outEdges.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  
  for (const edge of scan.edges) {
    if (outEdges.has(edge.from) && byId.has(edge.to)) {
      outEdges.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
    }
  }

  const roots: QuestionNode[] = [];
  for (const node of scan.nodes) {
    if (inDegree.get(node.id) === 0) {
      roots.push(node);
    }
  }

  const visited = new Set<string>();
  const treeChildren = new Map<string, string[]>();

  function traverse(nodeId: string) {
    visited.add(nodeId);
    const children: string[] = [];
    for (const childId of outEdges.get(nodeId) || []) {
      if (!visited.has(childId)) {
        children.push(childId);
        traverse(childId);
      }
    }
    treeChildren.set(nodeId, children);
  }

  for (const root of roots) {
    if (!visited.has(root.id)) {
      traverse(root.id);
    }
  }

  for (const node of scan.nodes) {
    if (!visited.has(node.id)) {
      roots.push(node);
      traverse(node.id);
    }
  }

  function buildDatum(nodeId: string): TreeDatum {
    const node = byId.get(nodeId)!;
    const label = nodeLabels[node.id]?.trim() || node.promptPreview;
    return {
      id: node.id,
      label: truncateLabel(label, 34),
      node,
      children: (treeChildren.get(nodeId) || []).map(buildDatum)
    };
  }

  return {
    id: "__project_root__",
    label: truncateLabel(scan.projectName, 28),
    children: roots.map((root) => buildDatum(root.id))
  };
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function edgeKind(edges: BranchEdge[], from: string, to: string): BranchEdge["kind"] {
  return edges.find((edge) => edge.from === from && edge.to === to)?.kind ?? "inferred";
}

function isVisibleTreeNode(datum: TreeDatum, visibleNodeIds: Set<string>): boolean {
  return !datum.node || visibleNodeIds.has(datum.id);
}

function collectActiveChainNodeIds(scan: ProjectScan, focusId: string | undefined): Set<string> {
  if (!focusId) return new Set();
  const parentByChild = new Map<string, string>();
  for (const edge of scan.edges) {
    if (!parentByChild.has(edge.to)) parentByChild.set(edge.to, edge.from);
  }
  for (const node of scan.nodes) {
    if (!parentByChild.has(node.id)) {
      parentByChild.set(node.id, "__project_root__");
    }
  }
  
  const active = new Set<string>([focusId]);
  let cursor = focusId;
  while (parentByChild.has(cursor)) {
    const parent = parentByChild.get(cursor)!;
    if (active.has(parent)) break;
    active.add(parent);
    cursor = parent;
  }
  return active;
}

function applyDragOffsets(
  layout: ReturnType<typeof buildLayout>,
  offsets: Record<string, { x: number; y: number }>
): ReturnType<typeof buildLayout> {
  const nodes = layout.nodes.map((node) => {
    const offset = offsets[node.point.data.id] ?? { x: 0, y: 0 };
    return { ...node, x: node.x + offset.x, y: node.y + offset.y };
  });
  const byId = new Map(nodes.map((node) => [node.point.data.id, node]));
  return {
    nodes,
    links: layout.links
      .map((link) => ({
        source: byId.get(link.source.point.data.id),
        target: byId.get(link.target.point.data.id)
      }))
      .filter((link): link is PositionedLink => Boolean(link.source && link.target))
  };
}
