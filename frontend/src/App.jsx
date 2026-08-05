import { useEffect, useMemo, useState } from "react";
import { request } from "./api/client.js";
import AuthScreen from "./components/AuthScreen.jsx";
import BottomNav from "./components/BottomNav.jsx";
import BubbleGarden from "./components/BubbleGarden.jsx";
import CoupleConnect from "./components/CoupleConnect.jsx";
import Header from "./components/Header.jsx";
import ShopPage from "./components/ShopPage.jsx";
import TaskBoard from "./components/TaskBoard.jsx";
import TaskForm from "./components/TaskForm.jsx";

export default function App() {
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [stats, setStats] = useState(null);
  const [couple, setCouple] = useState(null);
  const [activeUser, setActiveUser] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const coupleId = couple?.id || 1;
  const stardust = stats?.stardust || 0;

  async function loadCouple(userId) {
    try {
      const userCouple = await request(`/couples/user/${userId}`);
      const coupleDetail = await request(`/couples/${userCouple.id}`);
      setCouple(coupleDetail);
      return coupleDetail;
    } catch {
      setCouple(null);
      return null;
    }
  }

  async function load() {
    try {
      const userData = await request("/users");
      setUsers(userData);

      const coupleData = await loadCouple(activeUser);
      if (!coupleData) {
        setTasks([]);
        setCompleted([]);
        setStats(null);
        setError("");
        return;
      }

      const cid = coupleData.id;
      const [taskData, doneData, statData] = await Promise.all([
        request(`/tasks?couple_id=${cid}&user_id=${activeUser}&view=all`),
        request(`/tasks/completed?couple_id=${cid}&user_id=${activeUser}&view=all`),
        request(`/stats?couple_id=${cid}`),
      ]);
      setTasks(taskData);
      setCompleted(doneData);
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

  useEffect(() => { load(); }, [activeUser, refreshTick]);

  const activeName = useMemo(
    () => users.find((user) => user.id === Number(activeUser))?.username || "Sync",
    [users, activeUser]
  );

  function refresh() {
    setRefreshTick((tick) => tick + 1);
  }

  async function handleConnected() {
    await load();
    setActiveTab("home");
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
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

      {activeTab === "home" && (
        <BubbleGarden
          tasks={tasks}
          stardust={stardust}
          activeName={activeName}
          activeUser={activeUser}
          onRefresh={refresh}
          onAddTask={() => setActiveTab("tasks")}
          onConnect={() => setActiveTab("partner")}
          hasCouple={Boolean(couple)}
        />
      )}

      {activeTab === "partner" && (
        <CoupleConnect
          users={users}
          activeUser={activeUser}
          couple={couple}
          stats={stats}
          completed={completed}
          stardust={stardust}
          onRefresh={refresh}
          onConnected={handleConnected}
        />
      )}

      {activeTab === "tasks" && (
        <section className="growth-page">
          <div className="growth-intro">
            <span className="garden-kicker">泡泡管理</span>
            <h2>安排要一起面對的事</h2>
            <p>清單適合快速處理，日曆適合看時間分布。星域只留下需要被照顧的泡泡。</p>
          </div>
          {!couple && (
            <div className="connect-inline">
              先建立伴侶連結，才能把泡泡放進共享星域。
              <button className="btn primary" onClick={() => setActiveTab("partner")}>去連結</button>
            </div>
          )}
          {couple && <TaskForm users={users} activeUser={activeUser} coupleId={coupleId} onCreated={refresh} />}
          {error && <div className="error">{error}</div>}
          <TaskBoard tasks={tasks} activeUser={activeUser} onRefresh={refresh} />
        </section>
      )}

      {activeTab === "shop" && <ShopPage stardust={stardust} />}

      {activeTab === "profile" && (
        <section className="profile-page panel">
          <span className="garden-kicker">我的</span>
          <h2>我的小星球</h2>
          <p>{activeName} 目前照顧了 {stats?.total || 0} 顆泡泡，完成 {stats?.completed || 0} 顆，累積 {stardust} 星塵。</p>
          <button className="btn" onClick={() => setIsAuthenticated(false)}>登出</button>
        </section>
      )}

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} pendingConfirm={stats?.pending_confirm || 0} />
    </main>
  );
}
