import { useEffect } from "react";
import { Link, NavLink, Outlet } from "react-router";
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

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checkLogin = useAuthStore((s) => s.checkLogin);

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
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
