"""
/nutrition — Meal plan, grocery list, recipe, pantry, and cook event endpoints.
"""
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from core.database import get_session
from models.nutrition import (
    Recipe, RecipeIngredient, MealPlan, PlannedMeal, CookEvent,
    PantryItem, NutritionGroceryList, NutritionGroceryItem, Ingredient,
)
from models.fitness import DailyStats
from schemas.nutrition import (
    CookEventCreate, CookEventRead,
    PlannedMealCreate, PlannedMealMove, PlannedMealRead,
    PantryItemCreate, PantryItemRead,
    RecipeRead, RecipeDetailRead, IngredientRead,
    NutritionTodayRead, MealPlanRead, MealDayRead,
    GroceryListRead, GrocerySectionRead, GroceryItemRead,
)
from services.health_calc import get_calorie_target, get_macro_targets
from services.meal_planner import (
    generate_meal_plan, generate_grocery_list as _generate_grocery_list,
    RecipeData,
)

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


def _get_week_monday(week: str | None = None) -> date:
    if week:
        return date.fromisoformat(week)
    today = date.today()
    return today - timedelta(days=today.weekday())


def _recipe_to_data(r: Recipe) -> RecipeData:
    """Convert a Recipe model to a RecipeData DTO."""
    return RecipeData(
        id=r.id,
        name=r.name,
        calories_per_serving=r.calories_per_serving or 0,
        protein_per_serving=r.protein_per_serving or 0,
        carbs_per_serving=r.carbs_per_serving or 0,
        fat_per_serving=r.fat_per_serving or 0,
        tags=json.loads(r.tags) if r.tags else [],
        is_batch_cook=r.is_batch_cook,
    )


# ---------------------------------------------------------------------------
# Widget endpoints
# ---------------------------------------------------------------------------

@router.get("/widgets/today")
def get_today_nutrition(db: Session = Depends(get_session)):
    """Today's nutrition summary: targets, macros, upcoming meals."""
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

    macros_current = {"protein_g": 0, "carbs_g": 0, "fat_g": 0}
    dinner = None
    lunch = None

    if meal_plan:
        todays_meals = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == today,
            )
        ).all()

        for meal in todays_meals:
            recipe = db.get(Recipe, meal.recipe_id)
            if recipe:
                macros_current["protein_g"] += recipe.protein_per_serving or 0
                macros_current["carbs_g"] += recipe.carbs_per_serving or 0
                macros_current["fat_g"] += recipe.fat_per_serving or 0

        today_dinner = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == today,
                PlannedMeal.slot == "dinner",
            )
        ).first()

        if today_dinner:
            recipe = db.get(Recipe, today_dinner.recipe_id)
            if recipe:
                dinner = PlannedMealRead(
                    id=today_dinner.id,
                    recipe_id=recipe.id,
                    recipe_name=recipe.name,
                    calories_per_serving=recipe.calories_per_serving,
                    protein_per_serving=recipe.protein_per_serving,
                    meal_date=today_dinner.meal_date.isoformat() if today_dinner.meal_date else None,
                    slot=today_dinner.slot,
                    servings=today_dinner.servings,
                    cook_event_id=today_dinner.cook_event_id,
                )

        yesterday = today - timedelta(days=1)
        yesterday_dinner = db.exec(
            select(PlannedMeal).where(
                PlannedMeal.plan_id == meal_plan.id,
                PlannedMeal.meal_date == yesterday,
                PlannedMeal.slot == "dinner",
            )
        ).first()

        if yesterday_dinner:
            recipe = db.get(Recipe, yesterday_dinner.recipe_id)
            if recipe:
                lunch = {"recipe_name": recipe.name, "note": "Leftovers from yesterday"}

    return NutritionTodayRead(
        date=today.isoformat(),
        calories_target=calories_target,
        calories_burned_garmin=calories_burned,
        macros_target=macros,
        macros_current=macros_current,
        dinner=dinner,
        lunch=lunch,
    )


