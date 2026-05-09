import { beforeEach, describe, expect, it } from "vitest";
import { getPageStatus, scanDomConversation, setCachedApiProjects } from "../src/content/domScan";

describe("DOM scan", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setCachedApiProjects([]);
    window.history.replaceState({}, "", "/project/demo/c/chat-1");
  });

  it("detects a ChatGPT project from the URL", () => {
    document.body.innerHTML = `<header><h1>Research Project</h1></header>`;
    const status = getPageStatus();
    expect(status.isProject).toBe(true);
    expect(status.projectId).toBe("demo");
    expect(status.projectName).toBe("Research Project");
  });

  it("detects a ChatGPT /g project homepage URL", () => {
    window.history.replaceState({}, "", "/g/g-p-demo-suan-fa-zhuan-ti/project");
    document.body.innerHTML = `<main><h1>算法专题</h1></main>`;
    const status = getPageStatus();
    expect(status.isProject).toBe(true);
    expect(status.projectId).toBe("g-p-demo-suan-fa-zhuan-ti");
    expect(status.projectName).toBe("算法专题");
  });

  it("dedupes slugged project URLs against canonical API project ids", () => {
    window.history.replaceState({}, "", "/g/g-p-69fc5ca427bc819189a6bab6f7f6d722-ce-shi/project");
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/g/g-p-69fc5ca427bc819189a6bab6f7f6d722-ce-shi/project">测试多分支树</a>
      </nav>
      <main><h1>测试多分支树</h1></main>
    `;
    setCachedApiProjects([
      {
        id: "g-p-69fc5ca427bc819189a6bab6f7f6d722",
        name: "测试多分支树",
        url: "https://chatgpt.com/g/g-p-69fc5ca427bc819189a6bab6f7f6d722/project"
      }
    ]);

    const status = getPageStatus();

    expect(status.projectId).toBe("g-p-69fc5ca427bc819189a6bab6f7f6d722");
    expect(status.projects).toHaveLength(1);
  });

  it("extracts user prompts from ChatGPT message nodes", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user" data-message-id="u1">How should we branch?</div>
        <div data-message-author-role="assistant">Answer</div>
        <div data-message-author-role="user" data-message-id="u2">Give me a risk list.</div>
      </main>
    `;

    const snapshot = scanDomConversation();

    expect(snapshot.userMessages).toEqual([
      { messageId: "u1", text: "How should we branch?" },
      { messageId: "u2", text: "Give me a risk list." }
    ]);
  });

  it("detects branch marker parentage in loaded conversation DOM", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user" data-message-id="root-2">root 分支 node 2</div>
        <div data-message-author-role="assistant">Answer</div>
        <div data-message-author-role="user" data-message-id="root-3">root 分支 node 3</div>
        <div>从 Root分支 1 建立的分支</div>
        <div data-message-author-role="user" data-message-id="dev-1">dev 分支 node 1</div>
      </main>
    `;

    const snapshot = scanDomConversation();

    expect(snapshot.userMessages).toMatchObject([
      { messageId: "root-2", text: "root 分支 node 2" },
      { messageId: "root-3", text: "root 分支 node 3" },
      { messageId: "dev-1", parentMessageId: "root-3", text: "dev 分支 node 1" }
    ]);
  });

  it("extracts project homepage conversation rows when messages are absent", () => {
    window.history.replaceState({}, "", "/g/g-p-demo/project");
    document.body.innerHTML = `
      <main>
        <h1>算法专题</h1>
        <a href="https://chatgpt.com/c/chat-1">
          算法复习表格整理
          我觉得我需要归纳动态规划和图算法
          11月2日
        </a>
        <a href="https://chatgpt.com/c/chat-2">New chat 11月1日</a>
      </main>
    `;

    const snapshot = scanDomConversation();

    expect(snapshot.userMessages).toMatchObject([
      {
        conversationId: "chat-1",
        conversationTitle: "算法复习表格整理",
        url: "https://chatgpt.com/c/chat-1",
        text: "我觉得我需要归纳动态规划和图算法"
      },
      {
        conversationId: "chat-2",
        conversationTitle: "New chat 11月1日",
        url: "https://chatgpt.com/c/chat-2",
        text: "New chat 11月1日"
      }
    ]);
  });

  it("ignores recent sidebar conversations when scanning project rows", () => {
    window.history.replaceState({}, "", "/g/g-p-demo/project");
    document.body.innerHTML = `
      <aside>
        <a href="https://chatgpt.com/c/recent-1">最近对话 A</a>
        <a href="https://chatgpt.com/c/recent-2">最近对话 B</a>
      </aside>
      <main>
        <h1>测试多分支树</h1>
        <a href="https://chatgpt.com/c/project-1">Root分支 1 root 分支 node 5 5月7日</a>
        <a href="https://chatgpt.com/c/project-2">分支 · Root分支 1 dev 分支 node 2 5月7日</a>
      </main>
    `;

    const snapshot = scanDomConversation();

    expect(snapshot.userMessages.map((message) => message.conversationId)).toEqual([
      "project-1",
      "project-2"
    ]);
  });
});
