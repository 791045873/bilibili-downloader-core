import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Table, Tag } from "antd";
import type { TableProps } from "antd";
import * as api from "../api";
import type { AppUserListItem, AppUserRole } from "../types";
import { useSessionStore } from "../stores/session";

interface CreateFormValues {
  username: string;
  password: string;
  role: AppUserRole;
}

export function Component() {
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((s) => s.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<CreateFormValues>();

  const usersQuery = useQuery({
    queryKey: ["app-users"],
    queryFn: () => api.listAppUsers(),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["app-users"] });
  }

  async function onCreate(values: CreateFormValues) {
    setSubmitting(true);
    setError("");
    try {
      await api.createAppUser({
        username: values.username.trim(),
        password: values.password,
        role: values.role,
      });
      setCreateOpen(false);
      form.resetFields();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDisable(user: AppUserListItem) {
    setError("");
    try {
      await api.disableAppUser(user.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "禁用失败");
    }
  }

  const columns: TableProps<AppUserListItem>["columns"] = [
    { title: "用户名", dataIndex: "username", key: "username" },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      render: (role: string) => (
        <Tag color={role === "admin" ? "red" : "blue"}>{role}</Tag>
      ),
    },
    {
      title: "状态",
      key: "status",
      render: (_, row) =>
        row.disabledAt ? (
          <Tag color="default">已禁用</Tag>
        ) : (
          <Tag color="green">正常</Tag>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (value?: string) =>
        value ? new Date(value).toLocaleString("zh-CN") : "-",
    },
    {
      title: "操作",
      key: "actions",
      render: (_, row) => (
        <Button
          type="link"
          danger
          size="small"
          disabled={Boolean(row.disabledAt) || row.id === currentUser?.id}
          onClick={() => {
            Modal.confirm({
              title: `禁用用户 ${row.username}？`,
              content: "禁用后其会话立即失效，且无法再登录。",
              okButtonProps: { danger: true },
              onOk: () => onDisable(row),
            });
          }}
        >
          禁用
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">用户管理</h1>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建用户
        </Button>
      </div>
      {error && (
        <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />
      )}
      <Table<AppUserListItem>
        rowKey="id"
        size="small"
        loading={usersQuery.isLoading}
        dataSource={usersQuery.data?.users ?? []}
        columns={columns}
        pagination={false}
      />
      <Modal
        open={createOpen}
        title="新建用户"
        okText="创建"
        confirmLoading={submitting}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: "user" }}
          onFinish={onCreate}
          autoComplete="off"
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: "请输入用户名" },
              {
                pattern: /^[A-Za-z0-9._-]{3,32}$/,
                message: "3-32 位字母、数字、. _ -",
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: "请输入初始密码" },
              { min: 8, max: 200, message: "密码 8-200 位" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "user", label: "普通用户（QA + AI 总结）" },
                { value: "admin", label: "管理员（全部权限）" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
