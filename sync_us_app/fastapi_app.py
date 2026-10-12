from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import planner, services
from .config import INDEX_PATH
from .database import init_db
from .schemas import TaskCreate, TaskUpdate, UserCreate


# Planner actions also work with user_id in the query string and no body, like the
# standard-library server.
OPTIONAL_BODY = Body(default_factory=dict)


def is_local_request(request: Request) -> bool:
    forwarded = any(request.headers.get(name) for name in ("cf-connecting-ip", "x-forwarded-for", "cf-ray"))
    host = request.client.host if request.client else ""
    return not forwarded and host in {"127.0.0.1", "::1", "localhost"}


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

    @app.get("/api/v1/bootstrap")
    def bootstrap(user_id: int, today: str | None = None):
        return call_service(lambda: services.bootstrap(user_id, today))

    @app.get("/api/v1/version")
    def data_version(user_id: int):
        return call_service(lambda: {"version": services.data_version(user_id)})

    @app.post("/api/v1/users")
    def create_user(user: UserCreate):
        return call_service(lambda: services.create_user(model_to_dict(user)))

    @app.post("/api/v1/auth/login")
    def login(payload: dict):
        return call_service(lambda: services.login_user(payload))

    @app.get("/api/v1/users")
    def list_users(request: Request):
        # 完整使用者清單只給本機檢視模式
        if not is_local_request(request):
            raise HTTPException(status_code=404, detail="Not found")
        return services.list_users()

    @app.get("/api/v1/users/{user_id}")
    def get_user(user_id: int):
        return call_service(lambda: services.get_user(user_id))

    @app.post("/api/v1/couple-invites")
    def create_couple_invite(payload: dict):
        return call_service(lambda: services.create_couple_invite(payload))

    @app.get("/api/v1/couple-invites/user/{user_id}")
    def list_couple_invites(user_id: int):
        return call_service(lambda: services.list_couple_invites_for_user(user_id))

    @app.get("/api/v1/couple-invites/code/{invite_code}")
    def get_couple_invite(invite_code: str):
        return call_service(lambda: services.get_couple_invite_by_code(invite_code))

    @app.post("/api/v1/couple-invites/{invite_code}/accept")
    def accept_couple_invite(invite_code: str, payload: dict):
        return call_service(lambda: services.accept_couple_invite(invite_code, payload))

    @app.post("/api/v1/couple-invites/{invite_code}/decline")
    def decline_couple_invite(invite_code: str, payload: dict):
        return call_service(lambda: services.decline_couple_invite(invite_code, payload))

    @app.get("/api/v1/couples/{couple_id}")
    def get_couple(couple_id: int):
        return call_service(lambda: services.get_couple(couple_id))

    @app.get("/api/v1/couples/{couple_id}/manual")
    def list_manual(couple_id: int, user_id: int, subject_user_id: int | None = None, include_pending: bool = True):
        return call_service(lambda: services.list_manual_entries(couple_id, user_id, subject_user_id, include_pending))

    @app.post("/api/v1/couples/{couple_id}/manual")
    def save_manual(couple_id: int, payload: dict):
        return call_service(lambda: services.upsert_manual_entry(couple_id, payload.get("user_id"), payload))

    @app.post("/api/v1/couples/{couple_id}/manual/query")
    def query_manual(couple_id: int, payload: dict):
        return call_service(lambda: services.query_manual(couple_id, payload.get("user_id"), payload.get("query", "")))

    @app.post("/api/v1/manual/{entry_id}/confirm")
    def confirm_manual(entry_id: int, payload: dict):
        return call_service(lambda: services.confirm_manual_entry(entry_id, payload.get("user_id")))

    @app.get("/api/v1/couples/{couple_id}/rewards")
    def list_rewards(couple_id: int, user_id: int):
        return call_service(lambda: services.list_rewards(couple_id, user_id))

    @app.post("/api/v1/couples/{couple_id}/rewards", status_code=201)
    def redeem_reward(couple_id: int, payload: dict):
        return call_service(lambda: services.redeem_reward(couple_id, payload.get("user_id"), payload.get("item_key")))

    @app.get("/api/v1/couples/{couple_id}/footprints")
    def list_footprints(couple_id: int, user_id: int):
        return call_service(lambda: services.list_footprints(couple_id, user_id))

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

    @app.get("/api/v1/tasks/completed")
    def list_completed(
        couple_id: int | None = None,
        user_id: int | None = None,
        view: str = Query("all", pattern="^(all|private|shared|mine)$"),
    ):
        return services.list_completed(couple_id=couple_id, user_id=user_id, view=view)

    @app.get("/api/v1/tasks/{task_id}")
    def get_task(task_id: int, user_id: int | None = None):
        return call_service(lambda: services.get_task(task_id, user_id))

    @app.put("/api/v1/tasks/{task_id}")
    def update_task(task_id: int, task: TaskUpdate, user_id: int | None = None):
        data = model_to_dict(task, exclude_unset=True)
        return call_service(lambda: services.update_task(task_id, data, user_id or data.get("user_id")))

    @app.delete("/api/v1/tasks/{task_id}")
    def delete_task(task_id: int, user_id: int | None = None):
        return call_service(lambda: services.delete_task(task_id, user_id))

    @app.post("/api/v1/tasks/{task_id}/complete")
    def complete_task(task_id: int, payload: dict):
        return call_service(lambda: services.complete_task(task_id, payload.get("user_id")))

    @app.post("/api/v1/tasks/{task_id}/reopen")
    def reopen_task(task_id: int, payload: dict):
        return call_service(lambda: services.reopen_task(task_id, payload.get("user_id")))

    @app.post("/api/v1/tasks/{task_id}/restore")
    def restore_task(task_id: int, payload: dict):
        return call_service(lambda: services.restore_task(task_id, payload.get("user_id")))

    @app.post("/api/v1/tasks/{task_id}/footprint")
    def save_task_footprint(task_id: int, payload: dict):
        return call_service(lambda: services.save_task_footprint(task_id, payload.get("user_id"), payload))

    @app.post("/api/v1/tasks/{task_id}/confirm")
    def confirm_task(task_id: int, payload: dict):
        return call_service(lambda: services.confirm_task(task_id, payload.get("user_id")))

    @app.get("/api/v1/stats")
    def get_stats(couple_id: int = 1, user_id: int | None = None):
        return services.get_stats(couple_id, user_id=user_id)

    # --- 雙人週記 (same behaviour as the standard-library server) -----------------------

    @app.get("/api/v1/planner/week")
    def planner_week(user_id: int, start: str | None = None):
        return call_service(lambda: planner.get_week(user_id, start))

    @app.post("/api/v1/planner/items", status_code=201)
    def planner_create_item(payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.create_item(acting_user(payload, user_id), payload))

    @app.put("/api/v1/planner/items/{item_id}")
    def planner_update_item(item_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.update_item(item_id, acting_user(payload, user_id), payload))

    @app.delete("/api/v1/planner/items/{item_id}")
    def planner_delete_item(item_id: int, user_id: int | None = None):
        return call_service(lambda: planner.delete_item(item_id, user_id))

    @app.post("/api/v1/planner/items/{item_id}/restore")
    def planner_restore_item(item_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.restore_item(item_id, acting_user(payload, user_id)))

    @app.put("/api/v1/planner/availability/{day}")
    def planner_availability(day: str, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.set_availability(acting_user(payload, user_id), day, payload.get("status")))

    @app.post("/api/v1/planner/invitations", status_code=201)
    def planner_invite(payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.create_invitation(acting_user(payload, user_id), payload))

    @app.post("/api/v1/planner/invitations/{invitation_id}/accept")
    def planner_accept(invitation_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.accept_invitation(invitation_id, acting_user(payload, user_id)))

    @app.post("/api/v1/planner/invitations/{invitation_id}/decline")
    def planner_decline(invitation_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.decline_invitation(invitation_id, acting_user(payload, user_id)))

    @app.post("/api/v1/planner/invitations/{invitation_id}/withdraw")
    def planner_withdraw(invitation_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.withdraw_invitation(invitation_id, acting_user(payload, user_id)))

    @app.post("/api/v1/planner/shared-items/{item_id}/cancel")
    def planner_cancel_shared(item_id: int, payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.cancel_shared_item(item_id, acting_user(payload, user_id)))

    @app.post("/api/v1/planner/calendar/import-preview")
    def planner_import_preview(payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.preview_import(acting_user(payload, user_id), payload))

    @app.post("/api/v1/planner/calendar/import-confirm")
    def planner_import_confirm(payload: dict = OPTIONAL_BODY, user_id: int | None = None):
        return call_service(lambda: planner.confirm_import(acting_user(payload, user_id), payload))

    return app


def acting_user(payload: dict, query_user_id: int | None):
    value = payload.get("user_id")
    return value if value not in (None, "") else query_user_id


def model_to_dict(model, exclude_unset: bool = False) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def call_service(callback):
    try:
        return callback()
    except services.UserNotFoundError as exc:
        # Same body as the standard-library server: clients sign out only on this code.
        return JSONResponse(status_code=404, content={"detail": str(exc), "code": "user_not_found"})
    except services.NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except services.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except services.ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"資料格式不正確：{exc}") from exc


app = create_app()
