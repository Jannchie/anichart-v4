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
    await navigateTo('/dashboard')
}
</script>

<template>
  <section class="auth">
    <h1>{{ mode === 'sign-in' ? '登录' : '注册' }}</h1>
    <form @submit.prevent="submit">
      <input v-if="mode === 'sign-up'" v-model="name" placeholder="昵称" required>
      <input v-model="email" type="email" placeholder="邮箱" required>
      <input v-model="password" type="password" placeholder="密码" required>
      <button type="submit">
        提交
      </button>
    </form>
    <p class="switch" @click="mode = mode === 'sign-in' ? 'sign-up' : 'sign-in'">
      {{ mode === 'sign-in' ? '没有账号？去注册' : '已有账号？去登录' }}
    </p>
    <p v-if="message" class="err">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.auth { max-width: 320px; }
form { display: flex; flex-direction: column; gap: 12px; }
input, button { padding: 10px; font-size: 14px; }
.switch { color: #2563eb; cursor: pointer; }
.err { color: #dc2626; }
</style>
