import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("../views/Home.vue") },
    {
      path: "/parse-result",
      name: "parse-result",
      component: () => import("../views/ParseResult.vue"),
    },
    {
      path: "/parse-result/list",
      name: "parse-result-list",
      component: () => import("../views/ParseResultList.vue"),
    },
    {
      path: "/video",
      name: "video",
      component: () => import("../views/VideoDetail.vue"),
    },
    {
      path: "/downloading",
      name: "downloading",
      component: () => import("../views/Downloading.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/Settings.vue"),
    },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/Login.vue"),
    },
  ],
});

export default router;
