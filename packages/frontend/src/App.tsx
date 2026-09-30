import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { Avatar, Button, Drawer, Spin } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { useAuthStore } from "./stores/auth";
import { isAdmin, useSessionStore } from "./stores/session";

function imageSrc(url?: string): string {
  if (!url) return "";
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `px-3 py-1.5 rounded-md text-sm transition-colors ${
    isActive
      ? "text-rose-600 bg-rose-50"
      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
  }`;
}

function drawerLinkClass({ isActive }: { isActive: boolean }): string {
  return `px-3 py-2 rounded-md text-sm ${
    isActive
      ? "text-rose-600 bg-rose-50"
      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
  }`;
}

const NAV_ITEMS = [
  { to: "/downloading", label: "下载队列", adminOnly: true },
  { to: "/summary-tasks", label: "AI 总结任务", adminOnly: true },
  { to: "/qa", label: "穿搭问答", adminOnly: false },
  { to: "/prompts", label: "AI 提示词", adminOnly: true },
  { to: "/settings", label: "设置", adminOnly: true },
  { to: "/users", label: "用户管理", adminOnly: true },
];

const SIGN_IN_PATH = "/sign-in";

/** 普通 user 可访问：QA 与来源视频"AI 总结"整页 */
function isUserAllowedPath(pathname: string): boolean {
  return pathname === "/qa" || pathname.startsWith("/summary/");
}

/** 全宽页面：下载队列与 AI 总结的列表/表格占满整屏宽度，不受 max-w-5xl 限制 */
const FULL_WIDTH_PATHS = new Set(["/downloading", "/summary-tasks", "/qa"]);

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checkLogin = useAuthStore((s) => s.checkLogin);
  const sessionUser = useSessionStore((s) => s.user);
  const sessionStatus = useSessionStore((s) => s.status);
  const fetchMe = useSessionStore((s) => s.fetchMe);
  const signOut = useSessionStore((s) => s.logout);
  const { pathname } = useLocation();
  const isFullWidth = FULL_WIDTH_PATHS.has(pathname);
  const [navOpen, setNavOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  // B站 账号信息仅管理员需要
  useEffect(() => {
    if (isAdmin(sessionUser)) void checkLogin();
  }, [checkLogin, sessionUser]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      document.documentElement.style.setProperty(
        "--app-header-h",
        `${el.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const measure = () => {
      const height = viewport ? viewport.height : window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${height}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, []);

  if (sessionStatus === "unknown") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-50">
        <Spin />
      </div>
    );
  }

  if (sessionStatus === "anonymous") {
    if (pathname === SIGN_IN_PATH) {
      return (
        <div className="min-h-dvh bg-zinc-50 px-4 text-zinc-900">
          <Outlet />
        </div>
      );
    }
    return (
      <Navigate to={SIGN_IN_PATH} state={{ from: pathname }} replace />
    );
  }

  const admin = isAdmin(sessionUser);

  if (pathname === SIGN_IN_PATH) {
    return <Navigate to={admin ? "/" : "/qa"} replace />;
  }
  if (!admin && !isUserAllowedPath(pathname)) {
    return <Navigate to="/qa" replace />;
  }

  const navItems = NAV_ITEMS.filter((item) => admin || !item.adminOnly);

  const sessionAccount = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-zinc-600">{sessionUser?.username}</span>
      <Button
        type="text"
        size="small"
        onClick={() => {
          void signOut();
        }}
      >
        退出
      </Button>
    </div>
  );

  const biliAccount = !user ? (
    <NavLink to="/login" className={navLinkClass}>
      登录
    </NavLink>
  ) : (
    <NavLink to="/login" className="flex items-center gap-2 hover:opacity-80">
      <Avatar
        size={28}
        src={imageSrc(user.face)}
        alt={user.name}
        className="border border-zinc-200"
      />
      <span className="text-sm text-zinc-600">{user.name}</span>
    </NavLink>
  );

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header
        ref={headerRef}
        className="border-b border-zinc-200 bg-white/80 backdrop-blur pt-safe"
      >
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="text-lg font-bold text-rose-600 hover:text-rose-500 transition-colors"
          >
            Bilibili 下载器
          </Link>
          <nav className="hidden md:flex items-center gap-3">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            {admin && biliAccount}
            {sessionAccount}
          </nav>
          <Button
            className="md:hidden"
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航"
            onClick={() => setNavOpen(true)}
          />
        </div>
      </header>
      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        placement="right"
        width={260}
        title="导航"
      >
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setNavOpen(false)}
              className={drawerLinkClass}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4">
          {admin && biliAccount}
          {sessionAccount}
        </div>
      </Drawer>
      <main className={`px-4 py-6 ${isFullWidth ? "" : "max-w-5xl mx-auto"}`}>
        <Outlet />
      </main>
    </div>
  );
}
