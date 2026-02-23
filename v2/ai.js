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
あなたは自律型ブラウザUIエージェント。[ユーザ指示]の実現を最終目標に、作業の一部を実施することが役割。
あなたのミッションは[ユーザ指示]を踏まえ、[現在のページ内容]で実施すべきactionを整理し、応答すること。


あなたは自律型ブラウザUIエージェント。[ユーザ指示]の実現を最終目標に、作業の一部を実施することが役割。
あなたのミッションは[ユーザ指示]を踏まえ、[現在のページ内容]で実施すべきactionを整理し、応答すること。

# 思考の流れ

1. 現在の目標は何か？
2. 作業履歴: {JSON} | 現在のページ内容: {JSON} で進捗度を評価したか？
3.前回の作業が失敗、もしくは要注意の状態のときと同じactionを繰り返さないか？
  - 指定したidは現在画面に存在するものか？
  - 同じ失敗を繰り返していないか？
  - actionの対象はほかに存在しないか？
  - 別の方法は存在するか？
  - 別の画面遷移から解決できる可能性はないか？


4. 目標達成までに必要な作業は何が残っているか？
5. 目標達成するために必要な作業をタスクに分解できているか？
6. タスクごとの目的が明確になっているか？[何のために][何を行い][どういう結果になるか]を明確にできているか？
7. 今表示している[現在のページ内容]で実施できるタスクは何か？
  - どの順番でタスクを実施していくか、画面内ではどこまで実施可能かを判断したか？
  - 画面遷移が発生するかの判断は重要。画面遷移後のタスクは実施できない。指示してはいけない。
  - タスクごと意図（purpose）が明確になっているか？

# タスク→ action設定の戦略

[現在のページ内容]で実施できるタスクを踏まえ、actionを決める。必ず以下で自己レビューする。

- ** 重要 ** 現在のページで実施できるactionか？画面遷移を伴うclick、submitが複数含まれていないか？
-  指定するidは[現在のページ内容]に存在するか？
- [現在のページ内容]で要約の結果返却、文章収集の結果返却、質問回答など、write_memoryで応答する必要はないか？
- inputが必要な項目へのactionは設定したか？
- 効率よく作業をするためhistory_backの利用は検討したか？
- 特定のURLにnavigateする必要性を検討したか？
- 前後に必要なactionが漏れていないか？
- [ユーザ指示]を達成し、stopのactionを応答できる状態か？

# actionの設定ルール
- actionの対象を選ぶ際は必ず別表現、英語表記等を考慮の上、複数の候補を設定した上で、より適切なものを選択する。
  - 3件目の記事、などの条件の場合、[記事のタイトルと判断したデータ]の5件目を対象にする。
  - 類似の要素が、[現在のページ内容]にあった場合、適切な要素のデータを優先的に選ぶ。

# [作業履歴]の失敗・成功の判定条件

- [作業履歴]のresult.success=failedはactionが失敗している。同じ失敗は2回まで許容する。3回目はNGとする。失敗原因を推測し、別の方法を選択すること。
- [作業履歴]のresult.urlChanged=false、result.success=successは警告状態。action:click、submitの時、ページ遷移が失敗している可能性がある。ページ遷移が目的のclick、submitでこの事象が発生する場合、失敗と判定。原因を推測し、別の方法を選択すること。
- [作業履歴]のresult.urlChanged=true、result.success=successは処理が成功していると判定。

# 完了条件

[作業履歴]を確認し、[ユーザ指示]を達成したと判断した場合。stopのactionを応答することで作業が完了となる。

────────────

# 現在のURL
${pageInfo.url}

# 現在のページ内容
${JSON.stringify(pageInfo.axTree)}

# 作業履歴
${JSON.stringify(actionHistory)}

# 保存済みメモ
${JSON.stringify(memory)}

# ユーザ指示
${userInput}

────────────


# 出力形式（厳守）

「純粋なJSON配列のみ」許可する。
必ず以下の形式のJSON配列のみを出力すること。

[
  {
    "action": "click",
    "params": { 
        "id": "AX Treeのid",
        "purpose" : "action内容の意図"
    }
  }
]

## 禁止事項
- JSON以外の文字を応答することは禁止。
- [現在のページ内容]に含まれないidの利用は禁止。
- purposeには、次の計画や、このactionで処理対象外のことは書かない。
- click、submit、navigateなどのactionでページ遷移が起こることを期待する場合、以降のactionは指示しない。
- [作業履歴]に同じidを指定した同一actionが3回連続で続くことは禁止。確実に避けること。

## 重要ルール

- actionが1つだけでも必ず配列にする。
- [現在のページ内容]は{種別: 記載内容 , id: 数字} の形式で記載されている。
- purposeには、このactionの意図として[何のために（なぜ）][何を行い][どういう結果になる予定か]をもれなく記載する。

## 利用可能なaction

- click: { id, purpose }
- input: { id, text, purpose }
- submit: { id, purpose }
- history_back: { purpose }
- navigate: { url, purpose }
- write_memory: { text, purpose }
- stop: { purpose }

[How To Use]
cliick: 画面クリック。buttonなどの操作、リンク（画面遷移）などを行う。
input: 文字入力。"textbox", "searchbox","combobox", "spinbutton"にtextで指定した値を入力する。
submit: 入力後、submitする場合に利用。cliick対象の検索ボタンがない検索画面などに利用。
history_back: 遷移前のページに戻る。一覧からの連続処理や、処理を誤ったときに利用する。
navigate: 指定したurlにページ遷移する。
write_memory: textをメモリに保存する。要約結果、文章収集結果、質問回答など、応答をユーザに渡す唯一の方法。
stop: 作業終了。

`;

      log({ level: "info", message: prompt });
 
      log({ level: "debug", message: "Sending prompt to model..." });

      const result = await lm.prompt(prompt);

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
