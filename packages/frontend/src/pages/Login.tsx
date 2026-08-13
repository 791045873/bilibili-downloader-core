import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Button, QRCode } from "antd";
import { statusText, useAuthStore } from "../stores/auth";

const statusColor: Record<string, string> = {
  pending: "text-zinc-500",
  scanned: "text-amber-600",
  confirmed: "text-emerald-600",
  expired: "text-red-600",
};

export function Component() {
  const navigate = useNavigate();
  const qrcodeUrl = useAuthStore((s) => s.qrcodeUrl);
  const loginStatus = useAuthStore((s) => s.loginStatus);
  const startLogin = useAuthStore((s) => s.startLogin);
  const stopPolling = useAuthStore((s) => s.stopPolling);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return (
    <div className="max-w-md mx-auto">
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-rose-600 mb-2">
          Bilibili 扫码登录
        </h2>
        <p className="text-sm text-zinc-500 mb-6">
          登录后可下载大会员专属高画质视频
        </p>

        <div>
          <Button type="primary" size="large" onClick={() => void startLogin()}>
            获取登录二维码
          </Button>
        </div>

        <div className="space-y-4 mt-4">
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
            <Button onClick={() => void startLogin()}>重新获取</Button>
          )}
        </div>

        <Button className="mt-6" onClick={() => navigate("/")}>
          返回首页
        </Button>
      </div>
    </div>
  );
}
