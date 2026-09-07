import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AVATAR_COLORS,
  AVATAR_COLOR_LABELS,
  AVATAR_EXPRESSIONS,
  AVATAR_MOTIONS,
  AVATAR_SHAPES,
  randomAvatar,
  type BotAvatar,
} from "../lib/appearance";
import { BotIcon } from "./bot-icon";

const CATEGORIES = [
  { id: "color", label: "Color" },
  { id: "shape", label: "Shape" },
  { id: "expression", label: "Expression" },
  { id: "motion", label: "Motion" },
] as const;

type Category = (typeof CATEGORIES)[number]["id"];

export function AvatarAppearance({ avatar, onChange }: { avatar: BotAvatar; onChange: (avatar: BotAvatar) => void }) {
  const [category, setCategory] = useState<Category>("expression");
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div role="group" aria-label="Appearance category" className="flex min-w-0 flex-wrap gap-1">
          {CATEGORIES.map((entry) => (
            <Button key={entry.id} type="button" variant="ghost" size="sm" className="h-7 px-2" aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>
              {entry.label}
            </Button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0" onClick={() => onChange(randomAvatar())}>
          Randomize appearance
        </Button>
      </div>
      {category === "color" ? (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Color</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <Tooltip key={color}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="size-6 rounded-full border-2 border-background ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-foreground"
                    style={{ background: color }}
                    aria-label={color}
                    aria-pressed={avatar.color === color}
                    onClick={() => onChange({ ...avatar, color })}
                  />
                </TooltipTrigger>
                <TooltipContent>{AVATAR_COLOR_LABELS[color]}</TooltipContent>
              </Tooltip>
            ))}
            <input type="color" className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Custom color" value={avatar.color} onChange={(event) => onChange({ ...avatar, color: event.target.value })} />
          </div>
        </fieldset>
      ) : null}
      {category === "shape" ? (
        <div role="group" aria-label="Shape" className="grid grid-cols-4 gap-1">
          {AVATAR_SHAPES.map((option) => (
            <Tooltip key={option.id}>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-full [&_svg]:size-8" aria-label={option.label} aria-pressed={avatar.shape === option.id} onClick={() => onChange({ ...avatar, shape: option.id })}>
                  <BotIcon avatar={{ ...avatar, shape: option.id, motion: "still" }} size={32} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {category === "expression" ? (
        <div role="group" aria-label="Expression" className="grid grid-cols-4 gap-1">
          {AVATAR_EXPRESSIONS.map((option) => (
            <Tooltip key={option.id}>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-full [&_svg]:size-8" aria-label={option.label} aria-pressed={avatar.expression === option.id} onClick={() => onChange({ ...avatar, expression: option.id })}>
                  <BotIcon avatar={{ ...avatar, expression: option.id, motion: "still" }} size={32} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {category === "motion" ? (
        <div role="group" aria-label="Motion" className="flex flex-wrap gap-1">
          {AVATAR_MOTIONS.map((option) => (
            <Button key={option.id} type="button" variant="ghost" size="sm" className="h-7" aria-pressed={avatar.motion === option.id} onClick={() => onChange({ ...avatar, motion: option.id })}>
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
