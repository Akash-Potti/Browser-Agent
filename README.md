# Browser Agent

End-to-end browser automation using a Chrome MV3 extension and a Flask backend powered by Google Gemini. The system captures the page DOM, plans the next action, and executes it reliably across modern SPAs, shadow DOM, and iframes.

- Extension (MV3): Side panel UI, DOM capture, action execution, multi-frame awareness, SPA waits, BFCache recovery.
- Backend (Flask): Planning API with resilient prompts, robust JSON parsing, action schema validation, and transient error handling.

## Repository structure

```
backend/
  app.py
  requirements.txt
  test_backend.py
  models/
    schemas.py
  services/
    action_executor.py
    gemini_service.py
    session_manager.py
extension/
  manifest.json
  background/
    service-worker.js
  content/
    content-script.js
    dom-extractor.js
  sidebar/
    sidebar.css
    sidebar.html
    sidebar.js
  utils/
    uid-generator.js
```

Detailed docs:
- backend/README.md – API, setup, planner behavior, testing
- extension/README.md – Features, load-unpacked, actions, DOM model, troubleshooting

## Prerequisites

- Windows (dev scripts shown for cmd.exe; macOS/Linux are similar)
- Python 3.10+
- A Google Gemini API key in the environment: `GEMINI_API_KEY`
- Chrome/Edge with Developer Mode enabled

## Quick start

1) Backend

```cmd
:: Create and activate a virtual environment (optional)
python -m venv .venv
.venv\Scripts\activate

:: Install dependencies
pip install -r backend\requirements.txt

:: Set your Gemini API key
set GEMINI_API_KEY=your_api_key_here

:: Run the server
python backend\app.py
```

The backend starts on http://localhost:5000 and exposes REST endpoints for sessions and planning.

2) Extension (Load Unpacked)

- Open Chrome → `chrome://extensions` → enable Developer Mode
- Click “Load unpacked” and select the `extension/` folder
- Open a normal http(s) page (not Chrome Web Store or chrome://), open the extension’s side panel and enter a task

## How it works

- Capture: The content script serializes actionable elements (text/labels/accessibility/roles/bounds/UID), traversing shadow DOM and same-origin iframes
- Plan: Backend simplifies DOM for the model, prompts Gemini, parses the JSON, validates actions, and returns the next step
- Execute: The extension resolves targets via UID/selector and performs the action; on errors it recaptures DOM and replans
- Stabilize: Uses `wait_for_url_change` and `wait_network_idle` between steps for SPA transitions

## Supported actions

`click`, `type`, `scroll`, `wait`, `navigate|go_to_url|open_url|m_go_to_url`, `select`, `hover`, `press`, `check`, `uncheck`, `submit`, `wait_for_selector`, `wait_for_url_change`, `wait_network_idle`.

## Troubleshooting

- Planner 502 (transient): The sidebar retries with a fresh DOM automatically
- “Content script missing” or BFCache/port closed: The sidebar reinjects content scripts and retries the step once
- Unsupported pages: Chrome Web Store, `chrome://`, and PDFs block injection; open a normal website
- “Navigated to about:blank”: Logging uses the intended target if the page is still transitioning
- Still scrolling: Planner discourages scroll loops and prefers targeted waits and field interactions; DOM scoring boosts inputs/comboboxes via accessible labels

## Development workflow

- Backend: edit `backend/services/gemini_service.py` or `backend/app.py`, restart the server; use `backend/test_backend.py` for a quick smoke test
- Extension: edit files under `extension/`; click the refresh icon in `chrome://extensions` for the loaded unpacked extension
- Inspect logs: page DevTools (content script logs), extension side panel history, and backend console logs

## Security

- Do not commit secrets. Provide `GEMINI_API_KEY` as an environment variable
- Backend enables CORS for the extension on localhost

## License

This project is provided as-is for development and experimentation.
