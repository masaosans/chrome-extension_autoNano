// エージェントメモリクラス
export class AgentMemory {
  constructor(goal) {
    this.goal = goal;
    this.visited = new Set();
    this.pageSummaries = {};
    this.extracted = [];
    this.history = [];
  }

  // 訪問を追加する関数
  addVisit(url) {
    this.visited.add(url);
  }

  // ページ要約を追加する関数
  addSummary(url, summary) {
    this.pageSummaries[url] = summary;
  }

  // 抽出結果を追加する関数
  addExtracted(items) {
    this.extracted.push(...items);
  }

  // 履歴を追加する関数
  addHistory(action, result) {
    this.history.push({ action, result });
  }

  // ワーキングメモリを構築する関数
  buildWorkingMemory(currentUrl) {
    return {
      goal: this.goal,
      currentUrl,
      visitedCount: this.visited.size,
      collectedCount: this.extracted.length
    };
  }

  // 永続化を行う関数
  async persist() {
    await chrome.storage.local.set({
      lastSession: {
        goal: this.goal,
        extracted: this.extracted,
        pageSummaries: this.pageSummaries
      }
    });
  }
}