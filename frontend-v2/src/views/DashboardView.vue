<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface StorageBackend {
  connected: boolean
  enabled: boolean
  configured: boolean
  layer: string
  message: string
}

interface StatusData {
  telegram?: StorageBackend
  kv?: StorageBackend
  r2?: StorageBackend
  s3?: StorageBackend
  discord?: StorageBackend
  huggingface?: StorageBackend
  webdav?: StorageBackend
  github?: StorageBackend
  storage?: {
    used: number
    total: number
    userGroup: string
  }
}

const statusData = ref<StatusData | null>(null)
const loading = ref(true)
const error = ref(false)

const connectedBackends = computed(() => {
  if (!statusData.value) return []
  
  const backends: { name: string; status: StorageBackend }[] = []
  
  if (statusData.value.telegram?.connected) {
    backends.push({ name: 'Telegram', status: statusData.value.telegram })
  }
  if (statusData.value.r2?.connected) {
    backends.push({ name: 'R2', status: statusData.value.r2 })
  }
  if (statusData.value.s3?.connected) {
    backends.push({ name: 'S3', status: statusData.value.s3 })
  }
  if (statusData.value.discord?.connected) {
    backends.push({ name: 'Discord', status: statusData.value.discord })
  }
  if (statusData.value.huggingface?.connected) {
    backends.push({ name: 'HuggingFace', status: statusData.value.huggingface })
  }
  if (statusData.value.webdav?.connected) {
    backends.push({ name: 'WebDAV', status: statusData.value.webdav })
  }
  if (statusData.value.github?.connected) {
    backends.push({ name: 'GitHub', status: statusData.value.github })
  }
  
  return backends
})

function getPercentage(): number {
  if (!statusData.value?.storage || statusData.value.storage.total === 0) return 0
  return Math.round((statusData.value.storage.used / statusData.value.storage.total) * 100)
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)
  
  if (i >= 3) {
    return `${size.toFixed(2).replace(/\.?0+$/, '')} ${sizes[i]}`
  }
  return `${parseFloat(size.toFixed(2))} ${sizes[i]}`
}

function formatAvailable(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)
  
  const formatted = size.toFixed(2)
  const trimmed = formatted.replace(/\.?0+$/, '')
  
  return `${trimmed} ${sizes[i]}`
}

async function fetchStats() {
  loading.value = true
  error.value = false

  try {
    const response = await fetch('/api/status')
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    statusData.value = data
  } catch (err) {
    console.error('Failed to fetch stats:', err)
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchStats()
})
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-3xl font-bold">仪表盘</h1>
    
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card bg-base-100 shadow-xl dashboard-card">
        <div class="card-body">
          <h2 class="card-title">存储后端状态</h2>
          
          <div v-if="loading" class="flex justify-center items-center h-48">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
          
          <div v-else-if="error" class="flex justify-center items-center h-48">
            <span class="text-error text-lg">后端连接失败</span>
          </div>
          
          <div v-else-if="connectedBackends.length === 0" class="flex flex-col items-center justify-center h-48">
            <div class="text-6xl mb-4">📭</div>
            <p class="text-lg opacity-60">暂无已连接的存储后端</p>
          </div>
          
          <div v-else class="space-y-3">
            <div 
              v-for="backend in connectedBackends" 
              :key="backend.name"
              class="flex items-center justify-between p-4 bg-base-200 rounded-lg"
            >
              <div class="flex items-center gap-3">
                <div class="text-success text-2xl">✓</div>
                <div>
                  <div class="font-semibold">{{ backend.name }}</div>
                  <div class="text-sm opacity-60">{{ backend.status.message }}</div>
                </div>
              </div>
              <div class="badge badge-success gap-2">
                <span class="text-xs">已连接</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="space-y-4">
        <div class="card bg-base-100 shadow-xl dashboard-card">
          <div class="card-body">
            <h2 class="card-title mb-4">存储空间</h2>
            
            <div v-if="loading" class="flex justify-center items-center h-48">
              <span class="loading loading-spinner loading-lg"></span>
            </div>
            
            <div v-else class="flex flex-col items-center py-4">
              <div class="relative inline-flex items-center justify-center">
                <div class="absolute w-56 h-56 rounded-full border-[1.5rem] border-base-300"></div>
                <div 
                  class="radial-progress text-primary" 
                  :style="{
                    '--value': error ? 0 : getPercentage(),
                    '--size': '14rem',
                    '--thickness': '1.5rem'
                  }"
                  :aria-valuenow="error ? 0 : getPercentage()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  role="progressbar"
                >
                  <div class="text-center">
                    <div class="text-sm opacity-60 mb-1">存储空间</div>
                    <div class="text-xl font-bold mb-1">
                      {{ error ? '-- / --' : `${formatSize(statusData?.storage?.used || 0)} / ${formatSize(statusData?.storage?.total || 0)}` }}
                    </div>
                    <div class="text-sm opacity-60">
                      可用：{{ error ? '--' : formatAvailable((statusData?.storage?.total || 0) - (statusData?.storage?.used || 0)) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl dashboard-card">
          <div class="card-body">
            <div class="flex items-center gap-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <div>
                <div class="text-sm opacity-60">用户组</div>
                <div class="text-2xl font-bold">
                  {{ loading ? '--' : error ? '--' : statusData?.storage?.userGroup || '--' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-card {
  transition: transform 0.2s, box-shadow 0.2s;
}

.dashboard-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -8px oklch(var(--bc) / 0.15);
}
</style>
