export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function countdownText(value) {
  const diff = new Date(value) - new Date();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const text = days > 0 ? `${days} 天 ${hours} 小時` : `${hours} 小時 ${minutes} 分`;
  return diff >= 0 ? `剩餘 ${text}` : `已超過 ${text}`;
}
