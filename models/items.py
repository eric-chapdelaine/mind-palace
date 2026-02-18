from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class GroceryItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    processed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TodoItem(SQLModel, table=True):
    """
    Local mirror / queue for todo items before/after Vikunja sync.
    Useful for offline queuing when the vikunja integration doesn't work
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    vikunja_id: Optional[int] = None          # set after successful push
    project_id: Optional[int] = None
    synced: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
