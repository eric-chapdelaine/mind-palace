from datetime import date as date_type
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class Ingredient(SQLModel, table=True):
    """Ingredients for recipes."""
    __tablename__ = "nutrition_ingredient"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    store_section: Optional[str] = None
    calories_per_100g: Optional[float] = None
    protein_per_100g: Optional[float] = None
    carbs_per_100g: Optional[float] = None
    fat_per_100g: Optional[float] = None


class Recipe(SQLModel, table=True):
    """Recipes for meal planning."""
    __tablename__ = "nutrition_recipe"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    base_servings: int = 4
    calories_per_serving: Optional[float] = None
    protein_per_serving: Optional[float] = None
    carbs_per_serving: Optional[float] = None
    fat_per_serving: Optional[float] = None
    prep_minutes: Optional[int] = None
    cook_minutes: Optional[int] = None
    tags: Optional[str] = None
    is_batch_cook: bool = True


class RecipeIngredient(SQLModel, table=True):
    """Ingredients used in a recipe."""
    __tablename__ = "nutrition_recipe_ingredient"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="nutrition_recipe.id")
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity_per_serving: float = 0.0
    unit: Optional[str] = None


class MealPlan(SQLModel, table=True):
    """Weekly meal plan."""
    __tablename__ = "nutrition_meal_plan"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    week_start_date: date_type = Field(unique=True)
    generated_at: Optional[datetime] = None


class PlannedMeal(SQLModel, table=True):
    """Individual meal in a plan."""
    __tablename__ = "nutrition_planned_meal"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="nutrition_meal_plan.id")
    meal_date: Optional[date_type] = None
    slot: Optional[str] = None
    recipe_id: int = Field(foreign_key="nutrition_recipe.id")
    servings: float = 2.0


class PantryItem(SQLModel, table=True):
    """Items currently in pantry."""
    __tablename__ = "nutrition_pantry_item"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity: float = 0.0
    unit: Optional[str] = None


class GroceryList(SQLModel, table=True):
    """Generated grocery list."""
    __tablename__ = "nutrition_grocery_list"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="nutrition_meal_plan.id")
    generated_at: Optional[datetime] = None


class GroceryItem(SQLModel, table=True):
    """Items in a grocery list."""
    __tablename__ = "nutrition_grocery_item"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    list_id: int = Field(foreign_key="nutrition_grocery_list.id")
    ingredient_id: int = Field(foreign_key="nutrition_ingredient.id")
    quantity_needed: float = 0.0
    unit: Optional[str] = None
    checked: bool = False
