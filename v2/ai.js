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

async function initModel(log) {
  if (model) return model;

  log({ level: "info", message: "Initializing Gemini Nano..." });

  model = await LanguageModel.create({
    model: "gemini-nano"
  });

  log({ level: "info", message: "Model ready." });
  return model;
}

function now() {
  return new Date().toISOString();
}

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

      const prompt = `
あなたは自律型ブラウザUIエージェントです。
複数のターンを繰り返し、[ユーザ指示]を実現することが目的です。
[作業履歴]から現在の作業状況、このあと実施する作業を整理し、現在のページ（AX tree）で実施するactionを返答してください。

# 現在のURL
${pageInfo.url}

# AX Tree（現在のページのAX tree）
${JSON.stringify(pageInfo.axTree)}

# 作業履歴
${JSON.stringify(actionHistory)}

# 保存済みメモ
${JSON.stringify(memory)}

# ユーザ指示
${userInput}


# 出力形式（厳守）

あなたの出力は「純粋なJSON配列のみ」です。
必ず以下の形式のJSON配列のみを出力してください。

[
  {
    "action": "click",
    "params": { 
        "id": "AX Treeのid",
        "act_purpose" : "処理の目的・理由"
    }
  }
]

# 重要ルール

- actionが1つだけでも必ず配列にする。
- idは必ずAX Tree内のidを使う。
- act_purposeにはactionを実施する目的、理由を日本語で明記する。
- 現在のページで実施できるactionのみ返答する。
- click、navigateなどのactionでページ遷移が起こる場合、以降のactionは指示しない。

# 利用可能なaction

- click: { id, act_purpose }
- input: { id, text, act_purpose }
- navigate: { url, act_purpose }
- write_memory: { text, act_purpose }
- stop: { act_purpose }

ブラウザを操作：click、input、navigateのactionを利用
要約、文章収集、質問回答：write_memoryを利用。応答内容をtextに設定しactionする。
作業終了：stopを利用。[ユーザ指示]の内容が[作業履歴]で終わっていると判断した場合、stop のactionを行う。

`;

      log({ level: "info", message: prompt });
 
      log({ level: "debug", message: "Sending prompt to model..." });

      const result = await lm.prompt(prompt);

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

        //処理実施後、DOMが安定しるまでは待機する
          await waitForDomStable();

          const afterPageInfo = await getPageInfo(log);
          const afterAX = afterPageInfo.axTree;
          const domChanged = beforeAX.length !== afterAX.length;

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
async function waitForDomStable(tabId, timeout = 5000, quietMs = 800) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (timeout, quietMs) => {
        return new Promise((resolve) => {
          let lastChange = Date.now();

          const observer = new MutationObserver(() => {
            lastChange = Date.now();
          });

          observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
          });

          const interval = setInterval(() => {
            if (Date.now() - lastChange > quietMs) {
              cleanup();
            }
          }, 200);

          const timeoutId = setTimeout(() => {
            cleanup();
          }, timeout);

          function cleanup() {
            clearInterval(interval);
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve(true);
          }
        });
      },
      args: [timeout, quietMs],
    });

    return results?.[0]?.result ?? true;
  } catch (e) {
    console.warn("waitForDomStable failed:", e);
    return true;
  }
}