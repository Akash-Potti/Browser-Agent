// Runtime registry: approximate detection of elements that receive addEventListener after load
(function initEventListenerRegistry() {
  if (window.__baEventListenerRegistryInitialized) return;
  window.__baEventListenerRegistryInitialized = true;
  const orig = EventTarget.prototype.addEventListener;
  const registry = (window.__baEventListenerRegistry = {
    map: new WeakMap(),
    list: new Set(),
  });
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
      const set = registry.map.get(this) || new Set();
      set.add(String(type || ""));
      registry.map.set(this, set);
      if (this && this.nodeType === 1) {
        registry.list.add(this);
        if (registry.list.size > 2000) {
          const it = registry.list.values();
          for (let i = 0; i < 500; i++) {
            const v = it.next();
            if (v.done) break;
            registry.list.delete(v.value);
          }
        }
      }
    } catch (_) {}
    return orig.call(this, type, listener, options);
  };
})();

function captureDOM(options = {}) {
  console.log("Capturing DOM structure...");
  const startTime = performance.now();

  const interactiveElements = getInteractiveElements(options);

  console.log(`Captured ${interactiveElements.length} interactive elements.`);

  const serializedElements = interactiveElements
    .map((element, index) => serializeElement(element, index))
    .filter((el) => el !== null);

  const endTime = performance.now();
  console.log(
    `DOM capture completed in ${(endTime - startTime).toFixed(2)} ms.`
  );

  return {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elementCount: serializedElements.length,
    elements: serializedElements,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
  };
}