@router.get("/widgets/meal-plan")
def get_meal_plan_widget(week: str | None = None, db: Session = Depends(get_session)):
    """This week's meal plan grid."""
    week_start = _get_week_monday(week)

    meal_plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()

    if not meal_plan:
        return MealPlanRead(week_start_date=week_start.isoformat())

    meals = db.exec(
        select(PlannedMeal).where(PlannedMeal.plan_id == meal_plan.id)
    ).all()

    result: list[MealDayRead] = []
    for i in range(7):
        day = week_start + timedelta(days=i)

        dinner_read = None
        for m in meals:
            if m.meal_date == day and m.slot == "dinner":
                recipe = db.get(Recipe, m.recipe_id)
                if recipe:
                    dinner_read = PlannedMealRead(
                        id=m.id,
                        recipe_id=m.recipe_id,
                        recipe_name=recipe.name,
                        calories_per_serving=recipe.calories_per_serving,
                        protein_per_serving=recipe.protein_per_serving,
                        meal_date=m.meal_date.isoformat() if m.meal_date else None,
                        slot=m.slot,
                        servings=m.servings,
                        cook_event_id=m.cook_event_id,
                    )
                break

        lunch_read = None
        if i > 0:
            prev_day = week_start + timedelta(days=i - 1)
            prev_dinner = next(
                (m for m in meals if m.meal_date == prev_day and m.slot == "dinner"),
                None,
            )
            if prev_dinner:
                recipe = db.get(Recipe, prev_dinner.recipe_id)
                if recipe:
                    lunch_read = PlannedMealRead(
                        id=prev_dinner.id,
                        recipe_id=prev_dinner.recipe_id,
                        recipe_name=recipe.name,
                        meal_date=prev_day.isoformat(),
                        slot="lunch",
                        servings=prev_dinner.servings,
                    )

        result.append(MealDayRead(
            date=day.isoformat(),
            lunch=lunch_read,
            dinner=dinner_read,
        ))

    return MealPlanRead(
        week_start_date=week_start.isoformat(),
        plan_id=meal_plan.id,
        meals=result,
    )


# ---------------------------------------------------------------------------
# Meal plan generation
# ---------------------------------------------------------------------------

@router.post("/meal-plans/generate")
def generate_meal_plan_endpoint(db: Session = Depends(get_session)):
    """Generate (or regenerate) this week's meal plan."""
    week_start = _get_week_monday()

    existing = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()

    if existing:
        meals = db.exec(
            select(PlannedMeal).where(PlannedMeal.plan_id == existing.id)
        ).all()
        for m in meals:
            db.delete(m)
        # Also clean up cook events for this plan
        events = db.exec(
            select(CookEvent).where(CookEvent.plan_id == existing.id)
        ).all()
        for e in events:
            db.delete(e)
        db.commit()
        plan = existing
    else:
        plan = MealPlan(week_start_date=week_start, generated_at=datetime.now())
        db.add(plan)
        db.flush()

    recipes = db.exec(select(Recipe).where(Recipe.is_batch_cook)).all()

    recent_plan = db.exec(
        select(MealPlan).order_by(MealPlan.week_start_date.desc())
    ).all()

    recent_ids: set[int] = set()
    for rp in recent_plan[:2]:
        rms = db.exec(select(PlannedMeal).where(PlannedMeal.plan_id == rp.id)).all()
        for rm in rms:
            recent_ids.add(rm.recipe_id)

    recipe_data = [_recipe_to_data(r) for r in recipes]
    schedule = generate_meal_plan(recipe_data, week_start, recent_ids)

    for day_date, recipe in schedule:
        # Create a cook event for each batch recipe
        cook_event = CookEvent(
            plan_id=plan.id,
            recipe_id=recipe.id,
            cook_date=day_date,
            servings_produced=recipe_data[0].is_batch_cook and 4.0 or 2.0,
        )
        db.add(cook_event)
        db.flush()

        # Dinner uses the cook event
        db.add(PlannedMeal(
            plan_id=plan.id,
            meal_date=day_date,
            slot="dinner",
            recipe_id=recipe.id,
            servings=2.0,
            cook_event_id=cook_event.id,
        ))

    db.commit()
    return {"status": "success", "week_start_date": week_start.isoformat()}


# ---------------------------------------------------------------------------
# Cook event CRUD
# ---------------------------------------------------------------------------

