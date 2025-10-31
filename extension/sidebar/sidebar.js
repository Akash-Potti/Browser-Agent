// Sidebar JavaScript - Main Controller

// Configuration
const BACKEND_URL = "http://localhost:5000";

// State management
const state = {
  isExecuting: false,
  sessionId: null,
  currentTabId: null,
  actionHistory: [],
  backendConnected: false,
  stopRequested: false,
};

// DOM elements
const elements = {
  commandInput: document.getElementById("commandInput"),
  executeBtn: document.getElementById("executeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  statusText: document.getElementById("statusText"),
  statusBadge: document.getElementById("statusBadge"),
  currentStatus: document.getElementById("currentStatus"),
  progressBar: document.getElementById("progressBar"),
  actionHistory: document.getElementById("actionHistory"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  debugToggle: document.getElementById("debugToggle"),
  debugContent: document.getElementById("debugContent"),
  sessionIdDisplay: document.getElementById("sessionId"),
  tabIdDisplay: document.getElementById("tabId"),
  backendStatus: document.getElementById("backendStatus"),
};

// Initialize
document.addEventListener("DOMContentLoaded", init);

async function init() {
  console.log("Sidebar initialized");

  // Set up event listeners
  elements.executeBtn.addEventListener("click", handleExecute);
  elements.stopBtn.addEventListener("click", handleStop);
  elements.clearHistoryBtn.addEventListener("click", clearHistory);
  elements.debugToggle.addEventListener("click", toggleDebug);

  // Get current tab info
  await getCurrentTab();

  // Listen for tab changes from background to keep currentTabId fresh
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === "TAB_CHANGED") {
      state.currentTabId = message.tabId;
      elements.tabIdDisplay.textContent = message.tabId;
      console.log("Active tab changed:", message.tabId);
    } else if (message.type === "TAB_UPDATED") {
      // Update hostname label when the active tab updates
      if (message.tabId === state.currentTabId && message.url) {
        try {
          const hostname = new URL(message.url).hostname;
          elements.backendStatus.textContent = state.backendConnected
            ? `Connected ✓ (${hostname})`
            : `Disconnected ✗ (${hostname})`;
        } catch (_) {
          // ignore URL parse issues
        }
      }
    }
  });

  // Load saved history
  loadHistory();

  // Check backend connection
  await checkBackendConnection();

  // Update UI
  updateStatus("Ready", "idle");
}

// Check if backend is running
async function checkBackendConnection() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    if (response.ok) {
      state.backendConnected = true;
      elements.backendStatus.textContent = "Connected ✓";
      elements.backendStatus.style.color = "#22c55e";
      console.log("Backend connected");
    } else {
      throw new Error("Backend unhealthy");
    }
  } catch (error) {
    state.backendConnected = false;
    elements.backendStatus.textContent = "Disconnected ✗";
    elements.backendStatus.style.color = "#ef4444";
    console.error("Backend not connected:", error);
  }
}

// Get current active tab
async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      state.currentTabId = tab.id;
      elements.tabIdDisplay.textContent = tab.id;
      console.log("Current tab:", tab.id, tab.url);

      // Update backend status display with tab URL
      if (tab.url) {
        const hostname = new URL(tab.url).hostname;
        elements.backendStatus.textContent = state.backendConnected
          ? `Connected ✓ (${hostname})`
          : `Disconnected ✗ (${hostname})`;
      }
    }
  } catch (error) {
    console.error("Error getting current tab:", error);
    updateStatus("Could not access current tab", "error");
  }
}

