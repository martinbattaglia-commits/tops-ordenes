"use client";

import { useState, useEffect } from "react";
import { initialsFrom } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  initials?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | number;
  className?: string;
  alt?: string;
}

const SIZE_CLASSES = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-base",
};

export function Avatar({
  src,
  name,
  initials,
  size = "sm",
  className,
  alt,
}: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const resolvedInitials = initials || initialsFrom(name);
  const sizeClass = typeof size === "string" ? SIZE_CLASSES[size] ?? SIZE_CLASSES.sm : "";
  const customStyle = typeof size === "number" ? { width: size, height: size, fontSize: Math.max(9, Math.floor(size * 0.4)) } : undefined;

  const validSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;

  if (validSrc && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={validSrc}
        alt={alt ?? name ?? "Avatar"}
        onError={() => setImgError(true)}
        style={customStyle}
        className={cn(
          "shrink-0 rounded-full border border-stroke-soft object-cover",
          sizeClass,
          className,
        )}
      />
    );
  }

  return (
    <div
      style={customStyle}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-bg-surface-alt font-bold text-fg-secondary uppercase select-none border border-stroke-soft",
        sizeClass,
        className,
      )}
      aria-label={alt ?? name ?? "Avatar"}
    >
      {resolvedInitials}
    </div>
  );
}
