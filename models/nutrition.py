from datetime import date as date_type, datetime
from sqlmodel import Field, SQLModel


class Ingredient(SQLModel, table=True):
    """Ingredients for recipes."""
    __tablename__ = "nutrition_ingredient"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    store_section: str | None = None
    calories_per_100g: float | None = None
    protein_per_100g: float | None = None
    carbs_per_100g: float | None = None
    fat_per_100g: float | None = None


class Recipe(SQLModel, table=True):
    """Recipes for meal planning."""
    __tablename__ = "nutrition_recipe"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    description: str | None = None
    base_servings: int = 4
    calories_per_serving: float | None = None
    protein_per_serving: float | None = None
    carbs_per_serving: float | None = None
    fat_per_serving: float | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: str | None = None  # JSON-encoded list of tag strings
    is_batch_cook: bool = True


class RecipeIngredient(SQLModel, table=True):
    """Ingredients used in a recipe."""
    __tablename__ = "nutrition_recipe_ingredient"

    id: int | None = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="nutrition_recipe.id")
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity_per_serving: float = 0.0
    unit: str | None = None


class MealPlan(SQLModel, table=True):
    """Weekly meal plan."""
    __tablename__ = "nutrition_meal_plan"

    id: int | None = Field(default=None, primary_key=True)
    week_start_date: date_type = Field(unique=True)
    generated_at: datetime | None = None


class CookEvent(SQLModel, table=True):
    """A cooking event that produces N servings of a recipe.

    When a batch recipe is placed into a meal plan, a CookEvent is created.
    PlannedMeals consume servings from CookEvents.  Tracking is soft:
    the system shows remaining servings as a guide but does not block
    over-assignment.
    """
    __tablename__ = "nutrition_cook_event"

    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="nutrition_meal_plan.id")
    recipe_id: int = Field(foreign_key="nutrition_recipe.id")
    cook_date: date_type | None = None
    servings_produced: float = 4.0
    notes: str | None = None


class PlannedMeal(SQLModel, table=True):
    """Individual meal slot in a plan.

    A planned meal may optionally reference the CookEvent it draws from.
    If cook_event_id is NULL the meal is treated as standalone (e.g.
    eating out, simple prep).
    """
    __tablename__ = "nutrition_planned_meal"

    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="nutrition_meal_plan.id")
    meal_date: date_type | None = None
    slot: str | None = None  # "breakfast" | "lunch" | "dinner" | "snack"
    recipe_id: int = Field(foreign_key="nutrition_recipe.id")
    servings: float = 2.0
    cook_event_id: int | None = Field(default=None, foreign_key="nutrition_cook_event.id")


class PantryItem(SQLModel, table=True):
    """Items currently in pantry."""
    __tablename__ = "nutrition_pantry_item"

    id: int | None = Field(default=None, primary_key=True)
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity: float = 0.0
    unit: str | None = None


class NutritionGroceryList(SQLModel, table=True):
    """Generated grocery list (from meal plan)."""
    __tablename__ = "nutrition_grocery_list"

    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="nutrition_meal_plan.id")
    generated_at: datetime | None = None


class NutritionGroceryItem(SQLModel, table=True):
    """Items in a nutrition grocery list."""
    __tablename__ = "nutrition_grocery_item"

    id: int | None = Field(default=None, primary_key=True)
    list_id: int = Field(foreign_key="nutrition_grocery_list.id")
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity_needed: float = 0.0
    unit: str | None = None
    checked: bool = False
