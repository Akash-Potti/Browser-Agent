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
      const clicked = clickElement(element);
      return {
        ...baseResult,
        success: clicked,
        message: clicked ? "Clicked element" : "Click dispatched (uncertain)",
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

      {
        const value = typeof action.value === "string" ? action.value : "";
        
        // Special handling for autocomplete/combobox elements
        const role = element.getAttribute?.("role");
        const hasAutocomplete = element.hasAttribute?.("aria-autocomplete") || 
                                element.hasAttribute?.("autocomplete") ||
                                role === "combobox" ||
                                role === "searchbox";
        
        if (hasAutocomplete) {
          // For autocomplete fields, we need to trigger the dropdown first
          focusElement(element);
          await sleep(100); // Let autocomplete initialize
          
          // Some autocomplete fields need a click to open
          const ariaExpanded = element.getAttribute?.("aria-expanded");
          if (ariaExpanded === "false") {
            element.click();
            await sleep(150);
          }
        }
        
        focusElement(element);
        const { ok, mode, targetUsed, detail } = typeIntoElement(element, value);
        
        // For autocomplete, give time for suggestions to appear
        if (hasAutocomplete && ok) {
          await sleep(200);
        }
        
        return {
          ...baseResult,
          success: ok,
          message: ok
            ? `Entered text (${value.length} chars) via ${mode}${targetUsed ? ` -> ${targetUsed}` : ""}${hasAutocomplete ? " [autocomplete]" : ""}`
            : detail || "Failed to enter text",
        };
      }

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
      
      // If a specific element is targeted, focus it first
      let target = element;
      
      if (!target) {
        // No specific target, use activeElement or body
        target = document.activeElement || document.body;
      } else {
        // We have a target element, ensure it's focused
        try {
          if (typeof target.focus === 'function') {
            target.focus();
            // Wait a bit for focus to settle
            await sleep(50);
          }
        } catch (e) {
          console.warn('Could not focus target for key press:', e);
        }
      }
      
      keyPress(target, key);
      
      return {
        ...baseResult,
        success: true,
        message: `Pressed key: ${key}`,
      };
    }

    case "select":
    case "select_autocomplete":
      // For select_autocomplete, prioritize global search over specific element
      if (actionType === "select_autocomplete" || !element) {
        // Try to find visible autocomplete dropdown
        const autocompleteOption = findAutocompleteOption(action.value);
        if (autocompleteOption) {
          try {
            autocompleteOption.scrollIntoView({ block: "nearest" });
          } catch (_) {}
          clickElement(autocompleteOption);
          await sleep(150);
          return {
            ...baseResult,
            success: true,
            message: `Selected autocomplete: ${normalizeText(
              autocompleteOption.textContent || autocompleteOption.innerText
            )}`,
          };
        }
        
        // If select_autocomplete fails to find option, that's an error
        if (actionType === "select_autocomplete") {
          return {
            ...baseResult,
            success: false,
            error: `Autocomplete option not found: ${action.value}`,
          };
        }
      }
      
      // Standard select element
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
      
      // Custom dropdown with trigger element
      if (element) {
        try {
          focusElement(element);
          dispatchMouseEvents(element, ["mouseover", "mousemove"]);
          element.click();
        } catch (_) {}
        await sleep(150);
        
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
        clickElement(opt);
        return {
          ...baseResult,
          success: true,
          message: `Selected dropdown option: ${normalizeText(
            opt.textContent || opt.innerText
          )}`,
        };
      }
      
      return {
        ...baseResult,
        success: false,
        error: "No select target or autocomplete option found",
      };

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

