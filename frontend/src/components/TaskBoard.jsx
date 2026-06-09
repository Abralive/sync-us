import TaskCard from "./TaskCard.jsx";

export default function TaskBoard({ tasks, onRefresh }) {
  if (!tasks.length) {
    return (
      <section className="task-board planner-panel">
        <div className="empty">這個視圖目前沒有任務。</div>
      </section>
    );
  }

  return (
    <section className="task-board planner-panel">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} onRefresh={onRefresh} />
      ))}
    </section>
  );
}
