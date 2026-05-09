import { describe, expect, it } from "vitest";
import type { DomConversationSnapshot, InternalConversation } from "../src/shared/types";
import { scanFromDomSnapshot, scanFromInternalConversations } from "../src/shared/tree";
import { fingerprintText } from "../src/shared/text";

describe("tree builders", () => {
  it("marks DOM fallback edges as inferred", () => {
    const snapshot: DomConversationSnapshot = {
      projectId: "p1",
      projectName: "Project",
      conversationId: "c1",
      conversationTitle: "Chat",
      conversationUrl: "https://chatgpt.com/c/c1",
      warnings: [],
      userMessages: [
        { messageId: "u1", text: "First question" },
        { messageId: "u2", text: "Second question" }
      ]
    };

    const scan = scanFromDomSnapshot(snapshot);

    expect(scan.sourceMode).toBe("dom");
    expect(scan.nodes).toHaveLength(2);
    expect(scan.edges).toEqual([{ from: scan.nodes[0].id, to: scan.nodes[1].id, kind: "inferred" }]);
  });

  it("does not connect independent project homepage conversations", () => {
    const snapshot: DomConversationSnapshot = {
      projectId: "p1",
      projectName: "Project",
      conversationId: "project-home",
      conversationTitle: "Project",
      conversationUrl: "https://chatgpt.com/g/p1/project",
      warnings: [],
      userMessages: [
        {
          conversationId: "c1",
          conversationTitle: "Chat 1",
          url: "https://chatgpt.com/c/c1",
          messageId: "row-1",
          text: "Independent chat one"
        },
        {
          conversationId: "c2",
          conversationTitle: "Chat 2",
          url: "https://chatgpt.com/c/c2",
          messageId: "row-2",
          text: "Independent chat two"
        }
      ]
    };

    const scan = scanFromDomSnapshot(snapshot);

    expect(scan.conversations).toHaveLength(2);
    expect(scan.edges).toHaveLength(0);
  });

  it("keeps inferred edges inside the same conversation only", () => {
    const snapshot: DomConversationSnapshot = {
      projectId: "p1",
      projectName: "Project",
      conversationId: "c1",
      conversationTitle: "Chat",
      conversationUrl: "https://chatgpt.com/c/c1",
      warnings: [],
      userMessages: [
        { conversationId: "c1", messageId: "u1", text: "First" },
        { conversationId: "c1", messageId: "u2", text: "Second" },
        { conversationId: "c2", messageId: "u3", text: "Other root" }
      ]
    };

    const scan = scanFromDomSnapshot(snapshot);

    expect(scan.edges).toEqual([{ from: scan.nodes[0].id, to: scan.nodes[1].id, kind: "inferred" }]);
  });

  it("uses DOM branch marker parentage before sequential fallback", () => {
    const snapshot: DomConversationSnapshot = {
      projectId: "p1",
      projectName: "Project",
      conversationId: "c1",
      conversationTitle: "Chat",
      conversationUrl: "https://chatgpt.com/c/c1",
      warnings: [],
      userMessages: [
        { messageId: "root-2", text: "root 分支 node 2" },
        { messageId: "root-3", text: "root 分支 node 3" },
        { messageId: "dev-1", parentMessageId: "root-3", text: "dev 分支 node 1" }
      ]
    };

    const scan = scanFromDomSnapshot(snapshot);

    expect(scan.edges).toEqual([
      { from: scan.nodes[0].id, to: scan.nodes[1].id, kind: "inferred" },
      { from: scan.nodes[1].id, to: scan.nodes[2].id, kind: "observed" }
    ]);
  });

  it("can filter internal conversations by project conversation ids before merging", () => {
    const allowedIds = new Set(["project-1", "project-2"]);
    const conversations: InternalConversation[] = [
      { id: "project-1", title: "Project chat", mapping: {} },
      { id: "recent-1", title: "Recent chat", mapping: {} }
    ];

    expect(conversations.filter((conversation) => allowedIds.has(conversation.id)).map((c) => c.id)).toEqual([
      "project-1"
    ]);
  });

  it("uses internal parent mapping for observed edges", () => {
    const conversation: InternalConversation = {
      id: "c1",
      title: "Chat",
      mapping: {
        u1: {
          id: "u1",
          authorRole: "user",
          text: "Root question",
          childrenIds: ["a1"]
        },
        a1: {
          id: "a1",
          authorRole: "assistant",
          text: "Answer",
          parentId: "u1",
          childrenIds: ["u2"]
        },
        u2: {
          id: "u2",
          authorRole: "user",
          text: "Follow up",
          parentId: "a1",
          childrenIds: []
        }
      }
    };

    const scan = scanFromInternalConversations({
      projectId: "p1",
      projectName: "Project",
      conversations: [conversation],
      scannedUrl: "https://chatgpt.com/c/c1"
    });

    expect(scan.sourceMode).toBe("internal");
    expect(scan.nodes.map((node) => node.prompt)).toEqual(["Root question", "Follow up"]);
    expect(scan.nodes[0].response).toBe("Answer");
    expect(scan.edges[0]).toMatchObject({ kind: "observed" });
  });

  it("finds assistant replies through intermediate non-user mapping nodes", () => {
    const conversation: InternalConversation = {
      id: "c1",
      title: "Chat",
      mapping: {
        u1: {
          id: "u1",
          authorRole: "user",
          text: "Question",
          childrenIds: ["tool-1"]
        },
        "tool-1": {
          id: "tool-1",
          authorRole: "tool",
          text: "",
          parentId: "u1",
          childrenIds: ["a-short", "a-final"]
        },
        "a-short": {
          id: "a-short",
          authorRole: "assistant",
          text: "Thinking",
          parentId: "tool-1",
          childrenIds: []
        },
        "a-final": {
          id: "a-final",
          authorRole: "assistant",
          text: "This is the complete assistant reply.",
          parentId: "tool-1",
          childrenIds: []
        }
      }
    };

    const scan = scanFromInternalConversations({
      projectId: "p1",
      projectName: "Project",
      conversations: [conversation],
      scannedUrl: "https://chatgpt.com/c/c1"
    });

    expect(scan.nodes).toHaveLength(1);
    expect(scan.nodes[0].response).toBe("This is the complete assistant reply.");
  });

  it("falls back to same-conversation message order when assistant parent links are missing", () => {
    const conversation: InternalConversation = {
      id: "c1",
      title: "Chat",
      mapping: {
        u1: {
          id: "u1",
          authorRole: "user",
          text: "Question with broken children",
          childrenIds: [],
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        a1: {
          id: "a1",
          authorRole: "assistant",
          text: "Reply recovered from sequence",
          childrenIds: [],
          createdAt: "2026-01-01T00:00:01.000Z"
        },
        u2: {
          id: "u2",
          authorRole: "user",
          text: "Next question",
          childrenIds: [],
          createdAt: "2026-01-01T00:00:02.000Z"
        },
        a2: {
          id: "a2",
          authorRole: "assistant",
          text: "Next reply",
          childrenIds: [],
          createdAt: "2026-01-01T00:00:03.000Z"
        }
      }
    };

    const scan = scanFromInternalConversations({
      projectId: "p1",
      projectName: "Project",
      conversations: [conversation],
      scannedUrl: "https://chatgpt.com/c/c1"
    });

    expect(scan.nodes.map((node) => node.response)).toEqual([
      "Reply recovered from sequence",
      "Next reply"
    ]);
  });

  it("merges shared internal message ids into one project-level branch tree", () => {
    const sharedRoot = {
      id: "u-root",
      authorRole: "user" as const,
      text: "Root question",
      childrenIds: ["a-root"]
    };
    const sharedAnswer = {
      id: "a-root",
      authorRole: "assistant" as const,
      text: "Answer",
      parentId: "u-root",
      childrenIds: ["u-left", "u-right"]
    };
    const conversations: InternalConversation[] = [
      {
        id: "c-left",
        title: "Original",
        createdAt: "2026-01-01T00:00:00.000Z",
        mapping: {
          "u-root": sharedRoot,
          "a-root": sharedAnswer,
          "u-left": {
            id: "u-left",
            authorRole: "user",
            text: "Left branch",
            parentId: "a-root",
            childrenIds: []
          }
        }
      },
      {
        id: "c-right",
        title: "Fork",
        createdAt: "2026-01-02T00:00:00.000Z",
        mapping: {
          "u-root": sharedRoot,
          "a-root": sharedAnswer,
          "u-right": {
            id: "u-right",
            authorRole: "user",
            text: "Right branch",
            parentId: "a-root",
            childrenIds: []
          }
        }
      }
    ];

    const scan = scanFromInternalConversations({
      projectId: "p1",
      projectName: "Project",
      conversations,
      scannedUrl: "https://chatgpt.com/g/p1/project"
    });

    expect(scan.nodes.map((node) => node.prompt)).toEqual(["Root question", "Left branch", "Right branch"]);
    expect(scan.nodes.filter((node) => node.messageId === "u-root")).toHaveLength(1);
    expect(scan.nodes.find((node) => node.messageId === "u-root")?.conversationId).toBe("c-left");
    expect(scan.edges).toHaveLength(2);
    expect(new Set(scan.edges.map((edge) => edge.from))).toEqual(new Set([scan.nodes[0].id]));
  });

  it("filters user system messages out of the visible tree", () => {
    const conversation: InternalConversation = {
      id: "c1",
      title: "Chat",
      mapping: {
        "u-system": {
          id: "u-system",
          authorRole: "user",
          text: "Hidden project instruction",
          childrenIds: ["a1"],
          isUserSystemMessage: true
        },
        a1: {
          id: "a1",
          authorRole: "assistant",
          text: "",
          parentId: "u-system",
          childrenIds: ["u1"]
        },
        u1: {
          id: "u1",
          authorRole: "user",
          text: "Visible question",
          parentId: "a1",
          childrenIds: []
        }
      }
    };

    const scan = scanFromInternalConversations({
      projectId: "p1",
      projectName: "Project",
      conversations: [conversation],
      scannedUrl: "https://chatgpt.com/c/c1"
    });

    expect(scan.nodes.map((node) => node.prompt)).toEqual(["Visible question"]);
    expect(scan.edges).toHaveLength(0);
  });

  it("creates stable fingerprints for equivalent whitespace", () => {
    expect(fingerprintText("hello\n world")).toBe(fingerprintText("hello world"));
  });
});
