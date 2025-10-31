# Browser Automation Backend

A Flask-based planning service that analyzes a page DOM and orchestrates next actions for the browser extension using Google Gemini. It focuses on end-to-end reliability for modern SPAs, resilient retries, and robust JSON planning.

## Features

- REST API for session lifecycle and planning
  - `GET /health` – Health probe
  - `POST /session/start` – Start a session with a goal and the current tab URL
  - `POST /session/{id}/dom` – Submit a DOM snapshot for initial analysis
  - `POST /session/{id}/next-action` – Get the next action based on current DOM and last result
  - `GET /session/{id}/status` – Inspect session state
  - `POST /session/{id}/complete` – Mark a session as complete
- Gemini-based planner with hardened prompts and JSON parsing
  - Salvages JSON from mixed prose/code blocks
  - Avoids repeated scroll or click loops; recommends targeted waits
  - Supports action types: click, type, scroll, wait, navigate/go_to_url/open_url/m_go_to_url, select, hover, press, check, uncheck, submit, wait_for_selector, wait_for_url_change, wait_network_idle
- DOM simplification with scoring
  - Considers text, ARIA labels, title, placeholder, classes, viewport, and position
  - Includes `accessibleName` and `labels` to better detect inputs (e.g., "From", "To", "Date")
  - Boosts for `combobox`, `textbox`, `listbox`, and travel-related field keywords
- Action schema validation and normalization
  - Validates action types and key fields
  - Sets sensible defaults: e.g., `wait_for_url_change` ≥ 4–5s; `wait_network_idle` duration ~4s and `idle_ms` ~800ms
- Resilience and graceful completion
  - Treats planner failures as transient 502 to trigger retries
  - Fallback completion check when `next_action` is null but the last action succeeded

## Project layout

- `app.py` – Flask API and orchestration
- `services/gemini_service.py` – Prompting, LLM calls, JSON parsing, loop guards
- `services/session_manager.py` – Session state, iterations, and history (not shown above but used by `app.py`)
- `models/schemas.py` – Action validation and normalization
- `requirements.txt` – Python dependencies
- `test_backend.py` – Simple API test harness

## Requirements

- Python 3.10+
- A Google Gemini API key (`GEMINI_API_KEY`)

## Quick start (Windows cmd)

```cmd
:: 1) Create and activate a venv (optional but recommended)
python -m venv .venv
.venv\Scripts\activate

:: 2) Install dependencies
pip install -r backend\requirements.txt

:: 3) Set your Gemini API key (replace with your key)
set GEMINI_API_KEY=your_api_key_here

:: 4) Run the server
python backend\app.py
```

The server starts on `http://localhost:5000`.

## API overview

- `POST /session/start`
  - Body: `{ "goal": "<task>", "url": "<current_tab_url>" }`
  - Returns: `{ success, session_id }`
- `POST /session/{id}/dom`
  - Body: `{ "dom_data": { ... } }` (DOM snapshot from the extension)
  - Returns: `{ success, analysis }` (first action suggestion, understanding)
- `POST /session/{id}/next-action`
  - Body: `{ "dom_data": { ... }, "previous_result": { ... } }`
  - Returns: `{ success, action_plan, iteration }`
  - On transient planner error returns 502 with `{ success: false, transient: true }` and a message – the extension will retry with a fresh DOM
- `POST /session/{id}/complete`
  - Body: `{ "success": true|false, "message": "..." }`

## Planner behavior highlights

- Prefers direct interactions over repeated scrolls
- Recommends `wait_for_selector` when a click reveals fields
- Uses `wait_for_url_change` after route changes and `wait_network_idle` for heavy SPA updates
- Avoids clicking the same element multiple times consecutively

## Testing

Optional quick test (server must be running):

```cmd
python backend\test_backend.py
```

This exercises the main endpoints and prints responses to the console.

## Troubleshooting

- 502 "Planner error" – Treated as transient; the extension retries with a fresh DOM.
- "Backend did not provide a next action" – The backend performs a completion check and, if needed, returns a graceful completion.
- Empty `GEMINI_API_KEY` – The server won’t start; set the environment variable.

## Security notes

- Do not commit secrets. Provide `GEMINI_API_KEY` via environment variables.
- The backend enables CORS for the extension; keep it bound to localhost during development.
