import { CalendarCheck, HeartHandshake, Home, NotebookPen, User } from "lucide-react";

// 商城 is not in the bar: it opens from the 星塵瓶 card (星域) and from 我的.
export const NAV_ITEMS = [
  { key: "home", label: "星域", icon: Home },
  { key: "planner", label: "週記", icon: NotebookPen },
  { key: "tasks", label: "泡泡", icon: CalendarCheck },
  { key: "partner", label: "連結", icon: HeartHandshake },
  { key: "profile", label: "我的", icon: User },
];

// Pages that need an active couple and at least one handbook entry.
export const GATED_TABS = new Set(["home", "planner", "tasks", "shop"]);

// Mirrors the reward catalogue on the server (used for the stardust jar preview).
export const REWARD_PREVIEW = [
  { title: "雙人咖啡券", cost: 80 },
  { title: "晚餐許願卡", cost: 140 },
  { title: "週末空白時段", cost: 220 },
];

export function bubbleTone(weight) {
  if (weight >= 80) return "hot";
  if (weight >= 55) return "warm";
  return "cool";
}

export function weightLabel(weight) {
  if (weight >= 80) return "很重要";
  if (weight >= 55) return "中等";
  return "輕鬆";
}

export function initialOf(name) {
  return name?.trim()?.slice(0, 1)?.toUpperCase() || "?";
}

export function memberTone(members, userId) {
  const index = members.findIndex((member) => member.id === Number(userId));
  return index === 1 ? 2 : 1;
}
