// UID Generator and Element Finder - Utility for managing element identifiers

/**
 * Storage for UID to selector mappings
 * This allows us to find elements even after DOM changes
 */
const uidRegistry = new Map();

/**
 * Register an element with its UID and selectors
 * @param {string} uid - Unique identifier
 * @param {Object} selectors - Object containing different selector strategies
 */
function registerUID(uid, selectors) {
  uidRegistry.set(uid, {
    ...selectors,
    timestamp: Date.now(),
    accessCount: 0,
  });
}

/**
 * Find element by UID using multiple fallback strategies
 * @param {string} uid - Unique identifier
 * @returns {Element|null} Found element or null
 */
function getElementByUID(uid) {
  const entry = uidRegistry.get(uid);

  if (!entry) {
    console.warn(`UID not found in registry: ${uid}`);
    return null;
  }

  entry.accessCount++;

  // Strategy 1: Try CSS selector
  if (entry.selector) {
    try {
      const element = document.querySelector(entry.selector);
      if (element && isElementValid(element)) {
        console.log(`Found element by CSS selector: ${uid}`);
        return element;
      }
    } catch (e) {
      console.warn(`CSS selector failed for ${uid}:`, e.message);
    }
  }

  // Strategy 2: Try XPath
  if (entry.xpath) {
    try {
      const result = document.evaluate(
        entry.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const element = result.singleNodeValue;
      if (element && isElementValid(element)) {
        console.log(`Found element by XPath: ${uid}`);
        return element;
      }
    } catch (e) {
      console.warn(`XPath failed for ${uid}:`, e.message);
    }
  }

  // Strategy 3: Try finding by attributes
  if (entry.attributes) {
    const element = findByAttributes(entry.attributes, entry.tag);
    if (element && isElementValid(element)) {
      console.log(`Found element by attributes: ${uid}`);
      return element;
    }
  }

  // Strategy 4: Try finding by text content
  if (entry.text && entry.tag) {
    const element = findByText(entry.text, entry.tag);
    if (element && isElementValid(element)) {
      console.log(`Found element by text: ${uid}`);
      return element;
    }
  }

  console.error(`Could not find element with UID: ${uid}`);
  return null;
}

/**
 * Check if element is still valid and interactive
 * @param {Element} element
 * @returns {boolean}
 */
function isElementValid(element) {
  if (!element || !element.isConnected) {
    return false;
  }

  // Check if element is still visible
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  return true;
}

/**
 * Find element by matching attributes
 * @param {Object} attributes
 * @param {string} tag
 * @returns {Element|null}
 */
function findByAttributes(attributes, tag) {
  // Build a selector from attributes
  let selector = tag || "*";

  // Prioritize stable attributes
  const stableAttrs = ["id", "name", "data-testid", "data-test-id"];

  for (const attr of stableAttrs) {
    if (attributes[attr]) {
      selector += `[${attr}="${attributes[attr]}"]`;
      try {
        return document.querySelector(selector);
      } catch (e) {
        // Continue to next attribute
      }
    }
  }

  // Try other attributes
  for (const [key, value] of Object.entries(attributes)) {
    if (!stableAttrs.includes(key) && value) {
      try {
        const elements = document.querySelectorAll(`${tag}[${key}="${value}"]`);
        if (elements.length === 1) {
          return elements[0];
        }
      } catch (e) {
        // Continue
      }
    }
  }

  return null;
}

/**
 * Find element by text content
 * @param {string} text
 * @param {string} tag
 * @returns {Element|null}
 */
function findByText(text, tag) {
  const elements = document.querySelectorAll(tag);

  // Clean text for comparison
  const cleanText = text.trim().toLowerCase().replace(/\s+/g, " ");

  // First try exact match
  for (const element of elements) {
    const elementText = element.textContent
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (elementText === cleanText) {
      return element;
    }
  }

  // Then try partial match
  for (const element of elements) {
    const elementText = element.textContent
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (elementText.includes(cleanText) || cleanText.includes(elementText)) {
      return element;
    }
  }

  return null;
}

/**
 * Clear old entries from registry
 * Call this periodically to prevent memory leaks
 */
function cleanupRegistry() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [uid, entry] of uidRegistry.entries()) {
    if (now - entry.timestamp > maxAge && entry.accessCount === 0) {
      uidRegistry.delete(uid);
    }
  }

  console.log(`Registry cleaned. Current size: ${uidRegistry.size}`);
}

/**
 * Get registry statistics
 * @returns {Object} Statistics
 */
function getRegistryStats() {
  return {
    size: uidRegistry.size,
    entries: Array.from(uidRegistry.entries()).map(([uid, entry]) => ({
      uid,
      accessCount: entry.accessCount,
      age: Date.now() - entry.timestamp,
    })),
  };
}

/**
 * Clear entire registry
 */
function clearRegistry() {
  uidRegistry.clear();
  console.log("Registry cleared");
}

// Periodic cleanup (every 10 minutes)
setInterval(cleanupRegistry, 10 * 60 * 1000);

// Export functions
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    registerUID,
    getElementByUID,
    isElementValid,
    findByText,
    cleanupRegistry,
    getRegistryStats,
    clearRegistry,
  };
}
