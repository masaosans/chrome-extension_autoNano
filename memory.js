export class AgentMemory {
  constructor(goal) {
    this.goal = goal;
    this.visited = new Set();
    this.pageSummaries = {};
    this.extracted = [];
    this.history = [];
  }

  addVisit(url) {
    this.visited.add(url);
  }

  addSummary(url, summary) {
    this.pageSummaries[url] = summary;
  }

  addExtracted(items) {
    this.extracted.push(...items);
  }

  addHistory(action, result) {
    this.history.push({ action, result });
  }

  buildWorkingMemory(currentUrl) {
    return {
      goal: this.goal,
      currentUrl,
      visitedCount: this.visited.size,
      collectedCount: this.extracted.length
    };
  }

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