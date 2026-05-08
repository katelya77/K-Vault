<template>
  <div class="app-bg login-page">
    <section class="card login-card">
      <h1>Sign In</h1>
      <p class="muted">Use BASIC_USER/BASIC_PASS configured on the backend.</p>

      <form class="form-grid" @submit.prevent="submit">
        <label>
          Username
          <input v-model.trim="username" autocomplete="username" required />
        </label>
        <label>
          Password
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="btn" :disabled="submitting">
          {{ submitting ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p class="muted link-row">
        Need the old page?
        <a href="/login.html" target="_blank" rel="noopener">Open legacy login</a>
      </p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref('');

onMounted(async () => {
  if (!authStore.initialized) {
    await authStore.refresh();
  }

  if (!authStore.authRequired || authStore.authenticated) {
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/upload';
    router.replace(target);
  }
});

async function submit() {
  submitting.value = true;
  error.value = '';
  try {
    await authStore.login(username.value, password.value);
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/v1/upload';
    router.push(target);
  } catch (err) {
    error.value = err.message || 'Login failed';
  } finally {
    submitting.value = false;
  }
}
</script>