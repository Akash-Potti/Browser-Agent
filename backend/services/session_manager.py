import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional

class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, Dict] = {}

    def create_session(self, user_goal: str, tab_url: Optional[str] = None) -> str:
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            'id': session_id,
            'goal': user_goal,
            'url': tab_url,
            'status': 'PLANNING',
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'dom_data': None,
            'analysis': None,
            'actions': [],
            'iteration': 0,
            'max_iterations': 20
        }
        return session_id

    def get_session(self, session_id: str) -> Optional[Dict]:
        return self.sessions.get(session_id)

    def update_dom(self, session_id: str, dom_data: dict):
        if session_id in self.sessions and dom_data is not None:
            self.sessions[session_id]['dom_data'] = dom_data
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def update_analysis(self, session_id: str, analysis: dict):
        if session_id in self.sessions:
            self.sessions[session_id]['analysis'] = analysis
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def add_action(self, session_id: str, action: dict):
        if session_id in self.sessions and action:
            action_record = {
                'action': action,
                'timestamp': datetime.now().isoformat()
            }

            self.sessions[session_id]['actions'].append(action_record)

            if action.get('type') != 'scroll':
                self.sessions[session_id]['iteration'] += 1
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def update_last_action_result(self, session_id: str, result: dict):
        if session_id in self.sessions and self.sessions[session_id]['actions']:
            self.sessions[session_id]['actions'][-1]['result'] = result
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def update_status(self, session_id: str, status: str):
        if session_id in self.sessions:
            self.sessions[session_id]['status'] = status
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def complete_session(self, session_id: str, success: bool, message: str):
        if session_id in self.sessions:
            self.sessions[session_id]['status'] = 'COMPLETED' if success else 'FAILED'
            self.sessions[session_id]['completion_message'] = message
            self.sessions[session_id]['completed_at'] = datetime.now().isoformat()
            self.sessions[session_id]['updated_at'] = datetime.now().isoformat()

    def is_max_iterations_reached(self, session_id: str) -> bool:
        session = self.get_session(session_id)
        if session:
            return session['iteration'] >= session['max_iterations']
        return False

    def cleanup_old_sessions(self, max_age_hours: int = 24):
        current_time = datetime.now()
        expired_sessions = []
        for session_id, session in list(self.sessions.items()):
            created_at = datetime.fromisoformat(session['created_at'])
            if current_time - created_at > timedelta(hours=max_age_hours):
                expired_sessions.append(session_id)
        for session_id in expired_sessions:
            del self.sessions[session_id]
        return len(expired_sessions)