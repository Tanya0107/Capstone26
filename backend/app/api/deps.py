"""FastAPI dependencies, Firebase ID token verification (NFR4).

Every route depends on verify_token. Role comes from custom claims set at
provisioning (preferred) with a users doc fallback. Role checks gate the
teacher only and student only endpoints.
"""
from __future__ import annotations

import os

import firebase_admin
from fastapi import Depends, Header, HTTPException
from firebase_admin import auth as firebase_auth

from app.config import get_settings


def ensure_firebase_app() -> None:
    """Initialize the Admin SDK once. In emulator mode the auth client
    substitutes emulator credentials, so no service account is needed."""
    settings = get_settings()
    if settings.use_firestore_emulator:
        os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", settings.firebase_auth_emulator_host)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            options={"projectId": settings.firebase_project_id or "demo-project"}
        )


async def verify_token(authorization: str = Header(...)) -> dict:
    """Verify 'Bearer <Firebase ID token>' and return decoded claims with a
    role key resolved from custom claims or the users doc."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Missing bearer token")
    ensure_firebase_app()
    try:
        claims = firebase_auth.verify_id_token(token.strip())
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    if "role" not in claims:
        from app.core.firestore import get_db

        snapshot = get_db().collection("users").document(claims["uid"]).get()
        data = snapshot.to_dict() or {}
        if "role" in data:
            claims["role"] = data["role"]
    return claims


async def require_teacher(claims: dict = Depends(verify_token)) -> dict:
    if claims.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Teacher role required")
    return claims


async def require_student(claims: dict = Depends(verify_token)) -> dict:
    if claims.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student role required")
    return claims
