import type {
  BranchEdge,
  DomConversationSnapshot,
  InternalConversation,
  InternalMessage,
  ProjectConversation,
  ProjectScan,
  QuestionNode,
  SourceMode
} from "./types";
import { fingerprintText, previewText, stableId } from "./text";
import { chatUrlForConversation } from "./url";

export function scanFromDomSnapshot(snapshot: DomConversationSnapshot): ProjectScan {
  const nodes: QuestionNode[] = snapshot.userMessages.map((message, index) => {
    const nodeId = stableId([
      "dom",
      message.conversationId ?? snapshot.conversationId,
      message.messageId ?? fingerprintText(message.text),
      index
    ]);
    return {
      id: nodeId,
      conversationId: message.conversationId ?? snapshot.conversationId,
      conversationTitle: message.conversationTitle ?? snapshot.conversationTitle,
      messageId: message.messageId,
      parentId: undefined,
      prompt: message.text,
      promptPreview: previewText(message.text),
      fingerprint: fingerprintText(message.text),
      url: message.url ?? snapshot.conversationUrl,
      source: "dom",
      index,
      createdAt: message.createdAt
    };
  });

  const edges: BranchEdge[] = [];
  for (const conversation of groupDomNodesIntoConversations(nodes, snapshot)) {
    const nodeByMessageId = new Map(
      conversation.nodes
        .filter((node) => node.messageId)
        .map((node) => [node.messageId as string, node])
    );
    for (let index = 1; index < conversation.nodes.length; index += 1) {
      const rawMessage = snapshot.userMessages.find(
        (message) => message.messageId === conversation.nodes[index].messageId
      );
      const explicitParent = rawMessage?.parentMessageId
        ? nodeByMessageId.get(rawMessage.parentMessageId)
        : undefined;
      if (explicitParent) {
        conversation.nodes[index].parentId = explicitParent.id;
        edges.push({
          from: explicitParent.id,
          to: conversation.nodes[index].id,
          kind: "observed"
        });
        continue;
      }
      edges.push({
        from: conversation.nodes[index - 1].id,
        to: conversation.nodes[index].id,
        kind: "inferred"
      });
    }
  }

  return {
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    isProject: true,
    sourceMode: "dom",
    conversations: groupDomNodesIntoConversations(nodes, snapshot),
    nodes,
    edges,
    warnings: [
      ...snapshot.warnings,
      "页面兜底模式只扫描当前已加载对话中的消息，连线会按消息顺序推断。"
    ],
    scannedUrl: snapshot.conversationUrl,
    lastScanAt: new Date().toISOString()
  };
}

function groupDomNodesIntoConversations(
  nodes: QuestionNode[],
  snapshot: DomConversationSnapshot
): ProjectConversation[] {
  const byConversation = new Map<string, ProjectConversation>();
  for (const node of nodes) {
    const conversation = byConversation.get(node.conversationId) ?? {
      id: node.conversationId,
      title: node.conversationTitle,
      url: node.url || snapshot.conversationUrl,
      nodes: []
    };
    conversation.nodes.push(node);
    byConversation.set(node.conversationId, conversation);
  }
  if (byConversation.size > 0) return [...byConversation.values()];
  return [
    {
      id: snapshot.conversationId,
      title: snapshot.conversationTitle,
      url: snapshot.conversationUrl,
      nodes: []
    }
  ];
}

