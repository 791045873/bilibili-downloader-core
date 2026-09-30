import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Alert, Button, Form, Input } from "antd";
import { useSessionStore } from "../stores/session";

export function Component() {
  const login = useSessionStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setSubmitting(true);
    setError("");
    try {
      await login(values.username.trim(), values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/sign-in" ? from : "/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">登录</h1>
      <p className="mb-6 text-sm text-zinc-500">
        请使用管理员分配的账号登录。
      </p>
      {error && (
        <Alert type="error" showIcon message={error} className="mb-4" />
      )}
      <Form layout="vertical" onFinish={onFinish} autoComplete="off">
        <Form.Item
          label="用户名"
          name="username"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          登录
        </Button>
      </Form>
    </div>
  );
}
