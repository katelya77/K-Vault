<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface StorageStats {
  used: number
  total: number
  available: number
  userGroup: string
}

const stats = ref<StorageStats | null>(null)
const loading = ref(true)
const error = ref(false)

async function fetchStats() {
  try {
    loading.value = true
    error.value = false
    
    const response = await fetch('/api/storage/stats')
    if (!response.ok) throw new Error('Failed to fetch stats')
    
    stats.value = await response.json()
  } catch (err) {
    console.error('Failed to fetch storage stats:', err)
    error.value = true
  } finally {
    loading.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

function getPercentage(): number {
  if (!stats.value || stats.value.total === 0) return 0
  return Math.round((stats.value.used / stats.value.total) * 100)
}

onMounted(() => {
  fetchStats()
})
</script>

<template>
  <div class="dashboard">
    <h1 class="page-title">仪表盘</h1>
    
    <div class="stats-container">
      <div class="storage-chart">
        <svg class="chart-svg" viewBox="0 0 200 200">
          <circle
            class="chart-bg"
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="#e0e0e0"
            stroke-width="20"
          />
          <circle
            v-if="!loading && !error"
            class="chart-progress"
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="#4a90e2"
            stroke-width="20"
            stroke-linecap="round"
            :stroke-dasharray="`${getPercentage() * 5.03} 503`"
            transform="rotate(-90 100 100)"
          />
          <text x="100" y="90" text-anchor="middle" class="chart-text">
            <tspan v-if="loading" class="loading-text">加载中...</tspan>
            <tspan v-else-if="error" class="error-text">--</tspan>
            <tspan v-else class="percentage">{{ getPercentage() }}%</tspan>
          </text>
          <text x="100" y="115" text-anchor="middle" class="chart-label">
            <tspan v-if="!loading && !error">已使用</tspan>
          </text>
        </svg>
        <div class="chart-info">
          <div class="info-item">
            <span class="info-label">已使用</span>
            <span class="info-value">
              {{ loading ? '--' : error ? '--' : formatSize(stats?.used || 0) }}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">总容量</span>
            <span class="info-value">
              {{ loading ? '--' : error ? '--' : formatSize(stats?.total || 0) }}
            </span>
          </div>
        </div>
      </div>

      <div class="stats-cards">
        <div class="stat-card">
          <div class="card-icon">📊</div>
          <div class="card-content">
            <div class="card-label">可用容量</div>
            <div class="card-value">
              {{ loading ? '--' : error ? '--' : formatSize(stats?.available || 0) }}
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="card-icon">💾</div>
          <div class="card-content">
            <div class="card-label">未使用容量</div>
            <div class="card-value">
              {{ loading ? '--' : error ? '--' : formatSize(stats?.available || 0) }}
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="card-icon">👥</div>
          <div class="card-content">
            <div class="card-label">用户组</div>
            <div class="card-value">
              {{ loading ? '--' : error ? '--' : stats?.userGroup || '--' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.page-title {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 2rem;
  color: #1a1a2e;
}

.stats-container {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 2rem;
  align-items: start;
}

.storage-chart {
  background: white;
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.chart-svg {
  width: 200px;
  height: 200px;
  margin: 0 auto 1.5rem;
  display: block;
}

.chart-bg {
  opacity: 0.3;
}

.chart-progress {
  transition: stroke-dasharray 0.5s ease;
}

.chart-text {
  font-size: 32px;
  font-weight: 600;
  fill: #1a1a2e;
}

.percentage {
  font-size: 32px;
}

.loading-text,
.error-text {
  font-size: 16px;
  fill: #999;
}

.chart-label {
  font-size: 14px;
  fill: #666;
}

.chart-info {
  display: flex;
  justify-content: space-around;
  padding-top: 1rem;
  border-top: 1px solid #e0e0e0;
}

.info-item {
  text-align: center;
}

.info-label {
  display: block;
  font-size: 0.875rem;
  color: #666;
  margin-bottom: 0.25rem;
}

.info-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1a1a2e;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  gap: 1rem;
}

.card-icon {
  font-size: 2.5rem;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f4ff;
  border-radius: 12px;
}

.card-content {
  flex: 1;
}

.card-label {
  font-size: 0.875rem;
  color: #666;
  margin-bottom: 0.25rem;
}

.card-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1a1a2e;
}

@media (max-width: 768px) {
  .stats-container {
    grid-template-columns: 1fr;
  }
  
  .stats-cards {
    grid-template-columns: 1fr;
  }
}
</style>
