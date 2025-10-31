// Content Script - Injected into every page

console.log("Content script loaded on:", window.location.href);

// Store initial URL for navigation detection
let initialUrl = window.location.href;

// Listen for messages from sidebar/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message.type);

  switch (message.type) {
    case "PING":
      // Simple health check
      sendResponse({ status: "alive", url: window.location.href });
      break;

    case "CAPTURE_DOM":
      handleDOMCapture(message, sendResponse);
      return true; // Keep channel open for async

    case "EXECUTE_ACTION":
      handleExecuteAction(message, sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: "Unknown message type" });
  }
});

// Handle DOM capture request
function handleDOMCapture(message, sendResponse) {
  console.log("DOM capture requested for session:", message.sessionId);

  try {
    // Capture DOM using the extractor
    const domData = captureDOM();
    const stats = getDOMStatistics(domData);

    console.log("DOM captured:", stats);

    sendResponse({
      success: true,
      sessionId: message.sessionId,
      data: domData,
      statistics: stats,
    });
  } catch (error) {
    console.error("Error capturing DOM:", error);
    sendResponse({
      success: false,
      error: error.message,
      sessionId: message.sessionId,
    });
  }
}

// Handle action execution request
async function handleExecuteAction(message, sendResponse) {
  console.log("Action execution requested:", message.action);

  try {
    const action = message.action;
    const previousUrl = window.location.href;

    // Execute the action
    const result = await executeAction(action);

    // Check for navigation
    const navigated =
      hasNavigated(previousUrl) || Boolean(result.navigationPending);

    // Detect error/success messages
    const errors = detectErrorMessages();
    const successes = detectSuccessMessages();

    // Capture new DOM state after action (skip if navigation is pending)
    let newDomData = null;
    if (!result.navigationPending) {
      newDomData = captureDOM();
    }

    sendResponse({
      ...result,
      value: action.value,
      reasoning: action.reasoning,
      navigated: navigated,
      errors: errors,
      successes: successes,
      new_dom: newDomData,
      url: window.location.href,
      target_url: result.targetUrl || null,
    });
  } catch (error) {
    console.error("Error executing action:", error);
    let fallbackDom = null;
    try {
      // Attempt to provide a fresh DOM snapshot to help planner recover
      fallbackDom = captureDOM();
    } catch (e) {
      // ignore DOM capture errors in the error path
    }
    sendResponse({
      success: false,
      error: error.message,
      new_dom: fallbackDom,
      url: window.location.href,
    });
  }
}

// Notify extension when page loads
window.addEventListener("load", () => {
  console.log("Page fully loaded");

  chrome.runtime
    .sendMessage({
      type: "PAGE_LOADED",
      url: window.location.href,
      title: document.title,
    })
    .catch(() => {
      // Extension might not be listening, ignore
    });
});

// Monitor DOM changes (will be useful later)
let domChangeTimeout;
const observer = new MutationObserver((mutations) => {
  // Debounce DOM changes
  clearTimeout(domChangeTimeout);
  domChangeTimeout = setTimeout(() => {
    console.log("DOM changed:", mutations.length, "mutations");
  }, 500);
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
});

