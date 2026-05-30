import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'AniChart v4',
  description: '动画图表框架的技术文档',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: '参考', link: '/reference/bar-chart' },
      { text: 'GitHub', link: 'https://github.com/jannchie/anichart-v4' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '基础',
          items: [
            { text: '快速上手', link: '/guide/getting-started' },
            { text: '数据准备', link: '/guide/data-preparation' },
            { text: '样式定制', link: '/guide/customization' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API',
          items: [
            { text: 'BarChart', link: '/reference/bar-chart' },
            { text: 'Config', link: '/reference/config' },
            { text: 'DataProcessor', link: '/reference/data-processor' },
          ],
        },
      ],
    },
    outline: {
      level: [2, 3],
      label: '目录',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/jannchie/anichart-v4' },
    ],
  },
})
