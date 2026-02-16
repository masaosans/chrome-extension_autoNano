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
  const maxLoops = 10;

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
あなたはブラウザUIエージェントです。

以下はAX Treeです。
role と name を使って操作対象を判断してください。

${JSON.stringify(pageInfo.axTree)}

ユーザ指示:
${userInput}

可能なaction:
click
input
navigate
write_memory

必ず純粋なJSONのみ出力してください。
markdownや\`\`\`は絶対に含めないでください。
`;

      log({ level: "debug", message: "Sending prompt to model..." });

      log({ level: "info", message: prompt });

      const result = await lm.prompt(prompt);

      log({ level: "info", message: result });

      //```json {ｘｘｘｘ}　```の前後をトリム
      const parsed = extractJSON(result);

      log({
        level: "info",
        message: `Executing action: ${parsed.action?.type}`
      });

      const done = await executeAction(parsed.action, log);

      if (done === "STOP") {
        log({ level: "info", message: "Agent stopped by action" });
        break;
      }

    } catch (e) {
      log({ level: "error", message: e.message });
      break;
    }
  }

  log({ level: "info", message: `[${traceId}] Loop ended`, time: now() });
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

  // 最初の { から最後の } まで抽出
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) return null;

  const jsonString = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("JSON parse failed:", jsonString);
    return null;
  }
}