"""
/todos — Create, list, filter, and update local todo items.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from core.database import get_session
from models.items import TodoItem, TodoStatus, TodoPriority, Tag, TodoTag
from schemas.todos import TodoCreate, TodoUpdate, TodoRead, TagRead

router = APIRouter(prefix="/todos", tags=["todos"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sync_tags(db: Session, todo_id: int, tag_names: list[str]):
    """Ensure the given tag names exist and are linked to the todo."""
    # Remove existing links
    existing_links = db.exec(
        select(TodoTag).where(TodoTag.todo_id == todo_id)
    ).all()
    for link in existing_links:
        db.delete(link)

    for name in tag_names:
        name = name.strip().lower()
        if not name:
            continue
        tag = db.exec(select(Tag).where(Tag.name == name)).first()
        if not tag:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        db.add(TodoTag(todo_id=todo_id, tag_id=tag.id))


def _enrich_todo(db: Session, item: TodoItem) -> TodoRead:
    """Build a TodoRead with tags from the DB."""
    links = db.exec(select(TodoTag).where(TodoTag.todo_id == item.id)).all()
    tags = []
    for link in links:
        tag = db.get(Tag, link.tag_id)
        if tag:
            tags.append(TagRead.model_validate(tag))

    return TodoRead(
        id=item.id,
        title=item.title,
        description=item.description,
        due_date=item.due_date,
        status=item.status,
        priority=item.priority,
        created_at=item.created_at,
        tags=tags,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/", response_model=TodoRead, status_code=201)
def create_todo(body: TodoCreate, db: Session = Depends(get_session)):
    """Create a new todo item with optional tags and priority."""
    item = TodoItem(
        title=body.title,
        description=body.description,
        due_date=body.due_date,
        status=TodoStatus.TODO,
        priority=body.priority,
    )
    db.add(item)
    db.flush()

    if body.tag_names:
        _sync_tags(db, item.id, body.tag_names)

    db.commit()
    db.refresh(item)
    return _enrich_todo(db, item)


@router.get("/", response_model=list[TodoRead])
def list_todos(
    status: TodoStatus | None = Query(default=None, description="Filter by status"),
    priority: TodoPriority | None = Query(default=None, description="Filter by priority (1-5)"),
    tag: str | None = Query(default=None, description="Filter by tag name"),
    db: Session = Depends(get_session),
):
    """List all todo items, optionally filtered by status, priority, or tag."""
    query = select(TodoItem)
    if status is not None:
        query = query.where(TodoItem.status == status)
    if priority is not None:
        query = query.where(TodoItem.priority == priority)

    items = db.exec(query).all()

    # Tag filtering (post-query since it requires a join through TodoTag)
    if tag:
        tag_lower = tag.strip().lower()
        tag_obj = db.exec(select(Tag).where(Tag.name == tag_lower)).first()
        if not tag_obj:
            return []
        linked_ids = {
            link.todo_id
            for link in db.exec(select(TodoTag).where(TodoTag.tag_id == tag_obj.id)).all()
        }
        items = [i for i in items if i.id in linked_ids]

    return [_enrich_todo(db, i) for i in items]


@router.get("/tags", response_model=list[TagRead])
def list_tags(db: Session = Depends(get_session)):
    """List all available tags."""
    return db.exec(select(Tag)).all()


@router.get("/{todo_id}", response_model=TodoRead)
def get_todo(todo_id: int, db: Session = Depends(get_session)):
    """Get a specific todo by ID."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")
    return _enrich_todo(db, item)


@router.patch("/{todo_id}", response_model=TodoRead)
def update_todo(todo_id: int, body: TodoUpdate, db: Session = Depends(get_session)):
    """Update a todo item (any combination of fields)."""
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
    if body.priority is not None:
        item.priority = body.priority
    if body.tag_names is not None:
        _sync_tags(db, item.id, body.tag_names)

    db.add(item)
    db.commit()
    db.refresh(item)
    return _enrich_todo(db, item)


@router.delete("/{todo_id}", status_code=204)
def delete_todo(todo_id: int, db: Session = Depends(get_session)):
    """Delete a todo item and its tag links."""
    item = db.get(TodoItem, todo_id)
    if not item:
        raise HTTPException(status_code=404, detail="Todo not found")

    # Clean up tag links
    links = db.exec(select(TodoTag).where(TodoTag.todo_id == todo_id)).all()
    for link in links:
        db.delete(link)

    db.delete(item)
    db.commit()