// Handle execute button click
async function handleExecute() {
  const command = elements.commandInput.value.trim();

  if (!command) {
    updateStatus("Please enter a command", "error");
    return;
  }

  if (!state.currentTabId) {
    updateStatus("No active tab found", "error");
    return;
  }

  if (!state.backendConnected) {
    updateStatus(
      "Backend not connected. Please start the Flask server.",
      "error"
    );
    addToHistory("error", "Backend not available. Run: python app.py");
    return;
  }

  console.log("Executing command:", command);

  // Update UI state
  state.stopRequested = false;
  state.isExecuting = true;
  elements.executeBtn.disabled = true;
  elements.stopBtn.disabled = false;
  elements.commandInput.disabled = true;

  updateStatus("Creating session...", "executing");
  showProgress(true);

  try {
    // Step 1: Create session with backend
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const sessionResponse = await createBackendSession(command, tab.url);

    if (!sessionResponse.success) {
      throw new Error("Failed to create session");
    }

    state.sessionId = sessionResponse.session_id;
    elements.sessionIdDisplay.textContent = state.sessionId;

    addToHistory("started", `Task: ${command}`);
    updateStatus("Capturing page DOM...", "executing");

    // Step 2: Capture DOM from page
    const domResponse = await captureDOMFromPage();

    if (!domResponse.success) {
      throw new Error(domResponse.error || "Failed to capture DOM");
    }

    console.log("DOM captured:", domResponse.statistics);
    updateStatus(
      `Analyzing ${domResponse.statistics.total} elements with Gemini...`,
      "executing"
    );
    addToHistory(
      "info",
      `Captured ${domResponse.statistics.total} interactive elements`
    );

    // Step 3: Send DOM to backend for Gemini analysis
    const analysisResponse = await sendDOMToBackend(domResponse.data);

    if (!analysisResponse.success) {
      throw new Error("Failed to analyze DOM");
    }

    console.log("Gemini analysis:", analysisResponse.analysis);
    displayGeminiAnalysis(analysisResponse.analysis);

    addToHistory("info", "Starting action execution loop");
    updateStatus("Executing planned actions...", "executing");

    await startAutomationLoop(domResponse.data);
  } catch (error) {
    console.error("Execution error:", error);
    updateStatus(`Error: ${error.message}`, "error");
    addToHistory("error", error.message);
    resetUI();
    if (state.sessionId) {
      await completeBackendSession(false, error.message);
    }
    state.sessionId = null;
    elements.sessionIdDisplay.textContent = "-";
  }
}

