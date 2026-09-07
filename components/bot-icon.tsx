import { useId } from "react";
import type { BotAvatar } from "../lib/appearance";
import { eyeFitTransform, shapePath } from "../lib/appearance";

/** Existing curious/happy/focused/sleepy paths are unchanged; extra faces are small SVG stand-ins. */
export function Eyes({ expression }: { expression: BotAvatar["expression"] }) {
  if (expression === "happy") {
    return (
      <g className="bot-eyes" fill="none" stroke="#000" strokeLinecap="round" strokeWidth="7">
        <path d="M25 46Q35 35 45 46" />
        <path d="M56 46Q66 35 76 46" />
      </g>
    );
  }
  if (expression === "focused") {
    return (
      <g className="bot-eyes" fill="#000">
        <path d="M24 35L45 39L44 48L25 46Z" />
        <path d="M56 39L77 35L76 46L57 48Z" />
      </g>
    );
  }
  if (expression === "sleepy") {
    return (
      <g className="bot-eyes" fill="none" stroke="#000" strokeLinecap="round" strokeWidth="6">
        <path d="M27 45H44" />
        <path d="M58 45H75" />
      </g>
    );
  }
  if (expression === "neutral") {
    return (
      <g className="bot-eyes" fill="#000">
        <rect x="30" y="34" width="11" height="24" rx="5.5" />
        <rect x="59" y="34" width="11" height="24" rx="5.5" />
      </g>
    );
  }
  if (expression === "surprised") {
    return (
      <g className="bot-eyes" fill="#000">
        <circle cx="35" cy="44" r="10" />
        <circle cx="65" cy="44" r="10" />
      </g>
    );
  }
  if (expression === "excited") {
    return (
      <g className="bot-eyes" fill="#000">
        <ellipse cx="34" cy="40" rx="9" ry="12" transform="rotate(-8 34 40)" />
        <ellipse cx="66" cy="40" rx="9" ry="12" transform="rotate(8 66 40)" />
      </g>
    );
  }
  if (expression === "laughing") {
    return (
      <g className="bot-eyes" fill="none" stroke="#000" strokeLinecap="round" strokeWidth="6">
        <path d="M24 50Q35 36 46 50" />
        <path d="M54 50Q65 36 76 50" />
      </g>
    );
  }
  if (expression === "angry") {
    return (
      <g className="bot-eyes" fill="#000">
        <path d="M22 30L46 40L44 50L23 46Z" />
        <path d="M54 40L78 30L77 46L56 50Z" />
      </g>
    );
  }
  if (expression === "sad") {
    return (
      <g className="bot-eyes" fill="#000">
        <path d="M24 42L45 32L44 46L25 50Z" />
        <path d="M55 32L76 42L75 50L56 46Z" />
      </g>
    );
  }
  if (expression === "scared") {
    return (
      <g className="bot-eyes" fill="#000">
        <circle cx="34" cy="44" r="12" />
        <circle cx="66" cy="44" r="12" />
      </g>
    );
  }
  if (expression === "suspicious") {
    return (
      <g className="bot-eyes" fill="#000">
        <rect x="28" y="34" width="12" height="22" rx="6" />
        <rect x="58" y="42" width="16" height="8" rx="4" />
      </g>
    );
  }
  if (expression === "confused") {
    return (
      <g className="bot-eyes" fill="#000">
        <rect x="28" y="30" width="11" height="26" rx="5.5" transform="rotate(-18 33.5 43)" />
        <rect x="56" y="40" width="18" height="10" rx="5" transform="rotate(14 65 45)" />
      </g>
    );
  }
  if (expression === "proud") {
    return (
      <g className="bot-eyes" fill="#000">
        <ellipse cx="34" cy="36" rx="8" ry="5" transform="rotate(14 34 36)" />
        <ellipse cx="66" cy="36" rx="8" ry="5" transform="rotate(-14 66 36)" />
      </g>
    );
  }
  if (expression === "shy") {
    return (
      <g className="bot-eyes" fill="#000">
        <ellipse cx="30" cy="50" rx="6" ry="8" />
        <ellipse cx="58" cy="50" rx="6" ry="8" />
      </g>
    );
  }
  if (expression === "unimpressed") {
    return (
      <g className="bot-eyes" fill="#000">
        <rect x="22" y="42" width="18" height="6" rx="3" />
        <rect x="52" y="42" width="18" height="6" rx="3" />
      </g>
    );
  }
  return (
    <g className="bot-eyes" fill="#000">
      <rect x="29" y="31" width="13" height="28" rx="6.5" transform="rotate(-14 35.5 45)" />
      <rect x="58" y="29" width="12" height="25" rx="6" transform="rotate(8 64 41.5)" />
    </g>
  );
}

export function BotIcon({
  avatar,
  size = 30,
  label,
  working = false,
  idleVariant = 0,
  selected = false,
}: {
  avatar: BotAvatar;
  size?: number;
  label?: string;
  working?: boolean;
  idleVariant?: number;
  selected?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const path = shapePath(avatar.shape);
  const fit = eyeFitTransform(avatar.shape);
  const eyes = fit
    ? <g transform={fit}><Eyes expression={avatar.expression} /></g>
    : <Eyes expression={avatar.expression} />;
  return (
    <svg
      className={`bot-avatar bot-motion-${avatar.motion} ${working ? "bot-state-working" : `bot-state-idle bot-idle-${idleVariant % 3}`}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-color={avatar.color}
      data-shape={avatar.shape}
      data-expression={avatar.expression}
      data-motion={avatar.motion}
    >
      <circle className="bot-work-ring" cx="50" cy="50" r="47" fill="none" stroke={avatar.color} strokeWidth="2.5" />
      {selected ? (
        <>
          <path d={path} fill={avatar.color} stroke="#0a0a0c" strokeWidth="3.5" strokeLinejoin="round" />
          {eyes}
        </>
      ) : (
        <>
          <mask id={`bot-eyes-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <path d={path} fill="#fff" />
            {eyes}
          </mask>
          <path d={path} fill={avatar.color} mask={`url(#bot-eyes-${id})`} />
        </>
      )}
    </svg>
  );
}
