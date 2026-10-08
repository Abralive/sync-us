import { initialOf } from "../constants.js";

export default function Avatar({ name, tone = 1, size = "md", active = false, label }) {
  return (
    <span
      className={`avatar avatar-tone-${tone} avatar-${size}${active ? " is-active" : ""}`}
      title={label || name}
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {initialOf(name)}
    </span>
  );
}

export function AvatarPair({ members, size = "sm" }) {
  return (
    <span className="avatar-pair" aria-hidden="true">
      {members.slice(0, 2).map((member) => (
        <Avatar key={member.id} name={member.username} tone={member.tone} size={size} />
      ))}
    </span>
  );
}
