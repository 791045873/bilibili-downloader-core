import { createBrowserRouter } from "react-router";
import App from "./App";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, lazy: () => import("./pages/Home") },
      { path: "parse-result", lazy: () => import("./pages/ParseResult") },
      { path: "parse-result/list", lazy: () => import("./pages/ParseResultList") },
      { path: "video", lazy: () => import("./pages/VideoDetail") },
      { path: "downloading", lazy: () => import("./pages/Downloading") },
      { path: "summary-tasks", lazy: () => import("./pages/AiSummaryTasks") },
      { path: "settings", lazy: () => import("./pages/Settings") },
      { path: "login", lazy: () => import("./pages/Login") },
    ],
  },
]);