// Create session with backend
async function createBackendSession(goal, url) {
  const response = await fetch(`${BACKEND_URL}/session/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ goal, url }),
  });

  return await response.json();
}

// Capture DOM from current page
async function captureDOMFromPage() {
  // Try to capture DOM from all frames; fall back to top frame if needed
  const frames = await getAllFramesSafe(state.currentTabId);
  if (!frames || frames.length <= 1) {
    return await sendMessageToContentScript({
      type: "CAPTURE_DOM",
      sessionId: state.sessionId,
    });
  }

  const results = [];
  for (const f of frames) {
    try {
      const res = await sendMessageToContentScript(
        {
          type: "CAPTURE_DOM",
          sessionId: state.sessionId,
        },
        f.frameId
      );
      if (res && res.success && res.data) {
        results.push({ frameId: f.frameId, url: f.url, data: res.data });
      }
    } catch (e) {
      // Ignore frames that don't respond (cross-origin or restricted)
    }
  }

  if (results.length === 0) {
    // Fallback to top frame single capture
    return await sendMessageToContentScript({
      type: "CAPTURE_DOM",
      sessionId: state.sessionId,
    });
  }

  // Merge elements from all responding frames
  const top = results.find((r) => r.frameId === 0) || results[0];
  const merged = {
    url: top.data.url,
    title: top.data.title,
    timestamp: Date.now(),
    elementCount: 0,
    elements: [],
    viewport: top.data.viewport,
  };

  for (const r of results) {
    if (Array.isArray(r.data.elements)) {
      // Tag elements with source frame info for debugging
      const elems = r.data.elements.map((el) => ({
        ...el,
        _frameId: r.frameId,
        _frameUrl: r.url,
      }));
      merged.elements.push(...elems);
    }
  }
  merged.elementCount = merged.elements.length;

  return {
    success: true,
    sessionId: state.sessionId,
    data: merged,
    statistics: {
      total: merged.elements.length,
      inViewport: merged.elements.filter((el) => el.isInViewport).length,
    },
  };
}

async function sendMessageToContentScript(message, frameId) {
  if (!state.currentTabId) {
    throw new Error("No active tab available");
  }

  // Guard against unsupported pages (e.g., chrome://, chrome web store, PDFs)
  try {
    const tab = await chrome.tabs.get(state.currentTabId);
    const url = tab?.url || "";
    if (!isUrlSupportedForContentScripts(url)) {
      throw new Error(
        "This page doesn't allow content scripts (e.g., chrome://, Chrome Web Store, or PDF). Open a regular website and try again."
      );
    }
  } catch (e) {
    if (e && e.message && e.message.startsWith("This page doesn't allow")) {
      // Re-throw friendly error
      throw e;
    }
    // If tabs.get fails, surface a clear error
    throw new Error(
      "Unable to access the current tab. Please switch to a normal webpage."
    );
  }

  const attempt = () =>
    new Promise((resolve, reject) => {
      const options = typeof frameId === "number" ? { frameId } : undefined;
      chrome.tabs.sendMessage(
        state.currentTabId,
        message,
        options,
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });

  try {
    return await attempt();
  } catch (error) {
    const missingReceiverMessage =
      "Could not establish connection. Receiving end does not exist.";

    if (error.message && error.message.includes(missingReceiverMessage)) {
      console.warn(
        "Content script missing on tab",
        state.currentTabId,
        "Attempting reinjection."
      );
      addToHistory(
        "info",
        `Content script not detected on tab ${state.currentTabId}. Attempting reinjection...`
      );

      await injectContentScripts();
      // Give the scripts a brief moment to initialize
      await delay(150);
      return await attempt();
    }

    throw error;
  }
}

async function injectContentScripts() {
  if (!state.currentTabId) {
    throw new Error("No active tab available for script injection");
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.currentTabId, allFrames: true },
      files: [
        "utils/uid-generator.js",
        "content/dom-extractor.js",
        "content/content-script.js",
      ],
    });
    addToHistory("success", "Content scripts injected successfully");
  } catch (error) {
    console.error("Failed to inject content scripts:", error);
    const msg = String(error?.message || "").toLowerCase();
    if (
      msg.includes("cannot access contents of url") ||
      msg.includes("the extensions gallery cannot be scripted") ||
      msg.includes("chrome://") ||
      msg.includes("edge://") ||
      msg.includes("moz-extension://")
    ) {
      throw new Error(
        "Cannot inject scripts into this page (e.g., chrome://, Chrome Web Store, or PDF). Navigate to a regular http(s) webpage and try again."
      );
    }
    throw error;
  }
}

// Send DOM to backend for analysis
async function sendDOMToBackend(domData) {
  const response = await fetch(
    `${BACKEND_URL}/session/${state.sessionId}/dom`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dom_data: domData }),
    }
  );

  return await response.json();
}

async function requestNextAction(domData, previousResult) {
  // Single retry wrapper: on network/server error, recapture DOM and retry once
  const doRequest = async (payload) => {
    const resp = await fetch(
      `${BACKEND_URL}/session/${state.sessionId}/next-action`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      // if body isn't JSON, treat as failure
      throw new Error("Failed to parse backend response");
    }
    if (!resp.ok || !json.success) {
      throw new Error(json.error || `Backend error: ${resp.status}`);
    }
    return json;
  };

  const payload = { dom_data: domData, previous_result: previousResult };
  try {
    return await doRequest(payload);
  } catch (err) {
    const msg = String(err.message || "").toLowerCase();
    const transient =
      msg.includes("failed to fetch") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("internal server error") ||
      msg.includes("bad gateway") ||
      msg.includes("service unavailable") ||
      msg.includes("planner error") ||
      msg.includes("gemini");

    if (!transient) throw err;

    // Retry once with a fresh DOM snapshot
    try {
      const domCapture = await captureDOMFromPage();
      if (domCapture?.success && domCapture.data) {
        return await doRequest({
          dom_data: domCapture.data,
          previous_result: previousResult,
        });
      }
    } catch (e) {
      // fall through to throw original error
    }
    throw err;
  }
}

async function executeActionOnPage(action) {
  // Try in top frame first
  let response = await sendMessageToContentScript({
    type: "EXECUTE_ACTION",
    sessionId: state.sessionId,
    action,
  });

  if (response && response.success === true) {
    return response;
  }

  // If element not found or no response, try all frames
  const notFound = !response || isElementNotFound(response);
  if (!notFound) {
    return response;
  }

  const frames = await getAllFramesSafe(state.currentTabId);
  for (const f of frames) {
    try {
      const res = await sendMessageToContentScript(
        {
          type: "EXECUTE_ACTION",
          sessionId: state.sessionId,
          action,
        },
        f.frameId
      );
      if (res && res.success) {
        return res;
      }
    } catch (e) {
      // ignore this frame
    }
  }

  // Return the original response or a fallback error
  return (
    response || {
      success: false,
      error: "Element not found in any frame",
    }
  );
}

function isElementNotFound(res) {
  const msg = String(res?.error || res?.message || "").toLowerCase();
  return (
    msg.includes("element not found") ||
    msg.includes("target is not") ||
    msg.includes("no form found")
  );
}

function buildActionResultForBackend(action, executionResult) {
  if (!executionResult) {
    return null;
  }

  return {
    success: Boolean(executionResult.success),
    action: action?.type,
    target_uid: action?.target_uid || null,
    value: action?.value,
    reasoning: action?.reasoning,
    error: executionResult.error,
    message: executionResult.message,
    navigated: executionResult.navigated,
    url:
      executionResult.url ||
      executionResult.target_url ||
      executionResult.targetUrl ||
      null,
    errors: executionResult.errors,
    successes: executionResult.successes,
    navigation_pending: executionResult.navigationPending || false,
  };
}

async function startAutomationLoop(initialDomData) {
  let currentDom = initialDomData;
  let previousResultForBackend = null;
  let iteration = 0;
  const maxIterations = 20;
  let outcome = null;

  while (iteration < maxIterations) {
    if (state.stopRequested) {
      outcome = { status: "stopped", message: "Execution stopped by user" };
      break;
    }

    if (!currentDom) {
      try {
        const domCapture = await captureDOMFromPage();
        if (domCapture?.success && domCapture.data) {
          currentDom = domCapture.data;
        } else {
          throw new Error(domCapture?.error || "Empty DOM snapshot returned");
        }
      } catch (error) {
        outcome = {
          status: "error",
          message: `Unable to capture DOM: ${error.message}`,
        };
        break;
      }
    }

    let actionPlanData;
    try {
      actionPlanData = await requestNextAction(
        currentDom,
        previousResultForBackend
      );
    } catch (error) {
      outcome = { status: "error", message: error.message };
      break;
    }

    const actionPlan = actionPlanData.action_plan;

    if (!actionPlan) {
      outcome = {
        status: "error",
        message: "Backend returned an empty action plan",
      };
      break;
    }

    if (actionPlan.complete) {
      outcome = {
        status: "success",
        message: actionPlan.reason || "Goal achieved",
        confidence: actionPlan.confidence,
      };
      break;
    }

    const action = actionPlan.next_action;

    if (!action) {
      outcome = {
        status: "error",
        message: "Backend did not provide a next action",
      };
      break;
    }

    addToHistory(
      "info",
      `${action.type.toUpperCase()} on ${action.target_uid || "target"}`
    );

    let executionResult;
    try {
      executionResult = await executeActionOnPage(action);
    } catch (error) {
      outcome = { status: "error", message: error.message };
      break;
    }

    if (!executionResult || typeof executionResult.success === "undefined") {
      outcome = {
        status: "error",
        message: "Content script returned an unexpected response",
      };
      break;
    }

    previousResultForBackend = buildActionResultForBackend(
      action,
      executionResult
    );

    if (!executionResult.success) {
      const errMsg = (
        executionResult.error ||
        executionResult.message ||
        ""
      ).toLowerCase();
      const transientPatterns = [
        "element not found",
        "failed to fetch",
        "network",
        "timeout",
        "detached",
        "stale",
        "not clickable",
        "intercepted",
      ];
      const isTransient = transientPatterns.some((p) => errMsg.includes(p));

      if (isTransient) {
        if (executionResult.new_dom) {
          addToHistory(
            "info",
            "Transient error; recaptured DOM. Retrying planning..."
          );
          currentDom = executionResult.new_dom;
          await delay(150);
          continue;
        } else {
          // Try to capture DOM ourselves once
          try {
            const domCapture = await captureDOMFromPage();
            if (domCapture?.success && domCapture.data) {
              addToHistory(
                "info",
                "Transient error; captured DOM. Retrying planning..."
              );
              currentDom = domCapture.data;
              await delay(150);
              continue;
            }
          } catch (e) {
            // fall through
          }
        }
      }

      outcome = {
        status: "error",
        message:
          executionResult.error ||
          executionResult.message ||
          "Action execution failed",
      };
      break;
    }

    if (executionResult.message) {
      addToHistory("info", executionResult.message);
    }

    if (executionResult.errors && executionResult.errors.length > 0) {
      addToHistory(
        "error",
        `Page errors: ${executionResult.errors.slice(0, 3).join(", ")}`
      );
    }

    if (executionResult.successes && executionResult.successes.length > 0) {
      addToHistory(
        "success",
        `Page notices: ${executionResult.successes.slice(0, 3).join(", ")}`
      );
    }

    if (executionResult.navigated) {
      const navUrl = executionResult.url || "";
      const targetLogUrl =
        executionResult.target_url || executionResult.targetUrl || "";
      const displayUrl =
        !navUrl || navUrl.startsWith("about:blank")
          ? targetLogUrl || navUrl
          : navUrl;
      const navigationMessage = displayUrl
        ? `Navigated to ${displayUrl}`
        : "Navigation detected";
      addToHistory("info", navigationMessage);
      await delay(1500);
    }

    currentDom = executionResult.new_dom || null;
    iteration += 1;

    if (!state.stopRequested) {
      await delay(250);
    }
  }

  if (!outcome) {
    outcome = {
      status: "error",
      message: "Reached iteration limit without completing the task",
    };
  }

  await finalizeExecution(outcome);
}

async function completeBackendSession(success, message) {
  if (!state.sessionId) {
    return;
  }

  try {
    await fetch(`${BACKEND_URL}/session/${state.sessionId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success,
        message,
      }),
    });
  } catch (error) {
    console.warn("Failed to notify backend about completion:", error);
  }
}

