<template>
  <div class="app-bg">
    <header class="topbar card">
      <div class="brand-group">
        <span class="brand-dot"></span>
        <div>
          <h1>K-Vault</h1>
          <p>Docker + Cloudflare dual-mode runtime</p>
        </div>
      </div>
      <nav class="nav-row">
        <router-link class="nav-link" to="/v1/upload">Upload</router-link>
        <router-link class="nav-link" to="/v1/drive">Drive</router-link>
        <router-link class="nav-link" to="/v1/storage">Storage</router-link>
        <router-link class="nav-link" to="/v1/status">Status</router-link>
        <a class="nav-link" href="/legacy/index.html" target="_blank" rel="noopener">Legacy</a>
      </nav>
      <div class="toolbar">
        <router-link
          v-if="authStore.authRequired && !authStore.authenticated"
          class="btn btn-ghost"
          to="/v1/login"
        >
          Login
        </router-link>
        <button v-if="authStore.authenticated" class="btn btn-ghost" @click="handleLogout">Logout</button>
      </div>
    </header>

    <section v-if="authStore.guestMode" class="guest-note card">
      <strong>Guest mode enabled.</strong>
      <span>
        Max file size: {{ formatSize(authStore.guestUpload.maxFileSize) }},
        daily limit: {{ authStore.guestUpload.dailyLimit }} uploads.
      </span>
    </section>

    <main class="page-wrap">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const router = useRouter();

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

async function handleLogout() {
  try {
    await authStore.logout();
  } finally {
    router.push('/v1/login');
  }
}
</script>
