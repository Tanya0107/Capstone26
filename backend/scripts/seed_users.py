"""Dev account provisioning against the emulators (Step 2.4, Q5 dev default).

Creates 1 school, 2 teachers and 12 students in the Auth emulator, writes
their users docs and sets role custom claims. Idempotent, safe to re run.

Run from backend/ with the emulators up:
    .venv/bin/python -m scripts.seed_users

Real pilot provisioning is OPEN QUESTION Q5 and must not reuse this script.
The guard below refuses to run outside emulator mode.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from firebase_admin import auth as firebase_auth

from app.api.deps import ensure_firebase_app
from app.config import get_settings
from app.core.firestore import get_db

SCHOOL_KEY = "school1"
PASSWORD = "Demo1234"

TEACHERS = [
    {"uid": "t1", "email": "teacher1@demo.school", "name": "רות כהן"},
    {"uid": "t2", "email": "teacher2@demo.school", "name": "דוד לוי"},
]

STUDENT_NAMES = [
    "נועה פרץ", "איתי ביטון", "מאיה אזולאי", "יונתן מזרחי",
    "תמר דהן", "עידו אוחיון", "שירה גבאי", "אורי אמסלם",
    "הילה שטרית", "נדב אברהם", "ליאור חדד", "רוני סבן",
]

STUDENTS = [
    {"uid": f"s{i + 1:02d}", "email": f"student{i + 1:02d}@demo.school", "name": name}
    for i, name in enumerate(STUDENT_NAMES)
]


def upsert_auth_user(uid: str, email: str, name: str, role: str) -> None:
    try:
        firebase_auth.create_user(uid=uid, email=email, password=PASSWORD, display_name=name)
        action = "created"
    except firebase_auth.UidAlreadyExistsError:
        firebase_auth.update_user(uid, email=email, password=PASSWORD, display_name=name)
        action = "updated"
    firebase_auth.set_custom_user_claims(uid, {"role": role, "schoolKey": SCHOOL_KEY})
    print(f"  {action} {role:7s} {uid:4s} {email}")


def main() -> None:
    settings = get_settings()
    if not settings.use_firestore_emulator:
        sys.exit("Refusing to seed outside emulator mode (Q5, pilot provisioning is open)")

    ensure_firebase_app()
    db = get_db()

    print("Seeding school:")
    db.collection("schools").document(SCHOOL_KEY).set(
        {"schoolName": "בית ספר הדגמה", "location": "IL"}
    )
    print(f"  upserted {SCHOOL_KEY}")

    print("Seeding users:")
    for teacher in TEACHERS:
        upsert_auth_user(teacher["uid"], teacher["email"], teacher["name"], "teacher")
        db.collection("users").document(teacher["uid"]).set(
            {"name": teacher["name"], "avatar": "", "role": "teacher", "schoolKey": SCHOOL_KEY}
        )
    for student in STUDENTS:
        upsert_auth_user(student["uid"], student["email"], student["name"], "student")
        db.collection("users").document(student["uid"]).set(
            {"name": student["name"], "avatar": "", "role": "student", "schoolKey": SCHOOL_KEY}
        )

    print(f"\nDone. Password for every account: {PASSWORD}")


if __name__ == "__main__":
    main()