async function resolveElementWithRetry(uid, maxRetries = 10, retryDelay = 100) {
  try {
    // First attempt - check if element already exists
    let el = getElementByUIDSafe(uid);
    if (el) return el;
    
    // Retry with progressive delay for dynamic content (SPAs, lazy loading, etc.)
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Refresh UID registry by capturing DOM; this may re-register the same UID
      try {
        captureDOM();
      } catch (e) {
        // ignore capture errors here; a retry may still find the element
      }
      
      // Check if element appeared after DOM refresh
      el = getElementByUIDSafe(uid);
      if (el) {
        console.log(`Element found after ${attempt + 1} retries`);
        return el;
      }
      
      // Progressive backoff: 100ms, 100ms, 200ms, 200ms, 300ms, 300ms...
      const delay = retryDelay * (1 + Math.floor(attempt / 2));
      await sleep(delay);
    }
    
    // Final attempt after all retries
    el = getElementByUIDSafe(uid);
    if (!el) {
      console.warn(`Element with UID ${uid} not found after ${maxRetries} retries`);
    }
    return el;
  } catch (e) {
    console.error(`Error in resolveElementWithRetry for UID ${uid}:`, e);
    return null;
  }
}

async function resolveTargetElement(action) {
  // Try by UID first (with retries for dynamic content)
  if (action?.target_uid) {
    const byUid = await resolveElementWithRetry(action.target_uid);
    if (byUid) return byUid;
  }
  
  // Try by selector (with wait for dynamic SPAs like WhatsApp)
  const selector = action?.target_selector || action?.selector || null;
  if (selector) {
    try {
      // First try immediate query
      let el = document.querySelector(selector);
      if (el) return el;
      
      // If not found, wait up to 2 seconds for it to appear (SPAs, lazy loading)
      console.log(`Waiting for selector: ${selector}`);
      const found = await waitForSelector(selector, 2000);
      if (found) {
        el = document.querySelector(selector);
        if (el) {
          console.log(`Selector found after waiting: ${selector}`);
          return el;
        }
      }
    } catch (e) {
      console.warn(`Error resolving selector ${selector}:`, e);
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
  if (tag === "input" || tag === "textarea" || el.isContentEditable) return true;
  const role = (el.getAttribute && el.getAttribute("role")) || "";
  if (String(role).toLowerCase() === "textbox") return true;
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
  // Map common key names to their codes and key codes
  const keyMap = {
    'Enter': { code: 'Enter', keyCode: 13, which: 13 },
    'Escape': { code: 'Escape', keyCode: 27, which: 27 },
    'Tab': { code: 'Tab', keyCode: 9, which: 9 },
    'Backspace': { code: 'Backspace', keyCode: 8, which: 8 },
    'Delete': { code: 'Delete', keyCode: 46, which: 46 },
    'ArrowUp': { code: 'ArrowUp', keyCode: 38, which: 38 },
    'ArrowDown': { code: 'ArrowDown', keyCode: 40, which: 40 },
    'ArrowLeft': { code: 'ArrowLeft', keyCode: 37, which: 37 },
    'ArrowRight': { code: 'ArrowRight', keyCode: 39, which: 39 },
    'Space': { code: 'Space', keyCode: 32, which: 32, key: ' ' },
  };
  
  const keyInfo = keyMap[key] || {
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.charCodeAt(0),
    which: key.charCodeAt(0),
  };
  
  const actualKey = keyInfo.key || key;
  
  // More complete keyboard event sequence
  const sequence = ["keydown", "keypress", "keyup"];
  for (const type of sequence) {
    const evt = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: actualKey,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      which: keyInfo.which,
      charCode: type === 'keypress' ? keyInfo.keyCode : 0,
      composed: true, // Important for shadow DOM
      view: window,
    });
    
    target.dispatchEvent(evt);
    
    // Some apps check for defaultPrevented
    if (evt.defaultPrevented && type === "keydown") {
      console.log(`Key ${actualKey} was prevented by the page`);
    }
  }
  
  // For Enter key, also trigger submit-related events if in a form
  if (key === 'Enter' && target) {
    try {
      // Check if we're in a form context
      const form = target.closest('form');
      if (form) {
        // Some forms listen for Enter on inputs to submit
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        if (!form.dispatchEvent(submitEvent)) {
          console.log('Form submit was prevented');
        }
      }
    } catch (e) {
      // Ignore form check errors
    }
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

function findAutocompleteOption(valueOrText) {
  // Search for visible autocomplete options globally
  const value = String(valueOrText ?? "").trim();
  const valueLower = value.toLowerCase();
  
  // Common autocomplete option selectors
  const selectors = [
    '[role="option"]',
    '[role="listbox"] li',
    '[class*="autocomplete"] li',
    '[class*="suggestion"] li',
    '[class*="dropdown"] li',
    '[class*="option"]',
    'ul[role="listbox"] > *',
    '.react-autosuggest__suggestion',
    '.Select-option',
  ];
  
  for (const selector of selectors) {
    try {
      const options = document.querySelectorAll(selector);
      for (const opt of options) {
        // Check visibility
        const style = window.getComputedStyle(opt);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = opt.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        const text = normalizeText(opt.textContent || opt.innerText || "");
        if (!text) continue;
        
        // Match logic: exact, case-insensitive, or contains
        if (text === value || 
            text.toLowerCase() === valueLower || 
            text.toLowerCase().includes(valueLower) ||
            valueLower.includes(text.toLowerCase())) {
          return opt;
        }
        
        // Check data attributes
        const dataValue = opt.getAttribute?.('data-value') || opt.getAttribute?.('value');
        if (dataValue && (dataValue === value || dataValue.toLowerCase() === valueLower)) {
          return opt;
        }
      }
    } catch (_) {
      // Invalid selector, continue
    }
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

// ------------------------------
// Interaction helpers
// ------------------------------

function clickElement(element) {
  try {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.floor(rect.width / 2));
    const clientY = rect.top + Math.max(1, Math.floor(rect.height / 2));
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 };

    // Pointer events first for modern sites
    try { element.dispatchEvent(new PointerEvent("pointerover", opts)); } catch (_) {}
    try { element.dispatchEvent(new PointerEvent("pointerenter", opts)); } catch (_) {}
    try { element.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
    try { element.dispatchEvent(new MouseEvent("mouseover", opts)); } catch (_) {}
    try { element.dispatchEvent(new MouseEvent("mousedown", opts)); } catch (_) {}
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }
    try { element.dispatchEvent(new PointerEvent("pointerup", opts)); } catch (_) {}
    try { element.dispatchEvent(new MouseEvent("mouseup", opts)); } catch (_) {}
    try { element.dispatchEvent(new MouseEvent("click", opts)); } catch (_) {}
    // Also call native click as a fallback
    try { element.click(); } catch (_) {}
    return true;
  } catch (e) {
    try { element.click(); return true; } catch (_) { return false; }
  }
}

function setValueReactSafe(el, value) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  try {
    // Choose correct prototype for setter
    let proto = null;
    if (tag === "input") proto = window.HTMLInputElement && HTMLInputElement.prototype;
    else if (tag === "textarea") proto = window.HTMLTextAreaElement && HTMLTextAreaElement.prototype;
    else if (tag === "select") proto = window.HTMLSelectElement && HTMLSelectElement.prototype;

    const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && typeof desc.set === "function") {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }

    // React/Angular/Vue listeners
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (_) {
    try {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }
}

function typeIntoContentEditable(target, text) {
  try {
    if (!target) return { ok: false, detail: "No target" };
    if (!target.isContentEditable && String(target.getAttribute?.("role") || "").toLowerCase() !== "textbox") {
      return { ok: false, detail: "Not contentEditable" };
    }

    // Place caret at the end
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}

    // Try modern beforeinput/input with data
    const before = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    target.dispatchEvent(before);
    const input = new InputEvent("input", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: false,
      composed: true,
    });
    target.dispatchEvent(input);

    // Fallback if no change, mutate innerText
    if (!normalizeText(target.innerText || "").includes(normalizeText(text))) {
      try {
        document.execCommand("insertText", false, text);
      } catch (_) {}
      if (!normalizeText(target.innerText || "").includes(normalizeText(text))) {
        target.innerText = text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    return { ok: true, mode: "contentEditable", targetUsed: tagNameSafe(target) };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

function findEditorEditable(contextEl) {
  const roots = [];
  if (contextEl && contextEl.ownerDocument) roots.push(contextEl.ownerDocument);
  roots.push(document);
  // Search near target first
  const localRoot = contextEl ? contextEl.closest?.(".monaco-editor, .CodeMirror, .cm-editor") : null;
  if (localRoot) roots.unshift(localRoot);

  for (const root of roots) {
    try {
      // Monaco hidden textarea
      let t = root.querySelector?.(".monaco-editor textarea.inputarea, .monaco-editor textarea");
      if (t) return { target: t, kind: "monaco" };
      // CodeMirror 5 textarea
      t = root.querySelector?.(".CodeMirror textarea");
      if (t) return { target: t, kind: "codemirror5" };
      // CodeMirror 6 contenteditable div
      t = root.querySelector?.(".cm-content[contenteditable='true']");
      if (t) return { target: t, kind: "codemirror6" };
      // Generic ARIA textbox
      t = root.querySelector?.("[role='textbox'][contenteditable='true']");
      if (t) return { target: t, kind: "aria-textbox" };
    } catch (_) {}
  }
  return null;
}

function typeViaInsertText(target, text) {
  try {
    if (!target) return false;
    if (typeof target.focus === "function") target.focus({ preventScroll: true });

    if (text.length > 150) {
      // Big paste-like insert
      const before = new InputEvent("beforeinput", { inputType: "insertFromPaste", data: text, bubbles: true, cancelable: true });
      target.dispatchEvent(before);
      const input = new InputEvent("input", { inputType: "insertFromPaste", data: text, bubbles: true });
      target.dispatchEvent(input);
      return true;
    }

    // Insert as text
    const before = new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true });
    target.dispatchEvent(before);
    const input = new InputEvent("input", { inputType: "insertText", data: text, bubbles: true });
    target.dispatchEvent(input);
    return true;
  } catch (_) {
    try { document.execCommand("insertText", false, text); return true; } catch (_) { return false; }
  }
}

function typeViaKeyboardSequence(target, text) {
  try {
    if (!target) return false;
    if (typeof target.focus === "function") target.focus({ preventScroll: true });
    const chars = String(text ?? "").split("");
    for (const ch of chars) {
      const key = ch;
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      const before = new InputEvent("beforeinput", { inputType: "insertText", data: ch, bubbles: true, cancelable: true });
      target.dispatchEvent(before);
      const input = new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true });
      target.dispatchEvent(input);
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    }
    return true;
  } catch (_) {
    return false;
  }
}

