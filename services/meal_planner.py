"""Meal planning algorithm and grocery list generation.

Uses shared health calculations from services.health_calc.
"""
from datetime import date, timedelta
from dataclasses import dataclass

from services.health_calc import get_calorie_target, get_macro_targets  # noqa: F401 (re-export)


@dataclass
class RecipeData:
    id: int
    name: str
    calories_per_serving: float
    protein_per_serving: float
    carbs_per_serving: float
    fat_per_serving: float
    tags: list[str]
    is_batch_cook: bool


def generate_meal_plan(
    recipes: list[RecipeData],
    week_start: date,
    recent_recipe_ids: set[int] | None = None,
) -> list[tuple[date, RecipeData]]:
    """Deterministic meal plan generation.

    Picks one batch-cook recipe per day, prioritising:
    - High protein
    - Cheap tag
    - Variety (avoids recently used recipes)
    """
    if recent_recipe_ids is None:
        recent_recipe_ids = set()

    plan: list[tuple[date, RecipeData]] = []
    recent_days: list[int] = []

    for i in range(7):
        day_date = week_start + timedelta(days=i)

        candidates = [r for r in recipes if r.is_batch_cook and r.id not in recent_days]
        if not candidates:
            candidates = [r for r in recipes if r.is_batch_cook and r.id not in recent_days[-4:]]
        if not candidates:
            candidates = [r for r in recipes if r.is_batch_cook]

        scored = []
        for recipe in candidates:
            score = 0
            if recipe.protein_per_serving > 38:
                score += 10
            if "cheap" in recipe.tags:
                score += 5
            if len(recent_days) > 0 and recipe.id in recent_days[-1:]:
                score += 3
            if recipe.id in recent_recipe_ids:
                score -= 5
            scored.append((score, recipe.id, recipe))

        scored.sort(key=lambda x: (x[0], -x[1]), reverse=True)

        if scored:
            chosen = scored[0][2]
            plan.append((day_date, chosen))
            recent_days.append(chosen.id)

    return plan


def generate_grocery_list(
    plan: list[tuple[date, RecipeData]],
    recipe_ingredients: dict[int, list[dict]],
    pantry_items: dict[int, float],
) -> dict[int, dict]:
    """Aggregate ingredients from a meal plan, subtracting pantry stock."""
    totals: dict[int, dict] = {}

    for _, recipe in plan:
        ingredients = recipe_ingredients.get(recipe.id, [])
        for ing in ingredients:
            ing_id = ing["ingredient_id"]
            qty = ing["quantity_per_serving"] * 2

            if ing_id in totals:
                totals[ing_id]["quantity_needed"] += qty
            else:
                totals[ing_id] = {
                    "ingredient_id": ing_id,
                    "quantity_needed": qty,
                    "unit": ing["unit"],
                }

    for ing_id, qty in pantry_items.items():
        if ing_id in totals:
            totals[ing_id]["quantity_needed"] -= qty
            if totals[ing_id]["quantity_needed"] <= 0:
                del totals[ing_id]

    return totals