export function scanFromInternalConversations(params: {
  projectId: string;
  projectName: string;
  conversations: InternalConversation[];
  scannedUrl: string;
  warnings?: string[];
}): ProjectScan {
  const globalMessages = new Map<string, InternalMessage>();
  const messageConversationIds = new Map<string, Set<string>>();
  const conversationById = new Map(params.conversations.map((conversation, index) => [
    conversation.id,
    { conversation, index }
  ]));

  for (const conversation of params.conversations) {
    for (const message of Object.values(conversation.mapping ?? {})) {
      const existing = globalMessages.get(message.id);
      globalMessages.set(message.id, mergeInternalMessage(existing, message));
      const owners = messageConversationIds.get(message.id) ?? new Set<string>();
      owners.add(conversation.id);
      messageConversationIds.set(message.id, owners);
    }
  }
  const childIdsByParent = buildChildIndex(globalMessages);
  const responseCandidatesByMessageId = collectConversationResponseCandidates(params.conversations);

  const userMessages = [...globalMessages.values()].filter(isVisibleUserMessage);
  const parentUserOf = new Map<string, string | undefined>();
  for (const message of userMessages) {
    const parentUserId = message.parentId
      ? findNearestVisibleUserAncestor(globalMessages, message.parentId)
      : undefined;
    parentUserOf.set(message.id, parentUserId && parentUserId !== message.id ? parentUserId : undefined);
  }

  const orderedUserMessages = topoSortUserMessages(userMessages, parentUserOf);
  const nodeByMessageId = new Map<string, QuestionNode>();
  const nodes: QuestionNode[] = orderedUserMessages.map<QuestionNode>((message, index) => {
    const owner = pickMessageOwner(message.id, messageConversationIds, conversationById);
    const conversation = owner?.conversation;
    const conversationId = conversation?.id ?? params.conversations[0]?.id ?? "unknown";
    const conversationTitle = conversation?.title || "Untitled chat";
    const id = stableId(["internal", message.id]);
    const response = pickLongestText([
      findAssistantResponse(globalMessages, childIdsByParent, message.id),
      ...(responseCandidatesByMessageId.get(message.id) ?? [])
    ]);
    const node: QuestionNode = {
      id,
      conversationId,
      conversationTitle,
      messageId: message.id,
      parentId: undefined,
      prompt: message.text,
      promptPreview: previewText(message.text),
      response,
      responsePreview: response ? previewText(response) : undefined,
      fingerprint: fingerprintText(message.text),
      url: conversation?.url ?? chatUrlForConversation(conversationId),
      source: "internal",
      index,
      createdAt: message.createdAt
    };
    nodeByMessageId.set(message.id, node);
    return node;
  });

  const edges: BranchEdge[] = [];

  for (const node of nodes) {
    if (!node.messageId) continue;
    const parentMessageId = parentUserOf.get(node.messageId);
    if (!parentMessageId) continue;
    const parentNode = nodeByMessageId.get(parentMessageId);
    if (!parentNode || parentNode.id === node.id) continue;
    node.parentId = parentNode.id;
    edges.push({ from: parentNode.id, to: node.id, kind: "observed" });
  }

  const globalIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const conversations: ProjectConversation[] = params.conversations.map((conversation) => {
    const conversationNodes = Object.values(conversation.mapping ?? {})
      .filter(isVisibleUserMessage)
      .map((message) => nodeByMessageId.get(message.id))
      .filter((node): node is QuestionNode => Boolean(node))
      .filter(uniqueByNodeId)
      .sort((left, right) => (globalIndex.get(left.id) ?? 0) - (globalIndex.get(right.id) ?? 0));

    return {
      id: conversation.id,
      title: conversation.title || "Untitled chat",
      url: conversation.url ?? chatUrlForConversation(conversation.id),
      nodes: conversationNodes
    };
  });

  const sourceMode: SourceMode = params.conversations.length > 0 ? "internal" : "none";

  return {
    projectId: params.projectId,
    projectName: params.projectName,
    isProject: true,
    sourceMode,
    conversations,
    nodes,
    edges,
    warnings: params.warnings ?? [],
    scannedUrl: params.scannedUrl,
    lastScanAt: new Date().toISOString()
  };
}

function mergeInternalMessage(
  existing: InternalMessage | undefined,
  incoming: InternalMessage
): InternalMessage {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    text: incoming.text.trim() ? incoming.text : existing.text,
    parentId: incoming.parentId ?? existing.parentId,
    childrenIds: [...new Set([...existing.childrenIds, ...incoming.childrenIds])],
    createdAt: incoming.createdAt ?? existing.createdAt,
    isUserSystemMessage: existing.isUserSystemMessage === true || incoming.isUserSystemMessage === true
  };
}

function isVisibleUserMessage(message: InternalMessage): boolean {
  return (
    message.authorRole === "user" &&
    message.isUserSystemMessage !== true &&
    message.text.trim().length > 0
  );
}

function pickMessageOwner(
  messageId: string,
  messageConversationIds: Map<string, Set<string>>,
  conversationById: Map<string, { conversation: InternalConversation; index: number }>
): { conversation: InternalConversation; index: number } | undefined {
  const candidateIds = [...(messageConversationIds.get(messageId) ?? [])];
  return candidateIds
    .map((id) => conversationById.get(id))
    .filter((entry): entry is { conversation: InternalConversation; index: number } => Boolean(entry))
    .sort(compareConversationOwner)[0];
}