@router.post("/cook-events", status_code=201)
def create_cook_event(body: CookEventCreate, db: Session = Depends(get_session)):
    """Record a cooking event that produces servings."""
    week_start = _get_week_monday()
    plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan found for this week")

    recipe = db.get(Recipe, body.recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    event = CookEvent(
        plan_id=plan.id,
        recipe_id=body.recipe_id,
        cook_date=date.fromisoformat(body.cook_date),
        servings_produced=body.servings_produced,
        notes=body.notes,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return {"status": "success", "cook_event_id": event.id}


@router.get("/cook-events", response_model=list[CookEventRead])
def list_cook_events(db: Session = Depends(get_session)):
    """List cook events for the current week with remaining servings."""
    week_start = _get_week_monday()
    plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()
    if not plan:
        return []

    events = db.exec(
        select(CookEvent).where(CookEvent.plan_id == plan.id)
    ).all()

    result = []
    for ev in events:
        recipe = db.get(Recipe, ev.recipe_id)
        meals = db.exec(
            select(PlannedMeal).where(PlannedMeal.cook_event_id == ev.id)
        ).all()
        consumed = sum(m.servings for m in meals)

        result.append(CookEventRead(
            id=ev.id,
            recipe_id=ev.recipe_id,
            recipe_name=recipe.name if recipe else None,
            cook_date=ev.cook_date.isoformat() if ev.cook_date else None,
            servings_produced=ev.servings_produced,
            servings_consumed=consumed,
            servings_remaining=ev.servings_produced - consumed,
            notes=ev.notes,
        ))

    return result


# ---------------------------------------------------------------------------
# Planned meal CRUD
# ---------------------------------------------------------------------------

@router.post("/planned-meals/{meal_id}/swap")
def swap_meal(meal_id: int, db: Session = Depends(get_session)):
    """Swap a meal for the next best recipe."""
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

    recipes = db.exec(select(Recipe).where(Recipe.is_batch_cook)).all()
    candidates = [_recipe_to_data(r) for r in recipes if r.id not in used_ids]

    if not candidates:
        raise HTTPException(status_code=400, detail="No available recipes to swap")

    candidates.sort(key=lambda r: (r.protein_per_serving, -r.id), reverse=True)
    new_recipe_id = candidates[0].id

    meal.recipe_id = new_recipe_id
    db.add(meal)
    db.commit()
    return {"status": "success", "new_recipe_id": new_recipe_id}


@router.patch("/planned-meals/{meal_id}/override")
def override_meal(meal_id: int, recipe_id: int, db: Session = Depends(get_session)):
    """Replace a meal with a specific recipe."""
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


@router.patch("/planned-meals/{meal_id}/move")
def move_planned_meal(meal_id: int, body: PlannedMealMove, db: Session = Depends(get_session)):
    """Move a planned meal to a different date/slot."""
    meal = db.get(PlannedMeal, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Planned meal not found")

    meal.meal_date = date.fromisoformat(body.meal_date)
    if body.slot:
        meal.slot = body.slot

    db.add(meal)
    db.commit()
    return {"status": "success", "meal_id": meal_id}


@router.delete("/planned-meals/{meal_id}")
def delete_planned_meal(meal_id: int, db: Session = Depends(get_session)):
    """Delete a planned meal."""
    meal = db.get(PlannedMeal, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Planned meal not found")
    db.delete(meal)
    db.commit()
    return {"status": "success"}


@router.post("/meal-plans/{plan_id}/meals")
def add_planned_meal(body: PlannedMealCreate, plan_id: int, db: Session = Depends(get_session)):
    """Add a meal to an existing plan."""
    plan = db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Meal plan not found")

    recipe = db.get(Recipe, body.recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    meal = PlannedMeal(
        plan_id=plan_id,
        recipe_id=body.recipe_id,
        meal_date=date.fromisoformat(body.meal_date),
        slot=body.slot,
        servings=body.servings,
        cook_event_id=body.cook_event_id,
    )
    db.add(meal)
    db.commit()
    return {"status": "success", "meal_id": meal.id}


# ---------------------------------------------------------------------------
# Grocery list
# ---------------------------------------------------------------------------

@router.get("/grocery-list")
def get_grocery_list(plan_id: int | None = None, db: Session = Depends(get_session)):
    """Get the grocery list for the current (or specified) plan."""
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
        select(NutritionGroceryList).where(NutritionGroceryList.plan_id == plan.id)
    ).first()

    if not grocery_list:
        return GroceryListRead(
            plan_id=plan.id,
            week_start_date=plan.week_start_date.isoformat(),
        )

    grocery_items = db.exec(
        select(NutritionGroceryItem).where(NutritionGroceryItem.list_id == grocery_list.id)
    ).all()

    # Batch load only the ingredients we need
    ingredient_ids = {item.ingredient_id for item in grocery_items}
    ingredients = db.exec(
        select(Ingredient).where(Ingredient.id.in_(ingredient_ids))  # type: ignore[attr-defined]
    ).all()
    ingredient_map = {i.id: i for i in ingredients}

    section_order = ["protein", "produce", "dairy", "grains", "frozen", "pantry"]
    sections: dict[str, list[GroceryItemRead]] = {}

    for item in grocery_items:
        ing = ingredient_map.get(item.ingredient_id)
        if not ing:
            continue
        section = ing.store_section or "pantry"
        if section not in sections:
            sections[section] = []
        sections[section].append(GroceryItemRead(
            id=item.id,
            ingredient_id=item.ingredient_id,
            name=ing.name,
            quantity_needed=round(item.quantity_needed, 1),
            unit=item.unit,
            checked=item.checked,
        ))

    return GroceryListRead(
        plan_id=plan.id,
        week_start_date=plan.week_start_date.isoformat(),
        sections=[
            GrocerySectionRead(section=s, items=sections[s])
            for s in section_order if s in sections
        ],
    )


@router.post("/grocery-list/generate")
def generate_grocery_list_endpoint(db: Session = Depends(get_session)):
    """Generate a grocery list from the current meal plan."""
    week_start = _get_week_monday()
    plan = db.exec(
        select(MealPlan).where(MealPlan.week_start_date == week_start)
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan found")

    existing = db.exec(
        select(NutritionGroceryList).where(NutritionGroceryList.plan_id == plan.id)
    ).first()

    if existing:
        items = db.exec(
            select(NutritionGroceryItem).where(NutritionGroceryItem.list_id == existing.id)
        ).all()
        for i in items:
            db.delete(i)
        db.commit()
        grocery_list = existing
    else:
        grocery_list = NutritionGroceryList(plan_id=plan.id, generated_at=datetime.now())
        db.add(grocery_list)
        db.flush()

    meals = db.exec(
        select(PlannedMeal).where(PlannedMeal.plan_id == plan.id)
    ).all()

    recipe_ingredients: dict[int, list[dict]] = {}
    for meal in meals:
        if meal.recipe_id not in recipe_ingredients:
            ingredients = db.exec(
                select(RecipeIngredient).where(RecipeIngredient.recipe_id == meal.recipe_id)
            ).all()
            recipe_ingredients[meal.recipe_id] = [
                {
                    "ingredient_id": i.ingredient_id,
                    "quantity_per_serving": i.quantity_per_serving,
                    "unit": i.unit,
                }
                for i in ingredients
            ]

    pantry = db.exec(select(PantryItem)).all()
    pantry_dict = {p.ingredient_id: p.quantity for p in pantry}

    recipe_data_map: dict[int, RecipeData] = {}
    for meal in meals:
        if meal.recipe_id not in recipe_data_map:
            recipe = db.get(Recipe, meal.recipe_id)
            if recipe:
                recipe_data_map[meal.recipe_id] = _recipe_to_data(recipe)

    schedule = [
        (m.meal_date, recipe_data_map[m.recipe_id])
        for m in meals
        if m.meal_date and m.recipe_id in recipe_data_map
    ]

    grocery_totals = _generate_grocery_list(schedule, recipe_ingredients, pantry_dict)

    for ing_id, data in grocery_totals.items():
        db.add(NutritionGroceryItem(
            list_id=grocery_list.id,
            ingredient_id=ing_id,
            quantity_needed=data["quantity_needed"],
            unit=data["unit"],
            checked=False,
        ))

    db.commit()
    return {"status": "success", "list_id": grocery_list.id}


@router.patch("/grocery-items/{item_id}/check")
def toggle_grocery_item(item_id: int, db: Session = Depends(get_session)):
    """Toggle a grocery item's checked state."""
    item = db.get(NutritionGroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    item.checked = not item.checked
    db.add(item)
    db.commit()
    return {"status": "success", "checked": item.checked}


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------

@router.get("/recipes", response_model=list[RecipeRead])
def list_recipes(db: Session = Depends(get_session)):
    """List all recipes."""
    recipes = db.exec(select(Recipe)).all()
    return [
        RecipeRead(
            id=r.id,
            name=r.name,
            description=r.description,
            calories_per_serving=r.calories_per_serving,
            protein_per_serving=r.protein_per_serving,
            carbs_per_serving=r.carbs_per_serving,
            fat_per_serving=r.fat_per_serving,
            prep_minutes=r.prep_minutes,
            cook_minutes=r.cook_minutes,
            tags=json.loads(r.tags) if r.tags else [],
            is_batch_cook=r.is_batch_cook,
        )
        for r in recipes
    ]


@router.get("/recipes/{recipe_id}", response_model=RecipeDetailRead)
def get_recipe_details(recipe_id: int, db: Session = Depends(get_session)):
    """Get full recipe details with ingredients."""
    recipe = db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    recipe_ings = db.exec(
        select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
    ).all()

    ingredient_ids = {ri.ingredient_id for ri in recipe_ings}
    ingredients = db.exec(
        select(Ingredient).where(Ingredient.id.in_(ingredient_ids))  # type: ignore[attr-defined]
    ).all()
    ingredient_map = {i.id: i for i in ingredients}

    ing_list = []
    for ri in recipe_ings:
        ing = ingredient_map.get(ri.ingredient_id)
        if ing:
            ing_list.append(IngredientRead(
                id=ing.id,
                name=ing.name,
                quantity_per_serving=ri.quantity_per_serving,
                unit=ri.unit,
                store_section=ing.store_section,
            ))

    return RecipeDetailRead(
        id=recipe.id,
        name=recipe.name,
        description=recipe.description,
        base_servings=recipe.base_servings,
        calories_per_serving=recipe.calories_per_serving,
        protein_per_serving=recipe.protein_per_serving,
        carbs_per_serving=recipe.carbs_per_serving,
        fat_per_serving=recipe.fat_per_serving,
        prep_minutes=recipe.prep_minutes,
        cook_minutes=recipe.cook_minutes,
        tags=json.loads(recipe.tags) if recipe.tags else [],
        is_batch_cook=recipe.is_batch_cook,
        ingredients=ing_list,
    )


# ---------------------------------------------------------------------------
# Pantry
# ---------------------------------------------------------------------------

@router.get("/pantry", response_model=list[PantryItemRead])
def get_pantry(db: Session = Depends(get_session)):
    """List pantry items."""
    items = db.exec(select(PantryItem)).all()
    ingredient_ids = {p.ingredient_id for p in items}
    ingredients = db.exec(
        select(Ingredient).where(Ingredient.id.in_(ingredient_ids))  # type: ignore[attr-defined]
    ).all() if ingredient_ids else []
    ingredient_map = {i.id: i for i in ingredients}

    return [
        PantryItemRead(
            id=p.id,
            ingredient_id=p.ingredient_id,
            ingredient_name=ingredient_map[p.ingredient_id].name if p.ingredient_id in ingredient_map else "Unknown",
            quantity=p.quantity,
            unit=p.unit,
        )
        for p in items
    ]


@router.post("/pantry")
def add_pantry_item(body: PantryItemCreate, db: Session = Depends(get_session)):
    """Add or update a pantry item."""
    existing = db.exec(
        select(PantryItem).where(PantryItem.ingredient_id == body.ingredient_id)
    ).first()

    if existing:
        existing.quantity = body.quantity
        existing.unit = body.unit
        db.add(existing)
    else:
        db.add(PantryItem(
            ingredient_id=body.ingredient_id,
            quantity=body.quantity,
            unit=body.unit,
        ))

    db.commit()
    return {"status": "success"}


@router.delete("/pantry/{item_id}")
def delete_pantry_item(item_id: int, db: Session = Depends(get_session)):
    """Delete a pantry item."""
    item = db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pantry item not found")
    db.delete(item)
    db.commit()
    return {"status": "success"}
