"""Database engine, session management, seed data, and migrations."""
import json
import os
import sqlite3
from datetime import datetime

from sqlmodel import SQLModel, create_engine, Session, select

from core.config import settings

engine = create_engine(settings.DATABASE_URL, echo=False)


# ---------------------------------------------------------------------------
# Lightweight migrations
# ---------------------------------------------------------------------------
# Each entry is (id, description, sql).  Migrations are applied in order and
# tracked in a ``schema_migrations`` table so they only run once.  To add a
# new migration, append a tuple to the end of this list — never reorder or
# delete existing entries.
MIGRATIONS: list[tuple[int, str, str]] = [
    (
        1,
        "Add priority column to todoitem",
        "ALTER TABLE todoitem ADD COLUMN priority INTEGER DEFAULT 3",
    ),
    (
        2,
        "Add cook_event_id column to nutrition_planned_meal",
        "ALTER TABLE nutrition_planned_meal ADD COLUMN cook_event_id INTEGER "
        "REFERENCES nutrition_cook_event(id)",
    ),
]


def _run_migrations():
    """Apply any pending migrations against the SQLite database."""
    # Work with raw sqlite3 so we don't need SQLModel tables registered yet.
    db_url = settings.DATABASE_URL
    # Strip the ``sqlite:///`` prefix to get the file path.
    db_path = db_url.replace("sqlite:///", "", 1)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Ensure the tracking table exists.
    cur.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  id INTEGER PRIMARY KEY,"
        "  description TEXT NOT NULL,"
        "  applied_at TEXT NOT NULL"
        ")"
    )
    conn.commit()

    applied: set[int] = {
        row[0] for row in cur.execute("SELECT id FROM schema_migrations").fetchall()
    }

    for mid, desc, sql in MIGRATIONS:
        if mid in applied:
            continue
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (id, description, applied_at) "
                "VALUES (?, ?, ?)",
                (mid, desc, datetime.utcnow().isoformat()),
            )
            conn.commit()
            print(f"  Migration {mid} applied: {desc}")
        except sqlite3.OperationalError as exc:
            # E.g. "duplicate column name" if the column already exists but
            # wasn't tracked — mark it as applied and move on.
            if "duplicate column" in str(exc).lower():
                cur.execute(
                    "INSERT INTO schema_migrations (id, description, applied_at) "
                    "VALUES (?, ?, ?)",
                    (mid, desc, datetime.utcnow().isoformat()),
                )
                conn.commit()
                print(f"  Migration {mid} skipped (already applied): {desc}")
            else:
                conn.rollback()
                print(f"  Migration {mid} FAILED: {exc}")
                raise

    conn.close()


def init_db():
    """Create all tables, run migrations, and seed if empty."""
    # Import all models so SQLModel registers them
    import models.items  # noqa: F401
    import models.fitness  # noqa: F401
    import models.nutrition  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _run_migrations()
    seed_if_empty()


def seed_if_empty():
    from models.fitness import Exercise

    with Session(engine) as session:
        existing = session.exec(select(Exercise)).first()
        if existing:
            return

        seed_exercises(session)
        seed_ingredients(session)
        seed_recipes(session)
        session.commit()


def seed_exercises(session: Session):
    from models.fitness import Exercise, WorkoutTemplate, TemplateExercise, ExerciseState

    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "program_templates.json")
    with open(data_path) as f:
        data = json.load(f)

    exercise_map = {}
    for template_data in data["templates"]:
        for ex in template_data["exercises"]:
            if ex["name"] not in exercise_map:
                exercise = Exercise(
                    name=ex["name"],
                    garmin_enum=ex.get("garmin_enum"),
                    category=ex.get("category"),
                    equipment=ex.get("equipment"),
                    increment_lbs=ex.get("increment"),
                )
                session.add(exercise)
                session.flush()
                exercise_map[ex["name"]] = exercise.id

                session.add(ExerciseState(
                    exercise_id=exercise.id,
                    current_weight_lbs=ex.get("start_weight_lbs", 0),
                ))

    for template_data in data["templates"]:
        template = WorkoutTemplate(
            name=template_data["name"],
            session_type=template_data.get("session_type"),
            sort_order=template_data.get("sort_order", 0),
        )
        session.add(template)
        session.flush()

        for i, ex in enumerate(template_data["exercises"]):
            te = TemplateExercise(
                template_id=template.id,
                exercise_id=exercise_map[ex["name"]],
                prescribed_sets=ex.get("sets", 3),
                prescribed_reps=ex.get("reps", 8),
                sort_order=i,
            )
            session.add(te)


def seed_ingredients(session: Session):
    from models.nutrition import Ingredient

    ingredient_names: set[str] = set()
    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "recipes.json")
    with open(data_path) as f:
        data = json.load(f)

    for recipe in data["recipes"]:
        for ing in recipe.get("ingredients", []):
            if ing["name"] not in ingredient_names:
                ingredient_names.add(ing["name"])
                session.add(Ingredient(
                    name=ing["name"],
                    store_section=ing.get("store_section"),
                ))


def seed_recipes(session: Session):
    from models.nutrition import Recipe, RecipeIngredient, Ingredient

    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "recipes.json")
    with open(data_path) as f:
        data = json.load(f)

    ingredient_map = {i.name: i.id for i in session.exec(select(Ingredient)).all()}

    for recipe_data in data["recipes"]:
        recipe = Recipe(
            name=recipe_data["name"],
            description=recipe_data.get("description"),
            base_servings=recipe_data.get("base_servings", 4),
            calories_per_serving=recipe_data.get("calories_per_serving"),
            protein_per_serving=recipe_data.get("protein_per_serving"),
            carbs_per_serving=recipe_data.get("carbs_per_serving"),
            fat_per_serving=recipe_data.get("fat_per_serving"),
            prep_minutes=recipe_data.get("prep_minutes"),
            cook_minutes=recipe_data.get("cook_minutes"),
            tags=json.dumps(recipe_data.get("tags", [])),
            is_batch_cook=recipe_data.get("is_batch_cook", True),
        )
        session.add(recipe)
        session.flush()

        for ing in recipe_data.get("ingredients", []):
            ing_id = ingredient_map.get(ing["name"])
            if ing_id:
                session.add(RecipeIngredient(
                    recipe_id=recipe.id,
                    ingredient_id=ing_id,
                    quantity_per_serving=ing.get("quantity_per_serving", 0),
                    unit=ing.get("unit"),
                ))


def get_session():
    with Session(engine) as session:
        yield session
