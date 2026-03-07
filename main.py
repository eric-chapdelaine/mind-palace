from contextlib import asynccontextmanager

from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from api.routers import auth, groceries, sync, todos, ui
from api.routers import fitness, nutrition
from core.config import settings
from core.database import init_db


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print(f"🚀 {settings.APP_TITLE} v{settings.APP_VERSION}: Database initialized.")
    
    scheduler.add_job(
        sync_garmin,
        'interval',
        minutes=30,
        id='garmin_sync',
        replace_existing=True
    )
    scheduler.start()
    print("📅 APScheduler started with garmin_sync job")
    
    yield
    
    scheduler.shutdown()
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
app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(fitness.router)
app.include_router(nutrition.router)

# Future routers drop in here:
# app.include_router(calendar.router)
# app.include_router(finance.router)
# app.include_router(health.router)


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "app": settings.APP_TITLE, "version": settings.APP_VERSION}


def sync_garmin():
    try:
        from services.garmin_sync import sync_garmin as _sync
        _sync()
    except Exception as e:
        print(f"⚠️  Garmin sync failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=80, reload=False)
