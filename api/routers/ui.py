"""
Serves the web UI.

Templates live in ui/templates/.
Static assets (if any) live in ui/static/.

To add a new page: add a template and a route here.
"""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "ui" / "templates"

router = APIRouter(tags=["ui"])


def _render(name: str) -> HTMLResponse:
    path = TEMPLATES_DIR / name
    return HTMLResponse(content=path.read_text(), status_code=200)


@router.get("/", response_class=HTMLResponse)
def dashboard():
    return _render("dashboard.html")
