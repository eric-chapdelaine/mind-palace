"""
/nutrition — Meal plan, grocery list, pantry endpoints.
"""
import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from core.database import get_session
from models.nutrition import (
    Recipe, RecipeIngredient, MealPlan, PlannedMeal,
    PantryItem, GroceryList, GroceryItem, Ingredient
)
from models.fitness import DailyStats
from services.meal_planner import (
    get_calorie_target, get_macro_targets, generate_meal_plan,
    generate_grocery_list as _generate_grocery_list, RecipeData
)

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


def _get_week_monday(week: Optional[str] = None) -> date:
    if week:
        return date.fromisoformat(week)
    today = date.today()
    return today - timedelta(days=today.weekday())


@router.get("/widgets/today")
def get_today_nutrition(db: Session = Depends(get_session)):
    today = date.today()
    week_start = _get_week_monday()
    
    stats = db.exec(
        select(DailyStats).where(DailyStats.stat_date == today)
    ).first()
    
    calories_burned = stats.calories_burned_garmin if stats else 0
    calories_target = stats.calories_target if stats else get_calorie_target(calories_burned)
    
    macros = get_macro_targets(calories_target)
    
    meal_plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    
    macros_target = macros
    
    macros_current = {"protein_g": 0, "carbs_g": 0, "fat_g": 0}
    
    if meal_plan:
        todays_meals = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == today
            )
        ).all()
        
        for meal in todays_meals:
            recipe = db.get(Recipe, meal.recipe_id)
            if recipe:
                macros_current["protein_g"] += recipe.protein_per_serving or 0
                macros_current["carbs_g"] += recipe.carbs_per_serving or 0
                macros_current["fat_g"] += recipe.fat_per_serving or 0
    
    dinner = None
    lunch = None
    
    if meal_plan:
        today_dinner = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == today,
                PlannedMeal.slot == "dinner"
            )
        ).first()
        
        if today_dinner:
            recipe = db.get(Recipe, today_dinner.recipe_id)
            if recipe:
                dinner = {
                    "meal_id": today_dinner.id,
                    "recipe_id": recipe.id,
                    "recipe_name": recipe.name,
                    "calories_per_serving": recipe.calories_per_serving,
                    "protein_per_serving": recipe.protein_per_serving
                }
        
        yesterday = today - timedelta(days=1)
        yesterday_dinner = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == yesterday,
                PlannedMeal.slot == "dinner"
            )
        ).first()
        
        if yesterday_dinner:
            recipe = db.get(Recipe, yesterday_dinner.recipe_id)
            if recipe:
                lunch = {
                    "recipe_name": recipe.name,
                    "note": "Leftovers from yesterday"
                }
    
    return {
        "date": today.isoformat(),
        "calories_target": calories_target,
        "calories_burned_garmin": calories_burned,
        "macros_target": macros_target,
        "macros_current": macros_current,
        "dinner": dinner,
        "lunch": lunch
    }


@router.get("/widgets/meal-plan")
def get_meal_plan_widget(week: Optional[str] = None, db: Session = Depends(get_session)):
    week_start = _get_week_monday(week)
    
    meal_plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    
    if not meal_plan:
        return {"week_start_date": week_start.isoformat(), "meals": []}
    
    meals = db.exec(
        select(PlannedMeal).where(PlannedMeal.plan_id == meal_plan.id)
    ).all()
    
    result = []
    for i in range(7):
        day = week_start + timedelta(days=i)
        
        dinner = None
        for m in meals:
            if m.meal_date == day and m.slot == "dinner":
                recipe = db.get(Recipe, m.recipe_id)
                if recipe:
                    dinner = {
                        "id": m.id,
                        "recipe_id": m.recipe_id,
                        "recipe_name": recipe.name,
                        "calories_per_serving": recipe.calories_per_serving,
                        "protein_per_serving": recipe.protein_per_serving
                    }
                break
        
        lunch = None
        if i > 0:
            prev_day = week_start + timedelta(days=i - 1)
            prev_dinner = None
            for m in meals:
                if m.meal_date == prev_day and m.slot == "dinner":
                    prev_dinner = m
                    break
            
            if prev_dinner:
                recipe = db.get(Recipe, prev_dinner.recipe_id)
                if recipe:
                    lunch = {
                        "recipe_name": recipe.name,
                        "note": "Leftovers"
                    }
        
        result.append({
            "date": day.isoformat(),
            "lunch": lunch,
            "dinner": dinner
        })
    
    return {
        "week_start_date": week_start.isoformat(),
        "plan_id": meal_plan.id,
        "meals": result
    }


