from typing import Dict, Tuple, Set

# Allowed action types that the planner may return
ALLOWED_ACTION_TYPES: Set[str] = {
	"click",
	"type",
	"scroll",
	"wait",
	"navigate",
	"go_to_url",
	"open_url",
	"m_go_to_url",
	"select",
	"hover",
	"press",
	"check",
	"uncheck",
	"submit",
	"wait_for_selector",
	"wait_for_url_change",
	"wait_network_idle",
}


def normalize_action(action: Dict) -> Dict:
	if not isinstance(action, dict):
		return {}
	a = dict(action)
	t = str(a.get("type", "")).strip().lower()
	a["type"] = t

	# Normalize common aliases
	if t in {"go_to", "open"}:
		a["type"] = "navigate"
		t = "navigate"

	# Normalize duration if present
	if "duration" in a:
		try:
			a["duration"] = int(a["duration"]) if a["duration"] is not None else None
		except Exception:
			a["duration"] = None

	# Provide sensible defaults for specialized waits
	if t == "wait_for_url_change":
		mode = str(a.get("match") or a.get("mode") or "change").lower()
		if mode not in {"change", "equals", "contains", "regex"}:
			mode = "change"
		a["match"] = mode
		if not a.get("duration"):
			a["duration"] = 5000
		# Enforce a practical minimum to avoid flaky 2s waits
		try:
			if int(a.get("duration", 0)) < 1500:
				a["duration"] = 4000
		except Exception:
			a["duration"] = 5000
	elif t == "wait_network_idle":
		if not a.get("duration"):
			a["duration"] = 4000
		if a.get("idle_ms") is None and a.get("idleMs") is None:
			a["idle_ms"] = 800

	return a


def validate_action(action: Dict) -> Tuple[bool, Dict, str]:
	"""Validate and lightly sanitize a planner action.

	Returns (ok, normalized_action, error_message)
	"""
	a = normalize_action(action)
	t = a.get("type")
	if not t:
		return False, a, "Missing action type"
	if t not in ALLOWED_ACTION_TYPES:
		return False, a, f"Unsupported action type: {t}"

	# Validate per-action fields lightly
	if t == "type":
		if not isinstance(a.get("value"), str) or a.get("value") == "":
			return False, a, "Type action requires non-empty 'value'"

	if t in {"navigate", "go_to_url", "open_url", "m_go_to_url"}:
		if not isinstance(a.get("value") or a.get("url") or a.get("target_url"), str):
			return False, a, "Navigate action requires 'value'|'url'|'target_url'"

	if t in {"wait", "wait_for_selector", "wait_for_url_change", "wait_network_idle"}:
		dur = a.get("duration")
		if dur is None:
			a["duration"] = 1000 if t == "wait" else 2000
		# Clamp duration
		try:
			d = int(a["duration"])
			if d < 100:
				a["duration"] = 100
			if d > 60000:
				a["duration"] = 60000
		except Exception:
			a["duration"] = 2000

	return True, a, ""

