export async function getAXTree(tabId, log) {

  const debuggee = { tabId };

  try {
    await chrome.debugger.attach(debuggee, "1.3");

    const result = await chrome.debugger.sendCommand(
      debuggee,
      "Accessibility.getFullAXTree"
    );

    await chrome.debugger.detach(debuggee);

    log({ level: "info", message: "AX Tree acquired" });

    return simplifyAX(result.nodes);

  } catch (e) {
    log({ level: "error", message: "AX Tree error: " + e.message });
    try {
      await chrome.debugger.detach(debuggee);
    } catch {}
    return null;
  }
}

function simplifyAX(nodes) {
  return nodes
    .filter(n => n.name?.value || n.role?.value)
    .map(n => ({
      role: n.role?.value,
      name: n.name?.value,
      ignored: n.ignored,
      id: n.nodeId
    }))
    .slice(0, 300); // トークン節約
}