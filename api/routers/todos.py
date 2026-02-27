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
from integrations.google_calendar import GoogleCalendarClient, GoogleCalendarError, get_google_calendar_client
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


@router.get("/by-vikunja/{vikunja_id}", response_model=TodoRead)
def get_todo_by_vikunja(
    vikunja_id: int,
    db: Session = Depends(get_session),
):
    """Get a todo by its Vikunja ID for modal display."""
    item = db.exec(select(TodoItem).where(TodoItem.vikunja_id == vikunja_id)).first()
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")
    return item


@router.get("/{todo_id}", response_model=TodoRead)
def get_todo(
    todo_id: int,
    db: Session = Depends(get_session),
):
    """Get a specific todo by local ID for modal display."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")
    return item


@router.get("/vikunja/{vikunja_task_id}", response_model=dict)
async def get_vikunja_task(
    vikunja_task_id: int,
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """Get a specific task directly from Vikunja by its Vikunja ID."""
    try:
        return await vikunja.get_task(vikunja_task_id)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.patch("/vikunja/{vikunja_task_id}", response_model=dict)
async def update_task(
    vikunja_task_id: int,
    fields: dict,
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """
    Update a Vikunja task with the given fields.
    
    This endpoint is generic and accepts any valid Vikunja task fields.
    Common fields include:
        - title: str
        - description: str
        - due_date: str (ISO 8601)
        - done: bool
        - priority: int (0-5)
    
    The request body should be a JSON object with the fields to update.
    """
    try:
        return await vikunja.update_task(vikunja_task_id, **fields)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/vikunja/{vikunja_task_id}", status_code=204)
async def delete_task(
    vikunja_task_id: int,
    vikunja: VikunjaClient = Depends(get_vikunja_client),
):
    """Delete a task from Vikunja."""
    try:
        await vikunja.delete_task(vikunja_task_id)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/sync-to-google", status_code=200)
async def sync_to_google_calendar(
    project_id: Optional[int] = Query(default=None, description="Filter by Vikunja project ID"),
    vikunja: VikunjaClient = Depends(get_vikunja_client),
    gcal: GoogleCalendarClient = Depends(get_google_calendar_client),
):
    """
    Sync Vikunja tasks with due dates to Google Calendar.
    
    Creates, updates, or deletes events in Google Calendar to match Vikunja tasks.
    Events are tagged with the Vikunja task ID for tracking.
    """
    try:
        tasks = await vikunja.get_tasks(project_id=project_id)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    tasks_with_dates = [
        t for t in tasks
        if t.get("due_date") and t.get("due_date") != "0001-01-01T00:00:00Z"
    ]

    try:
        gcal_events = await gcal.list_events()
    except GoogleCalendarError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    gcal_event_map = {
        (ep.get("extendedProperties", {}).get("private", {}).get("vikunja_task_id")): eid
        for eid, ep in ((e.get("id"), e) for e in gcal_events if e.get("id"))
        if ep.get("extendedProperties", {}).get("private", {}).get("vikunja_task_id")
    }

    synced = 0
    errors = []

    for task in tasks_with_dates:
        task_id = str(task.get("id"))
        event_id = gcal_event_map.get(task_id)

        try:
            if event_id:
                await gcal.update_event(event_id, task)
            else:
                await gcal.create_event(task)
            synced += 1
        except GoogleCalendarError as e:
            errors.append(f"Task {task_id}: {e}")

    return {
        "synced": synced,
        "total_tasks": len(tasks_with_dates),
        "errors": errors,
    }
