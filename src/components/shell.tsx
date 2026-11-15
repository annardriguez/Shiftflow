"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Clock3,
  BarChart3,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Bell,
  HelpCircle,
  Settings2,
  Sprout,
  ArrowUpRight,
  Menu,
  X,
  Check,
  FlaskConical,
} from "lucide-react";
import { useApp } from "./provider";
import { AuthGate } from "./auth-ui";
import { Modal } from "./ui";
import { AccountMenu, EmployeePortal } from "./workforce-ui";
const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/team", label: "Team", icon: Users },
  { href: "/availability", label: "Availability", icon: Clock3 },
  { href: "/labour", label: "Labour insights", icon: BarChart3 },
  { href: "/requests", label: "Requests", icon: ArrowLeftRight },
  { href: "/employee", label: "Employee portal", icon: Users },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    { data, saving, actor, error, reload } = useApp();
  const [mobile, setMobile] = useState(false),
    [panel, setPanel] = useState<"notifications" | "help" | "location" | null>(
      null,
    );
  const active =
    links.find((l) => l.href === pathname)?.label ?? "Workspace settings";
  if (!actor) return <AuthGate />;
  if (actor.role === "employee") return <EmployeePortal />;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link href="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          shiftflow<span className="brand-period">.</span>
        </Link>
        <button
          className="location-switch"
          onClick={() => setPanel("location")}
        >
          <span className="location-mark">
            <Sprout size={19} />
          </span>
          <span>
            <strong>{actor.tenantName}</strong>
            <small>{data?.restaurant.location ?? "Local workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              href={href}
              key={href}
              className={`nav-item ${pathname === href ? "active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}
              onClick={() => setMobile(false)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Schedule" && <span className="nav-tag">Draft</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <span>
              <FlaskConical size={16} /> A little room to explore
            </span>
            <p>
              Fictional team. Real possibilities.
              <br />
              Make this workspace your own.
            </p>
            <Link href="/settings" onClick={() => setMobile(false)}>
              About this demo <ArrowUpRight size={14} />
            </Link>
          </div>
          <button className="nav-item" onClick={() => setPanel("help")}>
            <HelpCircle size={18} />
            <span>Help & getting started</span>
          </button>
          <Link
            href="/settings"
            className={`nav-item ${pathname === "/settings" ? "active" : ""}`}
            onClick={() => setMobile(false)}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </Link>
          <div className="profile">
            <span className="avatar navy">
              {actor.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <strong>{actor.name}</strong>
              <small>Restaurant manager</small>
            </span>
            <span className="online-dot" />
          </div>
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
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={21} /> : <Menu size={21} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{active}</strong>
          </div>
          <div className="topbar-right">
            <AccountMenu />
            <span className="saved-label">
              <span className={`status-dot ${saving ? "busy" : ""}`} />
              {saving ? "Saving changes" : "Local workspace"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-btn"
              aria-label="View activity notifications"
              onClick={() => setPanel("notifications")}
            >
              <Bell size={18} />
              <span className="notification-indicator" />
            </button>
            <span className="avatar navy small">
              {actor.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="app-footer">
          <span>
            <span className="brand-mark mini">
              <i />
              <i />
              <i />
            </span>{" "}
            A little less admin. A little more flow.
          </span>
          <span>
            Milestone 5 <span>·</span> Fictional data only
          </span>
        </footer>
      </div>
      {panel && (
        <Modal
          title={
            panel === "notifications"
              ? "Workspace activity"
              : panel === "help"
                ? "A calmer way to plan your week"
                : "Your restaurant workspace"
          }
          onClose={() => setPanel(null)}
          description={
            panel === "notifications"
              ? "Local change history. No external notifications are sent."
              : undefined
          }
        >
          {panel === "notifications" ? (
            <div className="activity-list">
              {data?.audit.map((a) => (
                <div key={a.id}>
                  <span className="activity-icon">
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>{a.message}</strong>
                    <small>
                      {new Date(a.at).toLocaleString("en-GB", {
                        timeZone: "Europe/Amsterdam",
                      })}{" "}
                      · Amsterdam time
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : panel === "help" ? (
            <div className="help-content">
              <p>
                Start with your team’s availability, set daily labour targets,
                then build a draft roster in Schedule.
              </p>
              <ol>
                <li>
                  <strong>Meet your team.</strong> Open a profile to edit
                  preferred and maximum hours.
                </li>
                <li>
                  <strong>Confirm availability.</strong> Each person has
                  recurring weekly windows.
                </li>
                <li>
                  <strong>Plan your week.</strong> Add shifts; the server checks
                  every change.
                </li>
                <li>
                  <strong>Review the balance.</strong> Labour insights shows
                  coverage gaps and budget deviations.
                </li>
              </ol>
              <div className="info-box">
                Generate and compare rosters in Schedule. Employees sign in with
                their own accounts; managers approve requests in their assigned
                restaurant. Publishing remains future work. All data stays local
                and Strobbo is not connected.
              </div>
            </div>
          ) : (
            <div className="help-content">
              <div className="location-detail">
                <span className="location-mark">
                  <Sprout size={25} />
                </span>
                <div>
                  <h3>{actor.tenantName}</h3>
                  <p>{data?.restaurant.location} · Fictional location</p>
                </div>
                <Check size={20} />
              </div>
              <p>Europe/Amsterdam · Preparation hours 10:00–23:00</p>
              <div className="info-box">
                Use the Restaurant selector to switch between your assigned
                restaurants. Access and roles are checked separately for each
                restaurant.
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
