"""Authentication REST endpoints: register, login, users list."""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from models import UserRegister, UserLogin, TokenResponse, UserInfo, MessageResponse
from database import create_user, get_user_by_username, get_all_users
import state

router = APIRouter(prefix="/api", tags=["auth"])
security = HTTPBearer()

# ── JWT Configuration ───────────────────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "chatapp-dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60


def create_access_token(username: str) -> str:
    """Create a JWT access token for the given username."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": username,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str | None:
    """Verify a JWT token and return the username, or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return username
    except JWTError:
        return None


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Dependency: extract and verify the current user from Bearer token."""
    username = verify_token(credentials.credentials)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return username


# ── Endpoints ───────────────────────────────────────────────────

@router.post("/register", response_model=MessageResponse, status_code=201)
async def register(user: UserRegister):
    """Register a new user with bcrypt hashed password."""
    # Hash password with bcrypt
    password_bytes = user.password.encode("utf-8")
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password_bytes, salt).decode("utf-8")

    success = await create_user(user.username, password_hash)
    if not success:
        raise HTTPException(status_code=409, detail="Username already exists")

    return MessageResponse(detail="User registered successfully")


@router.post("/login", response_model=TokenResponse)
async def login(user: UserLogin):
    """Authenticate user and return JWT token."""
    db_user = await get_user_by_username(user.username)
    if not db_user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Verify bcrypt hash
    password_bytes = user.password.encode("utf-8")
    stored_hash = db_user["password_hash"].encode("utf-8")

    if not bcrypt.checkpw(password_bytes, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Generate JWT
    access_token = create_access_token(db_user["username"])

    return TokenResponse(
        access_token=access_token,
        username=db_user["username"],
    )


@router.get("/users", response_model=list[UserInfo])
async def list_users(current_user: str = Depends(get_current_user)):
    """List all registered users with online status. Online users sorted first."""
    all_users = await get_all_users()
    user_list = []
    for u in all_users:
        user_list.append(
            UserInfo(
                username=u["username"],
                is_online=state.is_online(u["username"]),
            )
        )
    # Sort: online first, then alphabetically
    user_list.sort(key=lambda x: (not x.is_online, x.username))
    return user_list