async function executeAction(action) {
  if (!action || !action.type) {
    return {
      success: false,
      error: "Invalid action",
      action: action ? action.type : null,
      target_uid: action ? action.target_uid : null,
    };
  }

  const actionType = action.type.toLowerCase();
  const baseResult = {
    action: actionType,
    target_uid: action.target_uid || null,
  };

  let element = await resolveTargetElement(action);

  switch (actionType) {
    case "click":
      if (!element) {
        return {
          ...baseResult,
          success: false,
          error: `Element not found for UID ${action.target_uid}`,
        };
      }

      focusElement(element);
      element.click();
      return {
        ...baseResult,
        success: true,
        message: "Clicked element",
      };

    case "type":
      if (!element) {
        // Fallback: try active element if it's editable
        const active = document.activeElement;
        if (isEditableElement(active)) {
          element = active;
        } else {
          return {
            ...baseResult,
            success: false,
            error: `Element not found for UID ${action.target_uid}`,
          };
        }
      }

      const value = typeof action.value === "string" ? action.value : "";
      focusElement(element);
      setElementValue(element, value);
      return {
        ...baseResult,
        success: true,
        message: `Entered text (${value.length} chars)`,
      };

    case "scroll":
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(400);
        return {
          ...baseResult,
          success: true,
          message: "Scrolled element into view",
        };
      }

      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
      await sleep(400);
      return {
        ...baseResult,
        success: true,
        message: "Scrolled window",
      };

    case "wait":
      await sleep(Number(action.duration) || 1000);
      return {
        ...baseResult,
        success: true,
        message: "Waited",
      };

    case "m_go_to_url":
    case "go_to_url":
    case "navigate":
    case "open_url":
      return navigateToUrl(action, baseResult);

    case "hover":
      if (!element) {
        return {
          ...baseResult,
          success: false,
          error: `Element not found for UID ${action.target_uid}`,
        };
      }
      focusElement(element);
      dispatchMouseEvents(element, ["mouseover", "mousemove"]);
      return {
        ...baseResult,
        success: true,
        message: "Hovered over element",
      };

    case "press": {
      const key = (action.key || action.value || "Enter").toString();
      const target = element || document.activeElement || document.body;
      keyPress(target, key);
      return {
        ...baseResult,
        success: true,
        message: `Pressed key: ${key}`,
      };
    }

    case "select":
      if (element && element.tagName.toLowerCase() === "select") {
        const option = selectOption(element, action.value);
        if (!option) {
          return {
            ...baseResult,
            success: false,
            error: `Option not found: ${action.value}`,
          };
        }
        return {
          ...baseResult,
          success: true,
          message: `Selected option: ${option.text}`,
        };
      }
      // Custom dropdown: try clicking trigger then selecting role=option
      if (!element) {
        return {
          ...baseResult,
          success: false,
          error: "Target element for select not found",
        };
      }
      try {
        focusElement(element);
        dispatchMouseEvents(element, ["mouseover", "mousemove"]);
        element.click();
      } catch (_) {}
      await sleep(150);
      {
        const opt = findCustomDropdownOption(action.value, element);
        if (!opt) {
          return {
            ...baseResult,
            success: false,
            error: `Dropdown option not found: ${action.value}`,
          };
        }
        try {
          opt.scrollIntoView({ block: "nearest" });
        } catch (_) {}
        opt.click();
        return {
          ...baseResult,
          success: true,
          message: `Selected dropdown option: ${normalizeText(
            opt.textContent || opt.innerText
          )}`,
        };
      }

    case "check":
    case "uncheck":
      if (
        !element ||
        element.tagName.toLowerCase() !== "input" ||
        element.type !== "checkbox"
      ) {
        return {
          ...baseResult,
          success: false,
          error: "Target is not a checkbox",
        };
      }
      {
        const shouldCheck = actionType === "check";
        if (element.checked !== shouldCheck) {
          element.click();
        }
        return {
          ...baseResult,
          success: true,
          message: shouldCheck ? "Checked" : "Unchecked",
        };
      }

    case "submit": {
      let form =
        element && element.tagName.toLowerCase() === "form"
          ? element
          : element?.closest?.("form");
      if (!form) {
        form = document.querySelector("form");
      }
      if (!form) {
        return {
          ...baseResult,
          success: false,
          error: "No form found to submit",
        };
      }
      try {
        form.requestSubmit ? form.requestSubmit() : form.submit();
      } catch (e) {
        // ignore
      }
      return { ...baseResult, success: true, message: "Form submitted" };
    }

    case "wait_for_selector": {
      const selector =
        action.target_selector || action.selector || action.value;
      const timeout = Number(action.duration) || 2000;
      const ok = await waitForSelector(selector, timeout);
      return {
        ...baseResult,
        success: ok,
        message: ok
          ? `Selector appeared: ${selector}`
          : `Selector not found within ${timeout}ms`,
      };
    }

    default:
      return {
        ...baseResult,
        success: false,
        error: `Unsupported action type: ${action.type}`,
      };
  }
}

function getElementByUIDSafe(uid) {
  if (typeof getElementByUID === "function") {
    return getElementByUID(uid);
  }
  console.warn("getElementByUID is unavailable");
  return null;
}

async function resolveElementWithRetry(uid, retryDelay = 50) {
  try {
    let el = getElementByUIDSafe(uid);
    if (el) return el;
    // Refresh UID registry by capturing DOM; this may re-register the same UID
    try {
      captureDOM();
    } catch (e) {
      // ignore capture errors here; a retry may still find the element
    }
    await sleep(retryDelay);
    el = getElementByUIDSafe(uid);
    return el;
  } catch (e) {
    return null;
  }
}

async function resolveTargetElement(action) {
  // Try by UID first
  if (action?.target_uid) {
    const byUid = await resolveElementWithRetry(action.target_uid);
    if (byUid) return byUid;
  }
  // Try by selector
  const selector = action?.target_selector || action?.selector || null;
  if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch (e) {
      // ignore invalid selectors
    }
  }
  return null;
}

function focusElement(element) {
  if (!element) return;
  try {
    element.scrollIntoView({ block: "center" });
  } catch (error) {
    // Ignore scroll errors
  }

  if (typeof element.focus === "function") {
    element.focus({ preventScroll: true });
  }
}

