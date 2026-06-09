from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import services
from .config import INDEX_PATH
from .database import init_db
from .schemas import CoupleCreate, TaskCreate, TaskUpdate, UserCreate


def create_app() -> FastAPI:
    app = FastAPI(title="Sync-Us", version="0.3.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def startup() -> None:
        init_db()

    @app.get("/")
    def read_index():
        return FileResponse(INDEX_PATH)

    @app.get("/api/v1/health")
    def health():
        return services.health()

    @app.post("/api/v1/users")
    def create_user(user: UserCreate):
        return call_service(lambda: services.create_user(model_to_dict(user)))

    @app.get("/api/v1/users")
    def list_users():
        return services.list_users()

    @app.get("/api/v1/users/{user_id}")
    def get_user(user_id: int):
        return call_service(lambda: services.get_user(user_id))

    @app.post("/api/v1/couples")
    def create_couple(couple: CoupleCreate):
        return call_service(lambda: services.create_couple(model_to_dict(couple)))

    @app.get("/api/v1/couples/{couple_id}")
    def get_couple(couple_id: int):
        return call_service(lambda: services.get_couple(couple_id))

    @app.get("/api/v1/couples/user/{user_id}")
    def get_user_couple(user_id: int):
        return call_service(lambda: services.get_user_couple(user_id))

    @app.post("/api/v1/tasks")
    def create_task(task: TaskCreate):
        return call_service(lambda: services.create_task(model_to_dict(task)))

    @app.get("/api/v1/tasks")
    def list_tasks(
        couple_id: int | None = None,
        user_id: int | None = None,
        view: str = Query("all", pattern="^(all|private|shared|mine)$"),
    ):
        return services.list_tasks(couple_id=couple_id, user_id=user_id, view=view)

    @app.get("/api/v1/tasks/{task_id}")
    def get_task(task_id: int):
        return call_service(lambda: services.get_task(task_id))

    @app.put("/api/v1/tasks/{task_id}")
    def update_task(task_id: int, task: TaskUpdate):
        return call_service(lambda: services.update_task(task_id, model_to_dict(task, exclude_unset=True)))

    @app.delete("/api/v1/tasks/{task_id}")
    def delete_task(task_id: int):
        return call_service(lambda: services.delete_task(task_id))

    @app.get("/api/v1/stats")
    def get_stats(couple_id: int = 1):
        return services.get_stats(couple_id)

    return app


def model_to_dict(model, exclude_unset: bool = False) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def call_service(callback):
    try:
        return callback()
    except services.NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except services.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


app = create_app()
