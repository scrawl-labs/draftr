from fastapi import APIRouter
router = APIRouter(prefix="/items")

@router.get("/")
def list_items(): ...

@router.get("/{item_id}")
def get_item(item_id: int): ...

@router.post("/")
def create_item(): ...
