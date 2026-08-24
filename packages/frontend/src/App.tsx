import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Avatar, Space } from "antd";
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

/** 全宽页面：下载队列与 AI 总结的列表/表格占满整屏宽度，不受 max-w-5xl 限制 */
const FULL_WIDTH_PATHS = new Set(["/downloading", "/summary-tasks"]);

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checkLogin = useAuthStore((s) => s.checkLogin);
  const { pathname } = useLocation();
  const isFullWidth = FULL_WIDTH_PATHS.has(pathname);

  useEffect(() => {
    void checkLogin();
  }, [checkLogin]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="text-lg font-bold text-rose-600 hover:text-rose-500 transition-colors"
          >
            Bilibili 下载器
          </Link>
          <nav className="flex items-center gap-3">
            <NavLink to="/downloading" className={navLinkClass}>
              下载队列
            </NavLink>
            <NavLink to="/summary-tasks" className={navLinkClass}>
              AI 总结任务
            </NavLink>
            <NavLink to="/prompts" className={navLinkClass}>
              AI 提示词
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              设置
            </NavLink>
            {!user ? (
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
            )}
          </nav>
        </div>
      </header>
      <main className={`px-4 py-6 ${isFullWidth ? "" : "max-w-5xl mx-auto"}`}>
        <Outlet />
      </main>
    </div>
  );
}
