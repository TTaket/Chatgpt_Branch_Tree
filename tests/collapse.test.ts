import { beforeEach, describe, expect, it } from "vitest";
import { setAssistantCollapsed } from "../src/content/collapse";

describe("assistant collapse", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant"><p>Long answer</p></div>
      <div data-message-author-role="assistant"><p>Another answer</p></div>
    `;
  });

  it("adds toggles and collapse class to assistant replies", () => {
    const result = setAssistantCollapsed("collapse");
    expect(result).toEqual({ collapsed: true, affected: 2 });
    expect(document.querySelectorAll(".gptbt-assistant-collapsed")).toHaveLength(2);
    expect(document.querySelectorAll(".gptbt-reply-toggle")).toHaveLength(2);
  });

  it("expands replies", () => {
    setAssistantCollapsed("collapse");
    const result = setAssistantCollapsed("expand");
    expect(result).toEqual({ collapsed: false, affected: 2 });
    expect(document.querySelectorAll(".gptbt-assistant-collapsed")).toHaveLength(0);
  });
});
