"""FastAPI dependencies — Firebase ID-token verification (NFR4).

Every route depends on verify_token; role checks gate teacher-only endpoints.
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException


async def verify_token(authorization: str = Header(...)) -> dict:
    """Verify 'Bearer <Firebase ID token>' and return decoded claims.

    TODO Phase 2: firebase_admin.auth.verify_id_token; attach role from the
    users collection (or custom claims — preferred, set at provisioning).
    """
    raise NotImplementedError("Implement in Phase 2, Step 2.4")


async def require_teacher(claims: dict = Depends(verify_token)) -> dict:
    if claims.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Teacher role required")
    return claims


async def require_student(claims: dict = Depends(verify_token)) -> dict:
    if claims.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student role required")
    return claims
