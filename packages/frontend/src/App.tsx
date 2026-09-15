import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Avatar, Button, Drawer } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { useAuthStore } from "./stores/auth";

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
  { to: "/downloading", label: "下载队列" },
  { to: "/summary-tasks", label: "AI 总结任务" },
  { to: "/qa", label: "穿搭问答" },
  { to: "/prompts", label: "AI 提示词" },
  { to: "/settings", label: "设置" },
];

/** 全宽页面：下载队列与 AI 总结的列表/表格占满整屏宽度，不受 max-w-5xl 限制 */
const FULL_WIDTH_PATHS = new Set(["/downloading", "/summary-tasks", "/qa"]);

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checkLogin = useAuthStore((s) => s.checkLogin);
  const { pathname } = useLocation();
  const isFullWidth = FULL_WIDTH_PATHS.has(pathname);
  const [navOpen, setNavOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void checkLogin();
  }, [checkLogin]);

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

  const account = !user ? (
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
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            {account}
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
          {NAV_ITEMS.map((item) => (
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
        <div className="mt-4 border-t border-zinc-200 pt-4">{account}</div>
      </Drawer>
      <main className={`px-4 py-6 ${isFullWidth ? "" : "max-w-5xl mx-auto"}`}>
        <Outlet />
      </main>
    </div>
  );
}
