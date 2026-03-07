from datetime import datetime
from enum import Enum
from sqlmodel import Field, SQLModel, Relationship


class TodoStatus(str, Enum):
    TODO = "TODO"
    COMPLETED = "COMPLETED"


class TodoPriority(int, Enum):
    """Numeric priority: 1 (highest) to 5 (lowest)."""
    P1 = 1
    P2 = 2
    P3 = 3
    P4 = 4
    P5 = 5


class Tag(SQLModel, table=True):
    """Free-form tags for categorising items."""
    __tablename__ = "tag"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TodoTag(SQLModel, table=True):
    """Many-to-many link between TodoItem and Tag."""
    __tablename__ = "todo_tag"

    todo_id: int = Field(foreign_key="todoitem.id", primary_key=True)
    tag_id: int = Field(foreign_key="tag.id", primary_key=True)


class GroceryItem(SQLModel, table=True):
    """Simple grocery list items (separate from nutrition grocery lists)."""
    __tablename__ = "groceryitem"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    processed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TodoItem(SQLModel, table=True):
    """Local todo items stored in SQLite."""
    __tablename__ = "todoitem"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    description: str | None = None
    due_date: datetime | None = None
    status: TodoStatus = TodoStatus.TODO
    priority: TodoPriority = TodoPriority.P3
    created_at: datetime = Field(default_factory=datetime.utcnow)
