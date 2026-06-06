<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const mode = ref<'sign-in' | 'sign-up'>('sign-in')
const email = ref('')
const password = ref('')
const name = ref('')
const message = ref('')

async function submit() {
  message.value = ''
  const fn = mode.value === 'sign-in'
    ? authClient.signIn.email({ email: email.value, password: password.value })
    : authClient.signUp.email({ email: email.value, password: password.value, name: name.value })
  const { error } = await fn
  if (error)
    message.value = error.message ?? '操作失败'
  else
    await navigateTo('/studio')
}
</script>

<template>
  <section class="auth-wrap">
    <div class="auth card">
      <h1 class="auth-title">
        {{ mode === 'sign-in' ? '登录' : '注册' }}
      </h1>
      <p class="dim auth-sub">
        {{ mode === 'sign-in' ? '欢迎回来，继续你的创作' : '注册一个账号，同步你的作品' }}
      </p>
      <form class="auth-form" @submit.prevent="submit">
        <input v-if="mode === 'sign-up'" v-model="name" class="input" placeholder="昵称" required>
        <input v-model="email" type="email" class="input" placeholder="邮箱" required>
        <input v-model="password" type="password" class="input" placeholder="密码" required>
        <button type="submit" class="btn btn-primary">
          {{ mode === 'sign-in' ? '登录' : '注册' }}
        </button>
      </form>
      <button class="auth-switch" type="button" @click="mode = mode === 'sign-in' ? 'sign-up' : 'sign-in'">
        {{ mode === 'sign-in' ? '没有账号？去注册' : '已有账号？去登录' }}
      </button>
      <p v-if="message" class="auth-err">
        {{ message }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.auth-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
.auth { width: min(380px, 100%); padding: 32px 28px; }
.auth-title { font-size: 22px; }
.auth-sub { margin-top: 6px; font-size: 13px; }
.auth-form { margin-top: 22px; display: flex; flex-direction: column; gap: 12px; }
.auth-switch {
  margin-top: 16px; padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--accent);
}
.auth-switch:hover { text-decoration: underline; }
.auth-err { margin-top: 12px; font-size: 13px; color: var(--danger); }
</style>
