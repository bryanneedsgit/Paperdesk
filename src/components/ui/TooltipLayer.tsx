import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipPlacement = 'bottom' | 'left' | 'right' | 'top';

type TooltipState = {
  placement: TooltipPlacement | null;
  rect: DOMRect;
  text: string;
};

type TooltipPosition = {
  left: number;
  placement: TooltipPlacement;
  top: number;
};

const tooltipOffset = 8;
const viewportPadding = 8;
const edgePlacementThreshold = 170;

function getTooltipTrigger(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const trigger = target.closest<HTMLElement>('[data-tooltip]');

  if (
    !trigger ||
    trigger.matches(':disabled') ||
    trigger.getAttribute('aria-disabled') === 'true'
  ) {
    return null;
  }

  const tooltip = trigger.dataset.tooltip?.trim();

  return tooltip ? trigger : null;
}

function getRequestedPlacement(trigger: HTMLElement): TooltipPlacement | null {
  const placement = trigger.dataset.tooltipPlacement;

  return placement === 'bottom' ||
    placement === 'left' ||
    placement === 'right' ||
    placement === 'top'
    ? placement
    : null;
}

function getDefaultPlacement(rect: DOMRect): TooltipPlacement {
  if (window.innerWidth - rect.right < edgePlacementThreshold) {
    return 'left';
  }

  if (rect.left < edgePlacementThreshold) {
    return 'right';
  }

  return 'bottom';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeTooltipPosition(
  rect: DOMRect,
  tooltipRect: DOMRect,
  requestedPlacement: TooltipPlacement | null,
): TooltipPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = tooltipRect.width;
  const height = tooltipRect.height;
  let placement = requestedPlacement ?? getDefaultPlacement(rect);
  let left = 0;
  let top = 0;

  const place = () => {
    if (placement === 'top') {
      left = rect.left + rect.width / 2 - width / 2;
      top = rect.top - height - tooltipOffset;
    } else if (placement === 'left') {
      left = rect.left - width - tooltipOffset;
      top = rect.top + rect.height / 2 - height / 2;
    } else if (placement === 'right') {
      left = rect.right + tooltipOffset;
      top = rect.top + rect.height / 2 - height / 2;
    } else {
      left = rect.left + rect.width / 2 - width / 2;
      top = rect.bottom + tooltipOffset;
    }
  };

  place();

  if (placement === 'bottom' && top + height > viewportHeight - viewportPadding) {
    placement = 'top';
    place();
  } else if (placement === 'top' && top < viewportPadding) {
    placement = 'bottom';
    place();
  } else if (placement === 'left' && left < viewportPadding) {
    placement = 'right';
    place();
  } else if (placement === 'right' && left + width > viewportWidth - viewportPadding) {
    placement = 'left';
    place();
  }

  return {
    left: clamp(
      left,
      viewportPadding,
      Math.max(viewportPadding, viewportWidth - width - viewportPadding),
    ),
    placement,
    top: clamp(
      top,
      viewportPadding,
      Math.max(viewportPadding, viewportHeight - height - viewportPadding),
    ),
  };
}

export function TooltipLayer() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    const showTooltip = (trigger: HTMLElement) => {
      activeTriggerRef.current = trigger;
      setTooltipState({
        placement: getRequestedPlacement(trigger),
        rect: trigger.getBoundingClientRect(),
        text: trigger.dataset.tooltip?.trim() ?? '',
      });
    };

    const hideTooltip = (trigger: HTMLElement | null = activeTriggerRef.current) => {
      if (trigger && trigger !== activeTriggerRef.current) {
        return;
      }

      activeTriggerRef.current = null;
      setTooltipState(null);
      setPosition(null);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const trigger = getTooltipTrigger(event.target);

      if (trigger) {
        showTooltip(trigger);
      }
    };

    const handlePointerOut = (event: PointerEvent) => {
      const trigger = activeTriggerRef.current;

      if (!trigger) {
        return;
      }

      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && trigger.contains(relatedTarget)) {
        return;
      }

      hideTooltip(trigger);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const trigger = getTooltipTrigger(event.target);

      if (trigger) {
        showTooltip(trigger);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const trigger = activeTriggerRef.current;

      if (!trigger) {
        return;
      }

      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && trigger.contains(relatedTarget)) {
        return;
      }

      hideTooltip(trigger);
    };

    const refreshTooltipPosition = () => {
      const trigger = activeTriggerRef.current;

      if (!trigger) {
        return;
      }

      setTooltipState((currentState) =>
        currentState
          ? {
              ...currentState,
              rect: trigger.getBoundingClientRect(),
            }
          : currentState,
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', refreshTooltipPosition);
    window.addEventListener('scroll', refreshTooltipPosition, true);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', refreshTooltipPosition);
      window.removeEventListener('scroll', refreshTooltipPosition, true);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltipElement = tooltipRef.current;

    if (!tooltipState || !tooltipElement) {
      return;
    }

    setPosition(
      computeTooltipPosition(
        tooltipState.rect,
        tooltipElement.getBoundingClientRect(),
        tooltipState.placement,
      ),
    );
  }, [tooltipState]);

  if (!tooltipState) {
    return null;
  }

  return createPortal(
    <div
      className="app-tooltip"
      data-placement={position?.placement ?? tooltipState.placement ?? 'bottom'}
      ref={tooltipRef}
      role="tooltip"
      style={{
        left: `${position?.left ?? -9999}px`,
        top: `${position?.top ?? -9999}px`,
      }}
    >
      {tooltipState.text}
    </div>,
    document.body,
  );
}
