/** @vitest-environment jsdom */

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Topbar, { formatTopbarDate } from "./Topbar";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    priority: _priority,
    alt,
    ...props
  }: React.ComponentProps<"img"> & { priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

vi.mock("@/components/shell/TopsConnectButton", () => ({
  TopsConnectButton: () => <button type="button">Connect</button>,
}));

vi.mock("@/components/shell/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock("@/components/shell/NotificationsBell", () => ({
  NotificationsBell: () => <button type="button">Notificaciones</button>,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BEFORE_MIDNIGHT_BA = "2026-08-15T02:59:59.999Z";
const AFTER_MIDNIGHT_BA = "2026-08-15T03:00:00.001Z";

function renderTopbar(initialNowIso: string) {
  return <Topbar initialNowIso={initialNowIso} onMenuClick={() => undefined} />;
}

describe("Topbar hydration date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routerPush.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("formats the serialized instant in the Buenos Aires calendar day", () => {
    expect(formatTopbarDate(new Date(BEFORE_MIDNIGHT_BA))).toBe("viernes, 14 de agosto");
    expect(formatTopbarDate(new Date(AFTER_MIDNIGHT_BA))).toBe("sábado, 15 de agosto");
  });

  it("hydrates the real Topbar across midnight and updates only after mounting", async () => {
    const initialNowIso = BEFORE_MIDNIGHT_BA;
    const recoverableErrors: unknown[] = [];
    const container = document.createElement("div");
    window.history.replaceState({}, "", "/copilot");
    document.body.appendChild(container);
    let root: Root | undefined;

    vi.setSystemTime(new Date(BEFORE_MIDNIGHT_BA));
    const serverHtml = renderToString(renderTopbar(initialNowIso));
    container.innerHTML = serverHtml;
    expect(window.location.pathname).toBe("/copilot");
    expect(container.textContent).toContain("viernes, 14 de agosto");

    vi.setSystemTime(new Date(AFTER_MIDNIGHT_BA));
    const clientFirstRenderHtml = renderToString(renderTopbar(initialNowIso));
    expect(clientFirstRenderHtml).toBe(serverHtml);

    await act(async () => {
      root = hydrateRoot(container, renderTopbar(initialNowIso), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toContain("sábado, 15 de agosto");
    expect(recoverableErrors.map(String).join(" ")).not.toMatch(
      /Minified React error #(425|422)|hydration|server HTML/i,
    );

    window.history.pushState({}, "", "/connect");
    await act(async () => {
      root?.render(renderTopbar(initialNowIso));
    });
    expect(container.textContent).toContain("sábado, 15 de agosto");
    expect(window.location.pathname).toBe("/connect");
    expect(recoverableErrors).toEqual([]);

    await act(async () => root?.unmount());
  });
});
