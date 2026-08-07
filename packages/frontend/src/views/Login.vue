<script setup lang="ts">
import { onUnmounted, onUpdated, ref } from "vue";
import { useRouter } from "vue-router";
import { statusText, useAuthStore } from "../stores/auth";
import { storeToRefs } from "pinia";
import { useQRCode } from '@vueuse/integrations/useQRCode'

const store = useAuthStore();
const { qrcodeUrl, loginStatus } = storeToRefs(store)
const router = useRouter();
onUnmounted(() => store.stopPolling());

const qrcode = useQRCode(qrcodeUrl)
</script>

<template>
  <div class="max-w-md mx-auto">
    <div class="rounded-lg border border-zinc-200 bg-white p-8 text-center">
      <h2 class="text-lg font-semibold text-rose-600 mb-2">Bilibili 扫码登录</h2>
      <p class="text-sm text-zinc-500 mb-6">登录后可下载大会员专属高画质视频</p>

      <div>
        <button
          class="rounded-md bg-rose-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-rose-500 transition-colors"
          @click="store.startLogin"
        >
          获取登录二维码
        </button>
      </div>
      <div class="space-y-4">
        <div class="w-48 h-48 mx-auto bg-zinc-100 rounded-lg flex items-center justify-center">
          <span v-if="!qrcodeUrl" class="text-zinc-500 text-sm">加载中...</span>
          <img v-else :src="qrcode" alt="登录二维码" class="w-full h-full object-contain rounded-lg" />
        </div>
        <p class="text-sm font-medium" :class="{
          'text-zinc-500': loginStatus === 'pending',
          'text-amber-600': loginStatus === 'scanned',
          'text-emerald-600': loginStatus === 'confirmed',
          'text-red-600': loginStatus === 'expired',
        }">
          {{ statusText[loginStatus] }}
        </p>
        <button
          v-if="loginStatus === 'expired'"
          class="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
          @click="store.startLogin"
        >
          重新获取
        </button>
      </div>

      <button
        class="mt-6 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 hover:border-zinc-400 transition-colors"
        @click="router.push('/')"
      >
        返回首页
      </button>
    </div>
  </div>
</template>