<script setup lang="ts">
import { useRoute } from "vue-router";
import { computed, onMounted } from "vue";
import { useAuthStore } from "./stores/auth";
import { storeToRefs } from "pinia";

const route = useRoute();
const isHome = computed(() => route.name === "home");

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

function imageSrc(url?: string): string {
  if (!url) return "";
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

onMounted(() => {
  authStore.checkLogin();
});
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <!-- Header -->
    <header class="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur">
      <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <router-link to="/" class="text-lg font-bold text-rose-500 hover:text-rose-400 transition-colors">
          Bilibili 下载器
        </router-link>
        <nav class="flex items-center gap-3">
          <router-link
            to="/downloading"
            class="px-3 py-1.5 rounded-md text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            下载队列
          </router-link>
          <router-link
            to="/summary-tasks"
            class="px-3 py-1.5 rounded-md text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            AI 总结任务
          </router-link>
          <router-link
            to="/settings"
            class="px-3 py-1.5 rounded-md text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            设置
          </router-link>

          <!-- 登录状态 -->
          <router-link
            v-if="!user"
            to="/login"
            class="px-3 py-1.5 rounded-md text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            登录
          </router-link>
          <div v-else class="flex items-center gap-2">
            <img
              :src="imageSrc(user.face)"
              :alt="user.name"
              class="w-7 h-7 rounded-full object-cover border border-zinc-700"
            />
            <span class="text-sm text-zinc-300">{{ user.name }}</span>
          </div>
        </nav>
      </div>
    </header>

    <!-- Main -->
    <main class="max-w-5xl mx-auto px-4 py-6">
      <router-view />
    </main>
  </div>
</template>