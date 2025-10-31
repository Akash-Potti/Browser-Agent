# Browser Automation Extension (MV3)

A Chrome Manifest V3 extension that captures DOM, plans with a backend (Gemini), and executes actions across frames. It targets modern SPAs with robust element detection, retries, and smart waits.

## Features

- Side panel UI (`extension/sidebar`) to control runs, view status, and action history
- Content scripts that:
  - Capture actionable DOM with rich metadata (including accessibility, shadow paths, and frame info)
  - Execute actions: click, type, scroll, wait, navigate/go_to_url/open_url/m_go_to_url, select (native + custom), hover, press, check/uncheck, submit, wait_for_selector, wait_for_url_change, wait_network_idle
  - Resolve elements by UID and selector, with active-editable fallback
  - Handle custom dropdowns (aria-controls, role=option/menuitem)
- DOM extractor (`extension/content/dom-extractor.js`):
  - Broad interactive coverage: native controls, ARIA roles, contenteditable, data-* hooks
  - Traverses open shadow roots and same-origin iframes; marks cross-origin frames
  - Captures bounds, viewport visibility (scroll-container aware), accessibility names/labels, element state (expanded/hasPopup/options)
  - Generates selector, XPath, and a shadow-root-aware path; includes basic frame metadata
  - Performance: style caching, batched queries, debounced mutation observer
- Multi-frame aware execution and capture
- Resilience
  - Auto-reinjects content scripts when missing and on BFCache/port-closed errors; retries once
  - Treats common transient errors as recoverable and recaptures DOM to replan
  - Improved navigation logging (avoids confusing `about:blank` messages)

## Project layout

- `manifest.json` – MV3 manifest, permissions (webNavigation, scripting), all_frames enabled
- `background/service-worker.js` – Background service worker (minimal in this project)
- `content/content-script.js` – Action execution + DOM capture glue
- `content/dom-extractor.js` – High-fidelity DOM serializer
- `sidebar/` – Side panel UI (HTML/CSS/JS)
- `utils/uid-generator.js` – UID registry used to resolve elements during execution

## Prerequisites

- Backend running at `http://localhost:5000` (see backend/README.md)
- Chromium-based browser (Chrome/Edge) with Developer Mode enabled

## Install and run (Load Unpacked)

1. Build nothing is required – this is plain JS.
2. In Chrome, go to `chrome://extensions` and enable "Developer mode".
3. Click "Load unpacked" and select the `extension/` folder.
4. Open any http(s) page and open the Sidebar panel (extension’s UI).
5. Ensure the backend is up; the panel will show its connection status.

## Using the side panel

1. Enter a task in the input (e.g., "Book a bus from Bangalore to Udupi on 3 Nov 2025 after 8pm").
2. Click "Execute Task". The sidebar will:
   - Create a backend session
   - Capture the DOM (across frames)
   - Send for planning
   - Execute the returned action, then loop
3. Watch action history for status, messages, and retries.
4. Click "Stop" to stop after the current step.

## Supported actions (executed by content script)

- click, hover, press(key)
- type(value)
  - If target isn’t directly editable, the script finds inner `input/textarea/[contenteditable]/[role=textbox]` and clicks to activate edit mode before typing
- scroll (window or element)
- select(value)
  - Native `<select>` or custom dropdowns via `aria-controls` and role=option/menuitem
- check/uncheck, submit (form)
- wait(duration)
- wait_for_selector(selector, duration)
- navigate/go_to_url/open_url/m_go_to_url(value)
- wait_for_url_change({ match: change|equals|contains|regex, target_url|value, duration })
- wait_network_idle({ duration, idle_ms, max_inflight })

## DOM capture format (high level)

Each `elements[]` entry includes:
- `uid`: Stable identifier used to resolve the element later
- `tag`, `type`, `text`, `attributes`, `bounds`, `isInViewport`, `tabIndex`
- `accessibleName`, `labels`, `state` (expanded/hasPopup/optionCount), `selector`, `xpath`
- `shadowPath`: shadow-root-aware path hint; `frame`: basic iframe metadata

## Troubleshooting

- "Content script not detected" or BFCache/port closed
  - The panel auto-reinjects scripts and retries once
- Unsupported pages
  - Chrome Web Store, `chrome://` pages, and PDFs block injection; navigate to a normal http(s) site
- Cross-origin iframes
  - Content scripts cannot access cross-origin frames. The extractor marks them as cross-origin, and actions will target accessible frames.
- Planner errors (502)
  - The sidebar retries with a fresh DOM; check the backend logs for details.

## Development tips

- Keep the DevTools console open on target pages to see content-script logs
- The side panel shows action history, including retries and decisions
- To iterate quickly on extractor/executor, tweak `content/*.js`, then click the refresh icon on the Extensions page

## Security

- The extension holds no API keys. The backend’s Gemini key stays server-side.