async function finalizeExecution(outcome) {
  showProgress(false);

  if (!outcome) {
    outcome = { status: "error", message: "Unknown execution outcome" };
  }

  switch (outcome.status) {
    case "success":
      updateStatus(outcome.message || "Task completed", "success");
      addToHistory("success", outcome.message || "Task completed");
      await completeBackendSession(true, outcome.message || "Task completed");
      break;
    case "stopped":
      updateStatus("Task stopped by user", "stopped");
      addToHistory("stopped", "Execution stopped by user");
      await completeBackendSession(false, "Stopped by user");
      break;
    default:
      updateStatus(outcome.message || "Automation failed", "error");
      addToHistory("error", outcome.message || "Automation failed");
      await completeBackendSession(
        false,
        outcome.message || "Automation failed"
      );
      break;
  }

  state.sessionId = null;
  elements.sessionIdDisplay.textContent = "-";

  resetUI();
}

// Display Gemini's analysis
function displayGeminiAnalysis(analysis) {
  const understanding = analysis.understanding || "No analysis available";
  const confidence = analysis.confidence || 0;
  const firstAction = analysis.first_action;

  addToHistory("info", `🧠 Gemini: ${understanding}`);
  addToHistory("info", `📊 Confidence: ${(confidence * 100).toFixed(0)}%`);

  if (firstAction) {
    const actionDesc = `${firstAction.type} on ${firstAction.target_uid}`;
    addToHistory("info", `🎯 Suggested action: ${actionDesc}`);
    addToHistory("info", `💭 Reasoning: ${firstAction.reasoning}`);
  }

  if (analysis.next_steps && analysis.next_steps.length > 0) {
    addToHistory("info", `📋 Next steps: ${analysis.next_steps.join(", ")}`);
  }
}

