import TaskCard from "./TaskCard.jsx";

export default function TaskBoard({ tasks, activeUser, onRefresh }) {
  if (!tasks.length) {
    return <div className="empty">目前沒有進行中的泡泡，新增一顆吧。</div>;
  }

  return (
    <div className="task-board">
      {tasks.map((task, index) => (
        <TaskCard
          key={task.id}
          task={task}
          index={index}
          activeUser={activeUser}
          onRefresh={onRefresh}
          variant="card"
        />
      ))}
    </div>
  );
}
