"""Request/response schemas for grocery endpoints."""
from datetime import datetime

from pydantic import BaseModel


class GroceryItemCreate(BaseModel):
    name: str


class GroceryItemRead(BaseModel):
    id: int
    name: str
    processed: bool
    created_at: datetime

    model_config = {"from_attributes": True}
