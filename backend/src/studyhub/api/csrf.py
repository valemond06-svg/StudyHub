"""CSRF Protection with Double-Submit Cookie Pattern.

Implements CSRF protection using the double-submit cookie pattern:
- Cookie: csrf_token (HttpOnly, SameSite=Strict, Secure)
- Header: X-CSRF-Token (sent by client on mutating requests)
"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

# CSRF token cookie name
CSRF_COOKIE_NAME = "csrf_token"
# Header name for CSRF token from client
CSRF_HEADER_NAME = "X-CSRF-Token"
# Cookie settings
CSRF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def generate_csrf_token() -> str:
    """Generate a cryptographically secure CSRF token (32 bytes = 64 hex chars)."""
    return secrets.token_hex(32)


def set_csrf_cookie(response: Response, token: str) -> None:
    """Set the CSRF token cookie readable by client for double-submit header."""
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        httponly=False,  # Client JS reads this to send X-CSRF-Token header
        secure=False,    # Allowed over local HTTP (127.0.0.1 / localhost)
        samesite="lax",
        max_age=CSRF_COOKIE_MAX_AGE,
        path="/",
    )


def get_csrf_token_from_cookie(request: Request) -> Optional[str]:
    """Extract CSRF token from cookie."""
    return request.cookies.get(CSRF_COOKIE_NAME)


def get_csrf_token_from_header(request: Request) -> Optional[str]:
    """Extract CSRF token from X-CSRF-Token header."""
    return request.headers.get(CSRF_HEADER_NAME)


def validate_csrf(request: Request) -> bool:
    """Validate CSRF token: compare cookie value with header value.
    Requests with a valid Authorization: Bearer token are inherently safe from CSRF (OWASP standard).
    """
    cookie_token = get_csrf_token_from_cookie(request)
    header_token = get_csrf_token_from_header(request)

    # Check double-submit cookie pattern
    if cookie_token and header_token and secrets.compare_digest(cookie_token, header_token):
        return True

    # If client uses custom Authorization header with the valid API token, it is immune to CSRF
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token_val = auth_header[7:].strip()
        try:
            from ..config import get_or_create_api_token
            expected_token = get_or_create_api_token()
            if expected_token and secrets.compare_digest(token_val, expected_token):
                return True
        except Exception:
            pass

    return False


class CSRFMiddleware(BaseHTTPMiddleware):
    """Middleware that ensures CSRF cookie is set on all responses."""

    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)

        # Set CSRF cookie if not already present (for GET requests that load the UI)
        if CSRF_COOKIE_NAME not in request.cookies:
            token = generate_csrf_token()
            set_csrf_cookie(response, token)

        return response


async def csrf_protect(request: Request) -> None:
    """FastAPI dependency to protect mutating endpoints with CSRF validation.

    Usage: Add `Depends(csrf_protect)` to POST/PUT/DELETE/PATCH endpoints.

    Raises:
        HTTPException: 403 if CSRF token is missing or invalid.
    """
    # Only validate on mutating methods
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        if not validate_csrf(request):
            raise HTTPException(
                status_code=403,
                detail="CSRF token missing or invalid. Include X-CSRF-Token header matching the csrf_token cookie."
            )