function compareConversationOwner(
  left: { conversation: InternalConversation; index: number },
  right: { conversation: InternalConversation; index: number }
): number {
  const leftTime = left.conversation.createdAt ? Date.parse(left.conversation.createdAt) : Number.NaN;
  const rightTime = right.conversation.createdAt ? Date.parse(right.conversation.createdAt) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }
  return left.index - right.index;
}

function uniqueByNodeId(
  node: QuestionNode,
  index: number,
  list: QuestionNode[]
): boolean {
  return list.findIndex((candidate) => candidate.id === node.id) === index;
}

function findNearestVisibleUserAncestor(
  mapping: Map<string, InternalMessage>,
  startId: string
): string | undefined {
  let cursor: string | undefined = startId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const message = mapping.get(cursor);
    if (!message) return undefined;
    if (isVisibleUserMessage(message)) return message.id;
    cursor = message.parentId;
  }
  return undefined;
}

function findAssistantResponse(
  mapping: Map<string, InternalMessage>,
  childIdsByParent: Map<string, string[]>,
  userMessageId: string
): string | undefined {
  const queue = sortMessageIds(mapping, childIdsByParent.get(userMessageId) ?? []);
  const candidates: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0 && seen.size < 250) {
    const childId = queue.shift()!;
    if (seen.has(childId)) continue;
    seen.add(childId);
    const child = mapping.get(childId);
    if (!child) continue;

    if (child.authorRole === "assistant" && child.text.trim()) {
      candidates.push(child.text);
    }
    if (isVisibleUserMessage(child)) continue;
    queue.push(...sortMessageIds(mapping, childIdsByParent.get(child.id) ?? []));
  }

  return pickLongestText(candidates);
}

function collectConversationResponseCandidates(
  conversations: InternalConversation[]
): Map<string, string[]> {
  const candidatesByUserId = new Map<string, string[]>();
  for (const conversation of conversations) {
    const messages = Object.values(conversation.mapping ?? {});
    if (messages.length === 0) continue;

    const mapping = new Map(messages.map((message) => [message.id, message]));
    const childIdsByParent = buildChildIndex(mapping);
    const orderedMessages = orderConversationMessages(messages);
    const activePathMessages = orderConversationPathMessages(mapping, conversation.currentNodeId);

    for (const message of orderedMessages) {
      if (!isVisibleUserMessage(message)) continue;
      const candidates = [
        findAssistantResponse(mapping, childIdsByParent, message.id),
        findAssistantResponseBySequence(activePathMessages, message.id),
        findAssistantResponseBySequence(orderedMessages, message.id)
      ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
      if (candidates.length === 0) continue;
      const existing = candidatesByUserId.get(message.id) ?? [];
      candidatesByUserId.set(message.id, [...existing, ...candidates]);
    }
  }
  return candidatesByUserId;
}

function findAssistantResponseBySequence(
  orderedMessages: InternalMessage[],
  userMessageId: string
): string | undefined {
  const userIndex = orderedMessages.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) return undefined;
  const candidates: string[] = [];

  for (let index = userIndex + 1; index < orderedMessages.length; index += 1) {
    const message = orderedMessages[index];
    if (isVisibleUserMessage(message)) break;
    if (message.authorRole === "assistant" && message.text.trim()) {
      candidates.push(message.text);
    }
  }

  return pickLongestText(candidates);
}

function orderConversationMessages(messages: InternalMessage[]): InternalMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = left.message.createdAt ? Date.parse(left.message.createdAt) : Number.NaN;
      const rightTime = right.message.createdAt ? Date.parse(right.message.createdAt) : Number.NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
        return Number.isFinite(leftTime) ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function orderConversationPathMessages(
  mapping: Map<string, InternalMessage>,
  currentNodeId: string | undefined
): InternalMessage[] {
  if (!currentNodeId) return [];
  const path: InternalMessage[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = currentNodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const message = mapping.get(cursor);
    if (!message) break;
    path.push(message);
    cursor = message.parentId;
  }
  return path.reverse();
}

function pickLongestText(values: Array<string | undefined>): string | undefined {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0];
}

function sortMessageIds(mapping: Map<string, InternalMessage>, ids: string[]): string[] {
  return [...ids].sort((left, right) => {
    const leftMessage = mapping.get(left);
    const rightMessage = mapping.get(right);
    const leftTime = leftMessage?.createdAt ? Date.parse(leftMessage.createdAt) : Number.NaN;
    const rightTime = rightMessage?.createdAt ? Date.parse(rightMessage.createdAt) : Number.NaN;
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.localeCompare(right);
  });
}

