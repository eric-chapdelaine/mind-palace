"""
Serves the web UI.

Templates live in ui/templates/.
Static assets  live in ui/static/   — mounted at /static.

To add a new page: add a template and a route here.
"""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "ui" / "templates"
STATIC_DIR    = Path(__file__).parent.parent.parent / "ui" / "static"

router = APIRouter(tags=["ui"])

# Exposed so main.py can mount it (StaticFiles must be mounted on the app, not a router)
static_files = StaticFiles(directory=STATIC_DIR)


def _render(name: str) -> HTMLResponse:
    return HTMLResponse(content=(TEMPLATES_DIR / name).read_text(), status_code=200)


@router.get("/", response_class=HTMLResponse)
def dashboard():
    return _render("dashboard.html")
