import { executeAction } from "./action.js";
import { readMemory } from "./memory.js";
import { getAXTree } from "./ax.js";

let model = null;

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

  const lm = await initModel(log);

  let loopCount = 0;
  const maxLoops = 15;

  const actionHistory = [];

  while (loopCount < maxLoops) {
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

# 現在のURL
${pageInfo.url}

# AX Tree
${JSON.stringify(pageInfo.axTree)}

# 作業履歴
${JSON.stringify(actionHistory)}

# 保存済みメモ
${JSON.stringify(memory)}

# ユーザ指示
${userInput}

# 重要ルール

- 必ずJSON配列のみ出力
- 1つだけでも必ず配列にする
- 説明文は禁止
- idは必ずAX Tree内のidを使う
- elementフィールドは禁止
- act_purposeには実施の目的・理由を日本語で明記する。


# 利用可能なaction

- click: { id , act_purpose }
- input: { id, text, act_purpose }
- navigate: { url, act_purpose }
- write_memory: { text , act_purpose}
- stop: { act_purpose}

complete は処理完了時のみ使用する。
stop は中断時に使用する。
要約や文章の整理、収集の指示があった場合、結果をwrite_memoryに記録する。

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

        actionHistory.push({
          loop: loopCount,
          action
        });

        if (action.action === "complete") {
          log({ level: "info", message: "Task completed by model." });
          return;
        }

        if (action.action === "stop") {
          log({ level: "info", message: "Task stopped by model." });
          return;
        }

        const result = await executeAction(action, log);

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