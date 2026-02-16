console.log("BACKGROUND LOADED");

import { runAgentLoop } from "./ai.js";

function logToPanel(data) {
  chrome.runtime.sendMessage({
    type: "AGENT_LOG",
    payload: data
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "START_AGENT") {

    logToPanel({ level: "info", message: "Agent started" });

    runAgentLoop(msg.userInput, logToPanel)
      .then(() => {
        logToPanel({ level: "info", message: "Agent finished" });
        sendResponse({ ok: true });
      })
      .catch(e => {
        logToPanel({ level: "error", message: e.message });
        sendResponse({ error: e.message });
      });

    return true;
  }
});