@router.post("/meal-plans/generate")
def generate_meal_plan_endpoint(db: Session = Depends(get_session)):
    week_start = _get_week_monday()
    
    existing = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    
    if existing:
        db.exec(select(PlannedMeal).where(PlannedMeal.plan_id == existing.id))
        meals = db.exec(
            select(PlannedMeal).where(PlannedMeal.plan_id == existing.id)
        ).all()
        for m in meals:
            db.delete(m)
        db.commit()
        plan = existing
    else:
        plan = MealPlan(
            week_start_date=week_start,
            generated_at=datetime.now()
        )
        db.add(plan)
        db.flush()
    
    recipes = db.exec(
        select(Recipe).where(Recipe.is_batch_cook)
    ).all()
    
    recent_plan = db.exec(
        select(MealPlan).order_by(MealPlan.week_start_date.desc())
    ).all()
    
    recent_ids = set()
    for rp in recent_plan[:2]:
        rms = db.exec(select(PlannedMeal).where(PlannedMeal.plan_id == rp.id)).all()
        for rm in rms:
            recent_ids.add(rm.recipe_id)
    
    recipe_data = [
        RecipeData(
            id=r.id,
            name=r.name,
            calories_per_serving=r.calories_per_serving or 0,
            protein_per_serving=r.protein_per_serving or 0,
            carbs_per_serving=r.carbs_per_serving or 0,
            fat_per_serving=r.fat_per_serving or 0,
            tags=json.loads(r.tags) if r.tags else [],
            is_batch_cook=r.is_batch_cook
        )
        for r in recipes
    ]
    
    schedule = generate_meal_plan(recipe_data, week_start, recent_ids)
    
    for day_date, recipe in schedule:
        db.add(PlannedMeal(
            plan_id=plan.id,
            meal_date=day_date,
            slot="dinner",
            recipe_id=recipe.id,
            servings=2.0
        ))
    
    db.commit()
    
    return {"status": "success", "week_start_date": week_start.isoformat()}


