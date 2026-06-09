import Mascot from "./Mascot.jsx";

export default function Hero({ onAddTask, onSharedView }) {
  return (
    <section className="panel hero-panel">
      <div>
        <div className="eyebrow">Shared Orbit</div>
        <h2 className="hero-title">共享節奏，不互相打擾</h2>
        <p className="hero-copy">
          把雙人的任務、提醒與獎勵放在同一條軌道上。泡泡負責呈現狀態，完成後長按戳破，掉落物件會轉成星塵。
        </p>
        <div className="hero-actions">
          <button className="btn primary" onClick={onAddTask}>新增任務</button>
          <button className="btn" onClick={onSharedView}>共享世界</button>
        </div>
      </div>
      <Mascot />
    </section>
  );
}
