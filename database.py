"""Async SQLite database operations. Strictly limited to user registration."""

import aiosqlite

DATABASE_PATH = "chat.db"


async def get_db() -> aiosqlite.Connection:
    """Get an async database connection."""
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    """Initialize the database schema. Creates users table if not exists."""
    db = await get_db()
    try:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.commit()
    finally:
        await db.close()


async def create_user(username: str, password_hash: str) -> bool:
    """Insert a new user. Returns True on success, False if username exists."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash),
        )
        await db.commit()
        return True
    except aiosqlite.IntegrityError:
        return False
    finally:
        await db.close()


async def get_user_by_username(username: str) -> dict | None:
    """Fetch a user by username. Returns dict or None."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        )
        row = await cursor.fetchone()
        if row:
            return {"id": row["id"], "username": row["username"], "password_hash": row["password_hash"]}
        return None
    finally:
        await db.close()


async def get_all_users() -> list[dict]:
    """Fetch all registered usernames."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT username FROM users ORDER BY username")
        rows = await cursor.fetchall()
        return [{"username": row["username"]} for row in rows]
    finally:
        await db.close()
