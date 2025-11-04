import os
import json
import logging
import re
from typing import Dict, List, Optional
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

class GeminiService:
    """Service for interacting with Gemini API"""
    
    def __init__(self):
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")
        
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.5-flash')
        logger.info("Gemini service initialized")
    
    def analyze_dom(self, dom_data: dict, user_goal: str) -> dict:
        """Analyze DOM and create initial action plan"""
        
        # Prepare simplified DOM for Gemini
        simplified_dom = self._simplify_dom(dom_data, user_goal)
        goal_keywords = self._extract_goal_keywords(user_goal)
        
        prompt = f"""You are a browser automation assistant. Analyze the following webpage and determine what actions to take.

USER GOAL: {user_goal}

GOAL KEYWORDS: {', '.join(goal_keywords) if goal_keywords else 'n/a'}

WEBPAGE URL: {dom_data.get('url', 'unknown')}
WEBPAGE TITLE: {dom_data.get('title', 'unknown')}

AVAILABLE INTERACTIVE ELEMENTS:
{json.dumps(simplified_dom, indent=2)}

TASK:
1. Identify which element(s) are relevant to the user's goal
2. Determine the first action to take
3. Explain your reasoning

Return your response in this JSON format:
{{
    "understanding": "Brief description of what you understand the user wants",
    "relevant_elements": ["uid1", "uid2", ...],
    "first_action": {{
        "type": "click|type|scroll|wait|navigate|go_to_url|open_url|m_go_to_url|select|select_autocomplete|hover|press|check|uncheck|submit|wait_for_selector",
        "target_uid": "element_uid (if applicable)",
        "value": "text to type (type action) or URL (navigate) or option value/text (select/select_autocomplete)",
        "key": "Key to press (press action, e.g., Enter)",
        "duration": 1000,
        "target_selector": "CSS selector for wait_for_selector (optional)",
        "reasoning": "Why this action"
    }},
    "next_steps": ["step2", "step3", ...],
    "confidence": 0.0-1.0
}}

IMPORTANT: Only return valid JSON, no other text.

AUTOCOMPLETE GUIDELINES:
- After typing into a combobox/autocomplete field (role="combobox", aria-autocomplete), the next action should typically be "select_autocomplete" with the desired option text
- select_autocomplete does NOT need a target_uid - it searches visible dropdowns globally
- Example flow: 1) type "bangalore" into FROM field, 2) select_autocomplete with value "Bangalore, Karnataka"
"""

        try:
            response = self.model.generate_content(prompt)
            result = self._parse_json_response(response.text)
            
            logger.info(f"Gemini analysis complete. Confidence: {result.get('confidence', 0)}")
            return result
            
        except Exception as e:
            logger.error(f"Error analyzing DOM with Gemini: {e}")
            return self._fallback_analysis()
    
    def get_next_action(self, session: dict, dom_data: dict, previous_result: Optional[dict] = None) -> dict:
        """Get next action based on current state"""
        
        user_goal = session.get('goal')
        action_history = session.get('actions', [])
        iteration = session.get('iteration', 0)
        
        # Build context from history
        history_summary = self._summarize_history(action_history)

        scroll_streak = 0
        for entry in reversed(action_history):
            action = entry.get('action', {})
            action_type = (action.get('type') or '').lower()
            result = entry.get('result') or {}
            result_success = result.get('success')

            if action_type == 'scroll' and (result_success is not False):
                scroll_streak += 1
            else:
                break

        scroll_warning = ""
        if scroll_streak >= 2:
            scroll_warning = (
                f"WARNING: The last {scroll_streak} actions were SCROLL and did not progress the goal. "
                "Avoid recommending another scroll. Choose a different action that directly advances the objective."
            )

        # Detect repeat clicks on the same target to avoid loops
        same_click_streak = 0
        last_click_uid = None
        for entry in reversed(action_history):
            action = entry.get('action', {}) or {}
            if (action.get('type') or '').lower() != 'click':
                break
            uid = action.get('target_uid') or action.get('target') or None
            if last_click_uid is None:
                last_click_uid = uid
                same_click_streak = 1
            elif uid == last_click_uid:
                same_click_streak += 1
            else:
                break

        repeat_warning = ""
        if same_click_streak >= 2 and last_click_uid:
            repeat_warning = (
                f"WARNING: The last {same_click_streak} actions were CLICK on the SAME element (uid={last_click_uid}). "
                "Do NOT click the same element again. Prefer an alternative: wait_for_selector for the expected input, type into the revealed input/contenteditable, or click a different control that clearly leads to editing the bio."
            )
        
        # Build previous result summary
        prev_result_summary = "No previous action"
        just_navigated = False
        just_typed_message = False
        if previous_result:
            if previous_result.get('success'):
                action_type = str(previous_result.get('action', '')).lower()
                prev_result_summary = f"Action succeeded: {previous_result.get('action')} on {previous_result.get('target_uid')}"
                
                # Check if we just typed into a message/text field
                if action_type == 'type':
                    target_uid = str(previous_result.get('target_uid', ''))
                    # Common message input identifiers
                    if any(keyword in target_uid.lower() for keyword in ['message', 'text', 'input', 'entry', 'composer', 'chat', 'reply']):
                        just_typed_message = True
                        prev_result_summary += "\n💬 Just typed text into a message/input field"
                        prev_result_summary += "\n⚠️ IMPORTANT: Send/Submit buttons may have changed from disabled to enabled"
                        prev_result_summary += "\n🔍 Look for enabled send buttons in the current DOM (state.disabled=false or interaction.isDisabled=false)"
                
                if previous_result.get('navigated'):
                    just_navigated = True
                    prev_result_summary += f"\n✅ NAVIGATED to: {previous_result.get('url')}"
                    prev_result_summary += "\n⚠️ DOM below is from the NEW page after navigation"
                if previous_result.get('errors'):
                    prev_result_summary += f"\nPage errors: {', '.join(previous_result.get('errors', []))}"
                if previous_result.get('successes'):
                    prev_result_summary += f"\nSuccess messages: {', '.join(previous_result.get('successes', []))}"
            else:
                prev_result_summary = f"Action failed: {previous_result.get('error')}"
        
        # Simplified DOM for context
        simplified_dom = self._simplify_dom(dom_data, user_goal)
        goal_keywords = self._extract_goal_keywords(user_goal)
        
        # Add navigation context
        navigation_context = ""
        if just_navigated:
            navigation_context = f"""
⚠️ IMPORTANT: You just navigated to a new page ({dom_data.get('url')})
- The elements below are from the NEW page
- Ignore any elements from the previous page
- Focus on elements that help achieve the goal on THIS page
- Current page title: {dom_data.get('title')}
"""
        
        prompt = f"""You are continuing a browser automation task.

USER GOAL: {user_goal}
ITERATION: {iteration + 1}/20

PREVIOUS ACTIONS:
{history_summary}

PREVIOUS ACTION RESULT:
{prev_result_summary}

{navigation_context}

CURRENT PAGE STATE:
URL: {dom_data.get('url')}
Title: {dom_data.get('title')}
Elements available: {len(simplified_dom)}

GOAL KEYWORDS: {', '.join(goal_keywords) if goal_keywords else 'n/a'}

AVAILABLE ELEMENTS:
{json.dumps(simplified_dom[:30], indent=2)}

{scroll_warning if scroll_warning else ""}
{repeat_warning if repeat_warning else ""}

TASK: Determine if the goal is complete, or what action to take next.

Return JSON in this exact format:
{{
    "complete": true or false,
    "reason": "Why task is complete or what we're trying to do",
    "confidence": 0.0-1.0,
    "next_action": {{
        "type": "click|type|scroll|wait|navigate|go_to_url|open_url|m_go_to_url|select|select_autocomplete|hover|press|check|uncheck|submit|wait_for_selector",
        "target_uid": "element_uid (if applicable)",
        "value": "text (type) | URL (navigate) | option (select/select_autocomplete)",
        "key": "Key to press (for press action)",
        "duration": 1000,
        "target_selector": "CSS selector for wait_for_selector (optional)",
        "reasoning": "Why this action"
    }} or null if complete
}}

IMPORTANT RULES:
1. If goal appears achieved (success message, reached target page, form submitted), set complete=true
2. If stuck (same error 3+ times, no relevant elements), set complete=false and explain
3. Only return valid JSON, no other text
4. For type actions, always include the text in "value" field
5. Be concise in reasoning
6. Avoid recommending "scroll" unless it is the only viable step. Never recommend scroll if the last action was already a scroll.
7. Prefer direct interactions (click/type/select/submit) on elements whose text, aria-label, or title matches the goal keywords.
8. Use "navigate|go_to_url|open_url|m_go_to_url" when the goal explicitly mentions a URL or site.
9. Recommend "wait" or "wait_for_selector" when an action should reveal inputs (e.g., after clicking 'Edit profile'). Use a specific selector like input[name*="bio"], textarea[name*="bio"], [contenteditable="true"].
10. Do NOT click the same element more than once in a row. If the last click didn't reveal a new field, try wait_for_selector or choose a different element.
11. If no perfect match exists, choose the best available element rather than returning null.
12. AUTOCOMPLETE FLOW: After a successful TYPE action on a combobox/autocomplete field, if you see options appeared in the previous result, use "select_autocomplete" (NO target_uid needed) with the desired option text as value.
13. ⚠️ AFTER NAVIGATION: If the previous action was a navigation and you see elements from the new page, you can proceed immediately. The page has already loaded.
14. 🔑 SENDING MESSAGES: After typing a message, look for a "Send" button to click. DO NOT use "press" action with Enter key - modern messaging apps (WhatsApp, Slack, Discord, etc.) require clicking the Send button. Only use "press" for special keys in specific contexts (like Escape to close dialogs).
15. 📨 CRITICAL - MESSAGING APPS: Typing text into a message input field does NOT send the message! You MUST find and click the Send button after typing. Common send button indicators: text like "Send", "Post", "Submit", icons like ➤ ▶ 📤, aria-label="Send", data-testid contains "send" or "submit". The task is NOT complete until the send button is clicked and the message appears in the conversation thread.
16. 🔓 DISABLED BUTTONS: Send/Submit buttons are often DISABLED until text is entered. After a successful TYPE action, the send button may become ENABLED. Look for buttons with state.disabled=false or interaction.isDisabled=false after typing. The button that was disabled in previous DOM may now be enabled in the current DOM. Don't skip clicking send just because you saw it was disabled before typing."""

        try:
            response = self.model.generate_content(prompt)
            result = self._parse_json_response(response.text)

            # Safely log next action type even when next_action is null
            try:
                next_action = result.get('next_action') or {}
                next_type = next_action.get('type', 'complete' if result.get('complete') else 'none')
                logger.info("Next action: %s, Complete: %s", next_type, result.get('complete'))
            except Exception:
                logger.info("Next action: unknown, Complete: %s", result.get('complete'))
            return result
            
        except Exception as e:
            logger.error(f"Error getting next action from Gemini: {e}")
            return self._fallback_next_action()
    
    def check_completion(self, session: dict) -> dict:
        """Check if task is complete"""
        dom_data = session.get('dom_data') or {}
        user_goal = session.get('goal')
        action_history = session.get('actions', [])
        
        history_summary = self._summarize_history(action_history)
        
        prompt = f"""Evaluate if this browser automation task is complete.

USER GOAL: {user_goal}

ACTIONS TAKEN:
{history_summary}

CURRENT PAGE:
URL: {dom_data.get('url')}
Title: {dom_data.get('title')}

QUESTION: Has the user's goal been achieved?

CRITICAL CHECKS FOR MESSAGING TASKS:
- If the goal involves sending a message (e.g., "message X", "send Y", "DM Z"):
  - Typing the message is NOT enough - you must verify the send button was clicked
  - Look for actions like "CLICK on send button" or "CLICK on submit"
  - Check if the message appears in the conversation thread
  - If you only see TYPE actions without a subsequent CLICK on send/submit, the task is NOT complete

Return JSON:
{{
    "complete": true/false,
    "confidence": 0.0-1.0,
    "reasoning": "Detailed explanation",
    "evidence": ["What on the page indicates success/failure"]
}}

IMPORTANT: Only return valid JSON, no other text."""

        try:
            response = self.model.generate_content(prompt)
            result = self._parse_json_response(response.text)
            
            logger.info(f"Completion check: {result.get('complete', False)}")
            return result
            
        except Exception as e:
            logger.error(f"Error checking completion with Gemini: {e}")
            return {'complete': False, 'confidence': 0, 'reasoning': 'Error checking completion'}
    
    def _simplify_dom(self, dom_data: dict, user_goal: Optional[str] = None) -> list:
        """Simplify DOM data for Gemini (reduce token usage)"""
        if not isinstance(dom_data, dict):
            return []

        elements = dom_data.get('elements', [])
        keywords = self._extract_goal_keywords(user_goal)

        simplified = []

        for index, elem in enumerate(elements):
            attributes = elem.get('attributes', {}) or {}
            text = (elem.get('text') or '').strip()
            tag = elem.get('tag')
            element_type = elem.get('type')
            aria_label = attributes.get('aria-label') or attributes.get('aria_label')
            title = attributes.get('title')
            href = attributes.get('href')
            role = attributes.get('role')
            placeholder = attributes.get('placeholder')
            data_test = attributes.get('data-testid') or attributes.get('data-test-id') or attributes.get('data-test')
            classes = attributes.get('class')

            score = 0.0
            if elem.get('isInViewport'):
                score += 6
            if tag in ('a', 'button'):
                score += 5
            if role in ('button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'):
                score += 4
            if href:
                score += 4
            if aria_label or title:
                score += 2
            if data_test:
                score += 3  # data-testid is a strong signal (Twitter, React apps)
            if text:
                score += min(len(text) / 20.0, 4)

            aggregate_text = ' '.join(
                filter(
                    None,
                    [
                        text.lower(),
                        (aria_label or '').lower(),
                        (title or '').lower(),
                        (placeholder or '').lower(),
                        (classes or '').lower(),
                        (data_test or '').lower(),  # Include testid in searchable text
                    ],
                )
            )

            if keywords and aggregate_text:
                keyword_hits = sum(1 for kw in keywords if kw in aggregate_text)
                score += keyword_hits * 3
            
            # Boost score for send/submit buttons (important for messaging)
            if any(term in aggregate_text for term in ['send', 'submit', 'post', 'reply', 'message']):
                if tag == 'button' or role == 'button':
                    score += 5  # Prioritize send buttons

            bounds = elem.get('bounds') or {}
            top = bounds.get('top')
            if isinstance(top, (int, float)):
                score += max(0.0, 4 - (top / 250.0))
            
            # Get disabled state from element
            state = elem.get('state', {}) or {}
            interaction = elem.get('interaction', {}) or {}
            is_disabled = state.get('disabled', False) or interaction.get('isDisabled', False)

            simplified.append({
                'uid': elem.get('uid'),
                'type': element_type,
                'tag': tag,
                'text': text[:160],
                'ariaLabel': aria_label,
                'title': title,
                'href': href,
                'role': role,
                'placeholder': placeholder,
                'dataTestId': data_test,
                'class': (classes[:140] + '…') if classes and len(classes) > 140 else classes,
                'inViewport': elem.get('isInViewport'),
                'disabled': is_disabled,  # Include disabled state
                'score': round(score, 2),
                'index': index,
                'bounds': {
                    'top': bounds.get('top'),
                    'left': bounds.get('left'),
                    'width': bounds.get('width'),
                    'height': bounds.get('height'),
                },
            })

        simplified_sorted = sorted(
            simplified,
            key=lambda item: (
                -item.get('score', 0.0),
                item.get('bounds', {}).get('top', float('inf')) or float('inf'),
                item.get('index', 0),
            ),
        )

        return simplified_sorted[:80]
    
    def _summarize_history(self, action_history: list) -> str:
        """Summarize action history for prompt"""
        if not action_history:
            return "No actions taken yet"

        summary_lines = []
        recent_actions = action_history[-5:]

        for idx, entry in enumerate(recent_actions, 1):
            action = entry.get('action', {})
            result = entry.get('result', {}) or {}

            action_type = action.get('type', 'unknown')
            target = action.get('target_uid') or action.get('value') or 'n/a'

            status = "success" if result.get('success') else "failure" if result else "pending"
            message = result.get('message') or result.get('error') or ''

            line = f"{idx}. {action_type} -> {status} ({target})"
            if message:
                trimmed = message.replace('\n', ' ').strip()
                summary_text = trimmed[:80] + ('…' if len(trimmed) > 80 else '')
                line += f" | {summary_text}"

            summary_lines.append(line)

        return "\n".join(summary_lines)

    def _extract_goal_keywords(self, user_goal: Optional[str]) -> List[str]:
        if not user_goal:
            return []
        keywords = [
            token
            for token in re.findall(r"[a-zA-Z0-9']+", user_goal.lower())
            if len(token) > 2
        ]
        seen = []
        for kw in keywords:
            if kw not in seen:
                seen.append(kw)
        return seen[:12]
    
    def _parse_json_response(self, text: str) -> dict:
        """Parse JSON from Gemini response, handling markdown code blocks"""
        text = text.strip()

        # Remove markdown code blocks if present
        if text.startswith('```'):
            parts = text.split('```')
            if len(parts) >= 2:
                text = parts[1]
                if text.startswith('json'):
                    text = text[4:]
        text = text.strip()

        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Salvage: extract the largest JSON object block from the text
        try:
            start = text.find('{')
            end = text.rfind('}')
            if start != -1 and end != -1 and end > start:
                candidate = text[start : end + 1]
                return json.loads(candidate)
        except Exception:
            pass

        # As last resort, try to find a JSON object with a next_action/complete key
        try:
            match = re.search(r"\{[\s\S]*?\}\s*$", text)
            if match:
                return json.loads(match.group(0))
        except Exception:
            pass

        # If still not JSON, raise with the original content for caller to handle
        logger.error("Failed to parse JSON from Gemini response")
        logger.error(f"Response text: {text}")
        raise json.JSONDecodeError("Invalid JSON from model", text, 0)
    
    def _fallback_analysis(self) -> dict:
        """Fallback response when Gemini fails"""
        return {
            'understanding': 'Unable to analyze page',
            'relevant_elements': [],
            'first_action': None,
            'next_steps': [],
            'confidence': 0.0,
            'error': 'Gemini API error'
        }
    
    def _fallback_next_action(self) -> dict:
        """Fallback for next action"""
        return {
            'complete': False,
            'reason': 'Unable to determine next action',
            'next_action': None,
            'confidence': 0.0,
            'error': 'Gemini API error',
            'transient': True
        }