// Handle stop button click
function handleStop() {
  if (!state.isExecuting || state.stopRequested) {
    return;
  }

  console.log("Stop requested by user");
  state.stopRequested = true;
  elements.stopBtn.disabled = true;
  addToHistory("info", "Stop requested. Finishing current step...");
  updateStatus("Stopping task after current step...", "executing");
}

// Update status display
function updateStatus(message, type = "idle") {
  elements.currentStatus.textContent = message;
  elements.statusText.textContent =
    type.charAt(0).toUpperCase() + type.slice(1);

  // Update status badge color
  const dot = elements.statusBadge.querySelector(".status-dot");
  switch (type) {
    case "executing":
      dot.style.background = "#f59e0b";
      break;
    case "success":
      dot.style.background = "#22c55e";
      break;
    case "error":
    case "stopped":
      dot.style.background = "#ef4444";
      break;
    default:
      dot.style.background = "#4ade80";
  }
}

// Show/hide progress bar
function showProgress(show) {
  elements.progressBar.style.display = show ? "block" : "none";
}

// Add item to history
function addToHistory(type, message) {
  const timestamp = new Date().toLocaleTimeString();
  const item = { type, message, timestamp };

  state.actionHistory.unshift(item);

  // Create history item element
  const historyItem = document.createElement("div");
  historyItem.className = `history-item ${type}`;
  historyItem.innerHTML = `
    <div class="history-item-header">
      <span class="history-item-action">${getActionIcon(
        type
      )} ${type.toUpperCase()}</span>
      <span class="history-item-time">${timestamp}</span>
    </div>
    <div class="history-item-details">${message}</div>
  `;

  elements.actionHistory.insertBefore(
    historyItem,
    elements.actionHistory.firstChild
  );

  // Save to storage
  saveHistory();
}

