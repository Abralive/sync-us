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