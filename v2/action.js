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

                function dispatchRealClick(el) {
                  if (!el) return false;

                  const rect = el.getBoundingClientRect();
                  const x = rect.left + rect.width / 2;
                  const y = rect.top + rect.height / 2;

                  ['mousedown', 'mouseup', 'click'].forEach(type => {
                    el.dispatchEvent(new MouseEvent(type, {
                      view: window,
                      bubbles: true,
                      cancelable: true,
                      clientX: x,
                      clientY: y
                    }));
                  });

                  return true;
                }

                function isClickable(el) {
                  if (!el) return false;

                  if (el.tagName === 'A' && el.href) return true;
                  if (el.tagName === 'BUTTON') return true;
                  if (el.tagName === 'INPUT' &&
                    ['button','submit','checkbox','radio'].includes(el.type)) return true;

                  if (el.getAttribute?.('role') === 'button') return true;

                  if (el.tabIndex >= 0) return true;

                  const style = window.getComputedStyle(el);
                  if (style.cursor === 'pointer') return true;

                  return false;
                }

                // 自分から祖先へ探索
                let el = this;
                while (el) {
                  if (isClickable(el)) {
                    return dispatchRealClick(el);
                  }
                  el = el.parentElement;
                }

                // 最後の保険
                return dispatchRealClick(this);
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

                function findInput(el) {
                  if (!el) return null;

                  if (
                    el.tagName === 'INPUT' ||
                    el.tagName === 'TEXTAREA'
                  ) return el;

                  if (el.isContentEditable) return el;

                  return el.querySelector?.('input, textarea, [contenteditable="true"]');
                }

                const inputEl = findInput(this);
                if (!inputEl) return;

                if (inputEl.disabled || inputEl.readOnly) return;

                inputEl.focus();

                // React対策：native setterを使う
                const descriptor = Object.getOwnPropertyDescriptor(
                  inputEl.__proto__,
                  'value'
                );

                if (descriptor && descriptor.set) {
                  descriptor.set.call(inputEl, text);
                } else {
                  inputEl.value = text;
                }

                // contenteditable対応
                if (inputEl.isContentEditable) {
                  inputEl.textContent = text;
                }

                // 疑似キーボードイベント
                ['keydown','keypress','input','keyup','change'].forEach(type => {
                  inputEl.dispatchEvent(new Event(type, { bubbles: true }));
                });

                return true;
              }
           `,
            arguments: [{ value: params.text }]
          }
        );

        log({ level: "debug", message: "Input executed" });
        break;
      }
      // =========================
      // submit
      // =========================
      case "submit": {

        if (!params.id) {
          log({ level: "error", message: "Submit missing AX id" });
          break;
        }

        const backendNodeId = parseInt(params.id);

        log({
          level: "info",
          message: `Submit requested backendNodeId=${backendNodeId}`
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

                function findForm(el) {
                  if (!el) return null;
                  if (el.tagName === 'FORM') return el;
                  return el.closest ? el.closest('form') : null;
                }

                const form = findForm(this);

                // 1 requestSubmit (最も自然)
                if (form && typeof form.requestSubmit === 'function') {
                  form.requestSubmit();
                  return "requestSubmit";
                }

                // 2 submitボタンを探してクリック
                if (form) {
                  const btn = form.querySelector(
                    'button[type="submit"], input[type="submit"]'
                  );
                  if (btn) {
                    btn.click();
                    return "buttonClick";
                  }
                }

                // 3 Enterキー疑似送信
                const el = this;
                if (el) {
                  el.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true
                  }));
                  el.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true
                  }));
                  return "enterKey";
                }

                // 4 最終手段
                if (form) {
                  form.submit();
                  return "submitDirect";
                }

                return "noForm";
              }
            `
          }
        );

        log({ level: "debug", message: "Submit executed" });
        break;
      }
      
      // =========================
      // history_back
      // =========================
      case "history_back": {

        log({
          level: "info",
          message: "History back requested"
        });

        await chrome.debugger.sendCommand(
          debuggee,
          "Runtime.evaluate",
          {
            expression: `
              (function() {

                return new Promise((resolve) => {

                  let resolved = false;

                  function done(type) {
                    if (!resolved) {
                      resolved = true;
                      resolve(type);
                    }
                  }

                  // popstateを監視（SPA対応）
                  window.addEventListener("popstate", () => {
                    done("popstate");
                  }, { once: true });

                  // 通常の戻る
                  if (window.history.length > 1) {
                    window.history.back();
                    setTimeout(() => done("historyBack"), 1500);
                  } else {
                    done("noHistory");
                  }

                });

              })();
            `
          }
        );

        log({ level: "debug", message: "History back executed" });

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