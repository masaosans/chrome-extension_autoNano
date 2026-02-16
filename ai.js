// ai.js
// Chrome Prompt API (LanguageModel) を利用するAI制御モジュール

export async function ensureModelReady(notify, log) {

  log("AI: Prompt API存在確認");

  if (typeof LanguageModel === "undefined") {
    notify("Prompt API未対応");
    log("AI: LanguageModel undefined");
    return null;
  }

  notify("AI状態確認中...");
  log("AI: availabilityチェック開始");

  const availability = await LanguageModel.availability({
    model: "gemini-nano"
  });

  log("AI: availability結果 -> " + JSON.stringify(availability));

  if (!availability || availability.status === "unavailable") {
    notify("モデル利用不可");
    return null;
  }

  if (availability.status === "downloading") {
    notify("モデルダウンロード中...");
    log("AI: ダウンロード進行中");
  }

  if (availability.status === "downloadable") {
    notify("モデル初回ダウンロード開始...");
    log("AI: 初回ダウンロード発生");
  }

  log("AI: モデル生成開始");

  const model = await LanguageModel.create({
    model: "gemini-nano",
    temperature: 0.2
  });

  notify("モデル準備完了");
  log("AI: モデル生成完了");

  return model;
}

export async function runPrompt(model, prompt, log) {

  log("AI: プロンプト送信開始");
  log("AI: プロンプト文字数=" + prompt.length);

  const result = await model.prompt({
    input: prompt,
    maxOutputTokens: 800
  });

  const text = result.outputText?.trim() || "";

  log("AI: 生レスポンス取得");
  log("AI RAW: " + text);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      log("AI: JSONパース成功 -> " + JSON.stringify(parsed));
      return parsed;
    } catch (e) {
      log("AI: JSONパース失敗");
    }
  }

  log("AI: 有効JSON無し → finish");
  return { type: "finish" };
}