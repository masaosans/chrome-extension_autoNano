export class AgentMemory {
  constructor(goal) {
    this.goal = goal;
    this.history = [];
  }

  addHistory(action) {
    this.history.push(action);
  }

  detectLoop() {
    if (this.history.length < 6) return false;
    const recent = this.history.slice(-6);
    const sig = recent.map(a => a.type + (a.selector || ""));
    return new Set(sig).size <= 2;
  }
}