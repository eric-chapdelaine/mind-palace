from typing import Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from core.database import get_session
from models.items import GroceryItem

router = APIRouter(prefix="/groceries", tags=["groceries"])


@router.post("/", response_model=GroceryItem, status_code=201)
def add_grocery(name: str, db: Session = Depends(get_session)):
    item = GroceryItem(name=name)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/", response_model=list[GroceryItem])
def list_groceries(
    processed: Optional[bool] = False,
    db: Session = Depends(get_session),
):
    query = select(GroceryItem)
    if processed is not None:
        query = query.where(GroceryItem.processed == processed)
    return db.exec(query).all()


@router.patch("/{item_id}/done", response_model=GroceryItem)
def mark_done(item_id: int, db: Session = Depends(get_session)):
    item = db.get(GroceryItem, item_id)
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Item not found")
    item.processed = True
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
