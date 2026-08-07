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

const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const REVIEW_MODE = SEARCH_PARAMS.get("review") === "1";

export default function App() {
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [stats, setStats] = useState(null);
  const [couple, setCouple] = useState(null);
  const [activeUser, setActiveUser] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(REVIEW_MODE);
  const [activeTab, setActiveTab] = useState("home");
  const [isTaskSheetOpen, setIsTaskSheetOpen] = useState(false);
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

  useEffect(() => {
    load();
  }, [activeUser, refreshTick]);

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
    setIsTaskSheetOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function logout() {
    setIsAuthenticated(false);
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
    <main className="app-shell game-shell shared-journal-app">
      <Header
        users={users}
        activeUser={activeUser}
        activeTab={activeTab}
        onActiveUserChange={setActiveUser}
        onTabChange={handleTabChange}
        onLogout={logout}
      />

      {activeTab === "home" && (
        <BubbleGarden
          tasks={tasks}
          stardust={stardust}
          activeName={activeName}
          users={users}
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
        <section className="growth-page bubble-mobile-shell">
          {!couple && (
            <div className="connect-inline">
              先建立伴侶連結，才能把泡泡放進共享星域。
              <button className="btn primary" onClick={() => setActiveTab("partner")}>去連結</button>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <TaskBoard tasks={tasks} activeUser={activeUser} onRefresh={refresh} onAddTask={() => setIsTaskSheetOpen(true)} />
        </section>
      )}

      {activeTab === "tasks" && couple && isTaskSheetOpen && (
        <div className="task-sheet" role="dialog" aria-modal="true" aria-label="新增泡泡">
          <button className="task-sheet-backdrop" type="button" onClick={() => setIsTaskSheetOpen(false)} aria-label="關閉新增泡泡"></button>
          <section className="task-sheet-panel">
            <button className="sheet-handle" type="button" onClick={() => setIsTaskSheetOpen(false)} aria-label="關閉"></button>
            <div className="task-sheet-title">
              <span>新增泡泡</span>
              <button type="button" onClick={() => setIsTaskSheetOpen(false)} aria-label="關閉">×</button>
            </div>
            <TaskForm
              users={users}
              activeUser={activeUser}
              coupleId={coupleId}
              onCreated={() => {
                refresh();
                setIsTaskSheetOpen(false);
              }}
            />
          </section>
        </div>
      )}

      {activeTab === "shop" && <ShopPage stardust={stardust} />}

      {activeTab === "profile" && (
        <section className="profile-page panel">
          <span className="garden-kicker">我的</span>
          <h2>我的同步狀態</h2>
          <p>{activeName} 目前照顧 {stats?.total || 0} 顆泡泡，已完成 {stats?.completed || 0} 顆，累積 {stardust} 顆星塵。</p>
          <button className="btn" onClick={logout}>登出</button>
        </section>
      )}

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} pendingConfirm={stats?.pending_confirm || 0} />
    </main>
  );
}
