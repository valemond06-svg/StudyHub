"""Autenticazione API con token Bearer o cookie."""
from __future__ import annotations

import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyCookie, APIKeyHeader


# API Token authentication
api_key_header = APIKeyHeader(name="Authorization", auto_error=False, scheme_name="Bearer")
api_key_cookie = APIKeyCookie(name="api_token", auto_error=False)


async def get_current_token(
    authorization: str | None = Security(api_key_header),
    api_token_cookie: str | None = Security(api_key_cookie),
) -> str:
    """Validate API token from Authorization header or cookie.

    Raises:
        HTTPException: 401 if token is missing or invalid.
    """
    # Get token dynamically to pick up env changes (important for tests)
    from ..config import get_or_create_api_token
    expected_token = get_or_create_api_token()

    # Check Authorization header: "Bearer <token>"
    if authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:]  # Remove "Bearer " prefix
            if secrets.compare_digest(token, expected_token):
                return token

    # Check cookie
    if api_token_cookie:
        if secrets.compare_digest(api_token_cookie, expected_token):
            return api_token_cookie

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Provide Authorization: Bearer <token> header or api_token cookie."
    )