@router.post("/planned-meals/{meal_id}/swap")
def swap_meal(meal_id: int, db: Session = Depends(get_session)):
    meal = db.get(PlannedMeal, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    
    plan = db.get(MealPlan, meal.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")
    
    all_meals = db.exec(
        select(PlannedMeal).where(PlannedMeal.plan_id == plan.id)
    ).all()
    
    used_ids = {m.recipe_id for m in all_meals if m.id != meal_id}
    
    recipes = db.exec(
        select(Recipe).where(Recipe.is_batch_cook)
    ).all()
    
    recipe_data = [
        RecipeData(
            id=r.id,
            name=r.name,
            calories_per_serving=r.calories_per_serving or 0,
            protein_per_serving=r.protein_per_serving or 0,
            carbs_per_serving=r.carbs_per_serving or 0,
            fat_per_serving=r.fat_per_serving or 0,
            tags=json.loads(r.tags) if r.tags else [],
            is_batch_cook=r.is_batch_cook
        )
        for r in recipes if r.id not in used_ids
    ]
    
    if not recipe_data:
        raise HTTPException(status_code=400, detail="No available recipes to swap")
    
    candidates = [
        (r.id, r.protein_per_serving, r.name)
        for r in recipe_data
    ]
    candidates.sort(key=lambda x: (x[1], -x[0]), reverse=True)
    
    new_recipe_id = candidates[0][0]
    meal.recipe_id = new_recipe_id
    
    db.add(meal)
    db.commit()
    
    return {"status": "success", "new_recipe_id": new_recipe_id}


@router.get("/grocery-list")
def get_grocery_list(plan_id: Optional[int] = None, db: Session = Depends(get_session)):
    if not plan_id:
        week_start = _get_week_monday()
        plan = db.exec(
            select(MealPlan).where(MealPlan.week_start_date == week_start)
        ).first()
    else:
        plan = db.get(MealPlan, plan_id)
    
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan found")
    
    grocery_list = db.exec(
        select(GroceryList).where(GroceryList.plan_id == plan.id)
    ).first()
    
    if not grocery_list:
        return {
            "plan_id": plan.id,
            "week_start_date": plan.week_start_date.isoformat(),
            "sections": []
        }
    
    grocery_items = db.exec(
        select(GroceryItem).where(GroceryItem.list_id == grocery_list.id)
    ).all()
    
    ingredient_map = {i.id: i for i in db.exec(select(Ingredient)).all()}
    
    sections = {}
    section_order = ["protein", "produce", "dairy", "grains", "frozen", "pantry"]
    
    for item in grocery_items:
        ing = ingredient_map.get(item.ingredient_id)
        if not ing:
            continue
        
        section = ing.store_section or "pantry"
        if section not in sections:
            sections[section] = []
        
        sections[section].append({
            "id": item.id,
            "ingredient_id": item.ingredient_id,
            "name": ing.name,
            "quantity_needed": round(item.quantity_needed, 1),
            "unit": item.unit,
            "checked": item.checked
        })
    
    result = []
    for section in section_order:
        if section in sections:
            result.append({
                "section": section,
                "items": sections[section]
            })
    
    return {
        "plan_id": plan.id,
        "week_start_date": plan.week_start_date.isoformat(),
        "sections": result
    }


@router.post("/grocery-list/generate")
def generate_grocery_list(db: Session = Depends(get_session)):
    week_start = _get_week_monday()
    plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan found")
    
    existing = db.exec(
        select(GroceryList).where(GroceryList.plan_id == plan.id)
    ).first()
    
    if existing:
        items = db.exec(
            select(GroceryItem).where(GroceryItem.list_id == existing.id)
        ).all()
        for i in items:
            db.delete(i)
        db.commit()
        grocery_list = existing
    else:
        grocery_list = GroceryList(
            plan_id=plan.id,
            generated_at=datetime.now()
        )
        db.add(grocery_list)
        db.flush()
    
    meals = db.exec(
        select(PlannedMeal).where(PlannedMeal.plan_id == plan.id)
    ).all()
    
    recipe_ingredients = {}
    for meal in meals:
        ingredients = db.exec(
            select(RecipeIngredient).where(RecipeIngredient.recipe_id == meal.recipe_id)
        ).all()
        
        recipe_ingredients[meal.recipe_id] = [
            {
                "ingredient_id": i.ingredient_id,
                "quantity_per_serving": i.quantity_per_serving,
                "unit": i.unit
            }
            for i in ingredients
        ]
    
    pantry = db.exec(select(PantryItem)).all()
    pantry_dict = {p.ingredient_id: p.quantity for p in pantry}
    
    recipe_data = {}
    for meal in meals:
        recipe = db.get(Recipe, meal.recipe_id)
        if recipe:
            recipe_data[meal.recipe_id] = RecipeData(
                id=recipe.id,
                name=recipe.name,
                calories_per_serving=recipe.calories_per_serving or 0,
                protein_per_serving=recipe.protein_per_serving or 0,
                carbs_per_serving=recipe.carbs_per_serving or 0,
                fat_per_serving=recipe.fat_per_serving or 0,
                tags=json.loads(recipe.tags) if recipe.tags else [],
                is_batch_cook=recipe.is_batch_cook
            )
    
    schedule = [(m.meal_date, recipe_data.get(m.recipe_id)) for m in meals if m.meal_date]
    
    grocery_totals = _generate_grocery_list(schedule, recipe_ingredients, pantry_dict)
    
    for ing_id, data in grocery_totals.items():
        db.add(GroceryItem(
            list_id=grocery_list.id,
            ingredient_id=ing_id,
            quantity_needed=data["quantity_needed"],
            unit=data["unit"],
            checked=False
        ))
    
    db.commit()
    
    return {"status": "success", "list_id": grocery_list.id}


@router.patch("/grocery-items/{item_id}/check")
def toggle_grocery_item(item_id: int, db: Session = Depends(get_session)):
    item = db.get(GroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    
    item.checked = not item.checked
    db.add(item)
    db.commit()
    
    return {"status": "success", "checked": item.checked}


@router.get("/recipes")
def list_recipes(db: Session = Depends(get_session)):
    recipes = db.exec(select(Recipe)).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "calories_per_serving": r.calories_per_serving,
            "protein_per_serving": r.protein_per_serving,
            "carbs_per_serving": r.carbs_per_serving,
            "fat_per_serving": r.fat_per_serving,
            "prep_minutes": r.prep_minutes,
            "cook_minutes": r.cook_minutes,
            "tags": json.loads(r.tags) if r.tags else [],
            "is_batch_cook": r.is_batch_cook
        }
        for r in recipes
    ]


@router.get("/recipes/{recipe_id}")
def get_recipe_details(recipe_id: int, db: Session = Depends(get_session)):
    recipe = db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    recipe_ingredients = db.exec(
        select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
    ).all()
    
    ingredient_map = {i.id: i for i in db.exec(select(Ingredient)).all()}
    
    ingredients = []
    for ri in recipe_ingredients:
        ing = ingredient_map.get(ri.ingredient_id)
        if ing:
            ingredients.append({
                "id": ing.id,
                "name": ing.name,
                "quantity_per_serving": ri.quantity_per_serving,
                "unit": ri.unit,
                "store_section": ing.store_section
            })
    
    return {
        "id": recipe.id,
        "name": recipe.name,
        "description": recipe.description,
        "base_servings": recipe.base_servings,
        "calories_per_serving": recipe.calories_per_serving,
        "protein_per_serving": recipe.protein_per_serving,
        "carbs_per_serving": recipe.carbs_per_serving,
        "fat_per_serving": recipe.fat_per_serving,
        "prep_minutes": recipe.prep_minutes,
        "cook_minutes": recipe.cook_minutes,
        "tags": json.loads(recipe.tags) if recipe.tags else [],
        "is_batch_cook": recipe.is_batch_cook,
        "ingredients": ingredients
    }


@router.patch("/planned-meals/{meal_id}/override")
def override_meal(meal_id: int, recipe_id: int, db: Session = Depends(get_session)):
    meal = db.get(PlannedMeal, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Planned meal not found")
    
    recipe = db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    meal.recipe_id = recipe_id
    db.add(meal)
    db.commit()
    
    return {"status": "success", "new_recipe_id": recipe_id, "new_recipe_name": recipe.name}


@router.delete("/planned-meals/{meal_id}")
def delete_planned_meal(meal_id: int, db: Session = Depends(get_session)):
    meal = db.get(PlannedMeal, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Planned meal not found")
    
    db.delete(meal)
    db.commit()
    
    return {"status": "success"}


@router.post("/meal-plans/{plan_id}/meals")
def add_planned_meal(
    plan_id: int,
    recipe_id: int,
    meal_date: str,
    slot: str = "dinner",
    servings: float = 2.0,
    db: Session = Depends(get_session)
):
    plan = db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")
    
    recipe = db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    meal = PlannedMeal(
        plan_id=plan_id,
        recipe_id=recipe_id,
        meal_date=date.fromisoformat(meal_date),
        slot=slot,
        servings=servings
    )
    db.add(meal)
    db.commit()
    
    return {"status": "success", "meal_id": meal.id}


@router.get("/pantry")
def get_pantry(db: Session = Depends(get_session)):
    items = db.exec(select(PantryItem)).all()
    
    ingredient_map = {i.id: i for i in db.exec(select(Ingredient)).all()}
    
    return [
        {
            "id": p.id,
            "ingredient_id": p.ingredient_id,
            "ingredient_name": ingredient_map.get(p.ingredient_id, {}).name if ingredient_map.get(p.ingredient_id) else "Unknown",
            "quantity": p.quantity,
            "unit": p.unit
        }
        for p in items
    ]


@router.post("/pantry")
def add_pantry_item(
    ingredient_id: int,
    quantity: float,
    unit: str,
    db: Session = Depends(get_session)
):
    existing = db.exec(
        select(PantryItem).where(PantryItem.ingredient_id == ingredient_id)
    ).first()
    
    if existing:
        existing.quantity = quantity
        existing.unit = unit
        db.add(existing)
    else:
        db.add(PantryItem(
            ingredient_id=ingredient_id,
            quantity=quantity,
            unit=unit
        ))
    
    db.commit()
    
    return {"status": "success"}


@router.delete("/pantry/{item_id}")
def delete_pantry_item(item_id: int, db: Session = Depends(get_session)):
    item = db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pantry item not found")
    
    db.delete(item)
    db.commit()
    
    return {"status": "success"}


@router.post("/fitness/daily-stats/weight")
def log_weight(weight_lbs: float, db: Session = Depends(get_session)):
    today = date.today()
    
    stats = db.exec(
        select(DailyStats).where(DailyStats.stat_date == today)
    ).first()
    
    if stats:
        stats.weight_lbs = weight_lbs
    else:
        stats = DailyStats(
            date=today,
            weight_lbs=weight_lbs,
            calories_burned_garmin=0,
            calories_target=get_calorie_target(0)
        )
        db.add(stats)
    
    db.commit()
    
    return {"status": "success", "weight_lbs": weight_lbs}
