<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = computed(() => authStore.username || 'User')

const pageTitle = computed(() => {
  const title = route.meta?.title as string
  return title || 'K-Vault'
})

const sidebarItems = [
  { path: '/dashboard', icon: '📊', label: '仪表盘' },
  { path: '/files', icon: '📁', label: '文件列表' }
]

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="drawer lg:drawer-open">
    <input id="my-drawer" type="checkbox" class="drawer-toggle" />
    
    <div class="drawer-content flex flex-col">
      <div class="navbar bg-base-100 shadow-md border-b border-base-300">
        <div class="flex-none lg:hidden">
          <label for="my-drawer" class="btn btn-square btn-ghost">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-6 h-6 stroke-current">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </label>
        </div>
        
        <div class="flex-1">
          <span class="text-xl font-semibold">{{ pageTitle }}</span>
        </div>
        
        <div class="flex-none">
          <div class="dropdown dropdown-end dropdown-hover user-menu">
            <div tabindex="0" role="button" class="btn btn-ghost gap-2">
              <span>{{ username }}</span>
              <svg 
                class="w-4 h-4 arrow-icon"
                xmlns="http://www.w3.org/2000/svg" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <ul 
              tabindex="0" 
              class="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-40 border border-base-300 dropdown-menu"
            >
              <li><a class="whitespace-nowrap" @click="handleLogout">退出登录</a></li>
            </ul>
          </div>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto p-6">
        <router-view />
      </div>
    </div>
    
    <div class="drawer-side">
      <label for="my-drawer" class="drawer-overlay"></label>
      <aside class="bg-base-300 w-64 min-h-screen">
        <div class="p-4 border-b border-base-content/10">
          <h2 class="text-xl font-bold">K-Vault</h2>
        </div>
        <ul class="menu">
          <li v-for="item in sidebarItems" :key="item.path" class="px-4 py-1">
            <router-link 
              :to="item.path"
              class="gap-3"
              :class="{ 'active': route.path === item.path }"
            >
              <span class="text-xl">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </router-link>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.user-menu:hover .arrow-icon {
  transform: rotate(180deg);
}

.arrow-icon {
  transition: transform 0.2s ease;
}

.dropdown-menu {
  animation: dropdown-slide 0.2s ease;
}

@keyframes dropdown-slide {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.menu:not(.dropdown-menu) {
  width: 100%;
}

.menu:not(.dropdown-menu) li {
  width: 100%;
}

.menu:not(.dropdown-menu) li a {
  width: 100%;
  display: flex;
  border-radius: 0.5rem;
  transition: transform 0.2s, box-shadow 0.2s;
}

.menu:not(.dropdown-menu) li a.router-link-active,
.menu:not(.dropdown-menu) li a.active {
  font-weight: 700;
}

.menu:not(.dropdown-menu) li a:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px oklch(var(--bc) / 0.1);
}
</style>
