import { writeMemory, readMemory, deleteMemory } from "./memory.js";

export async function executeAction(action, log) {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!action) {
    log({ level: "warn", message: "No action received" });
    return "STOP";
  }

  switch (action.type) {

    case "click":
      log({ level: "info", message: `Clicking ${action.selector}` });
      await chrome.tabs.sendMessage(tab.id, {
        type: "CLICK",
        selector: action.selector
      });
      break;

    case "input":
      log({ level: "info", message: `Input to ${action.selector}` });
      await chrome.tabs.sendMessage(tab.id, {
        type: "INPUT",
        selector: action.selector,
        value: action.value
      });
      break;

    case "navigate":
      log({ level: "info", message: `Navigating to ${action.url}` });
      await chrome.tabs.update(tab.id, { url: action.url });
      return "STOP";

    case "write_memory":
      log({ level: "info", message: `Saving memory: ${action.title}` });
      await writeMemory(action.title, action.content);
      break;

    case "delete_memory":
      log({ level: "info", message: `Deleting memory ${action.id}` });
      await deleteMemory(action.id);
      break;

    default:
      log({ level: "warn", message: `Unknown action ${action.type}` });
  }
}