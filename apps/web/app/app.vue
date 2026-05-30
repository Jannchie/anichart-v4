<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const session = authClient.useSession()
</script>

<template>
  <div class="app">
    <header class="nav">
      <NuxtLink to="/" class="brand">
        AniChart
      </NuxtLink>
      <nav class="links">
        <NuxtLink to="/">
          发现
        </NuxtLink>
        <NuxtLink to="/upload">
          上传
        </NuxtLink>
        <NuxtLink to="/dashboard">
          我的作品
        </NuxtLink>
        <NuxtLink v-if="!session.data" to="/login">
          登录
        </NuxtLink>
        <span v-else class="user">{{ session.data.user.name }}</span>
      </nav>
    </header>
    <main class="content">
      <NuxtPage />
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; }
.nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; border-bottom: 1px solid #eee; }
.brand { font-weight: 700; font-size: 18px; text-decoration: none; color: inherit; }
.links { display: flex; gap: 16px; align-items: center; }
.links a { text-decoration: none; color: #555; }
.links a.router-link-active { color: #1a1a1a; font-weight: 600; }
.content { max-width: 1100px; margin: 0 auto; padding: 24px; }
</style>
