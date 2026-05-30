<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const session = authClient.useSession()

async function signOut() {
  await authClient.signOut()
  await navigateTo('/')
}
</script>

<template>
  <section>
    <h1>我的作品</h1>
    <p v-if="!session.data" class="hint">
      请先<NuxtLink to="/login">
        登录
      </NuxtLink>。
    </p>
    <template v-else>
      <p>你好，{{ session.data.user.name }}。</p>
      <!-- TODO(future): 列出当前用户的作品，支持编辑可见性 / 进入配置页 / 导出视频 -->
      <p class="hint">
        作品列表待实现。
      </p>
      <button @click="signOut">
        退出登录
      </button>
    </template>
  </section>
</template>

<style scoped>
.hint { color: #777; }
</style>
