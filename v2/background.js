console.log("BACKGROUND LOADED");

import { runAgentLoop } from "./ai.js";
import { deleteMemory } from "./memory.js";
import { requestStop } from "./ai.js";

//サイドバーを開く
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  await chrome.sidePanel.open({
    tabId: tab.id
  });
});

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
  //メモ削除処理
  if (msg.type === "DELETE_MEMORY") {
    deleteMemory(msg.id).then(() => {
      sendResponse({ ok: true });
    });

    return true; // 非同期レスポンス用
  }
  //停止指示
  if (msg.type === "STOP_AGENT") {
    requestStop();
  }

});

//DOM監視
async function waitForDomStable(tabId) {
  return new Promise((resolve) => {
    const listener = (msg, sender) => {
      if (msg.type === "DOM_STABLE" && sender.tab?.id === tabId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting.executeScript({
      target: { tabId },
      files: ["dom-waiter.js"]
    });
  });
}