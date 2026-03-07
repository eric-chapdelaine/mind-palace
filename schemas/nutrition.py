"""Request/response schemas for nutrition endpoints."""
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CookEventCreate(BaseModel):
    recipe_id: int
    cook_date: str
    servings_produced: float = 4.0
    notes: str | None = None


class PlannedMealCreate(BaseModel):
    recipe_id: int
    meal_date: str
    slot: str = "dinner"
    servings: float = 2.0
    cook_event_id: int | None = None


class PlannedMealMove(BaseModel):
    """Move a planned meal to a different date/slot."""
    meal_date: str
    slot: str | None = None


class PantryItemCreate(BaseModel):
    ingredient_id: int
    quantity: float
    unit: str


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class IngredientRead(BaseModel):
    id: int
    name: str
    quantity_per_serving: float | None = None
    unit: str | None = None
    store_section: str | None = None


class RecipeRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    calories_per_serving: float | None = None
    protein_per_serving: float | None = None
    carbs_per_serving: float | None = None
    fat_per_serving: float | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = []
    is_batch_cook: bool = True


class RecipeDetailRead(RecipeRead):
    base_servings: int = 4
    ingredients: list[IngredientRead] = []


class CookEventRead(BaseModel):
    id: int
    recipe_id: int
    recipe_name: str | None = None
    cook_date: str | None = None
    servings_produced: float
    servings_consumed: float = 0.0
    servings_remaining: float = 0.0
    notes: str | None = None


class PlannedMealRead(BaseModel):
    id: int
    recipe_id: int
    recipe_name: str | None = None
    meal_date: str | None = None
    slot: str | None = None
    servings: float
    cook_event_id: int | None = None
    calories_per_serving: float | None = None
    protein_per_serving: float | None = None


class MealDayRead(BaseModel):
    date: str
    meals: list[PlannedMealRead] = []


class MealPlanRead(BaseModel):
    week_start_date: str
    plan_id: int | None = None
    days: list[MealDayRead] = []


class NutritionTodayRead(BaseModel):
    date: str
    calories_target: int
    calories_burned_garmin: int
    calories_burned_source: str = "none"  # "garmin" | "estimate" | "none"
    macros_target: dict
    macros_current: dict
    meals: list[PlannedMealRead] = []


class GroceryItemRead(BaseModel):
    id: int
    ingredient_id: int
    name: str
    quantity_needed: float
    unit: str | None = None
    checked: bool


class GrocerySectionRead(BaseModel):
    section: str
    items: list[GroceryItemRead]


class GroceryListRead(BaseModel):
    plan_id: int
    week_start_date: str
    sections: list[GrocerySectionRead] = []


class PantryItemRead(BaseModel):
    id: int
    ingredient_id: int
    ingredient_name: str
    quantity: float
    unit: str | None = None
