from datetime import datetime
from enum import Enum
from typing import Optional
from sqlmodel import Field, SQLModel


class TodoStatus(str, Enum):
    TODO = "TODO"
    COMPLETED = "COMPLETED"


class GroceryItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    processed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TodoItem(SQLModel, table=True):
    """Local todo items stored in SQLite."""
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    status: TodoStatus = TodoStatus.TODO
    created_at: datetime = Field(default_factory=datetime.utcnow)
