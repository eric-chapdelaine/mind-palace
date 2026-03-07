"""Meal planning algorithm and grocery list generation.

Uses shared health calculations from services.health_calc.
"""
from datetime import date, timedelta
from dataclasses import dataclass, field

from services.health_calc import get_calorie_target, get_macro_targets, get_workout_calorie_estimate  # noqa: F401 (re-export)


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


@dataclass
class DayPlan:
    """Output of the meal planner for a single day."""
    day_date: date
    dinner_recipe: RecipeData
    workout_session_type: str | None = None  # non-None means a workout day
    # breakfast recipe is set on workout days to cover the extra calorie burn
    breakfast_recipe: RecipeData | None = None


def generate_meal_plan(
    recipes: list[RecipeData],
    week_start: date,
    recent_recipe_ids: set[int] | None = None,
    workout_schedule: dict | None = None,
) -> list[DayPlan]:
    """Deterministic meal plan generation.

    Picks one batch-cook recipe per dinner slot per day.  On workout days
    (identified via workout_schedule) also picks a breakfast recipe to cover
    the additional calorie burn.

    Args:
        recipes: All available recipes.
        week_start: Monday of the target week.
        recent_recipe_ids: Recipe IDs used in recent past weeks (for variety).
        workout_schedule: Mapping of date → session_type for the week.
            If None or a date is absent, the day is treated as rest.

    Returns:
        List of DayPlan, one per day of the week.
    """
    if recent_recipe_ids is None:
        recent_recipe_ids = set()
    if workout_schedule is None:
        workout_schedule = {}

    # Separate batch-cook (dinner/lunch rotation) from breakfast-suitable recipes.
    # Breakfast candidates: non-batch-cook OR tagged "breakfast".
    # Fall back to any recipe if none are tagged.
    breakfast_candidates_base = [
        r for r in recipes
        if (not r.is_batch_cook) or ("breakfast" in r.tags)
    ]
    if not breakfast_candidates_base:
        breakfast_candidates_base = recipes[:]

    batch_recipes = [r for r in recipes if r.is_batch_cook]

    plan: list[DayPlan] = []
    recent_dinner_ids: list[int] = []
    recent_breakfast_ids: list[int] = []

    for i in range(7):
        day_date = week_start + timedelta(days=i)
        session_type = workout_schedule.get(day_date)
        is_workout_day = bool(session_type and session_type != "rest")

        # ── Dinner recipe ──────────────────────────────────────────
        candidates = [r for r in batch_recipes if r.id not in recent_dinner_ids]
        if not candidates:
            candidates = [r for r in batch_recipes if r.id not in recent_dinner_ids[-4:]]
        if not candidates:
            candidates = batch_recipes[:]

        scored = []
        for recipe in candidates:
            score = 0
            if recipe.protein_per_serving > 38:
                score += 10
            if "cheap" in recipe.tags:
                score += 5
            if recipe.id in recent_recipe_ids:
                score -= 5
            # On workout days, prefer higher-calorie dinners
            if is_workout_day and recipe.calories_per_serving > 450:
                score += 3
            scored.append((score, recipe.id, recipe))

        scored.sort(key=lambda x: (x[0], -x[1]), reverse=True)
        dinner = scored[0][2] if scored else None

        if dinner:
            recent_dinner_ids.append(dinner.id)

        # ── Breakfast recipe (workout days only) ───────────────────
        breakfast = None
        if is_workout_day and dinner:
            b_candidates = [
                r for r in breakfast_candidates_base
                if r.id != dinner.id and r.id not in recent_breakfast_ids
            ]
            if not b_candidates:
                b_candidates = [r for r in breakfast_candidates_base if r.id != dinner.id]
            if not b_candidates:
                b_candidates = breakfast_candidates_base[:]

            b_scored = []
            for recipe in b_candidates:
                score = 0
                if recipe.protein_per_serving > 30:
                    score += 10
                if recipe.id in recent_recipe_ids:
                    score -= 3
                b_scored.append((score, recipe.id, recipe))
            b_scored.sort(key=lambda x: (x[0], -x[1]), reverse=True)
            breakfast = b_scored[0][2] if b_scored else None
            if breakfast:
                recent_breakfast_ids.append(breakfast.id)

        if dinner:
            plan.append(DayPlan(
                day_date=day_date,
                dinner_recipe=dinner,
                workout_session_type=session_type if is_workout_day else None,
                breakfast_recipe=breakfast,
            ))

    return plan


def generate_grocery_list(
    plan: list,
    recipe_ingredients: dict,
    pantry_items: dict,
) -> dict:
    """Aggregate ingredients from a meal plan, subtracting pantry stock.

    Args:
        plan: List of DayPlan objects from generate_meal_plan.
        recipe_ingredients: Mapping of recipe_id → list of ingredient dicts.
        pantry_items: Mapping of ingredient_id → quantity on hand.

    Returns:
        Dict of ingredient_id → {ingredient_id, quantity_needed, unit}.
    """
    totals: dict = {}

    def _add_recipe(recipe_id: int, servings: float) -> None:
        ingredients = recipe_ingredients.get(recipe_id, [])
        for ing in ingredients:
            ing_id = ing["ingredient_id"]
            qty = ing["quantity_per_serving"] * servings
            if ing_id in totals:
                totals[ing_id]["quantity_needed"] += qty
            else:
                totals[ing_id] = {
                    "ingredient_id": ing_id,
                    "quantity_needed": qty,
                    "unit": ing["unit"],
                }

    for day in plan:
        # dinner + next-day lunch = 2 servings each = 4 total per batch
        _add_recipe(day.dinner_recipe.id, 4.0)
        if day.breakfast_recipe:
            _add_recipe(day.breakfast_recipe.id, 2.0)

    for ing_id, qty in pantry_items.items():
        if ing_id in totals:
            totals[ing_id]["quantity_needed"] -= qty
            if totals[ing_id]["quantity_needed"] <= 0:
                del totals[ing_id]

    return totals
