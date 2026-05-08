<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  
  submitting.value = true
  error.value = ''
  
  try {
    await authStore.login(username.value, password.value)
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    router.push(target)
  } catch (err: any) {
    error.value = err.message || 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="hero min-h-screen bg-base-200">
    <div class="hero-content flex-col lg:flex-row-reverse">
      <div class="text-center lg:text-left">
        <h1 class="text-5xl font-bold">K-Vault</h1>
        <p class="py-6">免费图片/文件托管解决方案</p>
      </div>
      <div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
        <div class="card-body">
          <form @submit.prevent="submit">
            <div class="form-control">
              <label class="label">
                <span class="label-text">用户名</span>
              </label>
              <input 
                type="text" 
                placeholder="username" 
                class="input input-bordered" 
                v-model="username"
                required
                :disabled="submitting"
              />
            </div>
            <div class="form-control mt-4">
              <label class="label">
                <span class="label-text">密码</span>
              </label>
              <input 
                type="password" 
                placeholder="password" 
                class="input input-bordered" 
                v-model="password"
                required
                :disabled="submitting"
              />
            </div>
            
            <div v-if="error" class="alert alert-error mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{{ error }}</span>
            </div>
            
            <div class="form-control mt-6">
              <button 
                type="submit" 
                class="btn btn-primary"
                :disabled="submitting"
              >
                <span v-if="submitting" class="loading loading-spinner"></span>
                {{ submitting ? '登录中...' : '登录' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
