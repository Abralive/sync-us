import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "./api/client.js";
import AuthScreen from "./components/AuthScreen.jsx";
import BottomNav from "./components/BottomNav.jsx";
import BubbleGarden from "./components/BubbleGarden.jsx";
import CompletionRecordModal from "./components/CompletionRecordModal.jsx";
import CoupleConnect from "./components/CoupleConnect.jsx";
import Modal from "./components/Modal.jsx";
import ProfilePage from "./components/ProfilePage.jsx";
import ShopPage from "./components/ShopPage.jsx";
import SideRail from "./components/SideRail.jsx";
import TaskBoard from "./components/TaskBoard.jsx";
import TaskDetail from "./components/TaskDetail.jsx";
import TaskForm from "./components/TaskForm.jsx";
import Toast from "./components/Toast.jsx";
import TopBar from "./components/TopBar.jsx";
import { GATED_TABS } from "./constants.js";

const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const LOCAL_REVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REVIEW_MODE = LOCAL_REVIEW_HOSTS.has(window.location.hostname) && SEARCH_PARAMS.get("review") === "1";
const AUTH_STORAGE_KEY = "sync-us-auth";
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NO_LOCKS = new Set();

function readStoredAuth() {
  try {
    const data = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!data?.userId || !data?.expiresAt || Date.now() > data.expiresAt) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStoredAuth(userId) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ userId, expiresAt: Date.now() + AUTH_TTL_MS }));
  } catch {
    // Private mode / storage disabled: the session simply won't be remembered.
  }
}

function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="載入中">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );
}

