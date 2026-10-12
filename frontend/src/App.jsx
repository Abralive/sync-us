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
import WeeklyNotes from "./components/WeeklyNotes.jsx";
import { GATED_TABS } from "./constants.js";
import { dayKey } from "./utils/date.js";
import { clearPendingInvite, readPendingInvite } from "./utils/invite.js";

const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const LOCAL_REVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REVIEW_MODE = LOCAL_REVIEW_HOSTS.has(window.location.hostname) && SEARCH_PARAMS.get("review") === "1";
const AUTH_STORAGE_KEY = "sync-us-auth";
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// How often to ask the server "did anything change?" (a tiny request).
const POLL_PAIRED_MS = 5000;
const POLL_WAITING_MS = 3000;
const NO_LOCKS = new Set();
const EMPTY_SUMMARY = { total: 0, by_user: {} };

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

function withTask(list, task) {
  return list.some((item) => item.id === task.id) ? list.map((item) => (item.id === task.id ? task : item)) : [...list, task];
}

function withoutTask(list, taskId) {
  return list.filter((item) => item.id !== taskId);
}

export default function App() {
  const [activeUser, setActiveUser] = useState(() => readStoredAuth()?.userId || (REVIEW_MODE ? 1 : null));
  const [me, setMe] = useState(null);
  const [couple, setCouple] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [completedSummary, setCompletedSummary] = useState(EMPTY_SUMMARY);
  const [stats, setStats] = useState(null);
  const [manualRequired, setManualRequired] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [taskFormDate, setTaskFormDate] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [editTaskId, setEditTaskId] = useState(null);
  const [completionTask, setCompletionTask] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pendingInvite, setPendingInvite] = useState(() => readPendingInvite());
  // Change fingerprint of the data on screen (週記 reloads its week when it moves) and the
  // number of meetup invitations waiting for my answer (dot on 週記).
  const [dataVersion, setDataVersion] = useState("");
  const [plannerPending, setPlannerPending] = useState(0);
  const [shopFrom, setShopFrom] = useState("home");
  const loadSeq = useRef(0);
  const versionRef = useRef("");
  const mutating = useRef(0);
  const activeUserRef = useRef(activeUser);
  activeUserRef.current = activeUser;

  const isAuthenticated = Boolean(activeUser);
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  const showToast = useCallback((message, tone = "info", action = null) => {
    setToast({ message, tone, action, id: Date.now() + Math.random() });
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
  const editTask = tasks.find((task) => task.id === editTaskId) || null;

  // Nothing from the previous account may linger: an undo toast or an open sheet would
  // otherwise act (and show titles) under the next account on the same device.
  const resetSession = useCallback(() => {
    loadSeq.current += 1; // any load still in flight must not apply to the next account
    mutating.current = 0;
    versionRef.current = "";
    setMe(null);
    setCouple(null);
    setTasks([]);
    setCompletedSummary(EMPTY_SUMMARY);
    setStats(null);
    setToast(null);
    setCompletionTask(null);
    setDetailTaskId(null);
    setEditTaskId(null);
    setTaskFormDate(null);
    setError("");
    setLoaded(false);
    setActiveTab("home");
    setDataVersion("");
    setPlannerPending(0);
  }, []);

  const logout = useCallback(() => {
    activeUserRef.current = null;
    clearStoredAuth();
    resetSession();
    setActiveUser(null);
  }, [resetSession]);

  // A change made here shows up at once; loads that started before it finishes are
  // discarded, and one fresh load runs after it so both screens agree again.
  const beginMutation = useCallback(() => {
    mutating.current += 1;
    loadSeq.current += 1;
  }, []);
  const endMutation = useCallback(() => {
    mutating.current = Math.max(0, mutating.current - 1);
    if (mutating.current === 0) refresh();
  }, [refresh]);

  async function load() {
    const userId = Number(activeUser);
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current || Number(activeUserRef.current) !== userId;

    let data;
    try {
      // The phone's date decides which meetup invitations still count for the 週記 badge.
      data = await request(`/bootstrap?user_id=${userId}&today=${dayKey(new Date())}`);
    } catch (err) {
      if (stale()) return;
      if (err.code === "user_not_found") {
        // The stored account no longer exists (for example after a database reset).
        // Other 404s (e.g. a server still running the previous version) must not sign out.
        logout();
        return;
      }
      if (err.status === 0) setOffline(true);
      // With data already on screen a short outage only needs the offline banner.
      if (!loaded || err.status !== 0) setError(err.message);
      setLoaded(true);
      return;
    }
    if (stale() || mutating.current > 0) return;

    versionRef.current = data.version;
    setDataVersion(data.version || "");
    setMe(data.user);
    setCouple(data.couple);
    setTasks(data.tasks || []);
    setStats(data.stats);
    setCompletedSummary(data.completed_summary || EMPTY_SUMMARY);
    setPlannerPending(Number(data.planner_pending) || 0);
    if (!data.couple) {
      setManualRequired(false);
      setActiveTab((tab) => (GATED_TABS.has(tab) ? "partner" : tab));
    } else {
      const needsManual = !REVIEW_MODE && Number(data.manual_count) === 0;
      setManualRequired(needsManual);
      if (needsManual) setActiveTab((tab) => (GATED_TABS.has(tab) ? "partner" : tab));
      if (pendingInvite) {
        clearPendingInvite();
        setPendingInvite("");
      }
    }
    setError("");
    setOffline(false);
    setLoaded(true);
    if (!REVIEW_MODE) writeStoredAuth(userId);
  }

  useEffect(() => {
    if (isAuthenticated) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser, refreshTick]);

  // Poll the tiny /version fingerprint and reload only when something changed —
  // the partner's new bubbles appear within a few seconds without reloading everything.
  const coupleId = couple?.id || 0;
  useEffect(() => {
    if (!isAuthenticated || !loaded) return undefined;
    let cancelled = false;
    let busy = false;

    async function check() {
      if (busy || cancelled || document.visibilityState !== "visible" || mutating.current > 0) return;
      busy = true;
      try {
        const result = await request(`/version?user_id=${activeUser}`, { timeout: 6000 });
        if (cancelled) return;
        setOffline(false);
        if (result.version !== versionRef.current) refresh();
      } catch (err) {
        if (cancelled) return;
        if (err.code === "user_not_found") logout();
        else if (err.status === 0) setOffline(true);
      } finally {
        busy = false;
      }
    }

    const timer = window.setInterval(check, coupleId ? POLL_PAIRED_MS : POLL_WAITING_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthenticated, loaded, coupleId, activeUser, refresh, logout]);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    window.addEventListener("offline", goOffline);
    return () => window.removeEventListener("offline", goOffline);
  }, []);

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

  function openShop() {
    setShopFrom(activeTab === "shop" ? shopFrom : activeTab);
    changeTab("shop");
  }

  function postJson(path, body) {
    return request(path, { method: "POST", body: JSON.stringify(body) });
  }

  function stillSameUser(userId) {
    return Number(activeUserRef.current) === userId;
  }

  function announceCompleted(done) {
    const dust = Number(done?.stardust_awarded) || 0;
    const label = done?.is_private ? "私人泡泡完成了" : "泡泡完成了";
    showToast(dust > 0 ? `${label}，+${dust} 星塵 ✨` : `${label} ✨`, "info", {
      label: "復原",
      onClick: () => undoComplete(done),
    });
    if (done && !done.is_private) setCompletionTask(done);
  }

  // Detail sheet "完成" button: the bubble leaves the screen immediately.
  async function completeTask(task) {
    const userId = Number(activeUser);
    beginMutation();
    setDetailTaskId(null);
    setTasks((list) => withoutTask(list, task.id));
    try {
      const done = await postJson(`/tasks/${task.id}/complete`, { user_id: userId });
      if (stillSameUser(userId)) announceCompleted(done);
    } catch (err) {
      if (stillSameUser(userId)) {
        setTasks((list) => withTask(list, task));
        showToast(err.message, "error");
      }
    } finally {
      endMutation();
    }
  }

  // Long-press pop in the starfield: the request runs during the pop animation, and the
  // bubble is removed once the stardust has finished falling.
  async function popTask(task, animationDone) {
    const userId = Number(activeUser);
    beginMutation();
    try {
      const done = await postJson(`/tasks/${task.id}/complete`, { user_id: userId });
      await animationDone;
      if (!stillSameUser(userId)) return;
      setTasks((list) => withoutTask(list, task.id));
      announceCompleted(done);
    } catch (err) {
      if (stillSameUser(userId)) showToast(err.message || "完成失敗，請再試一次。", "error");
      throw err;
    } finally {
      endMutation();
    }
  }

  async function undoComplete(done) {
    const userId = Number(activeUser);
    beginMutation();
    setCompletionTask((current) => (current?.id === done.id ? null : current));
    try {
      const reopened = await postJson(`/tasks/${done.id}/reopen`, { user_id: userId });
      if (!stillSameUser(userId)) return;
      setTasks((list) => withTask(list, reopened));
      showToast(`「${reopened.title}」回到星域了`);
    } catch (err) {
      if (stillSameUser(userId)) showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  async function deleteTask(task) {
    const userId = Number(activeUser);
    beginMutation();
    setDetailTaskId(null);
    setTasks((list) => withoutTask(list, task.id));
    try {
      await request(`/tasks/${task.id}?user_id=${userId}`, { method: "DELETE" });
      if (stillSameUser(userId)) {
        showToast(`已刪除「${task.title}」`, "info", { label: "復原", onClick: () => restoreTask(task) });
      }
    } catch (err) {
      if (stillSameUser(userId)) {
        setTasks((list) => withTask(list, task));
        showToast(err.message, "error");
      }
    } finally {
      endMutation();
    }
  }

  async function restoreTask(task) {
    const userId = Number(activeUser);
    beginMutation();
    try {
      const restored = await postJson(`/tasks/${task.id}/restore`, { user_id: userId });
      if (!stillSameUser(userId)) return;
      setTasks((list) => withTask(list, restored));
      showToast(`「${restored.title}」回來了`);
    } catch (err) {
      if (stillSameUser(userId)) showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  function handleSaved(task, message) {
    setTasks((list) => withTask(list, task));
    showToast(message);
    refresh();
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        pendingInvite={pendingInvite}
        onAuthenticated={(user) => {
          writeStoredAuth(user.id);
          setLoaded(false);
          setActiveTab(pendingInvite ? "partner" : "home");
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
        onPopTask={popTask}
        onOpenDate={(date) => {
          setSelectedDate(date);
          changeTab("tasks");
        }}
        onSeeAll={() => changeTab("tasks")}
        onOpenShop={openShop}
      />
    );
  } else if (activeTab === "planner" && couple) {
    page = (
      <WeeklyNotes
        activeUser={activeUser}
        members={members}
        version={dataVersion}
        showToast={showToast}
        onChanged={refresh}
        onGoPartner={() => changeTab("partner")}
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
        pendingInvite={pendingInvite}
        onInviteHandled={() => {
          clearPendingInvite();
          setPendingInvite("");
        }}
        onRefresh={refresh}
        onConnected={async () => {
          clearPendingInvite();
          setPendingInvite("");
          await load();
          showToast("連結完成！歡迎來到你們的星域 ✨");
        }}
        showToast={showToast}
      />
    );
  } else if (activeTab === "shop" && couple) {
    page = (
      <ShopPage
        couple={couple}
        activeUser={activeUser}
        onChanged={refresh}
        showToast={showToast}
        backLabel={shopFrom === "profile" ? "回到我的" : "回到星域"}
        onBack={() => changeTab(shopFrom === "profile" ? "profile" : "home")}
      />
    );
  } else if (activeTab === "profile") {
    page = (
      <ProfilePage
        me={me}
        meMember={meMember}
        partner={partner}
        couple={couple}
        tasks={tasks}
        completedSummary={completedSummary}
        stardust={stardust}
        reviewMode={REVIEW_MODE}
        onSwitchUser={(userId) => {
          resetSession();
          setActiveUser(userId);
        }}
        onGoPartner={() => changeTab("partner")}
        onOpenShop={couple ? openShop : null}
        onLogout={logout}
      />
    );
  }

  const navBadges = { planner: plannerPending };

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
        badges={navBadges}
      />
      <div className="app-column">
        <TopBar members={couple ? members : []} onTabChange={changeTab} />
        <main id="main" className={`page page-${activeTab}`} tabIndex={-1}>
          {offline && (
            <div className="banner banner-offline" role="status">
              <span>目前連不上 Sync-Us，恢復連線後會自動更新。</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>重試</button>
            </div>
          )}
          {error && !offline && (
            <div className="banner banner-error" role="alert">
              <span>{error}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>重試</button>
            </div>
          )}
          {page}
        </main>
      </div>
      <BottomNav activeTab={activeTab} onTabChange={changeTab} lockedTabs={lockedTabs} badges={navBadges} />

      {taskFormDate && couple && (
        <Modal kicker="泡泡" title="新增泡泡" onClose={() => setTaskFormDate(null)}>
          <TaskForm
            members={members}
            activeUser={activeUser}
            coupleId={couple.id}
            defaultDate={taskFormDate}
            onCancel={() => setTaskFormDate(null)}
            onSaved={(task) => {
              setTaskFormDate(null);
              handleSaved(task, `「${task.title}」長出來了 🫧`);
            }}
          />
        </Modal>
      )}

      {editTask && couple && (
        <Modal kicker="泡泡" title="編輯泡泡" onClose={() => setEditTaskId(null)}>
          <TaskForm
            task={editTask}
            members={members}
            activeUser={activeUser}
            coupleId={couple.id}
            onCancel={() => setEditTaskId(null)}
            onSaved={(task) => {
              setEditTaskId(null);
              handleSaved(task, `已更新「${task.title}」`);
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
          onEdit={(task) => {
            setDetailTaskId(null);
            setEditTaskId(task.id);
          }}
          onDelete={deleteTask}
        />
      )}

      <CompletionRecordModal
        task={completionTask}
        activeUser={activeUser}
        onClose={() => setCompletionTask(null)}
        onUndo={(task) => undoComplete(task)}
        onSaved={(message) => {
          refresh();
          if (message) showToast(message);
        }}
      />

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
