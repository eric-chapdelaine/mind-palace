import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    # App
    APP_TITLE: str = "Mind Palace"
    APP_VERSION: str = "0.1.0"

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./mind-palace.db")

    # Vikunja
    VIKUNJA_URL: str = os.getenv("VIKUNJA_URL", "http://localhost:3456/api/v1")
    VIKUNJA_TOKEN: str | None = os.getenv("VIKUNJA_TOKEN")
    VIKUNJA_INBOX_PROJECT_ID: int = int(os.getenv("VIKUNJA_INBOX_PROJECT_ID", "1"))


settings = Settings()
