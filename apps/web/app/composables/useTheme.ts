export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'anichart-theme'

// 防 FOUC：在 hydration 前同步执行，读 localStorage（无则跟随系统）写到 <html data-theme>。
// 由 app.vue 通过 useHead 注入 <head>。
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`

// 主题状态：真实来源是 <html data-theme>（内联脚本先行写入），
// 组件侧的 ref 仅在 mounted 后同步，避免 SSR/hydration 不一致。
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  onMounted(() => {
    theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme.value
    try {
      localStorage.setItem(STORAGE_KEY, theme.value)
    }
    catch { /* 隐私模式等场景下静默 */ }
  }

  return { theme, toggle }
}
