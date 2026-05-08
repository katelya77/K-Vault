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
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <h2 class="card-title">存储后端状态</h2>
          
          <div v-if="loading" class="flex justify-center items-center h-48">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
          
          <div v-else-if="error" class="flex justify-center items-center h-48">
            <span class="text-error">加载失败</span>
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
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="flex items-center gap-4">
              <div class="text-4xl">📊</div>
              <div>
                <div class="text-sm opacity-60">已连接后端</div>
                <div class="text-2xl font-bold">
                  {{ loading ? '--' : error ? '--' : connectedBackends.length }}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="flex items-center gap-4">
              <div class="text-4xl">💾</div>
              <div>
                <div class="text-sm opacity-60">存储类型</div>
                <div class="text-2xl font-bold">
                  {{ loading ? '--' : error ? '--' : connectedBackends.length > 0 ? '多云存储' : '未配置' }}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="flex items-center gap-4">
              <div class="text-4xl">🔒</div>
              <div>
                <div class="text-sm opacity-60">认证状态</div>
                <div class="text-2xl font-bold">
                  {{ loading ? '--' : '已启用' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
