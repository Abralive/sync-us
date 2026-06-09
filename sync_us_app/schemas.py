from datetime import datetime
from typing import Optional

try:
    from pydantic import BaseModel, Field
except ModuleNotFoundError:  # Standard-library server does not require Pydantic.
    BaseModel = object

    def Field(default=None, **_kwargs):
        return default


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)


class CoupleCreate(BaseModel):
    partner_a_id: int
    partner_b_id: int


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    description: str = ""
    due_time: datetime
    priority_weight: int = Field(50, ge=1, le=100)
    couple_id: Optional[int] = 1
    created_by_id: int = 1
    assigned_to_id: Optional[int] = None
    is_private: bool = False
    reminder_minutes: int = Field(60, ge=0, le=10080)
    collaboration_note: str = ""


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = None
    due_time: Optional[datetime] = None
    priority_weight: Optional[int] = Field(default=None, ge=1, le=100)
    assigned_to_id: Optional[int] = None
    is_private: Optional[bool] = None
    is_completed: Optional[bool] = None
    reminder_minutes: Optional[int] = Field(default=None, ge=0, le=10080)
    collaboration_note: Optional[str] = None
