import { writeMemory, deleteMemory } from "./memory.js";

export async function executeAction(action, log) {

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab) {
    log({ level: "error", message: "No active tab found" });
    return "STOP";
  }

  if (!action) {
    log({ level: "warn", message: "No action received" });
    return "STOP";
  }

  const actionType = action.action;
  const params = action.params || {};

  log({
    level: "debug",
    message: `Action received: ${JSON.stringify(action)}`
  });

  const debuggee = { tabId: tab.id };

  try {

    await chrome.debugger.attach(debuggee, "1.3");
    log({ level: "debug", message: "Debugger attached" });

    switch (actionType) {

      // =========================
      // CLICK
      // =========================
      case "click": {

        if (!params.id) {
          log({ level: "error", message: "Click missing AX id" });
          break;
        }

        const backendNodeId = parseInt(params.id);

        log({
          level: "info",
          message: `Click requested backendNodeId=${backendNodeId}`
        });

        const { object } = await chrome.debugger.sendCommand(
          debuggee,
          "DOM.resolveNode",
          { backendNodeId }
        );

        await chrome.debugger.sendCommand(
          debuggee,
          "Runtime.callFunctionOn",
          {
            objectId: object.objectId,
            functionDeclaration: `
              function() {

                function findLink(el) {
                  if (!el) return null;

                  if (el.tagName === 'A' && el.href)
                    return el;

                  return el.closest ? el.closest('a[href]') : null;
                }

                // 1. 自分 or 祖先からリンクを探す
                const link = findLink(this);

                if (link && link.href) {
                  window.location.href = link.href;
                  return;
                }

                // 2. ボタンなどは通常クリック
                function isClickable(el) {
                  if (!el) return false;

                  if (el.tagName === 'BUTTON') return true;
                  if (el.getAttribute && el.getAttribute('role') === 'button') return true;
                  if (typeof el.onclick === 'function') return true;

                  const style = window.getComputedStyle(el);
                  if (style.cursor === 'pointer') return true;

                  return false;
                }

                if (isClickable(this)) {
                  this.click();
                  return;
                }

                let el = this.parentElement;
                while (el) {
                  if (isClickable(el)) {
                    el.click();
                    return;
                  }
                  el = el.parentElement;
                }

                this.click();
              }
            `
          }
        );

        log({ level: "debug", message: "Click executed" });
        break;
      }

      // =========================
      // INPUT
      // =========================
      case "input": {

        if (!params.id || !params.text) {
          log({ level: "error", message: "Input missing id/text" });
          break;
        }

        const backendNodeId = parseInt(params.id);

        log({
          level: "info",
          message: `Input requested backendNodeId=${backendNodeId}`
        });

        const { object } = await chrome.debugger.sendCommand(
          debuggee,
          "DOM.resolveNode",
          { backendNodeId }
        );

        await chrome.debugger.sendCommand(
          debuggee,
          "Runtime.callFunctionOn",
          {
            objectId: object.objectId,
            functionDeclaration: `
              function(text) {

                if (this.tagName !== 'INPUT' && this.tagName !== 'TEXTAREA') {
                  let el = this.querySelector('input, textarea');
                  if (el) {
                    el.value = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return;
                  }
                }

                this.value = text;
                this.dispatchEvent(new Event('input', { bubbles: true }));
                this.dispatchEvent(new Event('change', { bubbles: true }));
              }
            `,
            arguments: [{ value: params.text }]
          }
        );

        log({ level: "debug", message: "Input executed" });
        break;
      }

      // =========================
      // NAVIGATE
      // =========================
      case "navigate": {

        if (!params.url) {
          log({ level: "error", message: "Navigate missing url" });
          break;
        }

        log({
          level: "info",
          message: `Navigating to ${params.url}`
        });

        await chrome.tabs.update(tab.id, { url: params.url });

        await chrome.debugger.detach(debuggee);
        log({ level: "debug", message: "Debugger detached (navigate)" });

        return "STOP";
      }

      // =========================
      // WRITE MEMORY
      // =========================
      case "write_memory": {

        if (!params.text) {
          log({ level: "error", message: "write_memory missing text" });
          break;
        }

        const title = "Memory_" + Date.now();

        log({
          level: "info",
          message: `Saving memory (${title})`
        });

        await writeMemory(title, params.text);

        log({ level: "debug", message: "Memory saved" });
        break;
      }

      // =========================
      // DELETE MEMORY
      // =========================
      case "delete_memory": {

        if (!params.id) {
          log({ level: "error", message: "delete_memory missing id" });
          break;
        }

        log({
          level: "info",
          message: `Deleting memory ${params.id}`
        });

        await deleteMemory(params.id);

        log({ level: "debug", message: "Memory deleted" });
        break;
      }

      // =========================
      // STOP
      // =========================
      case "stop": {
        log({ level: "info", message: "STOP received" });
        await chrome.debugger.detach(debuggee);
        return "STOP";
      }

      default: {
        log({
          level: "warn",
          message: `Unknown action type: ${actionType}`
        });
      }
    }

    await chrome.debugger.detach(debuggee);
    log({ level: "debug", message: "Debugger detached" });

  } catch (e) {

    log({
      level: "error",
      message: `Action execution error: ${e.message}`
    });

    try {
      await chrome.debugger.detach(debuggee);
    } catch {}

    return "STOP";
  }
}