function getInteractiveElements(options = {}) {
  const maxShadowDepth = Number(options.maxShadowDepth ?? 3);
  const selectors = [
    "button",
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="dialog"]',
    "a[href]",
    "area[href]",
    "input",
    "select",
    "textarea",
    "summary",
    "details",
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="treeitem"]',
    '[role="listitem"]',
    '[role="gridcell"]',
    '[role="row"]',
    '[role="cell"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="dialog"]',
    "[onclick]",
    '[contenteditable="true"]',
    '*[tabindex]:not([tabindex="-1"])',
    "[data-testid]",
    "[data-test]",
    "[data-action]",
    "[data-command]",
    "[data-qa]",
    "[data-clickable]",
    "[data-interactive]",
    "[data-role]",
    "[data-type]",
    '[aria-haspopup="true"]',
    "[aria-controls]",
    "video",
    "audio",
    "iframe",
    "[class*='btn']",
    "[class*='button']",
    "[class*='clickable']",
    "[class*='action']",
    "[class*='toggle']",
    "label[for]",
    "option",
    "fieldset",
    "legend",
    "canvas",
    "svg",
  ];

  // Collect from document and open shadow roots
  const seen = new Set();
  const elements = [];

  function collectFromRoot(root, depth) {
    if (!root || depth > maxShadowDepth) return; // guard depth for performance
    try {
      const nodeList = queryAllBatched(root, selectors, 20);
      nodeList.forEach((element) => {
        if (!seen.has(element)) {
          seen.add(element);
          elements.push(element);
        }
        // Include controlled popup for dropdown-like widgets
        try {
          const controls =
            element.getAttribute && element.getAttribute("aria-controls");
          if (controls) {
            controls.split(/\s+/).forEach((cid) => {
              if (!cid) return;
              const popup = document.getElementById(cid);
              if (popup && !seen.has(popup)) {
                seen.add(popup);
                elements.push(popup);
                popup
                  .querySelectorAll(
                    '[role="option"], [role="menuitem"], option'
                  )
                  .forEach((opt) => {
                    if (!seen.has(opt)) {
                      seen.add(opt);
                      elements.push(opt);
                    }
                  });
              }
            });
          }
        } catch (_) {}

        const actionableParent = element.closest(
          'button, a[href], [role="button"], [role="link"], [onclick], *[tabindex]:not([tabindex="-1"])'
        );
        if (actionableParent && !seen.has(actionableParent)) {
          seen.add(actionableParent);
          elements.push(actionableParent);
        }

        // Mark elements with runtime listeners as interactive
        try {
          if (
            window.__baEventListenerRegistry &&
            window.__baEventListenerRegistry.map.has(element)
          ) {
            if (!seen.has(element)) {
              seen.add(element);
              elements.push(element);
            }
          }
        } catch (_) {}
      });
    } catch (e) {
      // ignore selector errors in this root
    }

    // Traverse open shadow roots
    const treeWalker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    let node = treeWalker.currentNode;
    while (node) {
      const el = node;
      try {
        if (
          el.tagName &&
          el.tagName.toLowerCase() === "slot" &&
          el.assignedElements
        ) {
          el.assignedElements().forEach((ae) => {
            if (!seen.has(ae)) {
              seen.add(ae);
              elements.push(ae);
            }
          });
        }
      } catch (_) {}
      if (el && el.shadowRoot) {
        collectFromRoot(el.shadowRoot, depth + 1);
      }
      node = treeWalker.nextNode();
    }

    // Traverse iframes: same-origin only; mark cross-origin via data attribute
    try {
      const iframes = root.querySelectorAll
        ? root.querySelectorAll("iframe")
        : [];
      iframes.forEach((frame) => {
        try {
          const doc = frame.contentDocument;
          if (doc) {
            collectFromRoot(doc, depth + 1);
          } else {
            try {
              frame.setAttribute("data-cross-origin", "true");
            } catch (_) {}
          }
        } catch (_) {
          try {
            frame.setAttribute("data-cross-origin", "true");
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

  collectFromRoot(document, 0);

  // Include datalist options linked from inputs[list]
  try {
    document.querySelectorAll("input[list]").forEach((inp) => {
      const listId = inp.getAttribute("list");
      if (!listId) return;
      const dl = document.getElementById(listId);
      if (dl && !seen.has(dl)) {
        seen.add(dl);
        elements.push(dl);
        dl.querySelectorAll("option").forEach((opt) => {
          if (!seen.has(opt)) {
            seen.add(opt);
            elements.push(opt);
          }
        });
      }
    });
  } catch (_) {}

  // Include any elements that registered listeners after our initial pass
  try {
    if (
      window.__baEventListenerRegistry &&
      window.__baEventListenerRegistry.list
    ) {
      window.__baEventListenerRegistry.list.forEach((el) => {
        if (el && !seen.has(el)) {
          seen.add(el);
          elements.push(el);
        }
      });
    }
  } catch (_) {}

  return elements.filter(isActionableElement);
}

// Style cache to avoid repeated getComputedStyle calls on huge DOMs
const __styleCache = new WeakMap();
function getStyle(el) {
  let st = __styleCache.get(el);
  if (!st) {
    st = window.getComputedStyle(el);
    __styleCache.set(el, st);
  }
  return st;
}

function isElementVisible(element) {
  // CSS visibility checks
  const style = getStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    const children = Array.from(element.children);
    const hasVisibleChild = children.some((child) => {
      const childStyle = getStyle(child);
      if (childStyle.display === "none" || childStyle.visibility === "hidden") {
        return false;
      }
      const childRect = child.getBoundingClientRect();
      return childRect.width > 1 && childRect.height > 1;
    });
    if (!hasVisibleChild) {
      return false;
    }
  }

  // Hidden via ancestors (overflow/opacity)
  let ancestor = element.parentElement;
  let depth = 0;
  while (ancestor && depth < 4) {
    const st = getStyle(ancestor);
    if (
      st.display === "none" ||
      st.visibility === "hidden" ||
      st.opacity === "0"
    ) {
      return false;
    }
    ancestor = ancestor.parentElement;
    depth++;
  }

  // Within nearest scrollable container
  const scroller = findScrollableAncestor(element);
  if (
    scroller &&
    scroller !== document.body &&
    scroller !== document.documentElement
  ) {
    const srect = scroller.getBoundingClientRect();
    const horizontallyVisible =
      rect.right > srect.left && rect.left < srect.right;
    const verticallyVisible =
      rect.bottom > srect.top && rect.top < srect.bottom;
    if (!(horizontallyVisible && verticallyVisible)) {
      return false;
    }
  }

  return true;
}

function isActionableElement(element) {
  if (!element) {
    return false;
  }

  if (!isElementVisible(element)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.pointerEvents === "none") {
    return false;
  }

  if (element.disabled || element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const ariaHidden = (element.getAttribute("aria-hidden") || "").toLowerCase();
  const hasHref = element.hasAttribute("href");
  const hasOnClick =
    typeof element.onclick === "function" || element.hasAttribute("onclick");
  const role = (element.getAttribute("role") || "").toLowerCase();
  const focusable = element.tabIndex >= 0;

  if (ariaHidden === "true" && !hasHref && !hasOnClick && !focusable && !role) {
    return false;
  }

  return true;
}

function serializeElement(element, index) {
  try {
    const rect = element.getBoundingClientRect();
    const bounds = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };

    // Generate UID for this element
    const uid = generateUID(element, index);

    // Get element text content (trimmed and limited)
    const textContent = getElementText(element);

    // Get element attributes
    const attributes = getRelevantAttributes(element);

    // Determine element type
    const elementType = getElementType(element);

    // Accessible metadata
    const accessibleName = getAccessibleName(element) || "";
    const labels = getAssociatedLabels(element);
    const state = getElementState(element);

    const tagName = element.tagName.toLowerCase();
    const selector = generateSelector(element);
    const xpath = generateXPath(element);
    const shadowPath = generateShadowPath(element);
    const frame = getFrameInfo(element);

    if (typeof registerUID === "function") {
      try {
        registerUID(uid, {
          selector,
          xpath,
          attributes,
          text: textContent,
          tag: tagName,
        });
      } catch (registryError) {
        console.warn("Failed to register UID", uid, registryError);
      }
    }

    return {
      uid: uid,
      tag: tagName,
      type: elementType,
      text: textContent,
      attributes: attributes,
      accessibleName: accessibleName,
      labels: labels,
      state: state,
      isInViewport: isInViewport(rect),
      tabIndex: element.tabIndex,
      bounds: bounds,
      selector: selector,
      xpath: xpath,
      shadowPath: shadowPath,
      frame: frame,
    };
  } catch (error) {
    console.error("Error serializing element:", error);
    return null;
  }
}

function generateUID(element, index) {
  // Prefer stable testing hooks
  const testId =
    element.getAttribute &&
    (element.getAttribute("data-testid") ||
      element.getAttribute("data-test-id") ||
      element.getAttribute("data-test"));
  if (testId) return `elem_test_${sanitizeToken(testId)}`;

  // Use id/name next
  if (element.id) return `elem_id_${sanitizeToken(element.id)}`;
  if (element.name) return `elem_name_${sanitizeToken(element.name)}`;

  // Build a robust fingerprint using tag/role/type/attrs/text snippet + path
  const tag = (element.tagName || "").toLowerCase();
  const role = (element.getAttribute && element.getAttribute("role")) || "";
  const type = element.type || "";
  const placeholder =
    element.getAttribute && element.getAttribute("placeholder");
  const ariaLabel =
    element.getAttribute &&
    (element.getAttribute("aria-label") ||
      element.getAttribute("aria-labelledby"));
  const cls = (element.className || "")
    .toString()
    .split(/\s+/)
    .slice(0, 3)
    .join(".");
  const text = (getElementText(element) || "").slice(0, 40);
  const path = getElementPath(element);
  const fingerprint = [tag, role, type, placeholder, ariaLabel, cls, text, path]
    .filter(Boolean)
    .join("|");
  const hash = simpleHash(fingerprint);
  return `elem_${hash}_${index}`;
}

function getElementPath(element) {
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break; // ID is unique enough
    }

    // Add nth-child position
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(current);
      selector += `:nth-child(${index + 1})`;
    }

    path.unshift(selector);
    current = parent;
  }

  return path.join(" > ");
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

function getElementText(element) {
  let text = "";

  // Try different text sources
  if (element.value) {
    text = element.value;
  } else if (element.placeholder) {
    text = `[${element.placeholder}]`;
  } else if (element.textContent) {
    text = element.textContent;
  } else if (element.alt) {
    text = element.alt;
  } else if (element.title) {
    text = element.title;
  }

  // Clean and limit text
  text = text.trim().replace(/\s+/g, " ");
  return text.length > 100 ? text.substring(0, 97) + "..." : text;
}

function getAccessibleName(element) {
  try {
    // aria-label has highest priority
    const aria = element.getAttribute && element.getAttribute("aria-label");
    if (aria) return aria.trim();

    // aria-labelledby references
    const labelledBy =
      element.getAttribute && element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const parts = ids
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => normalizeText(el.textContent || el.innerText))
        .filter(Boolean);
      if (parts.length) return parts.join(" ").trim();
    }

    // <label for="id">
    if (element.id) {
      const lbl = document.querySelector(
        `label[for="${cssEscape(element.id)}"]`
      );
      if (lbl) return normalizeText(lbl.textContent || lbl.innerText);
    }

    // native labels property (inputs)
    if (element.labels && element.labels.length) {
      const parts = Array.from(element.labels)
        .map((l) => normalizeText(l.textContent || l.innerText))
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
  } catch (e) {
    // ignore
  }
  return "";
}

function getAssociatedLabels(element) {
  const out = [];
  try {
    if (element.labels) {
      Array.from(element.labels).forEach((l) => {
        const t = normalizeText(l.textContent || l.innerText);
        if (t) out.push(t);
      });
    }
    if (element.id) {
      const lbl = document.querySelector(
        `label[for="${cssEscape(element.id)}"]`
      );
      const t = lbl && normalizeText(lbl.textContent || lbl.innerText);
      if (t) out.push(t);
    }
  } catch (e) {
    // ignore
  }
  return Array.from(new Set(out)).slice(0, 3);
}

function getElementState(element) {
  const tag = (element.tagName || "").toLowerCase();
  const state = {
    disabled: Boolean(
      element.disabled || element.getAttribute?.("aria-disabled") === "true"
    ),
    readOnly: Boolean(element.readOnly),
    checked: undefined,
    selected: undefined,
    value: undefined,
    contentEditable: Boolean(element.isContentEditable),
    expanded: undefined,
    hasPopup: undefined,
    optionCount: undefined,
  };
  try {
    const ariaExpanded =
      element.getAttribute && element.getAttribute("aria-expanded");
    if (ariaExpanded != null) state.expanded = ariaExpanded === "true";
    const ariaHasPopup =
      element.getAttribute && element.getAttribute("aria-haspopup");
    if (ariaHasPopup) state.hasPopup = ariaHasPopup;
  } catch (_) {}
  if (tag === "input") {
    if (element.type === "checkbox" || element.type === "radio")
      state.checked = Boolean(element.checked);
    else state.value = element.value || "";
  } else if (tag === "textarea") {
    state.value = element.value || "";
  } else if (tag === "select") {
    const sel = Array.from(element.selectedOptions || []).map(
      (o) => o.value || o.textContent
    );
    state.selected = sel.slice(0, 5);
    state.optionCount =
      (element.options && element.options.length) || undefined;
  } else if (element.isContentEditable) {
    state.value = element.innerText || "";
  }
  // If element controls a popup list, count options
  try {
    const controls =
      element.getAttribute && element.getAttribute("aria-controls");
    if (controls) {
      let count = 0;
      controls.split(/\s+/).forEach((cid) => {
        const popup = document.getElementById(cid);
        if (popup) {
          count += popup.querySelectorAll(
            '[role="option"], [role="menuitem"], option'
          ).length;
        }
      });
      if (count) state.optionCount = count;
    }
  } catch (_) {}
  return state;
}
function getRelevantAttributes(element) {
  const attrs = {};

  const relevantAttrs = [
    "id",
    "name",
    "class",
    "type",
    "href",
    "src",
    "placeholder",
    "value",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "aria-controls",
    "aria-expanded",
    "aria-haspopup",
    "aria-current",
    "title",
    "role",
    "tabindex",
    "list",
    "data-testid",
    "data-test-id",
    "data-test",
    "data-title",
    "data-name",
    "data-label",
    "data-value",
    "data-type",
    "data-role",
    "data-action",
    "data-command",
    "data-qa",
    "data-url",
    "data-href",
  ];

  relevantAttrs.forEach((attr) => {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      if (value && value.length < 200) {
        // Limit attribute length
        attrs[attr] = value;
      }
    }
  });

  return attrs;
}

