import os
import json
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional


CALORIE_SURPLUS = 300
MACRO_SPLIT_PROTEIN_PCT = 0.35
MACRO_SPLIT_CARB_PCT = 0.40
MACRO_SPLIT_FAT_PCT = 0.25


def _calculate_bmr() -> int:
    weight_lbs = float(os.getenv("USER_WEIGHT_LBS", "145"))
    height_in = float(os.getenv("USER_HEIGHT_IN", "73"))
    age = int(os.getenv("USER_AGE", "23"))
    
    weight_kg = weight_lbs * 0.453592
    height_cm = height_in * 2.54
    
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    return int(bmr)


def get_calorie_target(calories_burned: int = 0) -> int:
    bmr = _calculate_bmr()
    return bmr + calories_burned + CALORIE_SURPLUS


def get_macro_targets(calorie_target: int) -> dict:
    protein_g = int((calorie_target * MACRO_SPLIT_PROTEIN_PCT) / 4)
    carbs_g = int((calorie_target * MACRO_SPLIT_CARB_PCT) / 4)
    fat_g = int((calorie_target * MACRO_SPLIT_FAT_PCT) / 9)
    
    return {
        "protein_g": protein_g,
        "carbs_g": carbs_g,
        "fat_g": fat_g
    }


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
    recent_recipe_ids: set[int] = None
) -> list[tuple[date, RecipeData]]:
    if recent_recipe_ids is None:
        recent_recipe_ids = set()
    
    plan = []
    recent_days = []
    
    for i in range(7):
        day_date = week_start + timedelta(days=i)
        
        candidates = [r for r in recipes if r.is_batch_cook and r.id not in recent_days[-4:] if r.id not in recent_days]
        
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
    pantry_items: dict[int, float]
) -> dict[str, list[dict]]:
    totals = {}
    
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
                    "unit": ing["unit"]
                }
    
    for ing_id, qty in pantry_items.items():
        if ing_id in totals:
            totals[ing_id]["quantity_needed"] -= qty
            if totals[ing_id]["quantity_needed"] <= 0:
                del totals[ing_id]
    
    return totals