function setElementValue(element, value) {
  if (element.isContentEditable) {
    element.innerText = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value"
  );

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || el.isContentEditable)
    return true;
  return false;
}

function dispatchMouseEvents(element, events) {
  try {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.min(rect.width / 2, 1 + rect.width / 2);
    const clientY = rect.top + Math.min(rect.height / 2, 1 + rect.height / 2);
    for (const type of events) {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      });
      element.dispatchEvent(evt);
    }
  } catch (e) {
    // ignore
  }
}

function keyPress(target, key) {
  const sequence = ["keydown", "keypress", "keyup"];
  for (const type of sequence) {
    const evt = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    });
    target.dispatchEvent(evt);
  }
}

function selectOption(selectEl, valueOrText) {
  if (!selectEl || selectEl.tagName.toLowerCase() !== "select") return null;
  const value = String(valueOrText ?? "").trim();
  let found = null;
  for (const opt of selectEl.options) {
    if (opt.value === value || opt.text.trim() === value) {
      found = opt;
      break;
    }
  }
  if (!found && value) {
    // try case-insensitive contains on text
    for (const opt of selectEl.options) {
      if (opt.text.toLowerCase().includes(value.toLowerCase())) {
        found = opt;
        break;
      }
    }
  }
  if (found) {
    selectEl.value = found.value;
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return found;
}

function findCustomDropdownOption(valueOrText, trigger) {
  const value = String(valueOrText ?? "").trim();
  const texts = [value, value.toLowerCase()];
  // Look in aria-controls popup first
  const controls = trigger?.getAttribute?.("aria-controls");
  const popupRoots = [];
  if (controls) {
    controls.split(/\s+/).forEach((cid) => {
      const el = document.getElementById(cid);
      if (el) popupRoots.push(el);
    });
  }
  if (popupRoots.length === 0) popupRoots.push(document);

  const matchInRoot = (root) => {
    const candidates = root.querySelectorAll(
      '[role="option"], [role="menuitem"], li, option'
    );
    for (const el of candidates) {
      const t = normalizeText(el.textContent || el.innerText || "");
      if (!t) continue;
      if (
        t === value ||
        t.toLowerCase() === texts[1] ||
        t.toLowerCase().includes(texts[1])
      ) {
        return el;
      }
      // data-value or value attributes
      const dv =
        el.getAttribute &&
        (el.getAttribute("data-value") || el.getAttribute("value"));
      if (dv && (dv === value || dv.toLowerCase() === texts[1])) return el;
    }
    return null;
  };

  for (const root of popupRoots) {
    const found = matchInRoot(root);
    if (found) return found;
  }
  return null;
}

function waitForSelector(selector, timeout) {
  if (!selector) return Promise.resolve(false);
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(true);

    const obs = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        obs.disconnect();
        resolve(true);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      obs.disconnect();
      resolve(Boolean(document.querySelector(selector)));
    }, timeout);
  });
}

function hasNavigated(previousUrl) {
  try {
    return new URL(previousUrl).href !== new URL(window.location.href).href;
  } catch (error) {
    return window.location.href !== previousUrl;
  }
}

function detectErrorMessages() {
  return collectMessages([
    '[role="alert"]',
    ".error",
    ".alert-danger",
    ".notification-error",
    ".text-danger",
  ]);
}

function detectSuccessMessages() {
  return collectMessages([
    '[role="status"]',
    ".success",
    ".alert-success",
    ".notification-success",
    ".text-success",
  ]);
}

function collectMessages(selectors) {
  const messages = new Set();

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      const text = normalizeText(element.textContent || element.innerText);
      if (text) {
        messages.add(text);
      }
    });
  });

  return Array.from(messages).slice(0, 5);
}

function normalizeText(value) {
  if (!value) {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigateToUrl(action, baseResult) {
  const rawValue = (
    action?.value ||
    action?.url ||
    action?.target_url ||
    ""
  ).trim();

  if (!rawValue) {
    return {
      ...baseResult,
      success: false,
      error: "No URL provided for navigation",
    };
  }

  let targetUrl;
  try {
    let candidate = rawValue;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      candidate = `https://${candidate}`;
    }
    targetUrl = new URL(candidate, window.location.href).href;
  } catch (error) {
    return {
      ...baseResult,
      success: false,
      error: `Invalid URL: ${rawValue}`,
    };
  }

  setTimeout(() => {
    try {
      window.location.href = targetUrl;
    } catch (navError) {
      console.error("Failed to navigate:", navError);
    }
  }, 50);

  return {
    ...baseResult,
    success: true,
    message: `Navigating to ${targetUrl}`,
    navigationPending: true,
    targetUrl,
  };
}
