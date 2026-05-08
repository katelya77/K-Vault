<script setup lang="ts">
import { ref } from 'vue'

interface UploadTask {
  id: string
  fileName: string
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
}

const isExpanded = ref(false)
const uploadTasks = ref<UploadTask[]>([])

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function triggerFileUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files) {
      Array.from(files).forEach(file => {
        uploadTasks.value.push({
          id: Date.now().toString(),
          fileName: file.name,
          progress: 0,
          status: 'pending'
        })
      })
    }
  }
  input.click()
}
</script>

<template>
  <div class="fixed bottom-8 right-8 z-50">
    <button
      v-if="!isExpanded"
      class="btn btn-circle btn-primary btn-lg shadow-xl"
      @click="toggleExpand"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    </button>

    <div v-else class="card bg-base-100 shadow-xl w-80">
      <div class="card-body p-0">
        <div class="flex items-center justify-between p-4 border-b border-base-300">
          <h3 class="font-bold">上传列表</h3>
          <div class="flex gap-2">
            <button class="btn btn-circle btn-sm btn-primary" @click="triggerFileUpload">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button class="btn btn-circle btn-sm btn-ghost" @click="toggleExpand">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div class="max-h-80 overflow-y-auto p-4 space-y-2">
          <div
            v-for="task in uploadTasks"
            :key="task.id"
            class="card bg-base-200 compact"
          >
            <div class="card-body">
              <div class="flex justify-between items-center mb-2">
                <span class="font-medium truncate flex-1">{{ task.fileName }}</span>
                <span class="text-xs opacity-60 uppercase ml-2">{{ task.status }}</span>
              </div>
              <progress 
                class="progress progress-primary" 
                :value="task.progress" 
                max="100"
              ></progress>
            </div>
          </div>

          <div v-if="uploadTasks.length === 0" class="text-center py-8 opacity-60">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p>暂无上传任务</p>
            <p class="text-sm mt-1">点击右上角 + 按钮上传文件</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
