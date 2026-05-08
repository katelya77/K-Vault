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
  <div class="upload-widget">
    <div v-if="!isExpanded" class="upload-button" @click="toggleExpand">
      <img src="/icons/upload.svg" alt="Upload" class="upload-icon" />
    </div>

    <div v-else class="upload-panel">
        <div class="panel-header">
          <h3>上传列表</h3>
          <div class="header-actions">
            <button class="add-button" @click="triggerFileUpload">+</button>
            <button class="close-button" @click="toggleExpand">×</button>
          </div>
        </div>

        <div class="upload-list">
          <div
            v-for="task in uploadTasks"
            :key="task.id"
            class="upload-item"
          >
            <div class="item-info">
              <span class="item-name">{{ task.fileName }}</span>
              <span class="item-status">{{ task.status }}</span>
            </div>
            <div class="item-progress">
              <div class="progress-bar">
                <div
                  class="progress-fill"
                  :style="{ width: `${task.progress}%` }"
                ></div>
              </div>
              <span class="progress-text">{{ task.progress }}%</span>
            </div>
          </div>

          <div v-if="uploadTasks.length === 0" class="empty-state">
            <p>暂无上传任务</p>
            <p class="hint">点击右上角 + 按钮上传文件</p>
          </div>
        </div>
      </div>
  </div>
</template>

<style scoped>
.upload-widget {
  position: fixed;
  right: 2rem;
  bottom: 2rem;
  z-index: 1000;
}

.upload-button {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #4a90e2;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.4);
  transition: all 0.3s ease;
}

.upload-button:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(74, 144, 226, 0.5);
}

.upload-icon {
  width: 24px;
  height: 24px;
}

.upload-panel {
  width: 320px;
  max-height: 400px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.panel-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1a1a2e;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.add-button,
.close-button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #4a90e2;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  line-height: 1;
  padding: 0;
}

.close-button {
  background: #e0e0e0;
  color: #666;
}

.add-button:hover {
  background: #357abd;
}

.close-button:hover {
  background: #d0d0d0;
}

.upload-list {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.upload-item {
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.item-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.item-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1a1a2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 0.5rem;
}

.item-status {
  font-size: 0.75rem;
  color: #666;
  text-transform: uppercase;
}

.item-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #4a90e2;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: #666;
  min-width: 40px;
  text-align: right;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: #999;
}

.empty-state p {
  margin: 0.5rem 0;
}

.hint {
  font-size: 0.875rem;
  color: #bbb;
}
</style>
