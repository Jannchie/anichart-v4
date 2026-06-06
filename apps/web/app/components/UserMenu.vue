<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

// 顶栏用户区：未登录给登录按钮；已登录头像 + 下拉菜单。
const session = authClient.useSession()
const open = ref(false)
const wrap = ref<HTMLElement>()

const user = computed(() => session.value?.data?.user ?? null)
const initial = computed(() => (user.value?.name?.[0] ?? '?').toUpperCase())

function onDocClick(e: MouseEvent) {
  if (open.value && wrap.value && !wrap.value.contains(e.target as Node))
    open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function signOut() {
  open.value = false
  await authClient.signOut()
  await navigateTo('/')
}
</script>

<template>
  <div ref="wrap" class="user-menu">
    <NuxtLink v-if="!user" to="/login" class="btn btn-primary btn-sm login-btn">
      登录
    </NuxtLink>

    <template v-else>
      <button class="avatar-btn" type="button" :title="user.name" @click="open = !open">
        <img v-if="user.image" :src="user.image" :alt="user.name" class="avatar-img">
        <span v-else class="avatar-fallback">{{ initial }}</span>
      </button>

      <Transition name="fade">
        <div v-if="open" class="menu card">
          <div class="menu-head">
            <strong class="menu-name">{{ user.name }}</strong>
            <span class="dim menu-mail">{{ user.email }}</span>
          </div>
          <NuxtLink :to="`/u/${user.id}`" class="menu-item" @click="open = false">
            我的频道
          </NuxtLink>
          <NuxtLink to="/studio" class="menu-item" @click="open = false">
            工作室
          </NuxtLink>
          <button class="menu-item menu-danger" type="button" @click="signOut">
            退出登录
          </button>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.user-menu { position: relative; display: flex; align-items: center; }
.login-btn { border-radius: 999px; }

.avatar-btn {
  width: 32px; height: 32px; padding: 0; border: 1px solid var(--border-strong);
  border-radius: 50%; overflow: hidden; cursor: pointer; background: var(--surface-2);
  display: inline-flex; align-items: center; justify-content: center;
}
.avatar-img { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback { font-size: 14px; font-weight: 650; color: var(--text-2); }

.menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
  min-width: 200px; padding: 6px; box-shadow: var(--shadow-lg);
}
.menu-head { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px 10px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.menu-name { font-size: 14px; }
.menu-mail { font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.menu-item {
  display: block; width: 100%; padding: 8px 10px; text-align: left;
  font-family: inherit; font-size: 13.5px; color: var(--text);
  background: none; border: none; border-radius: var(--r-sm); cursor: pointer;
  transition: background 0.12s ease;
}
.menu-item:hover { background: var(--surface-2); }
.menu-danger { color: var(--danger); }
</style>
