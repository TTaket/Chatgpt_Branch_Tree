import type { QuestionNode } from "../shared/types";
import { normalizeText } from "../shared/text";

export async function highlightNode(node: QuestionNode): Promise<boolean> {
  const found = await waitForMessageElement(node);
  if (!found) return false;
  found.scrollIntoView({ behavior: "smooth", block: "center" });
  found.classList.add("gptbt-message-highlight");
  window.setTimeout(() => found.classList.remove("gptbt-message-highlight"), 2600);
  return true;
}

async function waitForMessageElement(node: QuestionNode): Promise<HTMLElement | undefined> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const element = findMessageElement(node);
    if (element) return element;
    await sleep(250);
  }
  return undefined;
}

function findMessageElement(node: QuestionNode): HTMLElement | undefined {
  if (node.messageId) {
    const byId = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(node.messageId)}"], [data-testid="${CSS.escape(node.messageId)}"]`
    );
    if (byId) return byId;
  }

  const userMessages = [...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')];
  const prompt = normalizeText(node.prompt);
  return userMessages.find((element) => normalizeText(element.innerText || element.textContent || "").includes(prompt.slice(0, 80)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
