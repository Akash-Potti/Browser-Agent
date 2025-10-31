import requests
import json
import time

BASE_URL = "http://localhost:5000"

def test_health():
    """Test health check endpoint"""
    print("\n1. Testing health check...")
    response = requests.get(f"{BASE_URL}/health")
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.json()}")
    assert response.status_code == 200
    print("   ✓ Health check passed")

def test_create_session():
    """Test session creation"""
    print("\n2. Testing session creation...")
    data = {
        "goal": "Click the login button",
        "url": "https://example.com"
    }
    response = requests.post(f"{BASE_URL}/session/start", json=data)
    print(f"   Status: {response.status_code}")
    result = response.json()
    print(f"   Session ID: {result.get('session_id')}")
    assert response.status_code == 200
    assert 'session_id' in result
    print("   ✓ Session creation passed")
    return result['session_id']

def test_send_dom(session_id):
    """Test DOM submission and Gemini analysis"""
    print("\n3. Testing DOM submission and Gemini analysis...")
    
    dom_data = {
        "dom_data": {
            "url": "https://example.com",
            "title": "Example Domain",
            "timestamp": int(time.time() * 1000),
            "elementCount": 5,
            "elements": [
                {
                    "uid": "elem_id_username",
                    "tag": "input",
                    "type": "input_text",
                    "text": "",
                    "attributes": {
                        "id": "username",
                        "name": "username",
                        "placeholder": "Username"
                    },
                    "isInViewport": True,
                    "selector": "#username",
                    "xpath": "//*[@id='username']"
                },
                {
                    "uid": "elem_id_password",
                    "tag": "input",
                    "type": "input_password",
                    "text": "",
                    "attributes": {
                        "id": "password",
                        "name": "password",
                        "type": "password"
                    },
                    "isInViewport": True,
                    "selector": "#password",
                    "xpath": "//*[@id='password']"
                },
                {
                    "uid": "elem_id_login_btn",
                    "tag": "button",
                    "type": "button",
                    "text": "Login",
                    "attributes": {
                        "id": "login_btn",
                        "type": "submit"
                    },
                    "isInViewport": True,
                    "selector": "#login_btn",
                    "xpath": "//*[@id='login_btn']"
                },
                {
                    "uid": "elem_name_remember",
                    "tag": "input",
                    "type": "input_checkbox",
                    "text": "Remember me",
                    "attributes": {
                        "name": "remember",
                        "type": "checkbox"
                    },
                    "isInViewport": True,
                    "selector": "input[name='remember']",
                    "xpath": "//input[@name='remember']"
                },
                {
                    "uid": "elem_a7f3b9_4",
                    "tag": "a",
                    "type": "link",
                    "text": "Forgot password?",
                    "attributes": {
                        "href": "/forgot-password"
                    },
                    "isInViewport": True,
                    "selector": "a[href='/forgot-password']",
                    "xpath": "//a[@href='/forgot-password']"
                }
            ],
            "viewport": {
                "width": 1920,
                "height": 1080,
                "scrollX": 0,
                "scrollY": 0
            }
        }
    }
    
    response = requests.post(f"{BASE_URL}/session/{session_id}/dom", json=dom_data)
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        print(f"   Analysis received:")
        analysis = result.get('analysis', {})
        print(f"   - Understanding: {analysis.get('understanding')}")
        print(f"   - Confidence: {analysis.get('confidence')}")
        print(f"   - First action: {analysis.get('first_action', {}).get('type')}")
        print(f"   - Target: {analysis.get('first_action', {}).get('target_uid')}")
        print("   ✓ DOM submission and analysis passed")
    else:
        print(f"   ✗ Error: {response.json()}")
        raise Exception("DOM submission failed")

def test_get_status(session_id):
    """Test getting session status"""
    print("\n4. Testing session status...")
    response = requests.get(f"{BASE_URL}/session/{session_id}/status")
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        session = result.get('session', {})
        print(f"   - Goal: {session.get('goal')}")
        print(f"   - Status: {session.get('status')}")
        print(f"   - Iterations: {session.get('iteration')}")
        print("   ✓ Status check passed")
    else:
        print(f"   ✗ Error: {response.json()}")

def test_complete_session(session_id):
    """Test completing session"""
    print("\n5. Testing session completion...")
    data = {
        "success": True,
        "message": "Test completed successfully"
    }
    response = requests.post(f"{BASE_URL}/session/{session_id}/complete", json=data)
    print(f"   Status: {response.status_code}")
    assert response.status_code == 200
    print("   ✓ Session completion passed")

def run_all_tests():
    """Run all tests"""
    print("=" * 60)
    print("BACKEND API TEST SUITE")
    print("=" * 60)
    
    try:
        test_health()
        session_id = test_create_session()
        test_send_dom(session_id)
        test_get_status(session_id)
        test_complete_session(session_id)
        
        print("\n" + "=" * 60)
        print("✓ ALL TESTS PASSED!")
        print("=" * 60)
        print("\nBackend is working correctly! 🎉")
        print("Next: Connect the extension to the backend.")
        
    except Exception as e:
        print("\n" + "=" * 60)
        print(f"✗ TEST FAILED: {e}")
        print("=" * 60)
        raise

if __name__ == "__main__":
    print("\nMake sure the Flask server is running on localhost:5000")
    print("Press Enter to start tests...")
    input()
    
    run_all_tests()