// Get icon for action type
function getActionIcon(type) {
  const icons = {
    started: "▶️",
    success: "✅",
    error: "❌",
    stopped: "⏹️",
    info: "ℹ️",
  };
  return icons[type] || "•";
}

// Clear history
function clearHistory() {
  if (confirm("Clear all action history?")) {
    state.actionHistory = [];
    elements.actionHistory.innerHTML =
      '<div class="empty-state">No actions yet</div>';
    saveHistory();
  }
}

// Save history to storage
function saveHistory() {
  chrome.storage.local.set({
    actionHistory: state.actionHistory.slice(0, 50), // Keep last 50 items
  });
}

// Load history from storage
function loadHistory() {
  chrome.storage.local.get(["actionHistory"], (result) => {
    if (result.actionHistory && result.actionHistory.length > 0) {
      state.actionHistory = result.actionHistory;
      elements.actionHistory.innerHTML = "";
      result.actionHistory.forEach((item) => {
        const historyItem = document.createElement("div");
        historyItem.className = `history-item ${item.type}`;
        historyItem.innerHTML = `
          <div class="history-item-header">
            <span class="history-item-action">${getActionIcon(
              item.type
            )} ${item.type.toUpperCase()}</span>
            <span class="history-item-time">${item.timestamp}</span>
          </div>
          <div class="history-item-details">${item.message}</div>
        `;
        elements.actionHistory.appendChild(historyItem);
      });
    } else {
      elements.actionHistory.innerHTML =
        '<div class="empty-state">No actions yet</div>';
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUrlSupportedForContentScripts(url) {
  if (!url || typeof url !== "string") return false;
  // Allow only http(s) by default. file:// requires optional permission not declared.
  return url.startsWith("http://") || url.startsWith("https://");
}

async function getAllFramesSafe(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    // Ensure at least top frame (0) exists in list
    const hasTop = frames.some((f) => f.frameId === 0);
    return hasTop
      ? frames
      : [{ frameId: 0, url: (await chrome.tabs.get(tabId)).url }];
  } catch (e) {
    // Permission missing or API unavailable; return top frame only
    try {
      const tab = await chrome.tabs.get(tabId);
      return [{ frameId: 0, url: tab.url }];
    } catch (_) {
      return [{ frameId: 0, url: "" }];
    }
  }
}

// Toggle debug section
function toggleDebug() {
  const isVisible = elements.debugContent.style.display !== "none";
  elements.debugContent.style.display = isVisible ? "none" : "block";
  elements.debugToggle.textContent = isVisible
    ? "Show Debug Info ▼"
    : "Hide Debug Info ▲";
}

// Reset UI after execution
function resetUI() {
  state.isExecuting = false;
  state.stopRequested = false;
  elements.executeBtn.disabled = false;
  elements.stopBtn.disabled = true;
  elements.commandInput.disabled = false;
  showProgress(false);
}

// Generate session ID
function generateSessionId() {
  return (
    "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)
  );
}

// Test content script connection
async function testContentScript() {
  try {
    const response = await chrome.tabs.sendMessage(state.currentTabId, {
      type: "PING",
    });
    console.log("Content script response:", response);
    return true;
  } catch (error) {
    console.error("Content script not responding:", error);
    return false;
  }
}