export default function App() {
  const [activeUser, setActiveUser] = useState(() => readStoredAuth()?.userId || (REVIEW_MODE ? 1 : null));
  const [me, setMe] = useState(null);
  const [couple, setCouple] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [stats, setStats] = useState(null);
  const [manualRequired, setManualRequired] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [taskFormDate, setTaskFormDate] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [completionTask, setCompletionTask] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const loadSeq = useRef(0);
  const activeUserRef = useRef(activeUser);
  activeUserRef.current = activeUser;

  const isAuthenticated = Boolean(activeUser);
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  const showToast = useCallback((message, tone = "info") => {
    setToast({ message, tone, id: Date.now() + Math.random() });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  const members = useMemo(() => {
    if (couple) {
      return [
        { id: couple.partner_a_id, username: couple.partner_a_name, tone: 1 },
        { id: couple.partner_b_id, username: couple.partner_b_name, tone: 2 },
      ];
    }
    return me ? [{ id: me.id, username: me.username, tone: 1 }] : [];
  }, [couple, me]);
  const meMember = members.find((member) => member.id === Number(activeUser)) || null;
  const partner = members.find((member) => member.id !== Number(activeUser)) || null;
  const stardust = stats?.stardust || 0;
  const lockedTabs = !loaded ? NO_LOCKS : !couple || manualRequired ? GATED_TABS : NO_LOCKS;
  const detailTask = tasks.find((task) => task.id === detailTaskId) || null;

  const logout = useCallback(() => {
    loadSeq.current += 1; // any load still in flight must not log the old user back in
    activeUserRef.current = null;
    clearStoredAuth();
    setActiveUser(null);
    setMe(null);
    setCouple(null);
    setTasks([]);
    setCompleted([]);
    setStats(null);
    setLoaded(false);
    setActiveTab("home");
  }, []);

  async function load() {
    const userId = Number(activeUser);
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current || Number(activeUserRef.current) !== userId;

    let user;
    try {
      user = await request(`/users/${userId}`);
    } catch (err) {
      if (stale()) return;
      if (err.status === 404) {
        // The stored account no longer exists (for example after a database reset).
        logout();
        return;
      }
      setError(err.message);
      setLoaded(true);
      return;
    }

    try {
      let coupleData = null;
      try {
        const userCouple = await request(`/couples/user/${userId}`);
        coupleData = await request(`/couples/${userCouple.id}`);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      if (stale()) return;
      setMe(user);
      setCouple(coupleData);

      if (!coupleData) {
        setTasks([]);
        setCompleted([]);
        setStats(null);
        setManualRequired(false);
        setActiveTab((tab) => (GATED_TABS.has(tab) ? "partner" : tab));
      } else {
        const cid = coupleData.id;
        const [taskData, doneData, statData, manualData] = await Promise.all([
          request(`/tasks?couple_id=${cid}&user_id=${userId}&view=all`),
          request(`/tasks/completed?couple_id=${cid}&user_id=${userId}&view=all`),
          request(`/stats?couple_id=${cid}&user_id=${userId}`),
          request(`/couples/${cid}/manual?user_id=${userId}`),
        ]);
        if (stale()) return;
        setTasks(taskData);
        setCompleted(doneData);
        setStats(statData);
        const needsManual = !REVIEW_MODE && (manualData.entries || []).length === 0;
        setManualRequired(needsManual);
        if (needsManual) setActiveTab((tab) => (GATED_TABS.has(tab) ? "partner" : tab));
      }
      setError("");
      setLoaded(true);
      if (!REVIEW_MODE) writeStoredAuth(userId);
    } catch (err) {
      if (stale()) return;
      setError(err.message);
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (isAuthenticated) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser, refreshTick]);

  // Refresh when coming back to the app (phones often don't fire "focus").
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthenticated, refresh]);

  // Waiting for the partner to accept: check every few seconds.
  // Paired: pick up the partner's new bubbles every 45 seconds while the page is visible.
  useEffect(() => {
    if (!isAuthenticated || !loaded) return undefined;
    const interval = couple ? 45000 : 4000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, interval);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, loaded, couple, refresh]);

  function changeTab(next) {
    if (lockedTabs.has(next)) {
      setActiveTab("partner");
      showToast(couple ? "先替對方寫下一則小手冊，就能打開這裡。" : "先完成伴侶連結，才能使用這個頁面。");
      return;
    }
    setActiveTab(next);
    setDetailTaskId(null);
    window.scrollTo({ top: 0 });
  }

  function openTaskForm(date) {
    setTaskFormDate(date instanceof Date ? date : new Date());
  }

  function handleCompleted(done) {
    refresh();
    const dust = Number(done?.stardust_awarded) || 0;
    if (done && !done.is_private) {
      setCompletionTask(done);
      if (dust > 0) showToast(`泡泡完成了，+${dust} 星塵 ✨`);
    } else {
      showToast(dust > 0 ? `私人泡泡完成了，+${dust} 星塵 ✨` : "私人泡泡完成了 ✨");
    }
  }

  async function completeTask(task) {
    try {
      const done = await request(`/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser) }),
      });
      setDetailTaskId(null);
      handleCompleted(done);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function deleteTask(task) {
    try {
      await request(`/tasks/${task.id}?user_id=${activeUser}`, { method: "DELETE" });
      setDetailTaskId(null);
      refresh();
      showToast(`已刪除「${task.title}」`);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        onAuthenticated={(user) => {
          writeStoredAuth(user.id);
          setLoaded(false);
          setActiveTab("home");
          setActiveUser(user.id);
        }}
      />
    );
  }

  let page = null;
  if (!loaded) {
    page = <PageSkeleton />;
  } else if (activeTab === "home") {
    page = (
      <BubbleGarden
        tasks={tasks}
        members={members}
        activeUser={activeUser}
        stats={stats}
        stardust={stardust}
        onAddTask={openTaskForm}
        onOpenTask={(task) => setDetailTaskId(task.id)}
        onTaskCompleted={handleCompleted}
        onOpenDate={(date) => {
          setSelectedDate(date);
          changeTab("tasks");
        }}
        onSeeAll={() => changeTab("tasks")}
        onError={(message) => showToast(message, "error")}
      />
    );
  } else if (activeTab === "tasks") {
    page = (
      <TaskBoard
        tasks={tasks}
        members={members}
        selectedDate={selectedDate}
        onSelectedDateChange={setSelectedDate}
        onAddTask={openTaskForm}
        onOpenTask={(task) => setDetailTaskId(task.id)}
      />
    );
  } else if (activeTab === "partner") {
    page = (
      <CoupleConnect
        me={me}
        partner={partner}
        members={members}
        couple={couple}
        activeUser={activeUser}
        manualRequired={manualRequired}
        onRefresh={refresh}
        onConnected={async () => {
          await load();
          showToast("連結完成！歡迎來到你們的星域 ✨");
        }}
        showToast={showToast}
      />
    );
  } else if (activeTab === "shop" && couple) {
    page = <ShopPage couple={couple} activeUser={activeUser} onChanged={refresh} showToast={showToast} />;
  } else if (activeTab === "profile") {
    page = (
      <ProfilePage
        me={me}
        meMember={meMember}
        partner={partner}
        couple={couple}
        tasks={tasks}
        completed={completed}
        stardust={stardust}
        reviewMode={REVIEW_MODE}
        onSwitchUser={(userId) => {
          setLoaded(false);
          setActiveUser(userId);
        }}
        onGoPartner={() => changeTab("partner")}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">跳到主要內容</a>
      <SideRail
        activeTab={activeTab}
        onTabChange={changeTab}
        members={members}
        couple={couple}
        lockedTabs={lockedTabs}
        onLogout={logout}
      />
      <div className="app-column">
        <TopBar members={couple ? members : []} onTabChange={changeTab} />
        <main id="main" className={`page page-${activeTab}`} tabIndex={-1}>
          {error && (
            <div className="banner banner-error" role="alert">
              <span>{error}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>重試</button>
            </div>
          )}
          {page}
        </main>
      </div>
      <BottomNav activeTab={activeTab} onTabChange={changeTab} lockedTabs={lockedTabs} />

      {taskFormDate && couple && (
        <Modal kicker="泡泡" title="新增泡泡" onClose={() => setTaskFormDate(null)}>
          <TaskForm
            members={members}
            activeUser={activeUser}
            coupleId={couple.id}
            defaultDate={taskFormDate}
            onCancel={() => setTaskFormDate(null)}
            onCreated={(task) => {
              setTaskFormDate(null);
              refresh();
              showToast(`「${task.title}」長出來了 🫧`);
            }}
          />
        </Modal>
      )}

      {detailTask && (
        <TaskDetail
          key={detailTask.id}
          task={detailTask}
          members={members}
          activeUser={activeUser}
          onClose={() => setDetailTaskId(null)}
          onComplete={completeTask}
          onDelete={deleteTask}
        />
      )}

      <CompletionRecordModal
        task={completionTask}
        activeUser={activeUser}
        onClose={() => setCompletionTask(null)}
        onSaved={(message) => {
          refresh();
          if (message) showToast(message);
        }}
      />

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
