import { useEffect, useMemo, useState } from "react";
import { request } from "./api/client.js";
import AuthScreen from "./components/AuthScreen.jsx";
import BottomNav from "./components/BottomNav.jsx";
import BubbleGarden from "./components/BubbleGarden.jsx";
import Header from "./components/Header.jsx";
import ShopPage from "./components/ShopPage.jsx";
import TaskBoard from "./components/TaskBoard.jsx";
import TaskForm from "./components/TaskForm.jsx";

export default function App() {
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeUser, setActiveUser] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [view, setView] = useState("shared");
  const [activeTab, setActiveTab] = useState("home");
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  async function load() {
    try {
      const query = new URLSearchParams({ couple_id: "1", user_id: String(activeUser), view });
      const [userData, taskData, statData] = await Promise.all([
        request("/users"),
        request(`/tasks?${query.toString()}`),
        request("/stats?couple_id=1"),
      ]);
      setUsers(userData);
      setTasks(taskData);
      setStats(statData);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadUsersOnly() {
    const userData = await request("/users");
    setUsers(userData);
  }

  useEffect(() => { load(); }, [activeUser, view, refreshTick]);

  const activeName = useMemo(
    () => users.find((user) => user.id === Number(activeUser))?.username || "Sync",
    [users, activeUser]
  );
  const stardust = tasks.filter((task) => task.is_completed).length * 12;

  function refresh() {
    setRefreshTick((tick) => tick + 1);
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    if (nextTab === "home" || nextTab === "shared") setView("shared");
    if (nextTab === "tasks") setView("mine");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        users={users}
        onUsersChanged={loadUsersOnly}
        onAuthenticated={(userId) => {
          setActiveUser(userId);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <main className="app-shell game-shell">
      <Header users={users} activeUser={activeUser} onActiveUserChange={setActiveUser} onLogout={() => setIsAuthenticated(false)} />

      {(activeTab === "home" || activeTab === "shared") && (
        <BubbleGarden tasks={tasks} stats={stats} activeName={activeName} onRefresh={refresh} onAddTask={() => setActiveTab("tasks")} />
      )}

      {activeTab === "tasks" && (
        <section className="growth-page">
          <div className="growth-intro">
            <span className="garden-kicker">Growth Bubbles</span>
            <h2>照顧新的泡泡</h2>
            <p>這裡不是任務 dashboard，只是把需要一起完成的事種成泡泡。細節留給泡泡自己長大。</p>
          </div>
          <TaskForm users={users} activeUser={activeUser} onCreated={refresh} />
          {error && <div className="error">{error}</div>}
          <TaskBoard tasks={tasks} />
        </section>
      )}

      {activeTab === "shop" && <ShopPage stardust={stardust} />}

      {activeTab === "profile" && (
        <section className="profile-page panel">
          <span className="garden-kicker">Profile</span>
          <h2>我的狀態</h2>
          <p>{activeName} 正在照顧 {stats?.total || 0} 顆泡泡，已累積 {stardust} 星塵。</p>
          <button className="btn" onClick={() => setIsAuthenticated(false)}>登出</button>
        </section>
      )}

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </main>
  );
}
