Total Iterations: 2

---

```python
"""
FastAPI backend for Sync‑Us.
Implements:
- JWT authentication (placeholder)
- Task CRUD with priority weight calculation
- Anti‑interruption scheduling logic
- PostgreSQL models via SQLAlchemy (async)
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Literal
import datetime as dt
import uuid

# ---------- Security ----------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Placeholder: decode JWT and return user_id.
    In real app, verify token signature, expiration, etc.
    """
    # dummy implementation
    if token != "valid_token":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return {"user_id": 1}  # user belongs to a couple

# ---------- Database models ----------
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Boolean,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, Session
from sqlalchemy import create_engine, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

DATABASE_URL = "postgresql+asyncpg://user:password@localhost/sync_us"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_pw = Column(String, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class Couple(Base):
    __tablename__ = "couples"
    id = Column(Integer, primary_key=True, index=True)
    partner_a_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    partner_b_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="active")  # active / broken_up
    created_at = Column(DateTime, default=dt.datetime.utcnow)

    tasks = relationship("Task", back_populates="creator")
    schedules = relationship("Schedule", back_populates="couple")


class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"))
    due_date = Column(DateTime, nullable=False)
    duration_minutes = Column(Integer, nullable=True)
    base_priority = Column(Integer, nullable=False)  # user‑provided importance 1‑5

    creator = relationship("User", back_populates="own_tasks")
    priority_weights = relationship("PriorityWeight", back_populates="task")
    schedules = relationship("Schedule", back_populates="task")


class PriorityWeight(Base):
    __tablename__ = "priority_weights"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    weight_score = Column(Float, nullable=False)  # computed weight
    weight_type = Column(Enum("time", "effort", "importance"), nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow)

    task = relationship("Task", back_populates="priority_weights")


class Schedule(Base):
    __tablename__ = "schedules"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    couple_id = Column(Integer, ForeignKey("couples.id"), nullable=False)
    slot_start = Column(DateTime, nullable=False)
    slot_end = Column(DateTime, nullable=False)
    is_blocked = Column(Boolean, default=False)  # protected by high‑priority card

    task = relationship("Task", back_populates="schedules")
    couple = relationship("Couple", back_populates="schedules")


class Interruption(Base):
    __tablename__ = "interruptions"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    couple_id = Column(Integer, ForeignKey("couples.id"), nullable=False)
    interrupted_at = Column(DateTime, default=dt.datetime.utcnow)
    reason = Column(String, nullable=False)


class Settings(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True)
    couple_id = Column(Integer, ForeignKey("couples.id"))
    voice_input_enabled = Column(Boolean, default=True)
    max_concurrent_tasks = Column(Integer, default=2)


# ---------- Pydantic schemas ----------
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: dt.datetime
    duration_minutes: Optional[int] = None
    base_priority: int  # 1 - 5


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[dt.datetime] = None
    duration_minutes: Optional[int] = None
    base_priority: Optional[int] = None


class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    due_date: dt.datetime
    duration_minutes: Optional[int]
    base_priority: int
    weight_score: Optional[float] = None  # populated after creation / update


class ScheduleRequest(BaseModel):
    slot_start: dt.datetime
    slot_end: dt.datetime


class InterruptRequest(BaseModel):
    reason: str


# ---------- Database utilities ----------
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


def _effort_factor(effort: str) -> float:
    """Map effort description to numeric factor."""
    mapping = {"low": 0.5, "medium": 1.0, "high": 1.5}
    return mapping.get(effort.lower(), 1.0)


def _calc_priority_weight(task: Task) -> float:
    """
    Compute weight_score based on:
    - duration_minutes * 0.3
    - importance (1‑5) * 0.5
    - effort_factor * 0.2
    """
    effort_val = task.base_priority  # here we reuse base_priority as importance score
    effort_desc = task.description.split()[0].lower() if task.description else "medium"
    factor = _effort_factor(effort_desc)
    return round((task.duration_minutes * 0.3) + (effort_val * 0.5) + (factor * 0.2), 2)


async def _check_and_set_schedule(
    db: AsyncSession,
    couple_id: int,
    new_slot_start: dt.datetime,
    new_slot_end: dt.datetime,
    task_id: int,
) -> None:
    """
    Block if any existing schedule (is_blocked=True) with higher priority overlaps.
    If new task weight >= existing blocked weight, set is_blocked=True for the overlapping high‑priority schedule,
    otherwise raise 409 Conflict.
    """
    # fetch overlapping blocked schedules
    stmt = (
        select(Schedule, Task.priority_weights)
        .join(Task, Schedule.task_id == Task.id)
        .where(
            Schedule.couple_id == couple_id,
            Schedule.is_blocked.is_(True),
            Schedule.slot_start < new_slot_end,
            Schedule.slot_end > new_slot_start,
        )
    )
    result = await db.execute(stmt)
    overlapping = result.fetchall()

    max_existing_weight = 0.0
    for sched, pw in overlapping:
        max_existing_weight = max(max_existing_weight, pw.weight_score)

    # fetch new task weight
    result_task = await db.execute(
        select(Task).where(Task.id == task_id)
    )
    new_task = result_task.scalar_one_or_none()
    if not new_task:
        raise HTTPException(status_code=404, detail="Task not found")

    new_weight = _calc_priority_weight(new_task)

    if max_existing_weight > new_weight:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot schedule: higher‑priority task already protected this slot.",
        )

    # If new task weight >= all blocked schedules, protect them
    for sched, pw in overlapping:
        await db.execute(
            update(Schedule)
            .where(
                Schedule.id == sched.id,
                Schedule.couple_id == couple_id,
            )
            .values(is_blocked=True)
        )
        await db.execute(
            update(PriorityWeight)
            .where(PriorityWeight.id == pw.id)
            .values(updated_at=dt.datetime.utcnow)
        )

    # Insert new schedule
    new_sched = Schedule(
        task_id=task_id,
        couple_id=couple_id,
        slot_start=new_slot_start,
        slot_end=new_slot_end,
        is_blocked=(new_weight >= max_existing_weight),
    )
    db.add(new_sched)
    await db.commit()


async def record_interruption(
    db: AsyncSession,
    couple_id: int,
    task_id: int,
    reason: str,
) -> None:
    inter = Interruption(task_id=task_id, couple_id=couple_id, reason=reason)
    db.add(inter)
    await db.commit()


# ---------- FastAPI app ----------
app = FastAPI(title="Sync‑Us API")


@app.post("/api/v1/couples/{couple_id}/tasks", response_model=TaskResponse)
async def create_task(
    couple_id: int,
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    一鍵輸入任務（語音/文字/手勢），後端計算權重並建立視覺化卡片指令。
    """
    # 1. 取得使用者所屬情侶
    couple_stmt = select(Couple).where(Couple.id == couple_id)
    couple_res = await db.execute(couple_stmt)
    couple = couple_res.scalar_one_or_none()
    if not couple:
        raise HTTPException(status_code=404, detail="Couple not found")

    # 2. 判斷使用者是否為該情侶的成員
    if user["user_id"] not in (couple.partner_a_id, couple.partner_b_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    # 3. 創建任務
    task = Task(
        title=payload.title,
        description=payload.description,
        due_date=payload.due_date,
        duration_minutes=payload.duration_minutes,
        base_priority=payload.base_priority,
        creator_id=user["user_id"],
    )
    db.add(task)
    await db.flush()  # obtain task.id

    # 4. 計算權重分數
    weight_score = _calc_priority_weight(task)
    pw = PriorityWeight(
        task_id=task.id,
        weight_score=weight_score,
        weight_type="time",  # 此處示例使用 time，實際可依情境切換
    )
    db.add(pw)

    await db.commit()
    await db.refresh(task)

    return TaskResponse.from_orm(task)


@app.get("/api/v1/couples/{couple_id}/tasks", response_model=List[TaskResponse])
async def list_tasks(couple_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """
    取得該情侶所有任務的卡片資訊（已依權重排序）。
    """
    # 驗證使用者權限
    couple_stmt = select(Couple).where(Couple.id == couple_id)
    couple_res = await db.execute(couple_stmt)
    couple = couple_res.scalar_one_or_none()
    if not couple or user["user_id"] not in (couple.partner_a_id, couple.partner_b_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    stmt = select(Task).where(Task.couple_tasks.any(couple_id=couple_id)).order_by(Task.id)  # 簡化排序
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    # 轉成 Pydantic 回應
    return [TaskResponse.from_orm(t) for t in tasks]


@app.patch("/api/v1/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    編輯任務（時間、說明、優先級），同時重新計算權重。
    """
    # 取得任務所屬情侶
    task_stmt = select(Task).where(Task.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # 驗證權限
    couple_stmt = select(Couple).where(Couple.id == task.couple_id)  # 假設 Task 有一對一關聯，簡化
    couple_res = await db.execute(couple_stmt)
    couple = couple_res.scalar_one_or_none()
    if not couple or user["user_id"] not in (couple.partner_a_id, couple.partner_b_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    # 更新欄位
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)

    # 重新計算權重
    task.weight_score = _calc_priority_weight(task)  # 若 PriorityWeight 已存在可直接更新
    await db.commit()
    return TaskResponse.from_orm(task)


@app.post("/api/v1/tasks/{task_id}/schedule", response_model=dict)
async def schedule_task(
    task_id: int,
    schedule_req: ScheduleRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    手動排程任務時段，若衝突且低權重，會觸發阻擋提示。
    """
    # 取得任務與情侶
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    couple_stmt = select(Couple).where(Couple.id == task.couple_id)
    couple_res = await db.execute(couple_stmt)
    couple = couple_res.scalar_one_or_none()
    if not couple:
        raise HTTPException(status_code=404, detail="Couple not found")
    if user["user_id"] not in (couple.partner_a_id, couple.partner_b_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    await _check_and_set_schedule(
        db,
        couple_id=couple.id,
        new_slot_start=schedule_req.slot_start,
        new_slot_end=schedule_req.slot_end,
        task_id=task_id,
    )
    return {"message": "排程已更新，若有衝突已自動阻擋較低優先權的任務"}


@app.post("/api/v1/tasks/{task_id}/interrupt", response_model=dict)
async def interrupt_task(
    task_id: int,
    payload: InterruptRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    伴侶端手動申請被干擾時，記錄干擾事件並推播提醒。
    """
    # 取得任務與情侶
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    couple_stmt = select(Couple).where(Couple.id == task.couple_id)
    couple_res = await db.execute(couple_stmt)
    couple = couple_res.scalar_one_or_none()
    if not couple or user["user_id"] not in (couple.partner_a_id, couple.partner_b_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    await record_interruption(db, couple_id=couple.id, task_id=task_id, reason=payload.reason)
    return {"message": "干擾事件已記錄"}


# ---------- Run server ----------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("sync_us_main:app", host="0.0.0.0", port=8000, reload=True)
```

