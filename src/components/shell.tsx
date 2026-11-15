"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  CalendarDays,
  Users,
  Clock3,
  BarChart3,
  ArrowLeftRight,
  Bell,
  Settings2,
  Sparkles,
  Menu,
  X,
  FlaskConical,
  ChevronRight,
  BellOff,
} from "lucide-react";
import { useApp } from "./provider";
import { AuthGate, AccountMenu } from "./auth-ui";
import { Brand, EmptyState } from "./ui";
import { EmployeePortal } from "./workforce-ui";
import { api, useManagerFeed } from "@/lib/client-api";
import { notificationText } from "@/lib/swap-insights";
import { notificationFor } from "@/lib/workforce-types";
import { relativeTime } from "@/lib/format";

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  badge?: "swaps";
};
const groups: { label: string; links: NavLink[] }[] = [
  {
    label: "Operations",
    links: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      {
        href: "/requests",
        label: "Swap Centre",
        icon: ArrowLeftRight,
        badge: "swaps",
      },
    ],
  },
  {
    label: "People",
    links: [
      { href: "/team", label: "Team", icon: Users },
      { href: "/availability", label: "Availability", icon: Clock3 },
    ],
  },
  {
    label: "Planning",
    links: [
      { href: "/intelligence", label: "Schedule Intelligence", icon: Sparkles },
      { href: "/labour", label: "Labour & coverage", icon: BarChart3 },
    ],
  },
];
const allLinks = [
  ...groups.flatMap((g) => g.links),
  { href: "/settings", label: "Settings", icon: Settings2 },
  { href: "/employee", label: "Team access", icon: Users },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    { data, saving, actor } = useApp();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setMobile(false);
  }, [pathname]);
  if (!actor) return <AuthGate />;
  if (actor.role === "employee") return <EmployeePortal />;
  const active = allLinks.find((l) => l.href === pathname)?.label ?? "";
  const awaiting = (data?.requests ?? []).filter(
    (r) => r.status === "pending-manager",
  ).length;
  const restaurant = (actor.tenantName ?? "").split("·")[0].trim();
  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${mobile ? "is-open" : ""}`}
        aria-label="Primary"
      >
        <Link href="/" className="brand-link" aria-label="ShiftFlow overview">
          <Brand />
        </Link>
        <div className="workspace-switch" title={actor.tenantName}>
          <span className="ws-mark">{restaurant[0] ?? "S"}</span>
          <span>
            <strong>{restaurant}</strong>
            <small>{data?.restaurant.location ?? "Restaurant"}</small>
          </span>
        </div>
        <nav aria-label="Main navigation">
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.links.map(({ href, label, icon: Icon, badge }) => (
                <Link
                  href={href}
                  key={href}
                  className={`nav-item ${pathname === href ? "active" : ""}`}
                  aria-current={pathname === href ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {badge === "swaps" && awaiting > 0 && (
                    <span
                      className="count accent"
                      aria-label={`${awaiting} awaiting approval`}
                    >
                      {awaiting}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="data-note">
            <FlaskConical size={14} />
            <span>
              <strong>Demo data.</strong> A fictional team. Changes are saved
              in ShiftFlow only. No external scheduling system is connected.
            </span>
          </div>
          <Link
            href="/settings"
            className={`nav-item ${pathname === "/settings" ? "active" : ""}`}
            aria-current={pathname === "/settings" ? "page" : undefined}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </Link>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label={mobile ? "Close navigation" : "Open navigation"}
              aria-expanded={mobile}
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={19} /> : <Menu size={19} />}
            </button>
            <span>{restaurant}</span>
            <ChevronRight size={13} />
            <strong>{active}</strong>
          </div>
          <div className="topbar-right">
            <span className="save-state" aria-live="polite">
              <span className={`status-dot ${saving ? "busy" : ""}`} />
              {saving ? "Saving…" : "All changes saved"}
            </span>
            <Notifications />
            <AccountMenu />
          </div>
        </header>
        <main className="page" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}

function Notifications() {
  const { actor, data } = useApp();
  const [open, setOpen] = useState(false),
    [version, setVersion] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const { feed, load } = useManagerFeed(true, version);
  // Refresh when the workspace revision changes (an approval elsewhere, etc).
  useEffect(() => {
    setVersion((v) => v + 1);
  }, [data?.revision]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!actor) return null;
  const list = (feed?.notifications ?? []).filter((n) =>
    notificationFor(n, actor),
  );
  const unread = list.filter((n) => !n.readBy.includes(actor.id));
  async function markAll() {
    await Promise.allSettled(
      unread.map((n) =>
        api("/api/workforce", { action: "read-notification", id: n.id }),
      ),
    );
    load();
  }
  return (
    <div className="user-menu" ref={ref}>
      <button
        className="icon-btn"
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={18} />
        {unread.length > 0 && <span className="dot" />}
      </button>
      {open && (
        <div className="popover" style={{ width: 360 }}>
          <div
            className="popover-section"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong>Notifications</strong>
            {unread.length > 0 && (
              <button className="text-link" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <div
            className="popover-section"
            style={{ maxHeight: 380, overflow: "auto", paddingTop: 0 }}
          >
            {!list.length ? (
              <EmptyState icon={<BellOff size={18} />} title="Nothing new">
                Swap and request updates will show up here.
              </EmptyState>
            ) : (
              list.slice(0, 25).map((n) => (
                <Link
                  href="/requests"
                  key={n.id}
                  className="notif-item"
                  onClick={() => setOpen(false)}
                >
                  <span
                    className={`unread-dot ${n.readBy.includes(actor.id) ? "read" : ""}`}
                  />
                  <span>
                    {notificationText(
                      n.message,
                      feed?.requests.find((r) => r.id === n.requestId),
                      feed?.names ?? {},
                    )}
                    <small>{relativeTime(n.at)}</small>
                  </span>
                </Link>
              ))
            )}
          </div>
          <div className="popover-section sync-note">
            In-app only. No emails or messages are sent.
          </div>
        </div>
      )}
    </div>
  );
}
