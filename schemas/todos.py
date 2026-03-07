"""Request/response schemas for todo endpoints."""
from datetime import datetime

from pydantic import BaseModel

from models.items import TodoPriority, TodoStatus


class TodoCreate(BaseModel):
    title: str
    description: str | None = None
    due_date: datetime | None = None
    priority: TodoPriority = TodoPriority.P3
    tag_names: list[str] | None = None


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: datetime | None = None
    status: TodoStatus | None = None
    priority: TodoPriority | None = None
    tag_names: list[str] | None = None


class TagRead(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class TodoRead(BaseModel):
    id: int
    title: str
    description: str | None
    due_date: datetime | None
    status: TodoStatus
    priority: TodoPriority
    created_at: datetime
    tags: list[TagRead] = []

    model_config = {"from_attributes": True}
