// Sidebar JavaScript - Main Controller

// Configuration
const BACKEND_URL = "http://localhost:5000";

// State management
const state = {
  isExecuting: false,
  sessionId: null,
  chatSessionId: null,
  currentTabId: null,
  actionHistory: [],
  chatHistory: [],
  backendConnected: false,
  stopRequested: false,
  currentTab: 'automation',
  currentDomData: null,
};

// DOM elements
const elements = {
// Existing automation elements
  commandInput: document.getElementById("commandInput"),
  executeBtn: document.getElementById("executeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  statusText: document.getElementById("statusText"),
  statusBadge: document.getElementById("statusBadge"),
  currentStatus: document.getElementById("currentStatus"),
  progressBar: document.getElementById("progressBar"),
  actionHistory: document.getElementById("actionHistory"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  
  // Tab navigation
  tabBtns: document.querySelectorAll(".tab-btn"),
  automationTab: document.getElementById("automation-tab"),
  chatTab: document.getElementById("chat-tab"),
  summaryTab: document.getElementById("summary-tab"),
  
  // Chat elements
  startChatBtn: document.getElementById("startChatBtn"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  chatMessages: document.getElementById("chatMessages"),
  chatInput: document.getElementById("chatInput"),
  sendChatBtn: document.getElementById("sendChatBtn"),
  chatInputContainer: document.querySelector(".chat-input-container"),
  
  // Summary elements
  summarizeBtn: document.getElementById("summarizeBtn"),
  summaryContent: document.getElementById("summaryContent"),
  summaryLoading: document.getElementById("summaryLoading"),
  
  // Debug elements
  debugToggle: document.getElementById("debugToggle"),
  debugContent: document.getElementById("debugContent"),
  sessionIdDisplay: document.getElementById("sessionId"),
  tabIdDisplay: document.getElementById("tabId"),
  backendStatus: document.getElementById("backendStatus"),
  chatSessionIdDisplay: document.getElementById("chatSessionId"),
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
setupEventListeners();
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
function setupEventListeners() {
  // Automation tab
  elements.executeBtn.addEventListener("click", handleExecute);
  elements.stopBtn.addEventListener("click", handleStop);
  elements.clearHistoryBtn.addEventListener("click", clearHistory);
  
  // Tab navigation
  elements.tabBtns.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  
  // Chat tab
  elements.startChatBtn.addEventListener("click", handleStartChat);
  elements.clearChatBtn.addEventListener("click", handleClearChat);
  elements.sendChatBtn.addEventListener("click", handleSendChat);
  elements.exportChatBtn?.addEventListener("click", handleExportChat);
  
  elements.chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  });
  
  // Auto-resize textarea
  elements.chatInput.addEventListener("input", () => {
    elements.chatInput.style.height = "auto";
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + "px";
  });
  
  // Example prompts
  elements.chatMessages.addEventListener("click", (e) => {
    if (e.target.classList.contains("example-prompt")) {
      const prompt = e.target.dataset.prompt;
      if (state.chatSessionId) {
        elements.chatInput.value = prompt;
        elements.chatInput.focus();
      }
    }
  });
  
  // Summary tab
  elements.summarizeBtn.addEventListener("click", handleSummarize);
  elements.copySummaryBtn?.addEventListener("click", handleCopySummary);
  elements.exportSummaryBtn?.addEventListener("click", handleExportSummary);
  
  // Debug toggle
  elements.debugToggle.addEventListener("click", toggleDebug);
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === "TAB_CHANGED") {
      state.currentTabId = message.tabId;
      elements.tabIdDisplay.textContent = message.tabId;
    } else if (message.type === "TAB_UPDATED") {
      if (message.tabId === state.currentTabId && message.url) {
        try {
          const hostname = new URL(message.url).hostname;
          elements.backendStatus.textContent = state.backendConnected
            ? `Connected ✓ (${hostname})`
            : `Disconnected ✗ (${hostname})`;
        } catch (_) {}
      }
    }
  });
}

// ============== TAB SWITCHING ==============

// ============== TAB SWITCHING ==============

function switchTab(tabName) {
  state.currentTab = tabName;
  
  // Update tab buttons
  elements.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Update tab content
  const tabs = {
    'automation': elements.automationTab,
    'chat': elements.chatTab,
    'summary': elements.summaryTab,
  };
  
  Object.entries(tabs).forEach(([name, element]) => {
    element.classList.toggle('active', name === tabName);
  });
  
  // Auto-capture DOM when switching to chat or summary tabs
  if ((tabName === 'chat' || tabName === 'summary') && !state.currentDomData) {
    captureDOMForAnalysis();
  }
}

// ============== CHAT FUNCTIONALITY ==============

