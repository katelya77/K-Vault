<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface FileItem {
  id: string
  name: string
  size: number
  type: string
  storage: string
  uploadedAt: string | null
  folderPath: string
}

interface FolderItem {
  id: string
  name: string
  path: string
  parentId: string | null
  fileCount: number
}

interface Pagination {
  cursor: string | null
  listComplete: boolean
  pageCount: number
  total: number
}

const files = ref<FileItem[]>([])
const folders = ref<FolderItem[]>([])
const currentFolder = ref<FolderItem | null>(null)
const loading = ref(true)
const error = ref(false)
const pagination = ref<Pagination>({
  cursor: null,
  listComplete: true,
  pageCount: 0,
  total: 0
})

const breadcrumb = computed(() => {
  if (!currentFolder.value) return [{ name: '根目录', path: '' }]
  const parts = currentFolder.value.path.split('/').filter(Boolean)
  const result = [{ name: '根目录', path: '' }]
  let path = ''
  for (const part of parts) {
    path = path ? `${path}/${part}` : part
    result.push({ name: part, path })
  }
  return result
})

async function loadFiles(folderId?: string) {
  loading.value = true
  error.value = false

  try {
    const params = new URLSearchParams()
    if (folderId) {
      params.append('folderId', folderId)
    }
    params.append('pageSize', '50')

    const response = await fetch(`/api/v1/files?${params}`)
    const data = await response.json()

    if (data.success) {
      files.value = data.data.files || []
      pagination.value = data.data.pagination
    } else {
      error.value = true
    }
  } catch (err) {
    console.error('Failed to load files:', err)
    error.value = true
  } finally {
    loading.value = false
  }
}

async function loadFolders(parentId?: string | null) {
  try {
    const params = new URLSearchParams()
    if (parentId) {
      params.append('parentId', parentId)
    }

    const response = await fetch(`/api/manage/folders?${params}`)
    const data = await response.json()

    if (data.success) {
      folders.value = data.result || []
    }
  } catch (err) {
    console.error('Failed to load folders:', err)
  }
}

async function navigateToFolder(folder?: FolderItem | null) {
  currentFolder.value = folder || null
  await Promise.all([
    loadFiles(folder?.id),
    loadFolders(folder?.id)
  ])
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️'
  if (type.startsWith('video/')) return '🎬'
  if (type.startsWith('audio/')) return '🎵'
  if (type === 'application/pdf') return '📄'
  if (type.includes('zip') || type.includes('rar')) return '📦'
  return '📁'
}

onMounted(() => {
  loadFiles()
  loadFolders()
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold">文件列表</h1>
        <div class="text-sm breadcrumbs mt-2">
          <ul>
            <li v-for="(item, index) in breadcrumb" :key="item.path">
              <a 
                v-if="index < breadcrumb.length - 1"
                @click="navigateToFolder(item.path ? folders.find(f => f.path === item.path) : null)"
                class="cursor-pointer hover:text-primary"
              >
                {{ item.name }}
              </a>
              <span v-else class="opacity-60">{{ item.name }}</span>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="!loading && !error" class="text-sm opacity-60">
        共 {{ pagination.total }} 个文件
      </div>
    </div>

    <div v-if="loading" class="flex justify-center items-center h-64">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <div v-else-if="error" class="alert alert-error">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>加载失败，请重试</span>
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
      <div
        v-for="folder in folders"
        :key="folder.id"
        class="card bg-base-100 shadow-md hover:shadow-xl transition-shadow cursor-pointer border-l-4 border-primary"
        @click="navigateToFolder(folder)"
      >
        <div class="card-body p-4">
          <div class="text-4xl text-center mb-2">📁</div>
          <div class="text-center">
            <div class="font-medium truncate">{{ folder.name }}</div>
            <div class="text-xs opacity-60">{{ folder.fileCount }} 个文件</div>
          </div>
        </div>
      </div>

      <div
        v-for="file in files"
        :key="file.id"
        class="card bg-base-100 shadow-md hover:shadow-xl transition-shadow cursor-pointer"
      >
        <div class="card-body p-4">
          <div class="text-4xl text-center mb-2">{{ getFileIcon(file.type) }}</div>
          <div>
            <div class="font-medium truncate">{{ file.name }}</div>
            <div class="text-xs opacity-60 flex items-center gap-1">
              <span>{{ formatSize(file.size) }}</span>
              <span>·</span>
              <span>{{ formatDate(file.uploadedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="folders.length === 0 && files.length === 0" class="col-span-full">
        <div class="hero min-h-64 bg-base-200 rounded-lg">
          <div class="hero-content text-center">
            <div class="max-w-md">
              <div class="text-6xl mb-4">📂</div>
              <p class="text-lg opacity-60">暂无文件</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
