import { useEffect, useMemo, useState } from "react";
import { request } from "./api/client.js";
import AuthScreen from "./components/AuthScreen.jsx";
import BottomNav from "./components/BottomNav.jsx";
import BubbleGarden from "./components/BubbleGarden.jsx";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Stats from "./components/Stats.jsx";
import TaskBoard from "./components/TaskBoard.jsx";
import TaskForm from "./components/TaskForm.jsx";
import ViewTabs from "./components/ViewTabs.jsx";

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

  function refresh() {
    setRefreshTick((tick) => tick + 1);
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    if (nextTab === "shared") setView("shared");
    if (nextTab === "tasks") setView("mine");
    if (nextTab === "home") setView("shared");
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
      <Header
        users={users}
        activeUser={activeUser}
        onActiveUserChange={setActiveUser}
        onLogout={() => setIsAuthenticated(false)}
      />

      {(activeTab === "home" || activeTab === "shared") && (
        <BubbleGarden
          tasks={tasks}
          stats={stats}
          activeName={activeName}
          onRefresh={refresh}
          onAddTask={() => setActiveTab("tasks")}
        />
      )}

      {activeTab === "tasks" && (
        <section className="main-grid planner-panel" id="planner">
          <div className="panel">
            <div className="section-head">
              <div>
                <h2 className="section-title">任務管理</h2>
                <p className="section-copy">新增、指派與整理任務。泡泡本身放在泡泡星域中照顧。</p>
              </div>
              <ViewTabs view={view} onViewChange={setView} />
            </div>

            <Stats stats={stats} activeName={activeName} tasks={tasks} />
            <TaskForm users={users} activeUser={activeUser} onCreated={refresh} />
            {error && <div className="error">{error}</div>}
            <TaskBoard tasks={tasks} onRefresh={refresh} />
          </div>
          <Sidebar tasks={tasks} />
        </section>
      )}

      {activeTab === "shop" && (
        <section className="shop-screen">
          <Sidebar tasks={tasks} />
        </section>
      )}

      {activeTab === "profile" && (
        <section className="panel profile-screen">
          <h2 className="section-title">我的狀態</h2>
          <Stats stats={stats} activeName={activeName} tasks={tasks} />
          <button className="btn" onClick={() => setIsAuthenticated(false)}>登出</button>
        </section>
      )}

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </main>
  );
}
