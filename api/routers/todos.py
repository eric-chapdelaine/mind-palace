"""
/todos  — create, list, and sync todo items through Vikunja.

Designed to be called from:
  - iPhone Shortcuts (PUT /todos  with JSON body)
  - IoT devices       (PUT /todos  with query params as fallback)
  - Future automations
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from core.database import get_session
from integrations.vikunja import VikunjaClient, VikunjaError, get_vikunja_client
from models.items import TodoItem

router = APIRouter(prefix="/todos", tags=["todos"])


# ---------------------------------------------------------------------------
# Request / Response schemas (separate from DB models)
# ---------------------------------------------------------------------------

class TodoCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    due_date: Optional[datetime] = None   # client sends ISO 8601
    project_id: Optional[int] = None      # override inbox project if needed


class TodoRead(BaseModel):
    id: int
    title: str
    notes: Optional[str]
    due_date: Optional[datetime]
    vikunja_id: Optional[int]
    project_id: Optional[int]
    synced: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/", response_model=TodoRead, status_code=201)
async def create_todo(
    body: TodoCreate,
    db: Session = Depends(get_session),
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """
    Create a new todo and immediately push it to Vikunja.
    Falls back to local-only storage if Vikunja is unreachable,
    so IoT devices never get a failed response over bad WiFi.
    """
    item = TodoItem(
        title=body.title,
        notes=body.notes,
        due_date=body.due_date,
        project_id=body.project_id,
    )

    # Try Vikunja — degrade gracefully
    try:
        result = await vikunja.create_task(
            title=body.title,
            project_id=body.project_id,
            notes=body.notes,
            due_date=body.due_date.isoformat() if body.due_date else None,
        )
        item.vikunja_id = result.get("id")
        item.synced = True
    except VikunjaError as e:
        # Store locally; a future sync job can push unsynced items
        item.synced = False
        # Surface the degraded state in logs but don't fail the request
        print(f"⚠️  Vikunja unavailable ({e}), saved locally for later sync.")

    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/", response_model=list[TodoRead])
def list_todos(
    synced: Optional[bool] = Query(default=None, description="Filter by sync status"),
    db: Session = Depends(get_session),
):
    """List all local todo items, optionally filtered by sync status."""
    query = select(TodoItem)
    if synced is not None:
        query = query.where(TodoItem.synced == synced)
    return db.exec(query).all()


@router.post("/sync", response_model=list[TodoRead])
async def sync_unsynced(
    db: Session = Depends(get_session),
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """
    Push any locally-queued (unsynced) items to Vikunja.
    Useful to call after connectivity is restored.
    """
    pending = db.exec(select(TodoItem).where(TodoItem.synced == False)).all()
    synced_items = []

    for item in pending:
        try:
            result = await vikunja.create_task(
                title=item.title,
                project_id=item.project_id,
                notes=item.notes,
                due_date=item.due_date.isoformat() if item.due_date else None,
            )
            item.vikunja_id = result.get("id")
            item.synced = True
            db.add(item)
            synced_items.append(item)
        except VikunjaError as e:
            print(f"⚠️  Could not sync item '{item.title}': {e}")

    db.commit()
    return synced_items


@router.get("/vikunja", response_model=list[dict])
async def list_vikunja_tasks(
    project_id: Optional[int] = Query(default=None),
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """Proxy: fetch tasks directly from Vikunja (live view)."""
    try:
        return await vikunja.get_tasks(project_id=project_id)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
