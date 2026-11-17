"""Test manuale CSRF."""
import sys
sys.path.insert(0, 'src')
import os
os.environ['STUDYHUB_API_TOKEN'] = 'test-api-token-12345'

from fastapi.testclient import TestClient
from studyhub.api.app import app

client = TestClient(app, raise_server_exceptions=False)

# Prima GET per ottenere CSRF cookie
r = client.get('/')
csrf_token = r.cookies.get('csrf_token')
print(f'CSRF cookie: {csrf_token}')
set_cookie = r.headers.get('set-cookie')
print(f'Set-Cookie header: {set_cookie}')

# Test POST senza CSRF (should fail)
r = client.post('/api/ai/queue', json={'course_id': 1, 'limit': 1}, headers={'Authorization': 'Bearer test-api-token-12345'})
print(f'POST senza CSRF: {r.status_code} - {r.json()}')

# Test POST con CSRF header ma senza cookie (should fail)
r = client.post('/api/ai/queue', json={'course_id': 1, 'limit': 1},
    headers={'Authorization': 'Bearer test-api-token-12345', 'X-CSRF-Token': 'fake_token'})
print(f'POST con CSRF sbagliato: {r.status_code} - {r.json()}')

# Test POST con CSRF corretto (cookie + header)
r = client.post('/api/ai/queue', json={'course_id': 1, 'limit': 1},
    headers={'Authorization': 'Bearer test-api-token-12345', 'X-CSRF-Token': csrf_token},
    cookies={'csrf_token': csrf_token})
print(f'POST con CSRF corretto: {r.status_code} - {r.json()}')

# Test GET (non deve richiedere CSRF)
r = client.get('/api/courses', headers={'Authorization': 'Bearer test-api-token-12345'})
print(f'GET senza CSRF: {r.status_code} - OK')

# Test cross-origin POST senza CSRF (simula attacco CSRF)
r = client.post('/api/ai/queue', json={'course_id': 1, 'limit': 1},
    headers={'Authorization': 'Bearer test-api-token-12345', 'Origin': 'http://evil.com'})
print(f'POST cross-origin senza CSRF: {r.status_code} - {r.json()}')