async function handleStartChat() {
  try {
    elements.startChatBtn.disabled = true;
    elements.startChatBtn.textContent = "Starting...";
    
    // Capture DOM if not already captured
    if (!state.currentDomData) {
      await captureDOMForAnalysis();
    }
    
    if (!state.currentDomData) {
      throw new Error("Failed to capture page content");
    }
    
    // Generate chat session ID
    state.chatSessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    elements.chatSessionIdDisplay.textContent = state.chatSessionId;
    
    // Start chat session with backend
    const response = await fetch(`${BACKEND_URL}/chat/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.chatSessionId,
        dom_data: state.currentDomData,
      }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to start chat");
    }
    
    // Clear welcome message and show chat interface
    elements.chatMessages.innerHTML = "";
    elements.chatInputContainer.style.display = "flex";
    elements.startChatBtn.style.display = "none";
    elements.clearChatBtn.style.display = "block";
    
    // Add welcome message
    addChatMessage("assistant", "Hi! I'm ready to answer questions about this page. What would you like to know?");
    
  } catch (error) {
    console.error("Error starting chat:", error);
    alert(`Failed to start chat: ${error.message}`);
    elements.startChatBtn.textContent = "Start Chat";
    elements.startChatBtn.disabled = false;
  }
}

async function handleSendChat() {
  const message = elements.chatInput.value.trim();
  
  if (!message) return;
  
  if (!state.chatSessionId) {
    alert("Please start a chat session first");
    return;
  }
  
  // Add user message to UI
  addChatMessage("user", message);
  elements.chatInput.value = "";
  elements.sendChatBtn.disabled = true;
  
  // Add typing indicator
  const typingId = addChatMessage("assistant", "...", true);
  
  try {
    // Send message to backend
    const response = await fetch(`${BACKEND_URL}/chat/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.chatSessionId,
        message: message,
      }),
    });
    
    const result = await response.json();
    
    // Remove typing indicator
    document.getElementById(typingId)?.remove();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to get response");
    }
    
    // Add assistant response
    addChatMessage("assistant", result.response);
    
  } catch (error) {
    console.error("Error sending chat message:", error);
    document.getElementById(typingId)?.remove();
    addChatMessage("assistant", `Sorry, I encountered an error: ${error.message}`);
  } finally {
    elements.sendChatBtn.disabled = false;
  }
}

function handleClearChat() {
  if (!confirm("Clear chat history?")) return;
  
  if (state.chatSessionId) {
    // Clear session on backend
    fetch(`${BACKEND_URL}/chat/clear/${state.chatSessionId}`, {
      method: "DELETE",
    }).catch(console.error);
  }
  
  // Reset UI
  state.chatSessionId = null;
  elements.chatSessionIdDisplay.textContent = "-";
  elements.chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p>👋 Click "Start Chat" to begin asking questions about this page.</p>
      <p class="chat-help">You can ask things like:</p>
      <ul class="chat-examples">
        <li>"What is this page about?"</li>
        <li>"Summarize the main content"</li>
        <li>"What are the key features?"</li>
        <li>"Tell me about [specific topic]"</li>
      </ul>
    </div>
  `;
  elements.chatInputContainer.style.display = "none";
  elements.startChatBtn.style.display = "block";
  elements.clearChatBtn.style.display = "none";
  elements.startChatBtn.disabled = false;
  elements.startChatBtn.textContent = "Start Chat";
}

function addChatMessage(role, content, isTyping = false) {
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const emoji = role === "user" ? "👤" : "🤖";
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const messageEl = document.createElement("div");
  messageEl.className = `chat-message ${role}`;
  messageEl.id = messageId;
  messageEl.innerHTML = `
    <div class="chat-message-avatar">${emoji}</div>
    <div class="chat-message-content">
      ${content}
      ${!isTyping ? `<div class="chat-message-time">${time}</div>` : ''}
    </div>
  `;
  
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  
  return messageId;
}

// ============== SUMMARY FUNCTIONALITY ==============

async function handleSummarize() {
  try {
    elements.summarizeBtn.disabled = true;
    elements.summaryLoading.style.display = "flex";
    elements.summaryContent.style.display = "none";
    
    // Capture DOM if not already captured
    if (!state.currentDomData) {
      await captureDOMForAnalysis();
    }
    
    if (!state.currentDomData) {
      throw new Error("Failed to capture page content");
    }
    
    // Request summary from backend
    const response = await fetch(`${BACKEND_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dom_data: state.currentDomData,
      }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to generate summary");
    }
    
    // Display summary
    displaySummary(result.summary, result.url, result.title);
    
  } catch (error) {
    console.error("Error generating summary:", error);
    elements.summaryContent.innerHTML = `
      <div class="summary-section">
        <h4>❌ Error</h4>
        <p>${error.message}</p>
      </div>
    `;
    elements.summaryContent.style.display = "block";
  } finally {
    elements.summarizeBtn.disabled = false;
    elements.summaryLoading.style.display = "none";
  }
}