function tagNameSafe(el) {
  try { return (el && el.tagName ? el.tagName.toLowerCase() : String(el?.nodeName || "node")); } catch (_) { return "node"; }
}

function typeIntoElement(element, text) {
  const tag = (element?.tagName || "").toLowerCase();
  // 1) Native inputs/textarea/select
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const ok = setValueReactSafe(element, text);
    return { ok, mode: tag };
  }

  // 2) ContentEditable/ARIA textbox
  if (element.isContentEditable || String(element.getAttribute?.("role") || "").toLowerCase() === "textbox") {
    const r = typeIntoContentEditable(element, text);
    if (r.ok) return r;
  }

  // 3) Rich editors (Monaco/CodeMirror)
  const editor = findEditorEditable(element);
  if (editor && editor.target) {
    const t = editor.target;
    if (editor.kind === "codemirror6" || t.isContentEditable) {
      const r = typeIntoContentEditable(t, text);
      if (r.ok) return { ...r, mode: editor.kind };
    }
    // Try insertText events
    if (typeViaInsertText(t, text)) {
      // Dispatch change event for frameworks listening on container
      try { t.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
      return { ok: true, mode: `editor-${editor.kind}`, targetUsed: tagNameSafe(t) };
    }
    // Fallback to keyboard sequence
    if (typeViaKeyboardSequence(t, text)) {
      return { ok: true, mode: `editor-keys-${editor.kind}`, targetUsed: tagNameSafe(t) };
    }
  }

  // 4) Final fallback: active element
  const active = document.activeElement;
  if (active && active !== document.body) {
    if ((active.tagName || "").toLowerCase() === "input" || (active.tagName || "").toLowerCase() === "textarea") {
      const ok = setValueReactSafe(active, text);
      return { ok, mode: "active-input" };
    }
    if (active.isContentEditable) {
      const r = typeIntoContentEditable(active, text);
      if (r.ok) return { ...r, mode: "active-contentEditable" };
    }
    if (typeViaInsertText(active, text)) {
      return { ok: true, mode: "active-insertText", targetUsed: tagNameSafe(active) };
    }
  }

  return { ok: false, mode: "none", detail: "No suitable editable target" };
}
