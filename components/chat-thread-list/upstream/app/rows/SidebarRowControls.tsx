import { type ReactNode } from "react";
import { Button } from "../../ui/components/ui/button.js";
import { Icon, type IconName } from "../../ui/components/ui/icon.js";
import { cn } from "../../ui/lib/utils.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "../../ui/components/ui/coarse-pointer-sizing.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui/components/ui/tooltip.js";
import {
  SIDEBAR_CONTROL_PAIR_GAP_CLASS,
  SIDEBAR_CONTROL_PRIMARY_BUTTON_CLASS,
} from "../../ui/components/ui/sidebar-row-classes.js";

export function SidebarRowControls({
  primaryAction,
  children,
}: {
  primaryAction: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-sidebar-row-controls=""
      className={cn(
        "inline-flex shrink-0 items-center",
        SIDEBAR_CONTROL_PAIR_GAP_CLASS,
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.stopPropagation();
        }
      }}
    >
      {primaryAction}
      {children}
    </span>
  );
}

export function SidebarControlButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          className={SIDEBAR_CONTROL_PRIMARY_BUTTON_CLASS}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            onClick();
          }}
        >
          <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