function buildChildIndex(mapping: Map<string, InternalMessage>): Map<string, string[]> {
  const byParent = new Map<string, Set<string>>();
  for (const message of mapping.values()) {
    if (message.parentId) {
      const siblings = byParent.get(message.parentId) ?? new Set<string>();
      siblings.add(message.id);
      byParent.set(message.parentId, siblings);
    }
    for (const childId of message.childrenIds) {
      const siblings = byParent.get(message.id) ?? new Set<string>();
      siblings.add(childId);
      byParent.set(message.id, siblings);
    }
  }
  return new Map([...byParent.entries()].map(([parentId, childIds]) => [parentId, [...childIds]]));
}

function topoSortUserMessages(
  userMessages: import("./types").InternalMessage[],
  parentUserOf: Map<string, string | undefined>
): import("./types").InternalMessage[] {
  const byId = new Map(userMessages.map((m) => [m.id, m]));
  const childrenOf = new Map<string | undefined, string[]>();
  for (const u of userMessages) {
    const p = parentUserOf.get(u.id);
    const list = childrenOf.get(p) ?? [];
    list.push(u.id);
    childrenOf.set(p, list);
  }

  const sortChildren = (ids: string[]): string[] =>
    ids.sort((l, r) => {
      const ml = byId.get(l)!;
      const mr = byId.get(r)!;
      const tl = ml.createdAt ? Date.parse(ml.createdAt) : Number.NaN;
      const tr = mr.createdAt ? Date.parse(mr.createdAt) : Number.NaN;
      if (Number.isFinite(tl) && Number.isFinite(tr) && tl !== tr) return tl - tr;
      return ml.id.localeCompare(mr.id);
    });

  const out: import("./types").InternalMessage[] = [];
  const visited = new Set<string>();

  function dfs(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const m = byId.get(id);
    if (m) out.push(m);
    const kids = sortChildren([...(childrenOf.get(id) ?? [])]);
    for (const k of kids) dfs(k);
  }

  for (const rootId of sortChildren([...(childrenOf.get(undefined) ?? [])])) {
    dfs(rootId);
  }
  // Any leftover (should not happen) – append at end to avoid data loss.
  for (const u of userMessages) if (!visited.has(u.id)) out.push(u);
  return out;
}

export function mergeScans(preferred: ProjectScan | undefined, fallback: ProjectScan): ProjectScan {
  if (!preferred || preferred.nodes.length === 0) return fallback;
  
  const preferredFingerprints = new Set(preferred.nodes.map((node) => node.fingerprint));
  const extraFallbackNodes = fallback.nodes.filter(
    (node) => !preferredFingerprints.has(node.fingerprint)
  );
  
  const allNodes = [...preferred.nodes, ...extraFallbackNodes];
  const allNodeIds = new Set(allNodes.map((n) => n.id));
  
  return {
    ...preferred,
    sourceMode: extraFallbackNodes.length > 0 ? "mixed" : preferred.sourceMode,
    conversations: [...preferred.conversations, ...fallback.conversations.filter(
      (fc) => !preferred.conversations.some((pc) => pc.id === fc.id)
    )],
    nodes: allNodes,
    edges: [
      ...preferred.edges,
      ...fallback.edges.filter((edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to))
    ],
    warnings: [...preferred.warnings, ...fallback.warnings]
  };
}

export function preserveFailedConversationBranches(
  incoming: ProjectScan,
  previous: ProjectScan | undefined
): ProjectScan {
  if (!previous || previous.projectId !== incoming.projectId) return incoming;
  const hasBranchReadFailure = incoming.warnings.some((warning) =>
    /对话「.+」读取失败|分支.+读取失败|拉取失败/.test(warning)
  );
  if (!hasBranchReadFailure) return incoming;

  const incomingConversationIds = new Set(incoming.conversations.map((conversation) => conversation.id));
  const missingPreviousConversations = previous.conversations.filter(
    (conversation) => !incomingConversationIds.has(conversation.id)
  );
  if (missingPreviousConversations.length === 0) return incoming;

  const merged = mergeScans(incoming, previous);
  return {
    ...merged,
    warnings: [
      ...incoming.warnings,
      `部分分支拉取失败，已保留上次缓存的 ${missingPreviousConversations.length} 条分支。`
    ]
  };
}
