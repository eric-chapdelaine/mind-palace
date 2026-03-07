import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    # App
    APP_TITLE: str = "Mind Palace"
    APP_VERSION: str = "0.2.0"

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./mind-palace.db")

    # Vikunja (available but not currently wired to routers)
    VIKUNJA_URL: str = os.getenv("VIKUNJA_URL", "http://localhost:3456/api/v1")
    VIKUNJA_TOKEN: str | None = os.getenv("VIKUNJA_TOKEN")
    VIKUNJA_INBOX_PROJECT_ID: int = int(os.getenv("VIKUNJA_INBOX_PROJECT_ID", "1"))

    # Google Calendar (OAuth2)
    GOOGLE_CLIENT_ID: str | None = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: str | None = os.getenv("GOOGLE_CLIENT_SECRET")
    GOOGLE_REFRESH_TOKEN: str | None = os.getenv("GOOGLE_REFRESH_TOKEN")
    GOOGLE_CALENDAR_ID: str | None = os.getenv("GOOGLE_CALENDAR_ID")

    # Garmin
    GARMIN_ENABLED: bool = os.getenv("GARMIN_ENABLED", "true").lower() == "true"
    GARMIN_DB_PATH: str = os.getenv("GARMIN_DB_PATH", "./garmin.db")

    # App URL for OAuth callbacks
    APP_URL: str = os.getenv("APP_URL", "http://localhost:8000")


settings = Settings()
