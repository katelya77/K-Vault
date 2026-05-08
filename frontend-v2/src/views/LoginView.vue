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
  <div class="hero min-h-screen bg-base-300">
    <div class="hero-content flex-col lg:flex-row-reverse gap-12">
      <div class="text-center lg:text-left">
        <h1 class="text-5xl font-bold whitespace-nowrap">K-Vault</h1>
        <p class="py-6 text-lg whitespace-nowrap">免费图片/文件托管解决方案</p>
      </div>
      <div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
        <div class="card-body">
          <form @submit.prevent="submit">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">用户名</span>
              </label>
              <input 
                type="text" 
                placeholder="username" 
                class="custom-input w-full"
                v-model="username"
                required
                :disabled="submitting"
              />
            </div>
            <div class="form-control mt-6">
              <label class="label">
                <span class="label-text font-medium">密码</span>
              </label>
              <input 
                type="password" 
                placeholder="password" 
                class="custom-input w-full"
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
            
            <div class="form-control mt-8">
              <button 
                type="submit" 
                class="btn btn-primary btn-lg btn-wide shadow-lg hover:shadow-xl transition-shadow"
                :disabled="submitting"
              >
                <span v-if="submitting" class="loading loading-spinner loading-lg"></span>
                <span v-else class="text-lg font-bold">登录</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-input {
  padding: 0.75rem 0;
  font-size: 1.125rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid oklch(var(--bc) / 0.5);
  outline: none;
  border-radius: 0;
}

.custom-input:focus {
  border-bottom-color: oklch(var(--p));
  border-bottom-width: 3px;
}

.custom-input::placeholder {
  color: oklch(var(--bc) / 0.25);
  font-size: 1rem;
}

.custom-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