function getElementType(element) {
  const tag = element.tagName.toLowerCase();

  if (
    tag === "button" ||
    element.type === "button" ||
    element.type === "submit"
  ) {
    return "button";
  }
  if (tag === "a") {
    return "link";
  }
  if (tag === "input") {
    const type = element.type || "text";
    return `input_${type}`;
  }
  if (tag === "select") {
    return "select";
  }
  if (tag === "textarea") {
    return "textarea";
  }

  // Check for role attribute
  const role = element.getAttribute("role");
  if (role) {
    return `role_${role}`;
  }

  return tag;
}

function generateSelector(element) {
  // Try ID first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try name
  if (element.name) {
    return `${element.tagName.toLowerCase()}[name="${element.name}"]`;
  }

  // Try data-testid
  if (element.hasAttribute("data-testid")) {
    return `[data-testid="${element.getAttribute("data-testid")}"]`;
  }

  // Build path with nth-child
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = parent;

    // Limit path length
    if (path.length >= 5) break;
  }

  return path.join(" > ");
}

function sanitizeToken(str) {
  return String(str)
    .replace(/[^a-zA-Z0-9_:\-.]/g, "_")
    .slice(0, 80);
}

// Minimal CSS.escape polyfill usage for ids in selectors
function cssEscape(value) {
  try {
    // @ts-ignore
    return CSS && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : String(value).replace(/"/g, '\\"');
  } catch (_) {
    return String(value).replace(/"/g, '\\"');
  }
}

function generateXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const segments = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousSibling;

    while (sibling) {
      if (
        sibling.nodeType === Node.ELEMENT_NODE &&
        sibling.tagName === current.tagName
      ) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = current.tagName.toLowerCase();
    const segment = `${tagName}[${index}]`;
    segments.unshift(segment);

    current = current.parentElement;

    // Limit depth
    if (segments.length >= 5) break;
  }

  return "//" + segments.join("/");
}

function isInViewport(rect) {
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

// Build a shadow-root-aware path hint for elements inside web components
function generateShadowPath(element) {
  try {
    const segments = [];
    let el = element;
    let safety = 0;
    while (el && el.nodeType === 1 && safety < 30) {
      safety++;
      // Element segment
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      let seg = tag;
      if (el.id) seg += `#${el.id}`;
      else {
        // add nth-of-type for some stability
        const p = el.parentElement;
        if (p) {
          const sibs = Array.from(p.children).filter(
            (c) => c.tagName === el.tagName
          );
          if (sibs.length > 1) {
            seg += `:nth-of-type(${sibs.indexOf(el) + 1})`;
          }
        }
      }
      segments.unshift(seg);

      // If we're inside a shadow root, jump to its host and mark boundary
      const root = el.getRootNode && el.getRootNode();
      if (root && root.host && root !== document) {
        const host = root.host;
        let hostSeg = host.tagName ? host.tagName.toLowerCase() : "host";
        if (host.id) hostSeg += `#${host.id}`;
        segments.unshift(`${hostSeg} >>`); // '>>' denotes shadow boundary
        el = host;
        continue;
      }

      el = el.parentElement;
    }
    // Coalesce redundant boundaries and limit length
    const out = segments.join(" ").replace(/\s+>>\s+>>/g, " >> ");
    return out.slice(0, 400);
  } catch (_) {
    return "";
  }
}

// Provide basic frame info for elements inside same-origin iframes
function getFrameInfo(element) {
  try {
    const doc = element.ownerDocument || document;
    if (doc === document) return null;
    const win = doc.defaultView;
    const frameEl = win && win.frameElement;
    if (!frameEl) return null;
    const frames = Array.from(document.querySelectorAll("iframe"));
    const index = frames.indexOf(frameEl);
    const src = frameEl.getAttribute("src") || "";
    const name = frameEl.getAttribute("name") || "";
    return {
      index: index,
      src: src.slice(0, 200),
      name: name.slice(0, 120),
      selector: generateSelector(frameEl),
      xpath: generateXPath(frameEl),
      crossOrigin:
        frameEl.getAttribute("data-cross-origin") === "true" || false,
    };
  } catch (_) {
    return null;
  }
}

function getDOMStatistics(domData) {
  const stats = {
    total: domData.elements.length,
    inViewport: domData.elements.filter((el) => el.isInViewport).length,
    byType: {},
  };

  domData.elements.forEach((el) => {
    stats.byType[el.type] = (stats.byType[el.type] || 0) + 1;
  });

  return stats;
}

// Find nearest scrollable ancestor for container-aware visibility checks
function findScrollableAncestor(el) {
  let node = el && el.parentElement;
  let depth = 0;
  while (node && depth < 6) {
    try {
      const st = getStyle(node);
      const overflowY = st.overflowY || st.overflow;
      if (
        /(auto|scroll|overlay)/.test(overflowY) &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node;
      }
    } catch (_) {}
    node = node.parentElement;
    depth++;
  }
  return null;
}

// SPA reactivity helper
function watchDOMChanges(callback) {
  const observer = new MutationObserver(() => {
    clearTimeout(window._domUpdateTimer);
    window._domUpdateTimer = setTimeout(callback, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

// Query selectors in batches to improve performance on very large pages
function queryAllBatched(root, selectors, batchSize) {
  const out = [];
  for (let i = 0; i < selectors.length; i += batchSize) {
    const slice = selectors.slice(i, i + batchSize);
    try {
      const n = root.querySelectorAll(slice.join(", "));
      n.forEach((el) => out.push(el));
    } catch (_) {
      for (const sel of slice) {
        try {
          const n2 = root.querySelectorAll(sel);
          n2.forEach((el) => out.push(el));
        } catch (_) {}
      }
    }
  }
  return out;
}

// Export functions for use in content script
if (typeof module !== "undefined" && module.exports) {
  module.exports = { captureDOM, getDOMStatistics, watchDOMChanges };
}
