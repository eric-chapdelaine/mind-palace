"""
/groceries — Simple grocery list CRUD.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from core.database import get_session
from models.items import GroceryItem
from schemas.groceries import GroceryItemCreate, GroceryItemRead

router = APIRouter(prefix="/groceries", tags=["groceries"])


@router.post("/", response_model=GroceryItemRead, status_code=201)
def add_grocery(body: GroceryItemCreate, db: Session = Depends(get_session)):
    """Add an item to the grocery list."""
    item = GroceryItem(name=body.name)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/", response_model=list[GroceryItemRead])
def list_groceries(
    processed: bool | None = False,
    db: Session = Depends(get_session),
):
    """List grocery items, optionally filtered by processed status."""
    query = select(GroceryItem)
    if processed is not None:
        query = query.where(GroceryItem.processed == processed)
    return db.exec(query).all()


@router.patch("/{item_id}/done", response_model=GroceryItemRead)
def mark_done(item_id: int, db: Session = Depends(get_session)):
    """Mark a grocery item as done."""
    item = db.get(GroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.processed = True
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
