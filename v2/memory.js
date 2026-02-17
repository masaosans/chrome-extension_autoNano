export async function writeMemory(title, content) {
  const { agentMemory = [] } = await chrome.storage.local.get("agentMemory");

  const entry = {
    id: crypto.randomUUID(),
    title,
    content,
    timestamp: new Date().toISOString()
  };

  agentMemory.push(entry);

  await chrome.storage.local.set({ agentMemory });

  return entry;
}

export async function readMemory() {
  const { agentMemory = [] } = await chrome.storage.local.get("agentMemory");
  return agentMemory;
}

export async function deleteMemory(id) {
  const { agentMemory = [] } = await chrome.storage.local.get("agentMemory");
  const updated = agentMemory.filter(m => m.id !== id);
  await chrome.storage.local.set({ agentMemory: updated });
}