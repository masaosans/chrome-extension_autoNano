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
あなたは自律型ブラウザUIエージェント。[ユーザ指示]の実現を最終目標に、作業の一部を実施することが役割。
あなたのミッションは[ユーザ指示]を踏まえ、[現在のページ内容]で実施すべきactionを整理し、応答すること。

■思考の流れ

1. 現在の目標は何か？
2. [作業履歴]を踏まえ、actionとpurposeからどこまで作業が成功しているか？
3.前回の作業が失敗しているとき、どのように対応するか？
  - 前回のactionは成功したか？
  - 失敗している場合、なぜ失敗したか？
  - 同じ失敗を繰り返していないか？
  - 別の方法は存在するか？

4. 目標達成までに必要な作業は何が残っているか？
5. 残りの作業で[現在のページ内容]の中で実施することは何か？


■タスク分解 → Actionの考え方
目標に向けたタスクを分解し、Actionを設定する。以下の考え方をする。

1. 目標達成するために必要な手順をタスクに分解し、タスクごとの意図（purpose）を明確にする。
  - どの順番でタスクを実施していくか、画面内ではどこまで実施できるかを踏まえてタスクを決める
  - タスクは、action単位で分解を行う。
    例：
      ユーザ指示: 検索条件にAIと入力し検索、一覧のデータを選び、開いた詳細画面の内容を要約
      タスク: [検索条件にAIと入力(input)][検索(subumit)][一覧のデータを選ぶ(click)][詳細画面の内容を要約(write_memory)]
      この画面で実施できる内容： [検索条件にAIと入力(input)][検索(subumit)]

  - タスクごと意図（purpose）を明確にする。[何のために][何を行い][どういう結果になるか]を明確にする。

2. タスクを踏まえ、設定するactionを確定する。事故レビューした結果をactionに設定する。
  - 以下の観点でactionの自己レビューができているかチェックする。
    - ** 重要 ** 現在のページで実施できるactionか？
      例）clickでページ遷移が予測される場合、以降の処理は応答してはならない。
    - 指定するidは[現在のページ内容]に存在する値か？
    - [現在のページ内容]で要約、文章収集、質問回答などwrite_memoryする必要はあるか？
    - inputが必要な項目へのactionは設定したか？
    - click、submitの画面操作を伴うactionは設定したか？
    - 効率よく作業をするためhistory_backの利用は検討したか？
    - 特定のURLにnavigateする必要性を検討したか？

  - actionの処理対象は適切か判断する。
    - 3件目の記事、などの条件の場合、[記事のタイトルと判断したデータ]の5件目を対象にする
    - 新着情報一覧などの条件の場合、[新着一覧][新着を開く][New]など、別の表現を考慮し対象を抽出する
    - 同じ内容の要素が、[現在のページ内容]にあった場合、適切な要素のデータを優先的に選ぶ
  
  - 前後に必要なactionが漏れていないか？
  - [ユーザ指示]を達成し、stopのactionを応答できる状態か？

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

- [現在のページ内容]に含まれないidの利用は禁止。
- purposeには、次の計画や、このactionで処理対象外のことは書かない。
- purposeには、このactionの意図として[何のために（なぜ）][何を行い][どういう結果になる予定か]をもれなく記載する。
- click、submit、navigateなどのactionでページ遷移が起こることを期待する場合、以降のactionは指示しない。
- [作業履歴]に同じidを指定した同一actionが3回連続で続くことは禁止。確実に避けること。

## 重要ルール

- JSON以外の内容を応答に含めることは禁止。応答したい内容がある場合、write_memoryを利用する。
- actionが1つだけでも必ず配列にする。
- [現在のページ内容]は{種別: 記載内容 , id: 数字} の形式で記載されている。
- [作業履歴]のresult.success=falseはactionが失敗している。同じ失敗は2回まで許容する。3回目はNGとする。失敗原因を推測し、別の方法を選択すること。
- [作業履歴]のresult.urlChanged=falseはresultがsuccessでもページ遷移できていない状態を指す。
  ページ遷移が目的の場合、失敗している。失敗原因を推測し、別の方法を選択すること。

# 完了条件
 [作業履歴]を確認し、[ユーザ指示]を達成したと判断した場合。stopのactionを応答することで作業が完了となる。


# 利用可能なaction

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
write_memory: textをメモリに保存する。要約、文章収集、質問回答などユーザに渡す唯一の方法。
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