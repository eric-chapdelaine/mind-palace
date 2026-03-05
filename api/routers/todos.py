"""
/todos  — create, list, and update local todo items.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from core.database import get_session
from models.items import TodoItem, TodoStatus

router = APIRouter(prefix="/todos", tags=["todos"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[TodoStatus] = None


class TodoRead(BaseModel):
    id: int
    title: str
    description: Optional[str]
    due_date: Optional[datetime]
    status: TodoStatus
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/", response_model=TodoRead, status_code=201)
def create_todo(
    body: TodoCreate,
    db: Session = Depends(get_session),
):
    """Create a new todo item."""
    item = TodoItem(
        title=body.title,
        description=body.description,
        due_date=body.due_date,
        status=TodoStatus.TODO,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/", response_model=list[TodoRead])
def list_todos(
    status: Optional[TodoStatus] = Query(default=None, description="Filter by status"),
    db: Session = Depends(get_session),
):
    """List all todo items, optionally filtered by status."""
    query = select(TodoItem)
    if status is not None:
        query = query.where(TodoItem.status == status)
    return db.exec(query).all()


@router.get("/{todo_id}", response_model=TodoRead)
def get_todo(
    todo_id: int,
    db: Session = Depends(get_session),
):
    """Get a specific todo by ID."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")
    return item


@router.patch("/{todo_id}", response_model=TodoRead)
def update_todo(
    todo_id: int,
    body: TodoUpdate,
    db: Session = Depends(get_session),
):
    """Update a todo item."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")

    if body.title is not None:
        item.title = body.title
    if body.description is not None:
        item.description = body.description
    if body.due_date is not None:
        item.due_date = body.due_date
    if body.status is not None:
        item.status = body.status

    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{todo_id}", status_code=204)
def delete_todo(
    todo_id: int,
    db: Session = Depends(get_session),
):
    """Delete a todo item."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")
    db.delete(item)
    db.commit()
