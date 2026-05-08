<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './components/AppShell.vue'
import UploadWidget from './components/UploadWidget.vue'
import LoginView from './views/LoginView.vue'

const route = useRoute()
const isLoginPage = computed(() => route.name === 'login')
</script>

<template>
  <div data-theme="light" class="min-h-screen bg-base-200">
    <LoginView v-if="isLoginPage" />
    <AppShell v-else />
    <UploadWidget v-if="!isLoginPage" />
  </div>
</template>
