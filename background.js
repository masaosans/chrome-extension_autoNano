import { AgentMemory } from "./memory.js";
import { runNano } from "./nano.js";
import { waitForDomStable, retryAction, detectLoop } from "./utils.js";

// メッセージリスナー
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== "START_AGENT") return;

  const memory = new AgentMemory(msg.prompt);
  const tabId = msg.tabId;

  for (let step = 0; step < 50; step++) {

    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;

    if (detectLoop(memory)) {
      log("Loop detected. Stopping.");
      break;
    }

    if (!memory.visited.has(url)) {
      const ax = await getAXTree(tabId);
      memory.addSummary(url, ax.slice(0, 20));
      memory.addVisit(url);
    }

    const ax = await getAXTree(tabId);
    const working = memory.buildWorkingMemory(url);

    const prompt = buildPrompt(msg.prompt, ax, working);
    const action = await runNano(prompt);

    log(`Step ${step}: ${JSON.stringify(action)}`);

    if (!action || !action.type) break;

    const result = await retryAction(tabId, action, executeAction);

    memory.addHistory(action, result);

    if (action.type === "extract" && result[0]?.result) {
      memory.addExtracted(result[0].result);
    }

    if (action.type === "finish") break;

    await waitForDomStable(tabId);
  }

  await memory.persist();
  log("Finished.");
});

// AXTreeを取得する関数
async function getAXTree(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch {}

  const { nodes } = await chrome.debugger.sendCommand(
    { tabId },
    "Accessibility.getFullAXTree"
  );

  await chrome.debugger.detach({ tabId });

  return nodes
    .filter(n => n.role && n.name)
    .map(n => ({
      role: n.role.value,
      name: n.name?.value || ""
    }))
    .slice(0, 200);
}

// アクションを実行する関数
async function executeAction(tabId, action) {

  if (action.type === "navigate") {
    await chrome.tabs.update(tabId, { url: action.url });
    return { ok: true };
  }

  return chrome.scripting.executeScript({
    target: { tabId },
    func: (action) => {

      const el = document.querySelector(action.selector);
      if (!el) return "not found";

      switch (action.type) {

        case "click":
          el.click();
          break;

        case "input":
          el.focus();
          el.value = action.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          break;

        case "scroll":
          window.scrollBy(0, action.direction === "down" ? 800 : -800);
          break;

        case "extract":
          return [...document.querySelectorAll(action.selector)]
            .slice(0, 10)
            .map(e => ({ text: e.innerText }));
      }

      return "ok";
    },
    args: [action]
  });
}

// プロンプトを構築する関数
function buildPrompt(userPrompt, axTree, memory) {
  return `
あなたはブラウザ自動操作エージェントです。
必ず1つのActionのみをJSONで出力してください。

# ユーザ指示
${userPrompt}

# Working Memory
${JSON.stringify(memory)}

# 画面構造（AX Tree簡略）
${JSON.stringify(axTree)}

# 使用可能Action
click, input, scroll, navigate, extract, wait, finish

例:
{
  "type": "click",
  "selector": "a.article"
}
`;
}

// ログ出力を行う関数
function log(text) {
  chrome.runtime.sendMessage({ type: "LOG", data: text });
}