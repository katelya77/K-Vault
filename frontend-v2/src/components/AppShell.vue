<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const username = computed(() => authStore.username || 'User')
const userMenuOpen = ref(false)

const sidebarItems = [
  { path: '/dashboard', icon: '📊', label: '仪表盘' },
  { path: '/files', icon: '📁', label: '文件列表' },
  { path: '/trash', icon: '🗑️', label: '回收站' },
  { path: '/settings', icon: '⚙️', label: '用户设置' }
]

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>K-Vault</h2>
      </div>
      <nav class="sidebar-nav">
        <router-link
          v-for="item in sidebarItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </nav>
    </aside>

    <div class="main-container">
      <header class="top-nav">
        <div class="nav-title">K-Vault</div>
        <div 
          class="user-menu"
          @mouseenter="userMenuOpen = true"
          @mouseleave="userMenuOpen = false"
        >
          <div class="user-info">
            <span class="username">{{ username }}</span>
            <span class="dropdown-icon">▼</span>
          </div>
          <Transition name="dropdown">
            <div v-if="userMenuOpen" class="user-dropdown">
              <button @click="handleLogout">退出登录</button>
            </div>
          </Transition>
        </div>
      </header>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 200px;
  background: #1a1a2e;
  color: white;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2d2d44;
}

.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid #2d2d44;
}

.sidebar-header h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.sidebar-nav {
  flex: 1;
  padding: 1rem 0;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 0.75rem 1.5rem;
  color: #a0a0a0;
  text-decoration: none;
  transition: all 0.2s;
}

.nav-item:hover {
  background: #2d2d44;
  color: white;
}

.nav-item.router-link-active {
  background: #4a90e2;
  color: white;
}

.nav-icon {
  margin-right: 0.75rem;
  font-size: 1.2rem;
}

.nav-label {
  font-size: 0.95rem;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.top-nav {
  height: 60px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.nav-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a1a2e;
}

.user-menu {
  position: relative;
}

.user-info {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.user-info:hover {
  background: #f5f5f5;
}

.username {
  margin-right: 0.5rem;
  font-weight: 500;
}

.dropdown-icon {
  font-size: 0.75rem;
  color: #666;
  transition: transform 0.2s ease;
}

.user-menu:hover .dropdown-icon {
  transform: rotate(180deg);
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  z-index: 1001;
  padding: 0.5rem 0;
}

.user-dropdown::before {
  content: '';
  position: absolute;
  top: -14px;
  left: 0;
  right: 0;
  height: 14px;
  background: transparent;
}

.user-dropdown::after {
  content: '';
  position: absolute;
  top: -6px;
  right: 20px;
  width: 12px;
  height: 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-right: none;
  border-bottom: none;
  transform: rotate(45deg);
  z-index: -1;
}

.user-dropdown button {
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
  color: #1a1a2e;
  font-size: 0.95rem;
}

.user-dropdown button:hover {
  background: #f5f5f5;
}

/* 下拉菜单动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.content {
  flex: 1;
  overflow-y: auto;
  background: #f8f9fa;
}
</style>
