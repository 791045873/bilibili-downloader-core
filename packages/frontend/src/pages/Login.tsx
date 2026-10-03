import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Divider, Input, QRCode } from "antd";
import { statusText, useAuthStore } from "../stores/auth";

const statusColor: Record<string, string> = {
  pending: "text-zinc-500",
  scanned: "text-amber-600",
  confirmed: "text-emerald-600",
  expired: "text-red-600",
};

export function Component() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const qrcodeUrl = useAuthStore((s) => s.qrcodeUrl);
  const loginStatus = useAuthStore((s) => s.loginStatus);
  const startLogin = useAuthStore((s) => s.startLogin);
  const stopPolling = useAuthStore((s) => s.stopPolling);
  const loginWithCookie = useAuthStore((s) => s.loginWithCookie);
  const { message } = App.useApp();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [cookieSubmitting, setCookieSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      setSessionStarted(true);
      void startLogin();
    }
    return () => stopPolling();
  }, [user, startLogin, stopPolling]);

  const startSession = () => {
    setSessionStarted(true);
    void startLogin();
  };

  const submitCookie = async () => {
    const cookie = cookieInput.trim();
    if (!cookie) {
      message.warning("请先粘贴 Cookie");
      return;
    }
    setCookieSubmitting(true);
    try {
      await loginWithCookie(cookie);
      message.success("Cookie 已应用");
      setCookieInput("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Cookie 应用失败");
    } finally {
      setCookieSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-rose-600 mb-2">
          Bilibili 扫码登录
        </h2>
        <p className="text-sm text-zinc-500 mb-6">
          登录后可下载大会员专属高画质视频
        </p>

        {user && !sessionStarted ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              当前已登录：
              <span className="text-zinc-900 font-medium">{user.name}</span>
            </p>
            <Button type="primary" size="large" onClick={startSession}>
              重新登录
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-48 h-48 mx-auto bg-zinc-100 rounded-lg flex items-center justify-center">
              {qrcodeUrl ? (
                <QRCode
                  value={qrcodeUrl}
                  size={192}
                  status={loginStatus === "expired" ? "expired" : "active"}
                />
              ) : (
                <span className="text-zinc-500 text-sm">加载中...</span>
              )}
            </div>
            <p
              className={`text-sm font-medium ${
                statusColor[loginStatus] ?? "text-zinc-500"
              }`}
            >
              {statusText[loginStatus] ?? loginStatus}
            </p>
            {loginStatus === "expired" && (
              <Button onClick={startSession}>重新获取</Button>
            )}
          </div>
        )}

        <Divider plain className="!my-6 !text-xs !text-zinc-400">
          或 粘贴 Cookie 登录
        </Divider>
        <div className="space-y-2 text-left">
          <Input.TextArea
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder="从浏览器复制 bilibili.com 的整串 Cookie，例如 SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx"
            autoSize={{ minRows: 3, maxRows: 6 }}
            disabled={cookieSubmitting}
          />
          <Button
            type="primary"
            block
            loading={cookieSubmitting}
            onClick={submitCookie}
          >
            使用此 Cookie 登录
          </Button>
          <p className="text-xs text-zinc-400">
            Cookie 将保存到服务端配置并用于后续解析/下载；请仅粘贴你本人的 bilibili.com
            Cookie。
          </p>
        </div>

        <Button className="mt-6" onClick={() => navigate("/")}>
          返回首页
        </Button>
      </div>
    </div>
  );
}
