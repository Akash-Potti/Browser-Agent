console.log("Background service worker loaded");

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed:", details);

  if (details.reason === "install") {
    console.log("First time installation tasks can be performed here.");
    chrome.storage.local.set({
      actionHistory: [],
      settings: {
        backendUrl: "http://localhost:5000",
        maxRetries: 3,
        timeout: 30000,
      },
    });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  console.log("Extension icon clicked, opening sidebar for tab:", tab.id);
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received:", message.type, "from:", sender);

  switch (message.type) {
    case "EXECUTE_TASK":
      handleExecuteTask(message, sender, sendResponse);
      return true; // Keep the message channel open for sendResponse
    case "STOP_TASK":
      handleStopTask(message, sender, sendResponse);
      return true; // Keep the message channel open for sendResponse
    case "GET_SETTINGS":
      handleGetSettings(sendResponse);
      return true; // Keep the message channel open for sendResponse
    case "LOG":
      console.log(
        "Log from",
        sender.tab ? "content" : "sidebar",
        ":",
        message.data
      );
      sendResponse({ success: true });
      break;
    default:
      console.log("Unknown message type:", message.type);
      sendResponse({ success: false, error: "Unknown message type" });
  }
});

async function handleExecuteTask(message, sender, sendResponse) {
  console.log("Handling task execution:", message.command);

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      sendResponse({ success: false, error: "No active tab found" });
      return;
    }

    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://")
    ) {
      sendResponse({
        success: false,
        error: "Cannot access Chrome internal pages",
      });
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_DOM",
      sessionId: message.sessionId,
    });

    console.log("DOM capture response:", response);

    sendResponse({
      success: true,
      data: response,
      tabId: tab.id,
    });
  } catch (error) {
    console.error("Error executing task:", error);
    sendResponse({
      success: false,
      error: error.message || "Failed to execute task",
    });
  }
}

function handleStopTask(message, sender, sendResponse) {
  console.log("Stopping task:", message.sessionId);

  // Here we would cancel any ongoing operations
  // For now, just acknowledge

  sendResponse({ success: true });
}

async function handleGetSettings(sendResponse) {
  chrome.storage.local.get(["settings"], (result) => {
    sendResponse({
      success: true,
      settings: result.settings || {},
    });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    console.log("Tab loaded:", tabId, tab.url);

    // Notify sidebar if it's open
    chrome.runtime
      .sendMessage({
        type: "TAB_UPDATED",
        tabId: tabId,
        url: tab.url,
      })
      .catch(() => {
        // Sidebar might not be open, ignore error
      });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);

  // Notify sidebar about tab change
  chrome.runtime
    .sendMessage({
      type: "TAB_CHANGED",
      tabId: activeInfo.tabId,
    })
    .catch(() => {
      // Sidebar might not be open, ignore error
    });
});

chrome.alarms.create("cleanup", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") {
    console.log("Running periodic cleanup...");

    // Clean up old history items
    chrome.storage.local.get(["actionHistory"], (result) => {
      if (result.actionHistory && result.actionHistory.length > 100) {
        const trimmed = result.actionHistory.slice(0, 50);
        chrome.storage.local.set({ actionHistory: trimmed });
        console.log("Cleaned up old history items");
      }
    });
  }
});
