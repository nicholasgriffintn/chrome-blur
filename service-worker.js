importScripts("lib/text-conditions.js", "lib/state.js");

const { STORAGE_KEY, createDefaultState } = BlurCore;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: createDefaultState() });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "PAGE_STATUS" || !sender.tab?.id) return;

  const count = Number.isInteger(message.profileCount) ? message.profileCount : 0;
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#ff6b4a" });
});
