from fastapi import FastAPI
from flask import Blueprint
from .routers import items
app = FastAPI()
app.include_router(items.router, prefix="/v1")

@app.get("/health")
def health(): ...

bp = Blueprint("admin", __name__, url_prefix="/admin")

@bp.route("/stats", methods=["GET", "POST"])
def stats(): ...

@bp.route("/users/<int:user_id>")
def admin_user(user_id): ...
