"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import init_db
from auth import router as auth_router
from websocket_handler import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize DB on startup."""
    await init_db()
    print("✅ Database initialized")
    print("🚀 ChatApp server running at http://localhost:8000")
    yield


app = FastAPI(
    title="E2EE ChatApp",
    description="End-to-end encrypted real-time chat application",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (for local development) ───────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(ws_router)

# ── Static files ────────────────────────────────────────────────
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# ── Root route ──────────────────────────────────────────────────
@app.get("/")
async def root():
    """Serve the main page."""
    index_path = static_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "ChatApp API is running. Frontend not yet built."}
