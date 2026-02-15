// Nanoモデルを使ってプロンプトを処理する関数
export async function runNano(prompt) {
  try {
    const response = await window.ai.generate({
      model: "gemini-nano",
      prompt,
      temperature: 0.2
    });

    const text = response.text.trim();

    // JSON抽出安全処理
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    const jsonString = text.slice(jsonStart, jsonEnd + 1);

    return JSON.parse(jsonString);
  } catch (e) {
    return { type: "finish" };
  }
}