```javascript
/**
 * React Native front‑end for Sync‑Us.
 * 使用卡片式 UI、拖曳排程、視覺化優先權。
 * 所有文字均為繁體中文。
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  Image,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import HeadlessVibration from "react-native-polling-event-loop-community";
import * as Audio from "expo-av";

// ---------- API ----------
const API_BASE = "http://localhost:8000/api/v1";

const fetchTasks = async (coupleId) => {
  const res = await fetch(`${API_BASE}/couples/${coupleId}/tasks`);
  if (!res.ok) throw new Error("Failed to load tasks");
  return res.json();
};

const scheduleTask = async (taskId, slotStart, slotEnd) => {
  const body = {
    slot_start: slotStart,
    slot_end: slotEnd,
  };
  const res = await fetch(`${API_BASE}/tasks/${taskId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Schedule failed");
  }
  return res.json();
};

const interruptTask = async (taskId, reason) => {
  const body = { reason };
  const res = await fetch(`${API_BASE}/tasks/${taskId}/interrupt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Interrupt failed");
  }
  return res.json();
};

// ---------- Types ----------
type Task = {
  id: number;
  title: string;
  description: string;
  due_date: string;
  duration_minutes: number;
  base_priority: number; // 1‑5
  weight_score: number; // computed weight
};

// ---------- Helper: weight to UI ----------
const WEIGHT_MAX_DISPLAY = 120; // example max weight for UI scaling
const colorMap = {
  high: "#ff4d4d", // red
  midHigh: "#ff9933", // orange
  midLow: "#ffff33", // yellow
  low: "#66cc66", // green
};

const getCardStyle = (weight) => {
  const widthRatio = Math.min(weight / WEIGHT_MAX_DISPLAY, 1);
  const width = 180 + widthRatio * 120; // base 180 + extra based on weight
  const hue = weight > 80 ? "red" : weight > 50 ? "orange" : weight > 20 ? "yellow" : "green";
  const bgColor = colorMap[
    weight > 80
      ? "high"
      : weight > 50
      : weight > 20
      ? "midLow"
      : "low"
  ];
  return {
    width,
    backgroundColor: bgColor,
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    elevation: 4,
  };
};

// ---------- Task Card ----------
const TaskCard = ({
  task,
  onPress,
  onLongPress,
  onDragStart,
  onDragEnd,
}) => {
  const animatedWidth = useState(new Animated.Value(180)).component;
  const widthRatio = task.weight_score / WEIGHT_MAX_DISPLAY;
  const animatedWidthValue = animatedWidth.interpolate({
    input: [0, 1],
    output: [180, 300],
  });

  // Example: if the card is blocked, show overlay
  const isBlocked = task.isBlocked ?? false; // 假設後端已有此屬性

  const overlayOpacity = isBlocked ? new Animated.Value(0.5) : new Animated.Value(0);

  return (
    <Animated.View style={[styles.cardContainer, getCardStyle(task.weight_score)]}>
      <Animated.View style={{ opacity: overlayOpacity }}>
        <View style={styles.blockedOverlay}>
          <Text style={styles.blockedText}>此時段已受保護</Text>
        </View>
      </Animated.View>

      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        onLongPress={onLongPress}
        onStartShouldSetResponder={() => true}
        onResponderRelease={onDragEnd}
        onResponderMove={onDragEnd}
        onStartShouldSetResponderCapture={() => true}
        // 這裡使用 Gesture Handler 包裹的 TouchableWithoutFeedback
        // 注意：在 React Native 0.71+ 需要使用 <GestureHandlerRootView> 包裹整個檔案
      >
        <View style={styles.cardContent}>
          <Text style={styles.title}>{task.title}</Text>
          <Text style={styles.meta}>
            {task.due_date.split("T")[0]} · {task.duration_minutes} 分鐘 · 優先級 {task.base_priority}
          </Text>
        </View>
      </TouchableOpacity>

      {/* 拖曳手勢 */}
      <PanGestureHandler
        onGestureEvent={onDragStart}
        onHandlerStateChange={onDragEnd}
        waitForBeginDragToEnd={false}
      >
        <Animated.View
          style={{
            ...styles.dragOverlay,
            transform: [{ translateX: 10 }, { scale: widthRatio }],
          }}
        />
      </PanGestureHandler>
    </Animated.View>
  );
};

// ---------- Main App ----------
const App = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const coupleId = "1"; // 替換為實際情侶 ID

  // 取得任務資料
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchTasks(coupleId);
        setTasks(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [coupleId]);

  // 拖曳排程（簡易示範，實際會呼叫 backend）
  const onDragEnd = useCallback(
    async (event, taskId) => {
      const { translationX } = event.nativeEvent.sourceEvent;
      // 這裡假設向右拖曳代表時間前進 1 小時
      const oneHourLater = new Date(task.due_date);
      oneHourLater.setHours(oneHourLater.getHours() + 1);
      try {
        await scheduleTask(taskId, oneHourLater.toISOString(), oneHourLater.toISOString());
        // 若成功，可顯示提醒
        await interruptTask(taskId, "已自動調整時間");
      } catch (err) {
        console.error("排程失敗", err);
      }
    },
    []
  );

  // 顯示任務列表
  const renderItem = ({ item }: { item: Task }) => (
    <TaskCard
      task={item}
      onPress={() => console.log("點擊任務", item.id)}
      onLongPress={() => console.log("長按任務", item.id)}
      onDragStart={async (event) => {
        // 可在此加入更細緻的拖曳逻辑
      }}
      onDragEnd={onDragEnd}
    />
  );

  if (loading) {
    return (
      <ActivityIndicator size="large" color="#0066cc" />
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <FlatList
        data={tasks}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>目前沒有任務</Text>
          </View>
        }
      />
    </GestureHandlerRootView>
  );
};

// ---------- Styles ----------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  listContainer: {
    padding: 10,
  },
  cardContainer: {
    alignItems: "center",
  },
  cardContent: {
    flexDirection: "column",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  meta: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
  },
  cardContainer: {
    alignItems: "center",
  },
  blockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffcc00",
    justifyContent: "center",
    alignItems: "center",
  },
  blockedText: {
    color: "#333",
    fontWeight: "bold",
  },
  emptyContainer: {
    marginTop: 40,
    alignItems: "center",
  },
  emptyText: {
    color: "#888",
    fontSize: 15,
  },
  dragOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,200,0,0.3)",
    zIndex: 1,
  },
});

export default App;
```