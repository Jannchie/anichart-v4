// better-auth 的全部端点（注册/登录/会话等）统一挂在 /api/auth/**
export default defineEventHandler(event => useAuth().handler(toWebRequest(event)))
