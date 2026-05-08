import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const authRequired = ref(true)
  const initialized = ref(false)
  const username = ref('')

  const isAuthenticated = computed(() => authenticated.value)

  async function checkAuth() {
    try {
      const response = await fetch('/api/auth/check')
      const data = await response.json()
      authRequired.value = data.authRequired ?? true
      authenticated.value = data.authenticated ?? false
      initialized.value = true
    } catch (error) {
      console.error('Auth check failed:', error)
      authRequired.value = true
      authenticated.value = false
      initialized.value = true
    }
  }

  async function login(usernameInput: string, password: string) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Login failed')
    }
    
    authenticated.value = true
    username.value = usernameInput
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    authenticated.value = false
    username.value = ''
  }

  return {
    authenticated,
    authRequired,
    initialized,
    username,
    isAuthenticated,
    checkAuth,
    login,
    logout
  }
})
