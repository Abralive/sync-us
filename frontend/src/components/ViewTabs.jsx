import { VIEWS } from "../constants.js";

export default function ViewTabs({ view, onViewChange }) {
  return (
    <div className="view-tabs">
      {Object.entries(VIEWS).map(([key, label]) => (
        <button
          key={key}
          className={`tab-btn ${view === key ? "active" : ""}`}
          onClick={() => onViewChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
