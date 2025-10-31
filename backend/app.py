from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import logging

from services.session_manager import SessionManager
from services.gemini_service import GeminiService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Allow requests from Chrome extension

# Initialize services
session_manager = SessionManager()
gemini_service = GeminiService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'service': 'Browser Automation Backend'
    })

@app.route('/session/start', methods=['POST'])
def start_session():
    """Create a new automation session"""
    try:
        data = request.json or {}
        user_goal = data.get('goal')
        tab_url = data.get('url')
        
        if not user_goal:
            return jsonify({'error': 'Goal is required'}), 400
        
        # Create new session
        session_id = session_manager.create_session(user_goal, tab_url)
        
        logger.info(f"Created session {session_id} for goal: {user_goal}")
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'message': 'Session created successfully'
        })
        
    except Exception as e:
        logger.error(f"Error creating session: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/session/<session_id>/dom', methods=['POST'])
def receive_dom(session_id):
    """Receive DOM data from extension"""
    try:
        data = request.json or {}
        dom_data = data.get('dom_data')
        
        if not dom_data:
            return jsonify({'error': 'DOM data is required'}), 400
        
        # Store DOM in session
        session_manager.update_dom(session_id, dom_data)
        
        logger.info(f"Received DOM for session {session_id}: {dom_data.get('elementCount', 0)} elements")
        
        # Analyze DOM with Gemini
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        analysis = gemini_service.analyze_dom(
            dom_data=dom_data,
            user_goal=session['goal']
        )
        
        # Store analysis in session
        session_manager.update_analysis(session_id, analysis)
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'analysis': analysis
        })
        
    except Exception as e:
        logger.error(f"Error processing DOM for session {session_id}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/session/<session_id>/next-action', methods=['POST'])
def get_next_action(session_id):
    """Get next action based on current state (used in execution loop)"""
    try:
        data = request.json or {}
        dom_data = data.get('dom_data') if data else None
        previous_result = data.get('previous_result') if data else None
        
        session = session_manager.get_session(session_id)
        
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        if previous_result:
            session_manager.update_last_action_result(session_id, previous_result)

        # Use latest DOM snapshot when none provided
        if dom_data is None:
            dom_data = session.get('dom_data')
        else:
            session_manager.update_dom(session_id, dom_data)

        if dom_data is None:
            return jsonify({'error': 'DOM data is required'}), 400
        
        # Check if max iterations reached
        if session_manager.is_max_iterations_reached(session_id):
            return jsonify({
                'success': True,
                'action_plan': {
                    'complete': False,
                    'reason': 'Maximum iterations reached',
                    'next_action': None
                }
            })
        
        # Get next action from Gemini
        action_plan = gemini_service.get_next_action(
            session=session,
            dom_data=dom_data,
            previous_result=previous_result
        )

        # If planner failed (transient LLM error), surface as retriable backend error
        if isinstance(action_plan, dict) and action_plan.get('error'):
            logger.error("Planner returned error for session %s: %s", session_id, action_plan.get('error'))
            return jsonify({
                'success': False,
                'error': 'Planner error: ' + str(action_plan.get('error')),
                'transient': bool(action_plan.get('transient')),
            }), 502

        # If model returned no next_action and did not explicitly mark complete,
        # perform a completion check to avoid front-end errors and end gracefully.
        try:
            if action_plan and not action_plan.get('complete') and not action_plan.get('next_action'):
                completion = gemini_service.check_completion(session)
                if isinstance(completion, dict) and completion.get('complete'):
                    action_plan['complete'] = True
                    # Prefer reasoning from completion check, fallback to existing reason
                    reason = completion.get('reasoning') or completion.get('evidence') or action_plan.get('reason')
                    action_plan['reason'] = reason or 'No further actions required'
                    if 'confidence' in completion:
                        action_plan['confidence'] = completion.get('confidence')
                # If still no decision but the last action succeeded, assume completion
                elif previous_result and previous_result.get('success'):
                    action_type = (previous_result.get('action') or 'action').upper()
                    target_uid = previous_result.get('target_uid') or 'target'
                    action_plan['complete'] = True
                    action_plan['reason'] = action_plan.get('reason') or f"Last action succeeded ({action_type} on {target_uid}). No further steps required."
                    # Set a moderate default confidence if not provided
                    action_plan['confidence'] = action_plan.get('confidence', 0.75)
        except Exception as _e:
            logger.warning("Completion check fallback failed: %s", _e)
        
        # Store action in session with context
        next_action = action_plan.get('next_action') if action_plan else None
        if next_action:
            session_manager.add_action(session_id, next_action)
        
        # Update status
        if action_plan.get('complete'):
            session_manager.update_status(session_id, 'COMPLETED')
        else:
            session_manager.update_status(session_id, 'EXECUTING')
        
        if isinstance(next_action, dict):
            next_action_type = next_action.get('type', 'unspecified')
        else:
            next_action_type = 'none'

        logger.info(
            "Next action for session %s: %s, Complete: %s",
            session_id,
            next_action_type,
            action_plan.get('complete') if action_plan else None,
        )

        return jsonify({
            'success': True,
            'action_plan': action_plan,
            'iteration': session['iteration']
        })
    except Exception as e:
        logger.error(f"Error getting next action for session {session_id}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/session/<session_id>/status', methods=['GET'])
def get_status(session_id):
    """Get current session status"""
    try:
        session = session_manager.get_session(session_id)
        
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        return jsonify({
            'success': True,
            'session': session
        })
        
    except Exception as e:
        logger.error(f"Error getting status for session {session_id}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/session/<session_id>/complete', methods=['POST'])
def complete_session(session_id):
    """Mark session as complete"""
    try:
        data = request.json or {}
        success = data.get('success', True)
        message = data.get('message', '')
        
        session_manager.complete_session(session_id, success, message)
        
        logger.info(f"Session {session_id} completed: {message}")
        
        return jsonify({
            'success': True,
            'session_id': session_id
        })
        
    except Exception as e:
        logger.error(f"Error completing session {session_id}: {e}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    logger.info("Starting Browser Automation Backend...")
    app.run(host='0.0.0.0', port=5000, debug=True)