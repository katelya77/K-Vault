import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppShell from '../components/AppShell.vue';
import LoginView from '../views/LoginView.vue';
import UploadView from '../views/UploadView.vue';
import DriveView from '../views/DriveView.vue';
import StorageView from '../views/StorageView.vue';
import StatusView from '../views/StatusView.vue';

const routes = [
  {
    path: '/v1/login',
    name: 'login',
    component: LoginView,
    meta: { public: true },
  },
  {
    path: '/v1',
    component: AppShell,
    children: [
      { path: '', redirect: '/v1/upload' },
      { path: 'upload', name: 'upload', component: UploadView },
      { path: 'drive', name: 'drive', component: DriveView, meta: { requiresAdmin: true } },
      { path: 'admin', redirect: '/v1/drive' },
      { path: 'storage', name: 'storage', component: StorageView, meta: { requiresAdmin: true } },
      { path: 'status', name: 'status', component: StatusView },
    ],
  },
  { path: '/', redirect: '/v1/upload' },
  { path: '/login', redirect: '/v1/login' },
  { path: '/upload', redirect: '/v1/upload' },
  { path: '/drive', redirect: '/v1/drive' },
  { path: '/admin', redirect: '/v1/drive' },
  { path: '/storage', redirect: '/v1/storage' },
  { path: '/status', redirect: '/v1/status' },
  { path: '/:pathMatch(.*)*', redirect: '/v1/upload' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();
  if (!authStore.initialized) {
    await authStore.refresh();
  }

  if (to.name === 'login') {
    if (!authStore.authRequired || authStore.authenticated) {
      const target = typeof to.query.redirect === 'string' ? to.query.redirect : '/v1/upload';
      return target;
    }
    return true;
  }

  if (to.meta.requiresAdmin && authStore.authRequired && !authStore.authenticated) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    };
  }

  return true;
});

export default router;
