"""CSRF Protection with Double-Submit Cookie Pattern.

Implements CSRF protection using the double-submit cookie pattern:
- Cookie: csrf_token (HttpOnly, SameSite=Strict, Secure)
- Header: X-CSRF-Token (sent by client on mutating requests)
"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

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
    """Set the CSRF token as an HttpOnly, SameSite=Strict, Secure cookie."""
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,  # Only sent over HTTPS (localhost counts as secure in modern browsers)
        samesite="strict",
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
    """Validate CSRF token: compare cookie value with header value."""
    cookie_token = get_csrf_token_from_cookie(request)
    header_token = get_csrf_token_from_header(request)

    if not cookie_token or not header_token:
        return False

    # Constant-time comparison to prevent timing attacks
    return secrets.compare_digest(cookie_token, header_token)


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