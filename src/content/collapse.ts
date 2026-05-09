const STYLE_ID = "gptbt-collapse-style";
const TOGGLE_CLASS = "gptbt-reply-toggle";
const COLLAPSED_CLASS = "gptbt-assistant-collapsed";

export function ensureCollapseStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [data-message-author-role="assistant"].${COLLAPSED_CLASS} > *:not(.${TOGGLE_CLASS}) {
      display: none !important;
    }
    .${TOGGLE_CLASS} {
      align-items: center;
      background: #f7f7f8;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 7px;
      color: #202123;
      cursor: pointer;
      display: inline-flex;
      font: 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      height: 22px;
      justify-content: center;
      margin: 2px 0 6px;
      min-width: 28px;
      padding: 0 6px;
    }
    .gptbt-message-highlight {
      animation: gptbt-highlight 2.2s ease;
      outline: 2px solid #10a37f !important;
      outline-offset: 4px !important;
      border-radius: 8px;
    }
    @keyframes gptbt-highlight {
      0% { background: rgba(16, 163, 127, 0.24); }
      100% { background: transparent; }
    }
  `;
  document.documentElement.appendChild(style);
}

export function setAssistantCollapsed(mode: "collapse" | "expand" | "toggle"): {
  collapsed: boolean;
  affected: number;
} {
  ensureCollapseStyles();
  const replies = assistantReplyElements();
  for (const reply of replies) {
    ensureToggle(reply);
    const shouldCollapse =
      mode === "toggle" ? !reply.classList.contains(COLLAPSED_CLASS) : mode === "collapse";
    reply.classList.toggle(COLLAPSED_CLASS, shouldCollapse);
    updateToggle(reply);
  }
  return {
    collapsed: replies.some((reply) => reply.classList.contains(COLLAPSED_CLASS)),
    affected: replies.length
  };
}

function assistantReplyElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')];
}

function ensureToggle(reply: HTMLElement): void {
  if (reply.querySelector(`.${TOGGLE_CLASS}`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = TOGGLE_CLASS;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    reply.classList.toggle(COLLAPSED_CLASS);
    updateToggle(reply);
  });
  reply.prepend(button);
  updateToggle(reply);
}

function updateToggle(reply: HTMLElement): void {
  const button = reply.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!button) return;
  const collapsed = reply.classList.contains(COLLAPSED_CLASS);
  button.textContent = collapsed ? "展开" : "收起";
  button.title = collapsed ? "展开助手回复" : "折叠助手回复";
  button.setAttribute("aria-label", button.title);
}
