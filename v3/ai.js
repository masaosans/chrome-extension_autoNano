import { executeAction } from "./action.js";
import { readMemory } from "./memory.js";
import { getAXTree } from "./ax.js";

let model = null;


let stopRequested = false;

//ストップ処理
export function requestStop() {

//ステータス変更
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS",
    status: "Stopping..."
  });

  stopRequested = true;
}
//モデルの起動（なければダウンロード）
async function initModel(log) {
  if (model) return model;

  log({ level: "info", message: "Initializing Gemini Nano..." });

  model = await LanguageModel.create({
    temperature: 0.4,         // ランダム性調整
    topK: 10,                 // 次の語候補数
    //signal: controller.signal, // 中断用シグナル
    //initialPrompts: [{ role: "system", content: "…" }],// セッション開始時のコンテキスト
    //expectedInputs: [{ type: "text", languages: ["ja"] }],
    //expectedOutputs: [{ type: "text", languages: ["ja"] }],
    model: "gemini-nano"
  });

  
  log({ level: "info", message: "Model ready." });
  return model;
}

function now() {
  return new Date().toISOString();
}


//事前処理（AI）
async function analyzePage(lm, pageInfo, log) {
  const prompt = `
あなたはWebページ構造アナライザーです。
アクションは決めないでください。

URL:
${pageInfo.url}

AXTree:
${JSON.stringify(pageInfo.axTree)}

以下をJSONで返してください:
{
  "pageType": "...",
  "possibleActions": [...],
  "keyElements": [...]
}
`;

  log({ level: "debug", message: "Stage1: analyzing page..." });

  return await lm.prompt(prompt);
}

//ACT処理
async function decideNextAction(lm, context, log) {
  const prompt = `
あなたは自律型ブラウザエージェントです。

分析結果:
${context.analyzed}

作業履歴:
${JSON.stringify(context.actionHistory.slice(-5))}

保存済みメモ:
${JSON.stringify(context.memory)}

ユーザ指示:
${context.userInput}

次のactionをJSON配列のみで返してください。
`;

  log({ level: "debug", message: "Stage2: deciding action..." });

  return await lm.prompt(prompt);
}




//全体処理の実行（ループ実行）
export async function runAgentLoop(userInput, log) {

  const traceId = crypto.randomUUID();
  log({ level: "info", message: `[${traceId}] Loop started`, time: now() });

 //ストップフラグを初期化
  stopRequested = false; 

//ステータス変更
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS",
    status: "initModel（ or Downloading）"
  });

  const lm = await initModel(log);

  //ステータス変更
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS",
    status: "Running..."
  });

  let loopCount = 0;
  const maxLoops = 15;

  const actionHistory = [];

  while (loopCount < maxLoops) {

    //ストップ指示があった場合
    if (stopRequested) {
      log({ level: "info", message: "Stop requested. Exiting loop." });
      break;
    }

    loopCount++;

    log({
      level: "info",
      message: `[${traceId}] Loop ${loopCount} started`,
      time: now()
    });

    try {




      const pageInfo = await getPageInfo(log);
      const memory = await readMemory();

      // --- Stage1: ページ構造分析 ---
      const analyzed = await analyzePage(lm, pageInfo, log);

      // --- Stage2: アクション決定 ---
      const result = await decideNextAction(
        lm,
        {
          analyzed,
          userInput,
          actionHistory,
          memory
        },
        log
      );



      log({ level: "info", message: result });
 
      const parsed = extractJSON(result);


      if (!Array.isArray(parsed)) {
        log({ level: "error", message: "Model output is not array" });
        break;
      }

      for (const action of parsed) {
        log({
          level: "info",
          message: `Executing action: ${JSON.stringify(action)}`
        });

        if (action.action === "stop") {
          log({ level: "info", message: "Task stopped by model." });
          return;
        }

        let actionResult;

        try {
          const beforeUrl = pageInfo.url;
          const beforeAX = pageInfo.axTree;

          const result = await executeAction(action, log);

        //処理実施後、DOMが安定するまでは待機する
          await waitForDomStable();

          const afterPageInfo = await getPageInfo(log);
          const afterAX = afterPageInfo.axTree;
          const domChanged = beforeAX.length !== afterAX.length;

          log({ level: "info", message: `domChanged:${domChanged}` });
          log({ level: "info", message: `beforeUrl:${beforeUrl}` });
          log({ level: "info", message: `afterUrl:${afterPageInfo.url}` });

          actionResult = {
            status: "success",
            error: null,
            urlChanged: beforeUrl !== afterPageInfo.url
          };

        } catch (e) {
          actionResult = {
            status: "failed",
            error: e.message,
            urlChanged: false
          };
        }
        //actionを記録
        actionHistory.push({
          loop: loopCount,
          action,
          result: actionResult
        });


        if (result === "STOP") {
          return;
        }
      }

    } catch (e) {
      log({ level: "error", message: e.message });
      break;
    }
  }

  log({
    level: "warn",
    message: `[${traceId}] Max loop reached`
  });

  log({ level: "info", message: `[${traceId}] Loop ended`, time: now() });
  //ステータス変更
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS",
    status: "IDLE"
  });

}
//ページのAXTreeを取得
async function getPageInfo(log) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  log({ level: "info", message: "Fetching AX Tree..." });

  const axTree = await getAXTree(tab.id, log);

  return {
    url: tab.url,
    axTree
  };
}

//AIの応答から不要な文字列を削除
function extractJSON(text) {
  if (!text) return null;

  // ```json ... ``` を除去
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

    const jsonString = cleaned

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("JSON parse failed:", jsonString);
    return null;
  }
}

//DOM監視
async function waitForDomStable(options = {}) {
  const {
    timeout = 8000,
    quietMs = 800
  } = options;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const tabId = tab.id;


  return new Promise((resolveOuter) => {

    let resolved = false;

    function safeResolve(value = true) {
      if (!resolved) {
        resolved = true;
        resolveOuter(value);
      }
    }

    // 強制タイムアウト（executeScriptが壊れても戻る）
    const hardTimeout = setTimeout(() => {
      console.warn("waitForDomStable HARD TIMEOUT");
      safeResolve(true);
    }, timeout + 1000);

    try {
      chrome.scripting.executeScript({
        target: { tabId },
        func: (timeout, quietMs) => {
          return new Promise((resolve) => {

            let lastChange = Date.now();
            const startTime = Date.now();

            const observer = new MutationObserver(() => {
              lastChange = Date.now();
            });

            observer.observe(document, {
              subtree: true,
              childList: true,
              attributes: true
            });

            const interval = setInterval(() => {
              const now = Date.now();

              if (now - startTime > timeout) {
                cleanup();
              }

              if (now - lastChange > quietMs) {
                cleanup();
              }

            }, 200);

            function cleanup() {
              clearInterval(interval);
              observer.disconnect();
              resolve(true);
            }
          });
        },
        args: [timeout, quietMs]
      }, (results) => {
        clearTimeout(hardTimeout);

        if (chrome.runtime.lastError) {
          console.warn("executeScript error:", chrome.runtime.lastError);
          safeResolve(true);
          return;
        }

        safeResolve(results?.[0]?.result ?? true);
      });

    } catch (e) {
      console.warn("waitForDomStable exception:", e);
      safeResolve(true);
    }

  });
}
