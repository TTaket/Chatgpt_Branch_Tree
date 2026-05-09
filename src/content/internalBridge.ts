export function requestActiveScan(projectId?: string, timeoutMs = 60000): Promise<any> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.warn("[GPTBT InternalBridge] Active scan timed out.");
      window.removeEventListener("message", onMessage);
      resolve({ error: "Scan timed out." });
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      if (event.data?.requestId !== requestId) return;
      
      if (event.data.type === "GPTBT_ACTIVE_SCAN_RESULT") {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(event.data.data);
      } else if (event.data.type === "GPTBT_ACTIVE_SCAN_ERROR") {
        console.error("[GPTBT InternalBridge] Active scan failed:", event.data.error);
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve({ error: event.data.error });
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: "GPTBT_DO_ACTIVE_SCAN", requestId, projectId }, "*");
  });
}

export function requestProjectsOnly(timeoutMs = 12000): Promise<any> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.warn("[GPTBT InternalBridge] Projects fetch timed out.");
      window.removeEventListener("message", onMessage);
      resolve({ error: "Projects fetch timed out." });
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      if (event.data?.requestId !== requestId) return;

      if (event.data.type === "GPTBT_FETCH_PROJECTS_RESULT") {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(event.data.data);
      } else if (event.data.type === "GPTBT_FETCH_PROJECTS_ERROR") {
        console.error("[GPTBT InternalBridge] Projects fetch failed:", event.data.error);
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve({ error: event.data.error });
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: "GPTBT_FETCH_PROJECTS", requestId }, "*");
  });
}
