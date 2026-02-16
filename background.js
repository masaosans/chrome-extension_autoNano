import { ensureModelReady, runPrompt } from "./ai.js";
import { waitForDomStable } from "./utils.js";

/*
  Background:
  - エージェント制御本体
  - AI呼び出し
  - AX取得
  - Action実行
  - ログ出力管理
*/

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// メインエージェント起動
chrome.runtime.onMessage.addListener(async (msg) => {

  if (msg.type !== "START_AGENT") return;

  const tabId = msg.tabId;

  const log = (text) =>
    chrome.runtime.sendMessage({ type: "LOG", data: text });

  const notify = (text) =>
    chrome.runtime.sendMessage({ type: "AI_STATUS", data: text });

  log("=== Agent Start ===");
  log("User Prompt: " + msg.prompt);

  try {

    // --- AI初期化 ---
    const model = await ensureModelReady(notify, log);
    if (!model) {
      log("AI初期化失敗");
      return;
    }

    const history = [];

    for (let step = 0; step < 30; step++) {

      log(`--- Step ${step} 開始 ---`);

      // ループ検出
      if (detectLoop(history)) {
        log("Loop detected. 停止します");
        break;
      }

      // AX Tree取得
      log("AX: 取得開始");
      const ax = await getAXTree(tabId);
      log("AX: ノード数=" + ax.length);

      // プロンプト構築
      const prompt = buildPrompt(msg.prompt, ax);

      // AI実行
      const action = await runPrompt(model, prompt, log);

      log("Action決定: " + JSON.stringify(action));

      if (!action || action.type === "finish") {
        log("finish受信 → 終了");
        break;
      }

      // Action実行
      log("Action実行開始");
      await executeAction(tabId, action, log);
      log("Action実行完了");

      history.push(action);

      // DOM安定待機
      await waitForDomStable(tabId, log);

      log(`--- Step ${step} 完了 ---`);
    }

  } catch (e) {
    log("例外発生: " + e.message);
  }

  log("=== Agent Finished ===");
});

//ループ検出
function detectLoop(history) {

  if (history.length < 6) return false;

  const recent = history.slice(-6);
  const sig = recent.map(a => a.type + (a.selector || ""));

  const unique = new Set(sig);

  return unique.size <= 2;
}

//AX取得
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
    }));
}

//Action実行
async function executeAction(tabId, action, log) {

  if (action.type === "navigate") {
    log("Navigate: " + action.url);
    await chrome.tabs.update(tabId, { url: action.url });
    return;
  }

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (action) => {

      const el = document.querySelector(action.selector);
      if (!el) return "not found";

      if (action.type === "click") el.click();

      if (action.type === "input") {
        el.focus();
        el.value = action.text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }

      if (action.type === "scroll") window.scrollBy(0, 800);

      if (action.type === "extract") {
        return [...document.querySelectorAll(action.selector)]
          .slice(0, 10)
          .map(e => e.innerText);
      }

      return "ok";
    },
    args: [action]
  });

  log("Action結果: " + JSON.stringify(result));
}