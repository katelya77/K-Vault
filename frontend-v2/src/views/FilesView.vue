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

async function navigateToFolder(folder?: FolderItem) {
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
  <div class="files-view">
    <div class="header">
      <h1>文件列表</h1>
      <div class="breadcrumb">
        <span
          v-for="(item, index) in breadcrumb"
          :key="item.path"
          class="breadcrumb-item"
          :class="{ clickable: index < breadcrumb.length - 1 }"
          @click="index < breadcrumb.length - 1 && navigateToFolder(item.path ? folders.find(f => f.path === item.path) : null)"
        >
          {{ item.name }}
          <span v-if="index < breadcrumb.length - 1" class="separator">/</span>
        </span>
      </div>
    </div>

    <div class="toolbar">
      <div class="stats">
        <span v-if="!loading && !error">
          共 {{ pagination.total }} 个文件
        </span>
      </div>
    </div>

    <div class="content">
      <div v-if="loading" class="loading">
        <p>加载中...</p>
      </div>

      <div v-else-if="error" class="error">
        <p>加载失败，请重试</p>
      </div>

      <div v-else class="file-grid">
        <div
          v-for="folder in folders"
          :key="folder.id"
          class="file-item folder"
          @click="navigateToFolder(folder)"
        >
          <div class="icon">📁</div>
          <div class="info">
            <div class="name">{{ folder.name }}</div>
            <div class="meta">{{ folder.fileCount }} 个文件</div>
          </div>
        </div>

        <div
          v-for="file in files"
          :key="file.id"
          class="file-item"
        >
          <div class="icon">{{ getFileIcon(file.type) }}</div>
          <div class="info">
            <div class="name">{{ file.name }}</div>
            <div class="meta">
              <span>{{ formatSize(file.size) }}</span>
              <span class="dot">·</span>
              <span>{{ formatDate(file.uploadedAt) }}</span>
            </div>
          </div>
        </div>

        <div v-if="folders.length === 0 && files.length === 0" class="empty">
          <p>暂无文件</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.files-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
}

.header {
  padding: 1.5rem 2rem;
  background: white;
  border-bottom: 1px solid #e0e0e0;
}

.header h1 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #1a1a2e;
}

.breadcrumb {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  color: #666;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
}

.breadcrumb-item.clickable {
  cursor: pointer;
  color: #4a90e2;
}

.breadcrumb-item.clickable:hover {
  text-decoration: underline;
}

.separator {
  margin: 0 0.5rem;
  color: #999;
}

.toolbar {
  padding: 1rem 2rem;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stats {
  font-size: 0.875rem;
  color: #666;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 2rem;
}

.loading,
.error,
.empty {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  color: #999;
}

.error {
  color: #e74c3c;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.file-item {
  background: white;
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid #e0e0e0;
}

.file-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.file-item.folder {
  border-left: 3px solid #4a90e2;
}

.icon {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
  text-align: center;
}

.info {
  min-width: 0;
}

.name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1a1a2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 0.25rem;
}

.meta {
  font-size: 0.75rem;
  color: #999;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.dot {
  color: #ccc;
}
</style>