function displaySummary(summary, url, title) {
  const confidence = summary.confidence || 0;
  const confidencePercent = Math.round(confidence * 100);
  
  let html = `
    <div class="summary-section">
      <h4>📄 Page Information</h4>
      <p><strong>Title:</strong> ${escapeHtml(title)}</p>
      <p><strong>URL:</strong> ${escapeHtml(url)}</p>
      <div class="summary-meta">
        <div class="summary-meta-item">
          <strong>Type:</strong> <span class="summary-badge">${escapeHtml(summary.page_type || 'Unknown')}</span>
        </div>
        <div class="summary-meta-item">
          <strong>Confidence:</strong> <span class="summary-badge">${confidencePercent}%</span>
        </div>
      </div>
    </div>
  `;
  
  if (summary.overview) {
    html += `
      <div class="summary-section">
        <h4>📋 Overview</h4>
        <p>${escapeHtml(summary.overview)}</p>
      </div>
    `;
  }
  
  if (summary.main_topics && summary.main_topics.length > 0) {
    html += `
      <div class="summary-section">
        <h4>🏷️ Main Topics</h4>
        <ul>
          ${summary.main_topics.map(topic => `<li>${escapeHtml(topic)}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  if (summary.key_points && summary.key_points.length > 0) {
    html += `
      <div class="summary-section">
        <h4>💡 Key Points</h4>
        <ul>
          ${summary.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  if (summary.detailed_summary) {
    html += `
      <div class="summary-section">
        <h4>📝 Detailed Summary</h4>
        <p>${escapeHtml(summary.detailed_summary)}</p>
      </div>
    `;
  }
  
  elements.summaryContent.innerHTML = html;
  elements.summaryContent.style.display = "block";
}

// ============== DOM CAPTURE FOR ANALYSIS ==============

async function captureDOMForAnalysis() {
  try {
    const response = await sendMessageToContentScript({
      type: "CAPTURE_DOM",
      sessionId: state.sessionId || `temp_${Date.now()}`,
    });
    
    if (response.success && response.data) {
      state.currentDomData = response.data;
      console.log("DOM captured for analysis:", response.statistics);
      return response.data;
    } else {
      throw new Error(response.error || "Failed to capture DOM");
    }
  } catch (error) {
    console.error("Error capturing DOM for analysis:", error);
    return null;
  }
}
async function checkBackendConnection() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    if (response.ok) {
      state.backendConnected = true;
      elements.backendStatus.textContent = "Connected ✓";
      elements.backendStatus.style.color = "#22c55e";
    } else {
      throw new Error("Backend unhealthy");
    }
  } catch (error) {
    state.backendConnected = false;
    elements.backendStatus.textContent = "Disconnected ✗";
    elements.backendStatus.style.color = "#ef4444";
  }
}
async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      state.currentTabId = tab.id;
      elements.tabIdDisplay.textContent = tab.id;
      
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

    // Wait for page to stabilize before initial capture
    await delay(1000);

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
async function captureDOMFromPage(waitBeforeCapture = 0) {
  // Wait for page to settle before capturing (useful after dynamic updates)
  if (waitBeforeCapture > 0) {
    await delay(waitBeforeCapture);
  }
  
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
      await injectContentScripts();
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
  } catch (error) {
    console.error("Failed to inject content scripts:", error);
    throw new Error("Cannot inject scripts into this page");
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
      // Wait for page to settle before retry
      await delay(1500);
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
        // Wait for page to settle if we need to recapture DOM
        await delay(1000);
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
            // Wait for page to settle before retry capture
            await delay(1000);
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
      
      // Wait for page to load after navigation
      await delay(2500); // Initial wait for page load
      
      // Capture NEW DOM from the navigated page with retries
      addToHistory("info", "Capturing DOM from new page...");
      let freshDomResult = null;
      let captureAttempt = 0;
      const maxCaptureAttempts = 3;
      
      while (captureAttempt < maxCaptureAttempts && !freshDomResult) {
        try {
          captureAttempt++;
          
          // Add small delay before each capture attempt to let page settle
          if (captureAttempt > 1) {
            const waitTime = 800 * (captureAttempt - 1); // 800ms, 1600ms for retries
            console.log(`Waiting ${waitTime}ms before attempt ${captureAttempt}...`);
            await delay(waitTime);
          }
          
          const result = await captureDOMFromPage();
          
          if (result && result.success && result.data && result.data.elements) {
            const elementCount = result.data.elements.length;
            if (elementCount > 0) {
              freshDomResult = result;
              currentDom = result.data;
              addToHistory("info", `Captured ${elementCount} elements from new page`);
              console.log(`Post-navigation DOM captured: ${elementCount} elements from ${currentDom.url}`);
              break;
            } else {
              console.warn(`Attempt ${captureAttempt}: DOM captured but 0 elements, retrying...`);
            }
          } else {
            console.warn(`Attempt ${captureAttempt}: DOM capture returned no data`);
          }
        } catch (error) {
          console.error(`Attempt ${captureAttempt}: Error capturing DOM after navigation:`, error);
        }
      }
      
      if (!freshDomResult) {
        addToHistory("warning", "Failed to capture DOM after navigation, will retry on next action");
        console.error("All DOM capture attempts failed after navigation");
        currentDom = null; // Force recapture on next iteration
      }
    } else {
      // Normal action, use the new_dom from execution result
      currentDom = executionResult.new_dom || null;
    }

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


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
