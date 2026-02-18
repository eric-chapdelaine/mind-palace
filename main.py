from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.routers import groceries, todos, ui
from core.config import settings
from core.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print(f"🚀 {settings.APP_TITLE} v{settings.APP_VERSION}: Database initialized.")
    yield
    print(f"🔌 {settings.APP_TITLE}: Shutting down gracefully.")


app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    description="Central hub connecting open-source life-management tools.",
    lifespan=lifespan,
)

# --- Static files (must be mounted on app, not a router) ---
app.mount("/static", ui.static_files, name="static")

# --- Routers ---
app.include_router(ui.router)
app.include_router(todos.router)
app.include_router(groceries.router)

# Future routers drop in here:
# app.include_router(calendar.router)
# app.include_router(finance.router)
# app.include_router(health.router)


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "app": settings.APP_TITLE, "version": settings.APP_VERSION}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
